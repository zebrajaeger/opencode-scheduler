import { afterEach, expect, test, vi } from "vitest";
import { Automations } from "../src/automations.js";
import { Scheduler } from "../src/scheduler.js";
import { memoryStorage, record } from "./automation-store.test.js";
import { hostFixture } from "./automation-host.test.js";
import { AutomationStore } from "../src/automation-store.js";
import { sessionInfo, deferred } from "./helpers.js";
import { readFileSync } from "node:fs";

const instances: { runtime: Automations; scheduler: Scheduler }[] = [];
afterEach(() => { instances.forEach(({ runtime, scheduler }) => { runtime.close(); scheduler.close(); }); instances.length = 0; vi.useRealTimers(); });
async function fixture(missedPolicy: "skip" | "catch-up-once" = "skip", now = 100_000) {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const memory = memoryStorage(), h = hostFixture(), r = { ...record(), missedPolicy };
  const store = new AutomationStore(memory.storage, r.owner); await store.load(); await store.mutate(r.id, () => ({ record: r, result: undefined }));
  const scheduler = new Scheduler(); const runtime = new Automations(store, h.host, scheduler); instances.push({ runtime, scheduler });
  return { ...memory, ...h, store, scheduler, runtime };
}

test("activation skips inactive occurrences by default and preserves interval anchor", async () => {
  const { runtime, store, session } = await fixture(); await runtime.activate(); await runtime.settled();
  expect(session.prompt).not.toHaveBeenCalled(); expect(store.get("a1").nextOccurrence).toBe(120_000);
  await vi.advanceTimersByTimeAsync(20_000); await runtime.settled(); expect(session.prompt).toHaveBeenCalledOnce();
});

test("foreground interruption after a completed report allows the next automation occurrence", async () => {
  const { runtime, store, session, scheduler } = await fixture("skip", 1_000);
  await runtime.activate();
  await vi.advanceTimersByTimeAsync(29_000); await runtime.settled();
  const run = store.get("a1").run!;
  await runtime.event({ sessionID: "s1", type: "delivered", messageId: run.messageID });
  await runtime.event({ sessionID: "s1", type: "succeeded" });
  const owner = { ...store.get("a1").owner, sessionID: "s1" };
  scheduler.start(owner, { mode: "repeat", intervalSeconds: 3600, maxLifetimeSeconds: 7200, prompt: "Temporary" });
  for (const type of ["busy", "interrupted", "busy", "succeeded"] as const) {
    scheduler.event({ sessionID: "s1", type });
    await runtime.event({ sessionID: "s1", type });
  }
  expect(scheduler.list(owner)).toEqual([]);
  await vi.advanceTimersByTimeAsync(60_000); await runtime.settled();
  expect(session.prompt).toHaveBeenCalledTimes(2);
  expect(store.get("a1").enabled).toBe(true);
});

test("weekday morning missed at 09:00 is skipped at 10:00 after several offline days", async () => {
  const now = Date.parse("2026-11-27T09:00:00Z"); // 10:00 Berlin
  const { runtime, store, session } = await fixture("skip", now);
  await store.mutate("a1", previous => ({ record: { ...previous!, recurrence: { anchorAt: Date.parse("2026-11-20T00:00:00Z"),
    schedule: { kind: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" } }, nextOccurrence: Date.parse("2026-11-23T08:00:00Z") }, result: undefined }));
  await runtime.activate(); await runtime.settled(); expect(session.prompt).not.toHaveBeenCalled();
  expect(store.get("a1").nextOccurrence).toBe(Date.parse("2026-11-30T08:00:00Z"));
});
test("explicit catch-up collapses missed slots to one outstanding current-state check", async () => {
  const { runtime, store, session } = await fixture("catch-up-once"); await runtime.activate(); await runtime.settled();
  expect(session.prompt).toHaveBeenCalledOnce(); const run = store.get("a1").run!;
  await vi.advanceTimersByTimeAsync(180_000); expect(session.prompt).toHaveBeenCalledOnce();
  await runtime.event({ sessionID: "s1", type: "delivered", messageId: run.messageID }); await runtime.event({ sessionID: "s1", type: "succeeded" });
  expect(store.get("a1").nextOccurrence).toBe(300_000); expect(store.get("a1").lastOutcome).toBe("succeeded");
});
test("no missed first occurrence and paused definitions stay inactive", async () => {
  const { runtime, store, session } = await fixture("catch-up-once", 1_000); await runtime.activate(); await runtime.settled();
  expect(session.prompt).not.toHaveBeenCalled(); await runtime.management.pause("a1"); runtime.wake();
  await vi.advanceTimersByTimeAsync(100_000); expect(session.prompt).not.toHaveBeenCalled(); expect(store.get("a1").recurrence.anchorAt).toBe(0);
});
test("offline message context or idle state cannot resolve restored admission", async () => {
  const { runtime, store, session, scheduler } = await fixture();
  await store.mutate("a1", previous => ({ record: { ...previous!, run: { occurrence: 30_000, revision: 1, messageID: "old", sessionID: "s1", prompt: "Check", phase: "queued", accepted: true, delivered: false } }, result: undefined }));
  await runtime.activate(); await runtime.settled(); expect(store.get("a1").run!.phase).toBe("unresolved");
  await runtime.event({ sessionID: "s1", type: "succeeded" }); expect(store.get("a1").run!.phase).toBe("unresolved");
  expect(session.prompt).not.toHaveBeenCalled(); expect(scheduler.reserveExternal({ ...record().owner, sessionID: "s1" }, "new")).toBe(false);
});

test("busy target and standby time jump coalesce slots without overlap or drift", async () => {
  const { runtime, store, session } = await fixture("skip", 1_000); await runtime.activate();
  vi.mocked(session.get).mockResolvedValue({ ...sessionInfo("s1"), time: { created: 0, updated: 0, busy: 1 } });
  await vi.advanceTimersByTimeAsync(180_000); await runtime.settled(); expect(session.prompt).not.toHaveBeenCalled();
  vi.mocked(session.get).mockResolvedValue(sessionInfo("s1"));
  vi.setSystemTime(600_000); runtime.wake(); await runtime.settled(); expect(session.prompt).toHaveBeenCalledOnce();
  const messageID = store.get("a1").run!.messageID;
  await runtime.management.update("a1", { target: { kind: "existing", sessionID: "s2" } }); runtime.wake(); await runtime.settled();
  expect(session.prompt).toHaveBeenCalledOnce();
  await runtime.event({ sessionID: "s1", type: "delivered", messageId: messageID }); await runtime.event({ sessionID: "s1", type: "succeeded" });
  expect(store.get("a1").nextOccurrence).toBe(630_000);
});

test("pause update remove and unload during asynchronous checks cannot submit stale prompts", async () => {
  for (const action of ["pause", "update", "remove", "close"] as const) {
    const { runtime, session } = await fixture("skip", 1_000); await runtime.activate();
    const gate = deferred<ReturnType<typeof sessionInfo>>(); vi.mocked(session.get).mockImplementationOnce(() => gate.promise);
    vi.setSystemTime(30_000); runtime.wake();
    if (action === "pause") await runtime.management.pause("a1");
    if (action === "update") await runtime.management.update("a1", { prompt: "New" });
    if (action === "remove") await runtime.management.remove("a1");
    if (action === "close") runtime.close();
    gate.resolve(sessionInfo("s1")); await runtime.settled(); expect(session.prompt).not.toHaveBeenCalled();
  }
});

test("failed durable intent write submits no prompt", async () => {
  const { runtime, storage, session } = await fixture("skip", 1_000); await runtime.activate();
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Disk full")); vi.setSystemTime(30_000); runtime.wake(); await runtime.settled();
  expect(session.prompt).not.toHaveBeenCalled();
});

test("stored intent exists before prompt and interruption during final inspection prevents submission", async () => {
  const { runtime, store, session } = await fixture("skip", 1_000); await runtime.activate();
  vi.mocked(session.prompt).mockImplementation(async () => { expect(store.get("a1").run?.phase).toBe("preparing"); return undefined as never; });
  vi.setSystemTime(30_000); runtime.wake(); await runtime.settled(); expect(session.prompt).toHaveBeenCalledOnce();
  const next = await fixture("skip", 1_000); await next.runtime.activate();
  const gate = deferred<ReturnType<typeof sessionInfo>>(); vi.mocked(next.session.get).mockImplementationOnce(() => gate.promise);
  vi.setSystemTime(30_000); next.runtime.wake(); await next.runtime.event({ sessionID: "s1", type: "interrupted" });
  gate.resolve(sessionInfo("s1")); await next.runtime.settled(); expect(next.session.prompt).not.toHaveBeenCalled();
});

test("queued acceptance waits for matching delivery and terminal outcome including early completion", async () => {
  const { runtime, store, session } = await fixture("catch-up-once");
  const ack = deferred<never>(); vi.mocked(session.prompt).mockImplementationOnce(() => ack.promise);
  await runtime.activate();
  // Let asynchronous owner/intent preparation reach prompt admission.
  for (let i = 0; i < 50 && !vi.mocked(session.prompt).mock.calls.length; i++) await Promise.resolve();
  expect(session.prompt).toHaveBeenCalledOnce();
  const messageID = store.get("a1").run!.messageID;
  await runtime.event({ sessionID: "s1", type: "enqueued", messageId: messageID });
  await runtime.event({ sessionID: "s1", type: "succeeded" }); expect(store.get("a1").run).toBeDefined();
  await runtime.event({ sessionID: "s1", type: "delivered", messageId: messageID });
  await runtime.event({ sessionID: "s1", type: "succeeded" });
  ack.resolve(undefined as never); await runtime.settled();
  expect(store.get("a1")).toMatchObject({ acceptedRunCount: 1, lastOutcome: "succeeded" }); expect(store.get("a1").run).toBeUndefined();
});

test("interrupted delivered run preserves routine and failed run pauses without retries", async () => {
  for (const outcome of ["interrupted", "failed"] as const) {
    const { runtime, store, session } = await fixture("catch-up-once"); await runtime.activate(); await runtime.settled();
    const messageID = store.get("a1").run!.messageID;
    await runtime.event({ sessionID: "s1", type: "interrupted" }); expect(store.get("a1").run).toBeDefined();
    await runtime.event({ sessionID: "s1", type: "delivered", messageId: messageID }); await runtime.event({ sessionID: "s1", type: outcome, error: "test failure" });
    expect(store.get("a1")).toMatchObject({ enabled: outcome === "interrupted", lastOutcome: outcome });
    if (outcome === "failed") { await vi.advanceTimersByTimeAsync(180_000); expect(session.prompt).toHaveBeenCalledOnce(); }
  }
});

test("session interruption stops its temporary timers but retains scheduled automation", async () => {
  const { runtime, scheduler, store } = await fixture("skip", 1_000); await runtime.activate();
  const owner = { ...record().owner, sessionID: "s1" };
  scheduler.start(owner, { mode: "repeat", prompt: "Temporary", intervalSeconds: 30 });
  scheduler.event({ sessionID: "s1", type: "interrupted" }); await runtime.event({ sessionID: "s1", type: "interrupted" });
  expect(scheduler.list(owner)).toEqual([]); expect(store.get("a1").enabled).toBe(true);
});

test("runtime documentation records active location misfire standby and interruption boundaries", () => {
  const docs = readFileSync(new URL("../docs/development.md", import.meta.url), "utf8");
  for (const value of ["owning active plugin location", "catch-up-once", "standby", "30 seconds", "Stop a running chat", "Pause an automation"]) expect(docs).toContain(value);
});

test("restored delivery-only context remains gated; new matching live delivery and terminal resolve it", async () => {
  const { runtime, store, session } = await fixture();
  await store.mutate("a1", previous => ({ record: { ...previous!, run: { occurrence: 30_000, revision: 1, messageID: "old", sessionID: "s1", prompt: "Check", phase: "running", accepted: true, delivered: true } }, result: undefined }));
  vi.mocked(session.context).mockResolvedValue([{ type: "user", id: "old", time: { created: 30_000 }, text: "Check" }]);
  await runtime.activate(); expect(store.get("a1").run?.phase).toBe("unresolved");
  await runtime.event({ sessionID: "s1", type: "succeeded" }); expect(store.get("a1").run).toBeDefined();
  await runtime.event({ sessionID: "s1", type: "delivered", messageId: "old" }); await runtime.event({ sessionID: "s1", type: "succeeded" });
  expect(store.get("a1").run).toBeUndefined(); expect(store.get("a1").lastOutcome).toBe("succeeded");
});

test("restored missing context stays unresolved and matching cancellation resolves without resubmission", async () => {
  const { runtime, store, session } = await fixture("catch-up-once");
  await store.mutate("a1", previous => ({ record: { ...previous!, run: { occurrence: 30_000, revision: 1, messageID: "old", sessionID: "s1", prompt: "Check", phase: "preparing", accepted: false, delivered: false } }, result: undefined }));
  vi.mocked(session.context).mockRejectedValue(new Error("Truncated/unavailable")); await runtime.activate();
  expect(store.get("a1").run?.phase).toBe("unresolved");
  await runtime.event({ sessionID: "s1", type: "cancelled", messageId: "old" });
  expect(store.get("a1").run).toBeUndefined(); expect(session.prompt).not.toHaveBeenCalled();
});

test("restored context waiting for plugin activation does not deadlock setup", async () => {
  const { runtime, store, session } = await fixture();
  await store.mutate("a1", previous => ({ record: { ...previous!, run: { occurrence: 30_000, revision: 1, messageID: "old", sessionID: "s1", prompt: "Check", phase: "queued", accepted: true, delivered: false } }, result: undefined }));
  const gate = deferred<Awaited<ReturnType<typeof session.context>>>(); vi.mocked(session.context).mockReturnValue(gate.promise);
  await runtime.activate(); expect(store.get("a1").run!.phase).toBe("unresolved"); gate.resolve([]);
});

test("terminal storage failure retains barrier and event-stream failure stops admissions", async () => {
  const { runtime, store, session, storage, scheduler } = await fixture("catch-up-once"); await runtime.activate(); await runtime.settled();
  const messageID = store.get("a1").run!.messageID; await runtime.event({ sessionID: "s1", type: "delivered", messageId: messageID });
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Disk full")); await expect(runtime.event({ sessionID: "s1", type: "succeeded" })).rejects.toThrow("Disk full");
  expect(store.get("a1").run).toBeDefined(); expect(scheduler.reserveExternal({ ...record().owner, sessionID: "s1" }, "other")).toBe(false);
  runtime.failEventStream(); await vi.advanceTimersByTimeAsync(120_000); expect(session.prompt).toHaveBeenCalledOnce();
});

test("unresolved handoff never retries but an unrelated target remains eligible", async () => {
  for (const policy of ["skip", "catch-up-once"] as const) {
    const { runtime, store, session } = await fixture(policy, 1_000);
    await store.mutate("a2", () => ({ record: { ...record("a2"), target: { kind: "existing", sessionID: "s2" } }, result: undefined }));
    vi.mocked(session.get).mockImplementation(async ({ sessionID }) => sessionInfo(sessionID));
    vi.mocked(session.prompt).mockImplementation(async input => { if (input.sessionID === "s1") throw new Error("Unknown admission"); return undefined as never; });
    await runtime.activate(); vi.setSystemTime(30_000); runtime.wake(); await runtime.settled();
    expect(store.get("a1").run?.phase).toBe("unresolved"); expect(store.get("a2").run?.phase).toBe("queued");
    vi.setSystemTime(120_000); runtime.wake(); await runtime.settled(); expect(session.prompt).toHaveBeenCalledTimes(2);
  }
});
