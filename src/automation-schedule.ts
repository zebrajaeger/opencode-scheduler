import { SchedulerError } from "./scheduler.js";
import { CronExpressionParser, type CronExpression } from "cron-parser";

export type AutomationSchedule =
  | { kind: "interval"; intervalSeconds: number }
  | { kind: "cron"; expression: string; timeZone: string };

export type MissedPolicy = "skip" | "catch-up-once";

type CronSchedule = Extract<AutomationSchedule, { kind: "cron" }>;
const syntax = /^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?(?:,(?:\*|\d+(?:-\d+)?)(?:\/\d+)?)*$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

function localMinute(time: number, timeZone: string): { identity: string; wallTime: number; hour: number; minute: number } {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, calendar: "gregory", numberingSystem: "latn",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (formatters.size >= 128) formatters.clear();
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
  const hour = Number(parts.hour), minute = Number(parts.minute);
  const wall = new Date(0);
  wall.setUTCFullYear(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  wall.setUTCHours(hour, minute, 0, 0);
  return { identity: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`, wallTime: wall.getTime(), hour, minute };
}

/** Resolve repeated wall-clock minutes to their earliest real instance, including non-hour DST changes. */
function isFirstLocalMinute(time: number, timeZone: string): boolean {
  const local = localMinute(time, timeZone);
  const minute = Math.floor(time / 60_000) * 60_000;
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = minute + hours * 3_600_000;
    offsets.add(localMinute(sample, timeZone).wallTime - sample);
  }
  for (const offset of offsets) {
    const candidate = local.wallTime - offset;
    if (candidate < time && localMinute(candidate, timeZone).identity === local.identity) return false;
  }
  return true;
}

function parseCron(schedule: CronSchedule, after: number): CronExpression {
  const fields = schedule.expression.split(/\s+/);
  if (fields.length !== 5 || fields.some(field => !syntax.test(field))) {
    invalid("expression must use five numeric cron fields with wildcards, lists, ranges, and steps; seconds, macros, and extensions are unsupported");
  }
  try {
    return CronExpressionParser.parse(schedule.expression, {
      currentDate: after, endDate: Math.min(8_640_000_000_000_000, after + 16 * 366 * 86_400_000),
      tz: schedule.timeZone, strict: false,
    });
  } catch (error) {
    return invalid(`Invalid cron expression: ${String(error).slice(0, 300)}`);
  }
}

function invalid(message: string): never {
  throw new SchedulerError("invalid-input", message);
}

export function validatePrompt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid("prompt must contain text");
  return value;
}

export function validateMissedPolicy(value: unknown = "skip"): MissedPolicy {
  if (value !== "skip" && value !== "catch-up-once") invalid("missedPolicy must be skip or catch-up-once");
  return value;
}

export function validateSchedule(value: unknown, minimumSpacingSeconds = 30): AutomationSchedule {
  if (!Number.isSafeInteger(minimumSpacingSeconds) || minimumSpacingSeconds < 30) {
    invalid("minimumSpacingSeconds must be a safe integer of at least 30 seconds");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("schedule must be an object");
  const input = value as Record<string, unknown>;
  if (input.kind === "interval") {
    if (Object.keys(input).some(key => key !== "kind" && key !== "intervalSeconds")) {
      invalid("interval schedule accepts only kind and intervalSeconds");
    }
    const interval = input.intervalSeconds;
    if (typeof interval !== "number" || !Number.isSafeInteger(interval) || interval < minimumSpacingSeconds ||
      !Number.isSafeInteger(interval * 1000)) {
      invalid(`intervalSeconds must be a safe integer of at least ${minimumSpacingSeconds} seconds within the timestamp range`);
    }
    return { kind: "interval", intervalSeconds: interval };
  }
  if (input.kind === "cron") {
    if (Object.keys(input).some(key => !["kind", "expression", "timeZone"].includes(key))) {
      invalid("cron schedule accepts only kind, expression, and timeZone");
    }
    if (typeof input.expression !== "string" || !input.expression.trim()) invalid("expression must contain text");
    if (typeof input.timeZone !== "string" || !input.timeZone.trim() || /^[+-]|^\d/.test(input.timeZone)) {
      invalid("timeZone must be an explicit IANA time zone");
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timeZone }).format(0);
    } catch {
      invalid("timeZone must be a valid IANA time zone");
    }
    const schedule: CronSchedule = { kind: "cron", expression: input.expression.trim(), timeZone: input.timeZone };
    const parsed = parseCron(schedule, 0);
    try { parsed.next(); } catch { invalid("expression has no possible future occurrence within the supported calendar range"); }
    return schedule;
  }
  return invalid("schedule kind must be interval or cron");
}

export function nextCronOccurrence(schedule: CronSchedule, after: number): number {
  if (!Number.isSafeInteger(after) || Math.abs(after) >= 8_640_000_000_000_000) invalid("after must be a valid timestamp");
  try {
    const parsed = parseCron(schedule, after);
    // The parser shifts nonexistent local times forward. Reject such generated
    // candidates, and reject second instances even when starting in a repeated hour.
    for (let candidates = 0; candidates < 10_000; candidates++) {
      const candidate = parsed.next().getTime();
      const local = localMinute(candidate, schedule.timeZone);
      if (parsed.fields.hour.values.some(hour => hour === local.hour) && parsed.fields.minute.values.some(minute => minute === local.minute) &&
        isFirstLocalMinute(candidate, schedule.timeZone)) return candidate;
    }
    return invalid("No future calendar occurrence found within the bounded candidate search");
  }
  catch (error) { return invalid(`Cannot calculate a future cron occurrence: ${String(error).slice(0, 300)}`); }
}

export interface Recurrence {
  schedule: AutomationSchedule;
  anchorAt: number;
}

export function createRecurrence(schedule: AutomationSchedule, anchorAt: number): Recurrence {
  if (!Number.isSafeInteger(anchorAt) || Math.abs(anchorAt) >= 8_640_000_000_000_000) invalid("anchorAt must be a valid timestamp");
  return { schedule: validateSchedule(schedule), anchorAt };
}

export function nextOccurrence(recurrence: Recurrence, after: number, consumedThrough?: number): number {
  const threshold = Math.max(after, consumedThrough ?? -Infinity);
  if (!Number.isSafeInteger(threshold) || Math.abs(threshold) >= 8_640_000_000_000_000) invalid("after must be a valid timestamp");
  if (recurrence.schedule.kind === "cron") return nextCronOccurrence(recurrence.schedule, threshold);
  const interval = recurrence.schedule.intervalSeconds * 1000;
  const slots = Math.max(1, Math.floor((threshold - recurrence.anchorAt) / interval) + 1);
  const next = recurrence.anchorAt + slots * interval;
  if (!Number.isSafeInteger(next) || Math.abs(next) >= 8_640_000_000_000_000) invalid("Next occurrence exceeds the timestamp range");
  return next;
}
