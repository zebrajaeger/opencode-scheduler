import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { createRecurrence, nextOccurrence, nextCronOccurrence, validateMissedPolicy, validatePrompt, validateSchedule } from "../src/automation-schedule.js";

test("validates non-empty prompts and explicit missed-occurrence policies", () => {
  expect(validatePrompt("List my assigned PRs with links")).toBe("List my assigned PRs with links");
  for (const value of [undefined, null, 1, "", " \n"]) expect(() => validatePrompt(value)).toThrow("prompt");
  expect(validateMissedPolicy()).toBe("skip");
  expect(validateMissedPolicy("catch-up-once")).toBe("catch-up-once");
  for (const value of [null, "catch-up", "replay", 1]) expect(() => validateMissedPolicy(value)).toThrow("missedPolicy");
});

test("schedule validation returns defensive typed values", () => {
  const interval = { kind: "interval", intervalSeconds: 1800 };
  expect(validateSchedule(interval)).toEqual(interval);
  expect(validateSchedule(interval)).not.toBe(interval);
  expect(validateSchedule({ kind: "cron", expression: " 0 9 * * 1-5 ", timeZone: "Europe/Berlin" }))
    .toEqual({ kind: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" });
  expect(validateSchedule({ kind: "cron", expression: "0 9 * * *", timeZone: "UTC" }).kind).toBe("cron");
});

test.each([undefined, null, [], {}, { kind: "once" }, { kind: "interval", intervalSeconds: 30, timeZone: "UTC" },
  { kind: "cron", expression: "0 9 * * *", timeZone: "UTC", intervalSeconds: 30 },
  { kind: "cron", expression: "", timeZone: "UTC" }, { kind: "cron", expression: "0 9 * * *" },
  { kind: "cron", expression: "0 9 * * *", timeZone: "Not/AZone" },
  { kind: "cron", expression: "0 9 * * *", timeZone: "+01:00" }])("rejects malformed/conflicting schedule %j", value => {
  expect(() => validateSchedule(value)).toThrow();
});

test.each([0, -1, 29, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, "30"])("rejects invalid interval %s", intervalSeconds => {
  expect(() => validateSchedule({ kind: "interval", intervalSeconds })).toThrow("intervalSeconds");
});

test("respects effective minimum spacing without weakening the built-in minimum", () => {
  expect(() => validateSchedule({ kind: "interval", intervalSeconds: 30 }, 60)).toThrow();
  expect(validateSchedule({ kind: "interval", intervalSeconds: 60 }, 60).kind).toBe("interval");
  for (const minimum of [29, 1.5, Infinity]) expect(() => validateSchedule({ kind: "interval", intervalSeconds: 30 }, minimum)).toThrow();
});

test("cron supports five numeric fields, lists, ranges, steps, and both Sunday values", () => {
  const schedule = (expression: string) => ({ kind: "cron" as const, expression, timeZone: "UTC" });
  const start = Date.parse("2026-11-27T12:00:00Z");
  expect(nextCronOccurrence(schedule("*/15 9-17 * * 1-5"), start)).toBe(Date.parse("2026-11-27T12:15:00Z"));
  expect(nextCronOccurrence(schedule("0,30 13 * * *"), start)).toBe(Date.parse("2026-11-27T13:00:00Z"));
  expect(nextCronOccurrence(schedule("0 9 * * 0"), start)).toBe(Date.parse("2026-11-29T09:00:00Z"));
  expect(nextCronOccurrence(schedule("0 9 * * 7"), start)).toBe(Date.parse("2026-11-29T09:00:00Z"));
});

test("restricted day fields use OR and leap-day schedules remain possible", () => {
  const start = Date.parse("2026-03-28T00:00:00Z");
  expect(nextCronOccurrence({ kind: "cron", expression: "0 9 1 * 1", timeZone: "UTC" }, start))
    .toBe(Date.parse("2026-03-30T09:00:00Z"));
  expect(nextCronOccurrence({ kind: "cron", expression: "0 9 31 2 1", timeZone: "UTC" }, start))
    .toBe(Date.parse("2027-02-01T09:00:00Z"));
  expect(nextCronOccurrence({ kind: "cron", expression: "0 9 29 2 *", timeZone: "UTC" }, Date.parse("2096-03-01T00:00:00Z")))
    .toBe(Date.parse("2104-02-29T09:00:00Z"));
});

test.each(["0 0 9 * * *", "@daily", "0 9 L * *", "0 9 1W * *", "0 9 * * 1#2", "0 9 * JAN MON",
  "60 9 * * *", "0 25 * * *", "0 9 31 2 *", "0 9 31 4 *", "*/0 9 * * *", "0 9 * 13 *"])("rejects invalid or impossible cron %s", expression => {
  expect(() => validateSchedule({ kind: "cron", expression, timeZone: "UTC" })).toThrow();
});

test("interval recurrence preserves anchor through restart and delayed completion", () => {
  const recurrence = createRecurrence({ kind: "interval", intervalSeconds: 1800 }, Date.parse("2026-11-27T08:00:00Z"));
  const restored = JSON.parse(JSON.stringify(recurrence));
  expect(nextOccurrence(restored, Date.parse("2026-11-27T09:10:00Z"))).toBe(Date.parse("2026-11-27T09:30:00Z"));
  expect(nextOccurrence(recurrence, Date.parse("2026-11-27T08:47:00Z"))).toBe(Date.parse("2026-11-27T09:00:00Z"));
  const updated = createRecurrence({ kind: "interval", intervalSeconds: 1800 }, Date.parse("2026-11-27T10:00:00Z"));
  expect(nextOccurrence(updated, updated.anchorAt)).toBe(Date.parse("2026-11-27T10:30:00Z"));
});

test("calendar recurrence returns a strictly future occurrence", () => {
  const recurrence = createRecurrence({ kind: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" }, 0);
  expect(nextOccurrence(recurrence, Date.parse("2026-11-27T08:00:00Z"))).toBe(Date.parse("2026-11-30T08:00:00Z"));
});

test("consumed high water prevents repeats after a backward clock jump", () => {
  const recurrence = createRecurrence({ kind: "interval", intervalSeconds: 1800 }, 0);
  expect(nextOccurrence(recurrence, 1000, 3_600_000)).toBe(5_400_000);
  expect(() => createRecurrence({ kind: "interval", intervalSeconds: 30 }, NaN)).toThrow();
  expect(() => nextOccurrence(recurrence, 8_640_000_000_000_000 - 1)).toThrow();
});

test("calendar weekday 09:00 follows saved zone across summer-time changes", () => {
  const recurrence = createRecurrence({ kind: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" }, 0);
  expect(nextOccurrence(recurrence, Date.parse("2026-03-27T08:00:00Z"))).toBe(Date.parse("2026-03-30T07:00:00Z"));
  expect(nextOccurrence(recurrence, Date.parse("2026-10-23T07:00:00Z"))).toBe(Date.parse("2026-10-26T08:00:00Z"));
  const before = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    expect(nextOccurrence(recurrence, Date.parse("2026-11-27T00:00:00Z"))).toBe(Date.parse("2026-11-27T08:00:00Z"));
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("nonexistent spring 02:30 is skipped rather than shifted to 03:30", () => {
  const recurrence = createRecurrence({ kind: "cron", expression: "30 2 * * *", timeZone: "Europe/Berlin" }, 0);
  expect(nextOccurrence(recurrence, Date.parse("2026-03-29T00:00:00Z"))).toBe(Date.parse("2026-03-30T00:30:00Z"));
});

test("autumn repeated local minute occurs only at its first instance", () => {
  const recurrence = createRecurrence({ kind: "cron", expression: "30 2 * * *", timeZone: "Europe/Berlin" }, 0);
  expect(nextOccurrence(recurrence, Date.parse("2026-10-25T00:00:00Z"))).toBe(Date.parse("2026-10-25T00:30:00Z"));
  expect(nextOccurrence(recurrence, Date.parse("2026-10-25T01:15:00Z"))).toBe(Date.parse("2026-10-26T01:30:00Z"));
  expect(nextOccurrence(recurrence, Date.parse("2026-10-25T00:00:00Z"), Date.parse("2026-10-25T00:30:00Z")))
    .toBe(Date.parse("2026-10-26T01:30:00Z"));
});

test("first-instance rule also handles half-hour daylight-saving rollback", () => {
  const recurrence = createRecurrence({ kind: "cron", expression: "45 1 * * *", timeZone: "Australia/Lord_Howe" }, 0);
  expect(nextOccurrence(recurrence, Date.parse("2026-04-04T14:00:00Z"))).toBe(Date.parse("2026-04-04T14:45:00Z"));
  expect(nextOccurrence(recurrence, Date.parse("2026-04-04T15:00:00Z"))).toBe(Date.parse("2026-04-05T15:15:00Z"));
});

test("development documentation schedules use supported syntax and fixture-backed zones", () => {
  const text = readFileSync(new URL("../docs/development.md", import.meta.url), "utf8");
  const examples = [...text.matchAll(/^- `([^`]+)`, `([^`]+)`:/gm)];
  expect(examples).toHaveLength(5);
  for (const example of examples) {
    const schedule = validateSchedule({ kind: "cron", expression: example[1], timeZone: example[2] });
    expect(nextOccurrence(createRecurrence(schedule, 0), Date.parse("2026-11-27T00:00:00Z"))).toBeGreaterThan(0);
  }
});
