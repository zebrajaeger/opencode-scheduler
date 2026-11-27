import { afterEach, expect, test, vi } from "vitest";
import { Scheduler, type Host } from "../src/scheduler.js";

const instances: Scheduler[] = [];
afterEach(() => { instances.forEach(instance => instance.close()); instances.length = 0; vi.useRealTimers(); });
test("external automation reservation and timer share session exclusion and cooldown", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const scheduler = new Scheduler(); instances.push(scheduler);
  const owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
  const host: Host = { messageId: () => "m1", inspect: vi.fn(async () => ({ owner, state: "idle" as const })), prompt: vi.fn(async () => {}) };
  scheduler.connect(host); scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 });
  expect(scheduler.reserveExternal(owner, "a1")).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000); expect(host.prompt).not.toHaveBeenCalled();
  expect(scheduler.reserveExternal(owner, "a2")).toBe(false);
  scheduler.releaseExternal("s1", "a1"); await vi.advanceTimersByTimeAsync(30_000);
  expect(host.prompt).toHaveBeenCalledOnce(); expect(scheduler.reserveExternal(owner, "a1")).toBe(false);
  scheduler.event({ sessionID: "s1", type: "delivered", messageId: "m1" }); scheduler.event({ sessionID: "s1", type: "succeeded" });
  expect(scheduler.reserveExternal(owner, "a1")).toBe(false);
  await vi.advanceTimersByTimeAsync(29_999); expect(scheduler.reserveExternal(owner, "a1")).toBe(false);
});
test("restored reservations block new timers and release independently", () => {
  const scheduler = new Scheduler(); instances.push(scheduler);
  const owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
  expect(scheduler.reserveExternal(owner, "old1", true)).toBe(true);
  expect(scheduler.reserveExternal(owner, "old2", true)).toBe(true);
  scheduler.releaseExternal("s1", "old1", false); expect(scheduler.reserveExternal(owner, "new")).toBe(false);
  scheduler.releaseExternal("s1", "old2", false); expect(scheduler.reserveExternal(owner, "new")).toBe(true);
});

test("an older due timer cannot be starved by recurring external reservations", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const scheduler = new Scheduler(); instances.push(scheduler);
  const owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
  const host: Host = { messageId: () => "timer-message", inspect: vi.fn(async () => ({ owner, state: "idle" as const })), prompt: vi.fn(async () => {}) };
  scheduler.connect(host);
  scheduler.start(owner, { mode: "once", delaySeconds: 35, prompt: "Older timer" });
  expect(scheduler.reserveExternal(owner, "first-automation")).toBe(true);
  await vi.advanceTimersByTimeAsync(37_000);
  scheduler.releaseExternal("s1", "first-automation");
  // Simulate the external deadline firing first at the shared cooldown boundary.
  vi.setSystemTime(67_000);
  expect(scheduler.reserveExternal(owner, "next-automation")).toBe(false);
  await vi.advanceTimersByTimeAsync(0);
  expect(host.prompt).toHaveBeenCalledOnce();
});

test("an older automation occurrence precedes a newer due timer but not a recovery barrier", () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const scheduler = new Scheduler(); instances.push(scheduler);
  const owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
  scheduler.connect({ messageId: () => "timer-message", inspect: async () => ({ owner, state: "idle" }), prompt: async () => {} });
  scheduler.start(owner, { mode: "once", delaySeconds: 35, prompt: "Newer timer" });
  vi.setSystemTime(60_000);
  expect(scheduler.reserveExternal(owner, "older-automation", false, 30_000)).toBe(true);
  expect(scheduler.reserveExternal(owner, "recovered-automation", true)).toBe(true);
});

test("disabled due timers and unrelated sessions do not block automation admission", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const scheduler = new Scheduler(); instances.push(scheduler);
  const owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
  scheduler.connect({ messageId: () => "timer-message", inspect: async () => { throw new Error("Private inspection failure"); }, prompt: async () => {} });
  scheduler.start({ ...owner, sessionID: "other" }, { mode: "once", delaySeconds: 30, prompt: "Independent" });
  scheduler.start(owner, { mode: "once", delaySeconds: 30, prompt: "Disabled" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(scheduler.list(owner)[0]?.status).toBe("disabled");
  vi.setSystemTime(60_000);
  expect(scheduler.reserveExternal(owner, "automation")).toBe(true);
});
