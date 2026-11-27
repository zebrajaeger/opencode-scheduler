import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";
import { OrchestrationJobs } from "../src/orchestration-jobs.js";
import { AdmissionGate } from "../src/admission-gate.js";
import { OrchestrationDispatch } from "../src/orchestration-dispatch.js";
import { deferred, sessionHostFixture, sessionInfo } from "./helpers.js";

async function fixture() {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-dispatch-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  let now = 1000, sequence = 0;
  const caller = { instanceID: "local", projectID: "p1", sessionID: "a", directory: "/project" };
  const jobs = new OrchestrationJobs(store, () => now, () => String(++sequence));
  const gate = new AdmissionGate(store, 30);
  const host = sessionHostFixture();
  vi.mocked(host.get).mockResolvedValue(sessionInfo("a"));
  const dispatch = new OrchestrationDispatch(store, gate, host, jobs, () => now, () => 0);
  const create = (mode: "message" | "prompt" = "prompt") => jobs.create(caller, {
    label: "Follow up", operator: "all", target: caller, conditions: [{ kind: "time", dueAt: 1 }], action: { mode, text: "Run tests" },
  });
  return { store, caller, jobs, gate, host, dispatch, create, advance: (milliseconds: number) => { now += milliseconds; } };
}

test("busy target defers one intent and queue submission waits for matched settlement", async () => {
  const f = await fixture();
  try {
    f.create();
    const busy = sessionInfo("a"); busy.time.busy = 100;
    vi.mocked(f.host.get).mockResolvedValue(busy);
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).not.toHaveBeenCalled();
    vi.mocked(f.host.get).mockResolvedValue(sessionInfo("a"));
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
    const submitted = vi.mocked(f.host.prompt).mock.calls[0]![0];
    expect(submitted.delivery).toBe("queue");
    f.dispatch.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
    f.dispatch.event("p1", { sessionID: "a", type: "delivered", messageId: String(submitted.id) });
    f.dispatch.event("p1", { sessionID: "a", type: "succeeded", sequence: 12 });
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "settled", hostOutcome: "succeeded" });
    expect(f.store.list("jobs", "p1", "a")[0]!.body).toMatchObject({ state: "completed" });
    expect(f.gate.acquire(f.caller, "next", 1001)).toBe(false);
    expect(f.gate.acquire(f.caller, "next", 31000)).toBe(true);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("passive action stores a mailbox entry without calling prompt", async () => {
  const f = await fixture();
  try {
    f.create("message");
    const busy = sessionInfo("a"); busy.time.busy = 100;
    vi.mocked(f.host.get).mockResolvedValue(busy);
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(f.store.list("mailbox", "p1", "a")).toHaveLength(1);
    expect(f.store.list("jobs", "p1", "a")[0]!.body).toMatchObject({ state: "completed" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("lost acknowledgement remains uncertain with fixed ID and blocks another admission", async () => {
  const f = await fixture();
  try {
    f.create();
    vi.mocked(f.host.prompt).mockRejectedValue(new Error("Connection lost"));
    await f.dispatch.pulse("p1");
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "uncertain" });
    f.create();
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
    expect(f.gate.acquire(f.caller, "different", 1_000_000)).toBe(false);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("cancel during target inspection prevents admission and repeated pause/resume is revision checked", async () => {
  const f = await fixture();
  try {
    f.create();
    const row = f.store.list("jobs", "p1", "a")[0]!;
    const initial = f.store.get("jobs", row.id, "p1")!;
    f.jobs.control(f.caller, row.id, "pause", initial.revision);
    const paused = f.store.get("jobs", row.id, "p1")!;
    f.jobs.control(f.caller, row.id, "resume", paused.revision);
    vi.mocked(f.host.get).mockImplementation(async () => {
      const current = f.store.get("jobs", row.id, "p1")!;
      f.jobs.control(f.caller, row.id, "cancel", current.revision);
      return sessionInfo("a");
    });
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(f.store.get("jobs", row.id, "p1")!.body).toMatchObject({ state: "cancelled" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("minimal timer admission gate survives worker replacement until delivery and epoch settle", async () => {
  const f = await fixture();
  try {
    expect(f.gate.acquire(f.caller, "timer-message", 1000)).toBe(true);
    const restored = new AdmissionGate(f.store, 30);
    expect(restored.acquire(f.caller, "new-message", 5000)).toBe(false);
    restored.observe(f.caller, { type: "busy", sequence: 10 }, 5000);
    restored.observe(f.caller, { type: "delivered", messageId: "timer-message" }, 5001);
    restored.observe(f.caller, { type: "succeeded", sequence: 12 }, 5002);
    expect(restored.acquire(f.caller, "new-message", 5003)).toBe(false);
    expect(restored.acquire(f.caller, "new-message", 35002)).toBe(true);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("terminal-before-ack survives a late rejected acknowledgement", async () => {
  const f = await fixture();
  try {
    f.create();
    vi.mocked(f.host.prompt).mockImplementation(async input => {
      f.dispatch.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
      f.dispatch.event("p1", { sessionID: "a", type: "delivered", messageId: String(input.id), sequence: 11 });
      f.dispatch.event("p1", { sessionID: "a", type: "succeeded", sequence: 12 });
      throw new Error("Acknowledgement connection closed after settlement");
    });
    await f.dispatch.pulse("p1");
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "settled" });
    expect(f.store.list("jobs", "p1", "a")[0]!.body).toMatchObject({ state: "completed" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("delivery-before-rejected-ack retains delivery evidence and can settle later", async () => {
  const f = await fixture();
  try {
    f.create();
    vi.mocked(f.host.prompt).mockImplementation(async input => {
      f.dispatch.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
      f.dispatch.event("p1", { sessionID: "a", type: "delivered", messageId: String(input.id), sequence: 11 });
      throw new Error("Lost admission response after delivery");
    });
    await f.dispatch.pulse("p1");
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "delivered" });
    f.dispatch.event("p1", { sessionID: "a", type: "succeeded", sequence: 12 });
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "settled" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("expired inspection callback cannot submit or overwrite a replacement worker", async () => {
  const f = await fixture();
  const replacement = new OrchestrationDispatch(f.store, f.gate, f.host, f.jobs, () => 32000);
  try {
    f.create();
    const inspection = deferred<Awaited<ReturnType<typeof f.host.get>>>();
    const entered = deferred<void>();
    vi.mocked(f.host.get).mockImplementationOnce(() => { entered.resolve(); return inspection.promise; });
    const original = f.dispatch.pulse("p1");
    await entered.promise;
    f.advance(31000);
    await replacement.pulse("p1");
    inspection.resolve(sessionInfo("a"));
    await original;
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
    expect(f.store.list("deliveries", "p1", "a")[0]!.body).toMatchObject({ state: "accepted", attempts: 1 });
  } finally { replacement.close(); f.dispatch.close(); f.store.close(); }
});

test("a later execution cannot settle an earlier delivered prompt with a missed terminal", async () => {
  const f = await fixture();
  try {
    f.create();
    await f.dispatch.pulse("p1");
    const messageID = String(vi.mocked(f.host.prompt).mock.calls[0]![0].id);
    const observe = (event: Parameters<typeof f.dispatch.event>[1]) => {
      f.dispatch.event("p1", event);
      f.gate.observe(f.caller, event, 1000);
    };
    observe({ sessionID: "a", type: "busy", sequence: 10 });
    observe({ sessionID: "a", type: "delivered", messageId: messageID, sequence: 11 });
    observe({ sessionID: "a", type: "busy", sequence: 20 });
    observe({ sessionID: "a", type: "succeeded", sequence: 21 });
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "uncertain" });
    expect(f.gate.acquire(f.caller, "replacement", 100000)).toBe(false);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("pre-admission retries are bounded and retain the original message ID", async () => {
  const f = await fixture();
  try {
    f.create();
    const original = f.store.list("deliveries", "p1", "a")[0]!;
    vi.mocked(f.host.get).mockRejectedValue(new Error("Inspection transport unavailable"));
    await f.dispatch.pulse("p1");
    expect(f.store.list("deliveries", "p1", "a")[0]!.body).toMatchObject({ state: "pending", inspectAttempts: 1 });
    await f.dispatch.pulse("p1");
    expect(f.host.get).toHaveBeenCalledTimes(1);
    f.advance(1000);
    vi.mocked(f.host.get).mockResolvedValue(sessionInfo("a"));
    await f.dispatch.pulse("p1");
    expect(f.store.get("deliveries", original.id, "p1")?.body).toMatchObject({ state: "accepted" });
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
    expect(original.body).toHaveProperty("messageID", vi.mocked(f.host.prompt).mock.calls[0]![0].id);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("unload during inspection fences late responses without sending or losing the pending intent", async () => {
  const f = await fixture();
  try {
    f.create();
    const inspection = deferred<Awaited<ReturnType<typeof f.host.get>>>(), entered = deferred<void>();
    vi.mocked(f.host.get).mockImplementationOnce(() => { entered.resolve(); return inspection.promise; });
    const work = f.dispatch.pulse("p1");
    await entered.promise;
    f.dispatch.close();
    inspection.resolve(sessionInfo("a"));
    await work;
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(f.store.list("deliveries", "p1", "a")[0]!.body).toMatchObject({ state: "pending" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("pre-admission retry cap terminates without an uncertain gate or prompt", async () => {
  const f = await fixture();
  try {
    f.create();
    vi.mocked(f.host.get).mockRejectedValue(new Error("Offline"));
    for (let i = 0; i < 6; i++) { await f.dispatch.pulse("p1"); f.advance(31000); }
    expect(f.host.get).toHaveBeenCalledTimes(6);
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "failed" });
    expect(f.store.list("jobs", "p1", "a")[0]!.body).toMatchObject({ state: "paused" });
    expect(f.gate.acquire(f.caller, "next", 999999)).toBe(true);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("retry deadline and authentication failure pause without automatic retries", async () => {
  const f = await fixture();
  try {
    f.jobs.create(f.caller, { label: "Short deadline", operator: "all", target: f.caller,
      conditions: [{ kind: "time", dueAt: 1 }], lifetimeSeconds: 1, action: { mode: "prompt", text: "Run" } });
    vi.mocked(f.host.get).mockRejectedValue(new Error("Offline"));
    await f.dispatch.pulse("p1");
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "failed" });
    f.create();
    vi.mocked(f.host.get).mockRejectedValue({ _tag: "UnauthorizedError", message: "secret must not appear" });
    await f.dispatch.pulse("p1"); await f.dispatch.pulse("p1");
    expect(f.host.prompt).not.toHaveBeenCalled();
    const records = f.store.list("deliveries", "p1", "a");
    expect(records[1]!.body).toMatchObject({ state: "failed", error: "Authentication required before admission" });
    expect(JSON.stringify(records)).not.toContain("secret must not appear");
  } finally { f.dispatch.close(); f.store.close(); }
});

test("recurring execution failure pauses and explicit resume never replays the failed round", async () => {
  const f = await fixture();
  try {
    f.jobs.create(f.caller, { label: "Periodic", operator: "all", target: f.caller, mode: "repeat",
      conditions: [{ kind: "time", dueAt: 1, intervalSeconds: 60 }], action: { mode: "prompt", text: "Run" } });
    await f.dispatch.pulse("p1");
    const input = vi.mocked(f.host.prompt).mock.calls[0]![0];
    f.dispatch.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
    f.dispatch.event("p1", { sessionID: "a", type: "delivered", messageId: String(input.id), sequence: 11 });
    f.dispatch.event("p1", { sessionID: "a", type: "failed", sequence: 12 });
    const job = f.store.list("jobs", "p1", "a")[0]!;
    expect(job.body).toMatchObject({ state: "paused" });
    f.jobs.control(f.caller, job.id, "resume", f.store.get("jobs", job.id, "p1")!.revision);
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
    expect(f.store.get("jobs", job.id, "p1")!.body).toMatchObject({ state: "waiting" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("pre-admission jitter stays bounded while preserving the immutable prompt envelope", async () => {
  const f = await fixture();
  const dispatch = new OrchestrationDispatch(f.store, f.gate, f.host, f.jobs, () => 1000, () => 1);
  try {
    f.create();
    const original = f.store.list("deliveries", "p1", "a")[0]!;
    vi.mocked(f.host.get).mockRejectedValue(new Error("Offline"));
    await dispatch.pulse("p1");
    const current = f.store.get("deliveries", original.id, "p1")!.body;
    expect(current).toMatchObject({ nextAttemptAt: 2250, inspectAttempts: 1 });
    if (!original.body || typeof original.body !== "object" || Array.isArray(original.body)) throw new Error("Missing intent");
    expect(current).toMatchObject({ messageID: original.body.messageID, text: original.body.text, payloadHash: original.body.payloadHash });
  } finally { dispatch.close(); f.dispatch.close(); f.store.close(); }
});

test("final admission rejects a source that moved after registration", async () => {
  const f = await fixture();
  try {
    const source = { ...f.caller, sessionID: "reviewer", directory: "/review" };
    f.jobs.create(f.caller, { label: "Use review", operator: "all", target: f.caller,
      conditions: [{ kind: "time", dueAt: 1 }], action: { mode: "prompt", text: "Update spec" } }, [source]);
    vi.mocked(f.host.get).mockImplementation(async ({ sessionID }) => sessionInfo(sessionID, sessionID === "reviewer" ? "/moved" : "/project"));
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "failed", error: "Owner or source moved outside its recorded scope" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("cancellation while inspecting a source wins before queue admission", async () => {
  const f = await fixture();
  try {
    f.jobs.create(f.caller, { label: "Use review", operator: "all", target: f.caller,
      conditions: [{ kind: "time", dueAt: 1 }], action: { mode: "prompt", text: "Update spec" } }, [{ ...f.caller, sessionID: "reviewer" }]);
    vi.mocked(f.host.get).mockImplementation(async ({ sessionID }) => {
      if (sessionID === "reviewer") {
        const job = f.store.list("jobs", "p1", "a")[0]!;
        f.jobs.control(f.caller, job.id, "cancel", f.store.get("jobs", job.id, "p1")!.revision);
      }
      return sessionInfo(sessionID);
    });
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).not.toHaveBeenCalled();
    expect(f.store.list("jobs", "p1", "a")[0]!.body).toMatchObject({ state: "cancelled" });
    expect(f.gate.acquire(f.caller, "next", 1000)).toBe(true);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("user work racing the idle snapshot receives only queued input without steering", async () => {
  const f = await fixture();
  try {
    f.create();
    vi.mocked(f.host.get).mockImplementation(async () => {
      const info = sessionInfo("a");
      // The snapshot is idle, but new user work starts before prompt is called.
      f.dispatch.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
      return info;
    });
    await f.dispatch.pulse("p1");
    expect(f.host.prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ delivery: "queue" }));
    expect(f.host).not.toHaveProperty("interrupt");
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "accepted" });
  } finally { f.dispatch.close(); f.store.close(); }
});

test("worker replacement replays the original delivery epoch before settling the stored run", async () => {
  const f = await fixture();
  const replacement = new OrchestrationDispatch(f.store, f.gate, f.host, f.jobs, () => 1000);
  try {
    f.create();
    await f.dispatch.pulse("p1");
    const messageId = String(vi.mocked(f.host.prompt).mock.calls[0]![0].id);
    f.dispatch.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
    f.dispatch.event("p1", { sessionID: "a", type: "delivered", messageId, sequence: 11 });
    f.dispatch.close();
    replacement.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
    replacement.event("p1", { sessionID: "a", type: "delivered", messageId, sequence: 11 });
    replacement.event("p1", { sessionID: "a", type: "succeeded", sequence: 12 });
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "settled" });
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
  } finally { replacement.close(); f.dispatch.close(); f.store.close(); }
});

test("recovery of an uncertain queued admission uses its fixed ID without resending", async () => {
  const f = await fixture();
  try {
    f.create();
    const original = f.store.list("deliveries", "p1", "a")[0]!;
    if (!original.body || typeof original.body !== "object" || Array.isArray(original.body)) throw new Error("Missing intent");
    const messageId = String(original.body.messageID);
    vi.mocked(f.host.prompt).mockRejectedValue(new Error("Lost acknowledgement"));
    await f.dispatch.pulse("p1");
    f.dispatch.event("p1", { sessionID: "a", type: "enqueued", messageId, sequence: 9 });
    expect(f.store.get("deliveries", original.id, "p1")!.body).toMatchObject({ state: "accepted" });
    f.dispatch.event("p1", { sessionID: "a", type: "busy", sequence: 10 });
    f.dispatch.event("p1", { sessionID: "a", type: "delivered", messageId, sequence: 11 });
    f.dispatch.event("p1", { sessionID: "a", type: "succeeded", sequence: 12 });
    expect(f.store.list("runs", "p1", "a")[0]!.body).toMatchObject({ state: "settled" });
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
  } finally { f.dispatch.close(); f.store.close(); }
});

test("unload after submission preserves the original unresolved gate and fences late acknowledgement", async () => {
  const f = await fixture();
  try {
    f.create();
    const acknowledgement = deferred<Awaited<ReturnType<typeof f.host.prompt>>>(), entered = deferred<void>();
    vi.mocked(f.host.prompt).mockImplementationOnce(() => { entered.resolve(); return acknowledgement.promise; });
    const work = f.dispatch.pulse("p1");
    await entered.promise;
    const original = f.store.list("deliveries", "p1", "a")[0]!;
    f.dispatch.close();
    acknowledgement.reject(new Error("Late acknowledgement failure"));
    await work;
    expect(f.store.get("deliveries", original.id, "p1")!.body).toMatchObject({ state: "submitting" });
    expect(f.gate.acquire(f.caller, "replacement", 100000)).toBe(false);
    expect(f.gate.acquire({ ...f.caller, sessionID: "unrelated" }, "other", 100000)).toBe(true);
    expect(f.host.prompt).toHaveBeenCalledTimes(1);
  } finally { f.dispatch.close(); f.store.close(); }
});
