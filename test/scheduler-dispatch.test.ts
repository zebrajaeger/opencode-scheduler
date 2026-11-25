import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MissingSessionError, Scheduler, type Host, type Owner } from "../src/scheduler.js";
import { deferred, deterministicIds } from "./helpers.js";

const owner: Owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
let scheduler: Scheduler;
let host: Host;

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  scheduler = new Scheduler({}, Date.now, deterministicIds());
  host = {
    inspect: vi.fn(async (owner: Owner) => ({ owner, state: "idle" as const })),
    prompt: vi.fn(async () => {}), messageId: deterministicIds("msg"),
  };
  scheduler.connect(host);
});
afterEach(() => { scheduler.close(); vi.useRealTimers(); });

function complete(sessionID = "s1", messageId = vi.mocked(host.prompt).mock.calls.findLast(call => call[0].sessionID === sessionID)![1]) {
  scheduler.event({ sessionID, type: "delivered", messageId });
  scheduler.event({ sessionID, type: "succeeded" });
}

test("one-shot admission is not completion and multiple timers serialize with cooldown", async () => {
  scheduler.start(owner, { mode: "once", prompt: "First", delaySeconds: 30 });
  scheduler.start(owner, { mode: "once", prompt: "Second", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  expect(scheduler.list(owner).map(timer => timer.status)).toEqual(["in-flight", "deferred"]);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  complete();
  await vi.advanceTimersByTimeAsync(29_999);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(host.prompt).toHaveBeenCalledTimes(2);
});

test("configured spacing governs every timer in the session", async () => {
  scheduler.close();
  scheduler = new Scheduler({ minimumSpacingSeconds: 60 }, Date.now, deterministicIds());
  scheduler.connect(host);
  expect(() => scheduler.start(owner, { mode: "repeat", prompt: "Too fast", intervalSeconds: 30 })).toThrow();
  scheduler.start(owner, { mode: "once", prompt: "First", delaySeconds: 60 });
  scheduler.start(owner, { mode: "once", prompt: "Second", delaySeconds: 60 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  complete();
  await vi.advanceTimersByTimeAsync(59_999);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(host.prompt).toHaveBeenCalledTimes(2);
});

test("busy deferral coalesces missed slots and does not wait for real background work", async () => {
  vi.mocked(host.inspect).mockImplementation(async owner => ({ owner, state: "busy" }));
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(125_000);
  expect(host.prompt).not.toHaveBeenCalled();
  vi.mocked(host.inspect).mockImplementation(async owner => ({ owner, state: "idle" }));
  scheduler.event({ sessionID: owner.sessionID, type: "idle" });
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  complete();
  expect(scheduler.list(owner)[0]!.nextDueAt).toBe(150_000);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(2);
  expect(scheduler.list(owner)[0]!.id).toBe(timer.id);
});

test("stalled session does not block another session and close ignores late results", async () => {
  const pending = deferred<{ owner: Owner; state: "idle" }>();
  vi.mocked(host.inspect).mockImplementation(owner => owner.sessionID === "s1" ? pending.promise : Promise.resolve({ owner, state: "idle" }));
  scheduler.start(owner, { mode: "once", prompt: "First", delaySeconds: 30 });
  scheduler.start({ ...owner, sessionID: "s2" }, { mode: "once", prompt: "Second", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  scheduler.close();
  pending.resolve({ owner, state: "idle" });
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("expiry removes busy disabled and in-flight records without waiting for host", async () => {
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30, maxLifetimeSeconds: 60 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)[0]!.status).toBe("in-flight");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)).toEqual([]);
  complete();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  expect(() => scheduler.update(owner, timer.id, { label: "Expired" })).toThrow();
});

test("update and stop during inspection prevent stale submission", async () => {
  const pending = deferred<{ owner: Owner; state: "idle" }>();
  vi.mocked(host.inspect).mockReturnValue(pending.promise);
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.update(owner, timer.id, { intervalSeconds: 60 });
  pending.resolve({ owner, state: "idle" });
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).not.toHaveBeenCalled();
  const stopped = scheduler.stop(owner, timer.id);
  expect(stopped.removed).toBe(true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(host.prompt).not.toHaveBeenCalled();
});

test("stop and a new timer cannot release an accepted reservation", async () => {
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.stop(owner, timer.id).warning).toContain("already submitted");
  scheduler.start(owner, { mode: "once", prompt: "New", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  complete();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(2);
});

test("expiry removes disabled and busy deferred timers with no catchup", async () => {
  scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30, maxLifetimeSeconds: 60 });
  vi.mocked(host.inspect).mockImplementation(async owner => ({ owner, state: "busy" }));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)[0]!.status).toBe("deferred");
  scheduler.failEventStream("Stream lost");
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

test("in-flight updates preserve submitted snapshot and submitted once cannot rearm", async () => {
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Old", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.update(owner, timer.id, { prompt: "New", intervalSeconds: 60 });
  expect(vi.mocked(host.prompt).mock.calls[0]![2]).toBe("Old");
  complete();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(vi.mocked(host.prompt).mock.calls[1]![2]).toBe("New");
  complete();
  const once = scheduler.start({ ...owner, sessionID: "once" }, { mode: "once", prompt: "Once", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(() => scheduler.update({ ...owner, sessionID: "once" }, once.id, { prompt: "Again" })).toThrow();
});

test("early delivery and completion before acknowledgement settle exactly once", async () => {
  const pending = deferred<void>();
  vi.mocked(host.prompt).mockReturnValue(pending.promise);
  scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  complete();
  pending.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(scheduler.list(owner)).toEqual([]);
  expect(host.prompt).toHaveBeenCalledTimes(1);
});

test("ambiguous acknowledgement disables timer and cannot be blindly rearmed", async () => {
  vi.mocked(host.prompt).mockRejectedValue(new Error("Lost acknowledgement"));
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(300_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
  expect(() => scheduler.update(owner, timer.id, { prompt: "Retry" })).toThrow();
  complete();
  expect(scheduler.list(owner)[0]!.acceptedRunCount).toBe(1);
});

test("interruption removes all session timers but preserves foreign timers", async () => {
  scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  const foreign = { ...owner, sessionID: "s2" };
  scheduler.start(foreign, { mode: "repeat", prompt: "Foreign", intervalSeconds: 30 });
  scheduler.event({ sessionID: "s1", type: "interrupted" });
  expect(scheduler.list(owner)).toEqual([]);
  expect(scheduler.list(foreign)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
});

test("normal failure disables delivered timer until an explicit valid update", async () => {
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.event({ sessionID: "s1", type: "delivered", messageId: "msg_1" });
  scheduler.event({ sessionID: "s1", type: "failed", error: "Model failed" });
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
  scheduler.update(owner, timer.id, { intervalSeconds: 60 });
  expect(scheduler.list(owner)[0]!.status).toBe("scheduled");
});

test("deadline changes replace one timeout and busy rechecks do not spin", async () => {
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 60 });
  expect(vi.getTimerCount()).toBe(1);
  scheduler.update(owner, timer.id, { intervalSeconds: 30 });
  expect(vi.getTimerCount()).toBe(1);
  vi.mocked(host.inspect).mockImplementation(async owner => ({ owner, state: "busy" }));
  await vi.advanceTimersByTimeAsync(90_000);
  expect(host.inspect).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(1);
});

test("late wake coalesces elapsed intervals and does not dispatch expired timers", async () => {
  scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30, maxLifetimeSeconds: 300 });
  vi.setSystemTime(120_000);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  complete();
  expect(scheduler.list(owner)[0]!.nextDueAt).toBe(180_000);
  vi.setSystemTime(400_000);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  expect(scheduler.list(owner)).toEqual([]);
});

test("all due timers progress fairly across a short repeating timer", async () => {
  scheduler.start(owner, { mode: "repeat", prompt: "Repeat", intervalSeconds: 30 });
  scheduler.start(owner, { mode: "once", prompt: "Other", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  complete();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(vi.mocked(host.prompt).mock.calls.map(call => call[2])).toEqual(["Repeat", "Other"]);
});

test.each(["interrupted", "deleted"] as const)("%s during owner inspection prevents late admission", async type => {
  const pending = deferred<{ owner: Owner; state: "idle" }>();
  vi.mocked(host.inspect).mockReturnValue(pending.promise);
  scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.event({ sessionID: "s1", type });
  pending.resolve({ owner, state: "idle" });
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).not.toHaveBeenCalled();
  expect(scheduler.list(owner)).toEqual([]);
});

test("expiry during owner check prevents submission", async () => {
  const pending = deferred<{ owner: Owner; state: "idle" }>();
  vi.mocked(host.inspect).mockReturnValue(pending.promise);
  scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30, maxLifetimeSeconds: 60 });
  await vi.advanceTimersByTimeAsync(60_000);
  pending.resolve({ owner, state: "idle" });
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).not.toHaveBeenCalled();
});

test("a newer busy event takes precedence over stale idle inspection", async () => {
  const pending = deferred<{ owner: Owner; state: "idle" }>();
  vi.mocked(host.inspect).mockReturnValue(pending.promise);
  scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.event({ sessionID: "s1", type: "busy" });
  pending.resolve({ owner, state: "idle" });
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).not.toHaveBeenCalled();
});

test("old terminal events cannot complete a newer delivered reservation", async () => {
  scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.event({ sessionID: "s1", type: "delivered", messageId: "msg_1", sequence: 10 });
  scheduler.event({ sessionID: "s1", type: "succeeded", sequence: 11 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.event({ sessionID: "s1", type: "delivered", messageId: "msg_2", sequence: 20 });
  scheduler.event({ sessionID: "s1", type: "succeeded", sequence: 11 });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(host.prompt).toHaveBeenCalledTimes(2);
  scheduler.event({ sessionID: "s1", type: "succeeded", sequence: 21 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledTimes(3);
});

test("unrelated terminal and cancellation events cannot release queued input", async () => {
  scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.event({ sessionID: "s1", type: "succeeded" });
  scheduler.event({ sessionID: "s1", type: "cancelled", messageId: "foreign" });
  await vi.advanceTimersByTimeAsync(90_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
  scheduler.event({ sessionID: "s1", type: "cancelled", messageId: "msg_1" });
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
});

test("hanging acknowledgement becomes diagnostic but never releases its barrier", async () => {
  const pending = deferred<void>();
  vi.mocked(host.prompt).mockImplementation(owner => owner.sessionID === "s1" ? pending.promise : Promise.resolve());
  scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 });
  scheduler.start({ ...owner, sessionID: "s2" }, { mode: "once", prompt: "Foreign", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(90_000);
  expect(host.prompt).toHaveBeenCalledTimes(2);
  expect(scheduler.list(owner)[0]!.lastError).toContain("unresolved");
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
  scheduler.close();
  pending.reject(new Error("Late rejection"));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("failed one-shot is disabled and bounded diagnostics cannot cause retries", async () => {
  const timer = scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.event({ sessionID: "s1", type: "delivered", messageId: "msg_1" });
  scheduler.event({ sessionID: "s1", type: "failed", error: "x".repeat(1000) });
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
  expect(scheduler.list(owner)[0]!.lastError).toHaveLength(500);
  expect(() => scheduler.update(owner, timer.id, { prompt: "Retry" })).toThrow();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(host.prompt).toHaveBeenCalledTimes(1);
});

test("stream failure during inspection blocks stale idle admission", async () => {
  const pending = deferred<{ owner: Owner; state: "idle" }>();
  vi.mocked(host.inspect).mockReturnValue(pending.promise);
  scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  scheduler.failEventStream("Disconnected");
  pending.resolve({ owner, state: "idle" });
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).not.toHaveBeenCalled();
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
});

test("confirmed missing owner is removed but transient failure only disables", async () => {
  vi.mocked(host.inspect).mockRejectedValue(new MissingSessionError());
  scheduler.start(owner, { mode: "once", prompt: "Missing", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)).toEqual([]);
  vi.mocked(host.inspect).mockRejectedValue(new Error("Temporary error"));
  scheduler.start(owner, { mode: "once", prompt: "Transient", delaySeconds: 30 });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)[0]!.status).toBe("disabled");
});

test("moved owners stop and forks do not inherit timers", async () => {
  scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  expect(scheduler.list({ ...owner, sessionID: "fork" })).toEqual([]);
  vi.mocked(host.inspect).mockResolvedValue({ owner: { ...owner, directory: "/moved" }, state: "idle" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)).toEqual([]);
  expect(host.prompt).not.toHaveBeenCalled();
});
