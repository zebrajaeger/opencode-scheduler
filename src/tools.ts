import type { Plugin } from "@opencode/plugin";
import { Scheduler, SchedulerError, type Owner, type StartInput, type UpdateInput } from "./scheduler.js";

type Editor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0];
type Definition = Parameters<Editor["add"]>[0];

const seconds = { type: "integer" as const, minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const timing = {
  delaySeconds: { ...seconds, description: "Delay from now in whole seconds; must meet minimum spacing (default 30)." },
  intervalSeconds: { ...seconds, description: "Repeat interval in whole seconds; must meet minimum spacing (default 30)." },
  maxLifetimeSeconds: { ...seconds, description: "Total lifetime from ORIGINAL creation in seconds, including busy waits. Defaults to 3600, or the plugin default." },
};
const text = {
  prompt: { type: "string" as const, minLength: 1, description: "Prompt to deliver in this conversation; include what to inspect and how to report it." },
  label: { type: "string" as const, description: "Optional human-readable label to distinguish monitoring tasks." },
};
const timerId = { type: "string" as const, minLength: 1, description: "Exact timer ID returned by timer_start or timer_list in THIS session." };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SchedulerError("invalid-input", "Input must be an object");
  return value as Record<string, unknown>;
}

function allowed(value: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(value).some(key => !fields.includes(key))) throw new SchedulerError("invalid-input", "Unsupported input field; session and project are automatic");
}

export function timerTools(scheduler: Scheduler, location: Omit<Owner, "sessionID">): Definition[] {
  function definition(
    name: string, description: string, properties: Record<string, unknown>, required: string[],
    action: (owner: Owner, input: Record<string, unknown>) => unknown,
  ): Definition {
    return {
      name, description, options: { codemode: false },
      input: { type: "object", properties, required, additionalProperties: false },
      execute: async (input, invocation) => {
        try {
          const value = object(input);
          allowed(value, Object.keys(properties));
          for (const key of required) if (value[key] === undefined) throw new SchedulerError("invalid-input", `${key} is required`);
          if (value.timerId !== undefined && (typeof value.timerId !== "string" || !value.timerId)) throw new SchedulerError("invalid-input", "timerId must contain text");
          const result = action({ ...location, sessionID: invocation.sessionID }, value);
          return { content: JSON.stringify({ ok: true, result }) };
        } catch (error) {
          return { content: JSON.stringify({ ok: false, error: {
            code: error instanceof SchedulerError ? error.code : "internal-error",
            message: error instanceof Error ? error.message.slice(0, 500) : "Timer operation failed",
          } }) };
        }
      },
    };
  }

  const scope = "Only this calling session/project is accessible. List timers to resolve ambiguous references. No AGENTS.md instructions or slash command is required.";
  const limit = "Due prompts wait while the agent is busy and use queued delivery without interruption. Real background processes do not prevent monitoring. Timers are in memory, expire in real time, and stop on session interruption or plugin restart.";
  return [
    definition("timer_start", `Schedule a one-shot check (mode once + delaySeconds) or recurring status prompt (mode repeat + intervalSeconds). All durations use whole seconds, minimum spacing defaults to 30 seconds; repeat's first delay defaults to its interval. maxLifetimeSeconds defaults to 3600 seconds (one hour) or plugin default. Returns unique ID and schedule. ${scope} ${limit}`,
      { mode: { type: "string", enum: ["once", "repeat"] }, ...text, ...timing }, ["mode", "prompt"],
      (owner, input) => scheduler.start(owner, input as unknown as StartInput)),
    definition("timer_list", `List active and disabled timers owned by this session, with IDs, prompts, intervals, due/expiry times, scheduled/deferred/in-flight/disabled status, accepted run count and last error. Acceptance is not completed execution. ${scope}`,
      {}, [], owner => scheduler.list(owner)),
    definition("timer_stop", `Stop one timer by timerId from timer_list; repeated stops are safe. No future checks will be submitted, but input already submitted to OpenCode can still run and cannot be retracted by this tool. Does not interrupt agent work. ${scope}`,
      { timerId }, ["timerId"], (owner, input) => scheduler.stop(owner, input.timerId as string)),
    definition("timer_update", `Change a timer's prompt, label, interval, next delay, or total lifetime by exact timerId. Supply at least one change. Units are whole seconds, minimum spacing defaults to 30. Mode/owner/creation cannot change. Interval or delay resets next due from now; interval-only changes do NOT extend expiry. maxLifetimeSeconds is measured from original creation. Accepted prompts keep their old snapshot. A resolved disabled recurring timer can be explicitly rearmed; unresolved handoffs cannot. ${scope} ${limit}`,
      { timerId, ...text, ...timing }, ["timerId"], (owner, input) => {
        const { timerId: id, ...patch } = input;
        return scheduler.update(owner, id as string, patch as UpdateInput);
      }),
    definition("timer_stop_all", `Stop all timers in THIS session and return the removed count. Repeated calls are safe and other sessions are untouched. Submitted OpenCode input can still run; this tool cannot retract accepted input and does not interrupt work. ${scope}`,
      {}, [], owner => scheduler.stopAll(owner)),
  ];
}
