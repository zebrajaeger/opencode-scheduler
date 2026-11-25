import { afterEach, expect, test, vi } from "vitest";
import { Scheduler, type Owner } from "../src/scheduler.js";
import { deterministicIds } from "./helpers.js";

const owner: Owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
const instances: Scheduler[] = [];
afterEach(() => { for (const scheduler of instances) scheduler.close(); instances.length = 0; vi.useRealTimers(); });

test("creates one-shot and repeat timers with independent IDs and first delays", () => {
  const scheduler = new Scheduler({}, () => 1000, deterministicIds());
  instances.push(scheduler);
  const once = scheduler.start(owner, { mode: "once", prompt: "Check container", delaySeconds: 120 });
  const repeat = scheduler.start(owner, { mode: "repeat", prompt: "Check test", intervalSeconds: 300 });
  const early = scheduler.start(owner, { mode: "repeat", prompt: "Check early", intervalSeconds: 300, delaySeconds: 120 });
  expect(once.nextDueAt).toBe(121_000);
  expect(repeat.nextDueAt).toBe(301_000);
  expect(early.nextDueAt).toBe(121_000);
  expect(new Set([once.id, repeat.id, early.id]).size).toBe(3);
  expect(scheduler.list(owner)).toHaveLength(3);
});

test("listing isolates sessions and locations and returns defensive snapshots", () => {
  const scheduler = new Scheduler({}, () => 0, deterministicIds());
  instances.push(scheduler);
  scheduler.start(owner, { mode: "once", prompt: "One", delaySeconds: 30 });
  scheduler.start({ ...owner, sessionID: "s2" }, { mode: "once", prompt: "Two", delaySeconds: 30 });
  expect(scheduler.list(owner)).toHaveLength(1);
  expect(scheduler.list({ ...owner, directory: "/foreign" })).toEqual([]);
  scheduler.list(owner)[0]!.prompt = "mutated";
  expect(scheduler.list(owner)[0]!.prompt).toBe("One");
});

test.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 29])("rejects unsafe delay %s atomically", value => {
  const scheduler = new Scheduler();
  instances.push(scheduler);
  expect(() => scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: value })).toThrow();
  expect(scheduler.list(owner)).toEqual([]);
});

test("validates prompts modes schedules and configuration", () => {
  expect(() => new Scheduler({ minimumSpacingSeconds: 29 })).toThrow();
  expect(() => new Scheduler({ defaultMaxLifetimeSeconds: Infinity })).toThrow();
  const scheduler = new Scheduler({ minimumSpacingSeconds: 60, defaultMaxLifetimeSeconds: 600 });
  instances.push(scheduler);
  expect(() => scheduler.start(owner, { mode: "once", prompt: " ", delaySeconds: 60 })).toThrow();
  expect(() => scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 30 })).toThrow();
  expect(() => scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 600 })).toThrow();
  expect(() => scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 60, intervalSeconds: 60 })).toThrow();
  expect(() => scheduler.start(owner, { mode: "repeat", prompt: "Check" })).toThrow();
});

test("lifetime expires in real elapsed time without a list call and long timeouts are clamped", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const scheduler = new Scheduler(); instances.push(scheduler);
  expect(scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 }).expiresAt).toBe(3_600_000);
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(scheduler.list(owner)).toEqual([]);
  scheduler.start(owner, { mode: "once", prompt: "Long", delaySeconds: 30, maxLifetimeSeconds: 3_000_000 });
  await vi.advanceTimersByTimeAsync(2_147_483_647);
  expect(scheduler.list(owner)).toHaveLength(1);
});

test("updates are atomic, preserve ownership and creation and reset only timing", () => {
  let now = 0;
  const scheduler = new Scheduler({}, () => now, deterministicIds()); instances.push(scheduler);
  const timer = scheduler.start(owner, { mode: "repeat", prompt: "Check", intervalSeconds: 300 });
  now = 100_000;
  const changed = scheduler.update(owner, timer.id, { intervalSeconds: 600 });
  expect(changed.nextDueAt).toBe(700_000);
  expect(changed.createdAt).toBe(0);
  expect(changed.expiresAt).toBe(3_600_000);
  expect(scheduler.update(owner, timer.id, { prompt: "Other" }).nextDueAt).toBe(700_000);
  expect(scheduler.update(owner, timer.id, { maxLifetimeSeconds: 1800 }).expiresAt).toBe(1_800_000);
  const before = scheduler.list(owner);
  expect(() => scheduler.update(owner, timer.id, { prompt: "Invalid patch", intervalSeconds: 1 })).toThrow();
  expect(() => scheduler.update(owner, timer.id, {})).toThrow();
  expect(() => scheduler.update(owner, timer.id, { prompt: "Other" })).toThrow();
  expect(() => scheduler.update(owner, timer.id, { maxLifetimeSeconds: 50 })).toThrow();
  expect(() => scheduler.update({ ...owner, sessionID: "foreign" }, timer.id, { label: "Foreign" })).toThrow();
  expect(scheduler.list(owner)).toEqual(before);
});

test("stopping is idempotent and stop-all does not affect foreign sessions", () => {
  const scheduler = new Scheduler({}, () => 0, deterministicIds()); instances.push(scheduler);
  const timer = scheduler.start(owner, { mode: "once", prompt: "Check", delaySeconds: 30 });
  scheduler.start(owner, { mode: "once", prompt: "Other", delaySeconds: 30 });
  scheduler.start({ ...owner, sessionID: "foreign" }, { mode: "once", prompt: "Foreign", delaySeconds: 30 });
  expect(scheduler.stop({ ...owner, sessionID: "foreign" }, timer.id).removed).toBe(false);
  expect(scheduler.stop(owner, timer.id).removed).toBe(true);
  expect(scheduler.stop(owner, timer.id).removed).toBe(false);
  expect(scheduler.stopAll(owner).removedCount).toBe(1);
  expect(scheduler.stopAll(owner).removedCount).toBe(0);
  expect(scheduler.list({ ...owner, sessionID: "foreign" })).toHaveLength(1);
});
