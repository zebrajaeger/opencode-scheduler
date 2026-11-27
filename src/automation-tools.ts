import type { Plugin } from "@opencode/plugin";
import { Automations } from "./automations.js";
import { SchedulerError } from "./scheduler.js";

type Editor = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0];
type Definition = Parameters<Editor["add"]>[0];
const schedule = { oneOf: [
  { type: "object", properties: { kind: { const: "interval" }, intervalSeconds: { type: "integer", minimum: 30 } }, required: ["kind", "intervalSeconds"], additionalProperties: false },
  { type: "object", properties: { kind: { const: "cron" }, expression: { type: "string", minLength: 1 }, timeZone: { type: "string", minLength: 1, description: "Explicit IANA time zone, e.g. Europe/Berlin; ask if unknown." } }, required: ["kind", "expression", "timeZone"], additionalProperties: false },
] };
const target = { oneOf: [
  { type: "object", properties: { kind: { const: "current" } }, required: ["kind"], additionalProperties: false },
  { type: "object", properties: { kind: { const: "existing" }, sessionID: { type: "string", minLength: 1 } }, required: ["kind", "sessionID"], additionalProperties: false },
  ...["new-reuse", "new-each-run"].map(kind => ({ type: "object", properties: { kind: { const: kind }, title: { type: "string" } }, required: ["kind"], additionalProperties: false })),
] };
const fields = { prompt: { type: "string", minLength: 1 }, label: { type: "string" }, schedule, target,
  missedPolicy: { type: "string", enum: ["skip", "catch-up-once"], description: "Default skip; catch-up-once only when explicitly requested." } };
const automationId = { type: "string", minLength: 1 };

export function automationTools(runtime: Automations): Definition[] {
  const scope = "Only this project/plugin location is accessible; any chat here can manage its automations. Definitions survive restart, but execution requires the active OpenCode server and owning location. No automatic tool approval.";
  const targets = "Here means the invoking chat. Resolve described existing chats with automation_targets and ask when ambiguous. 'In a new chat' means new-reuse; use new-each-run only for an explicit new chat every time.";
  function definition(name: string, description: string, properties: Record<string, unknown>, required: string[],
    action: (sessionID: string, value: Record<string, unknown>) => Promise<unknown> | unknown): Definition {
    return { name, description: `${description} ${scope}`, options: { codemode: false },
      input: { type: "object", properties, required, additionalProperties: false }, execute: async (input, invocation) => {
        try {
          if (!input || typeof input !== "object" || Array.isArray(input)) throw new SchedulerError("invalid-input", "Input must be an object");
          const value = input as Record<string, unknown>;
          if (Object.keys(value).some(key => !Object.hasOwn(properties, key))) throw new SchedulerError("invalid-input", "Unsupported input field; ownership cannot be overridden");
          for (const key of required) if (value[key] === undefined) throw new SchedulerError("invalid-input", `${key} is required`);
          if (value.automationId !== undefined && (typeof value.automationId !== "string" || !value.automationId.trim())) throw new SchedulerError("invalid-input", "automationId must contain text");
          await runtime.host.inspect(invocation.sessionID);
          const result = await action(invocation.sessionID, value); runtime.wake();
          return { content: JSON.stringify({ ok: true, result }) };
        } catch (error) { return { content: JSON.stringify({ ok: false, error: { code: error instanceof SchedulerError ? error.code : "internal-error",
          message: error instanceof Error ? error.message.slice(0, 500) : "Automation operation failed" } }) }; }
      } };
  }
  return [
    definition("automation_create", `Create a durable interval or five-field cron prompt automation. Supply explicit schedule and target; calendar requires IANA timeZone. Default missedPolicy skip; no default expiry. ${targets}`, fields, ["prompt", "schedule", "target"], (sessionID, input) => runtime.targets.create(sessionID, input)),
    definition("automation_list", "List durable definitions, targets, next/pending occurrences, paused/error reasons and checking/queued/running/unresolved status. Acceptance is not completion; unresolved old handoffs may remain gated indefinitely.", {}, [], () => ({ automations: runtime.management.list(), issues: runtime.store.issues })),
    definition("automation_update", `Update an owned automation with a non-empty patch. Schedule edits reset its anchor; edits never implicitly resume. Admitted runs keep their snapshots. ${targets}`, { automationId, ...fields }, ["automationId"], async (sessionID, input) => {
      const { automationId: id, target: destination, ...patch } = input;
      if (destination !== undefined) {
        return runtime.targets.retarget(sessionID, id as string, destination, patch);
      }
      return runtime.management.update(id as string, patch);
    }),
    definition("automation_pause", "Persistently pause future runs without deleting the definition or interrupting current execution. Already admitted input can still run.", { automationId }, ["automationId"], (_, input) => runtime.management.pause(input.automationId as string)),
    definition("automation_resume", "Explicitly resume a paused automation after validating target and prior handoff. Default skips missed slots; explicit catch-up-once coalesces them. Unresolved setup or run cannot be bypassed.", { automationId }, ["automationId"], (_, input) => runtime.management.resume(input.automationId as string)),
    definition("automation_remove", "Remove a durable automation. Future admissions stop; already accepted input cannot be retracted. A hidden recovery tombstone may retain its session barrier. Does not interrupt chat execution.", { automationId }, ["automationId"], (_, input) => runtime.management.remove(input.automationId as string)),
    definition("automation_targets", "List scoped target candidates with IDs, titles, locations and activity. A described target must be resolved uniquely; ask rather than choosing the first ambiguous match.", { search: { type: "string" }, cursor: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, [], (_, input) => runtime.host.candidates(input)),
  ];
}
