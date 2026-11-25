import { afterEach, expect, test, vi } from "vitest";
import { deferred, deterministicIds, sessionHostFixture } from "./helpers.js";

afterEach(() => vi.useRealTimers());

test("time and promise resolution are controllable without sleeping", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const result = deferred<number>();
  setTimeout(() => result.resolve(Date.now()), 30_000);
  await vi.advanceTimersByTimeAsync(30_000);
  await expect(result.promise).resolves.toBe(30_000);
  expect(vi.getTimerCount()).toBe(0);
});

test("IDs and official host methods have deterministic fixtures", () => {
  const id = deterministicIds();
  expect([id(), id()]).toEqual(["timer_1", "timer_2"]);
  const host = sessionHostFixture();
  expect(vi.isMockFunction(host.get)).toBe(true);
  expect(vi.isMockFunction(host.prompt)).toBe(true);
});
