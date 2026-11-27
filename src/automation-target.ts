import type { AutomationHost } from "./automation-host.js";
import { AutomationStore, type AutomationRecord, type AutomationTarget, type ExecutionSelection } from "./automation-store.js";
import { createRecurrence, nextOccurrence, validateMissedPolicy, validatePrompt, validateSchedule } from "./automation-schedule.js";
import { MissingSessionError, SchedulerError } from "./scheduler.js";
import { randomUUID } from "node:crypto";
import { AutomationManagement } from "./automation-management.js";

export type TargetInput = { kind: "current" } | { kind: "existing"; sessionID: string } |
  { kind: "new-reuse"; title?: string } | { kind: "new-each-run"; title?: string };

export function validateTargetInput(value: unknown): TargetInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SchedulerError("invalid-input", "An explicit target policy is required");
  const input = value as Record<string, unknown>;
  const fields = input.kind === "current" ? ["kind"] : input.kind === "existing" ? ["kind", "sessionID"] : ["kind", "title"];
  if (!["current", "existing", "new-reuse", "new-each-run"].includes(String(input.kind)) || Object.keys(input).some(key => !fields.includes(key)) ||
    (input.kind === "existing" && (typeof input.sessionID !== "string" || !input.sessionID.trim())) ||
    (input.title !== undefined && typeof input.title !== "string")) throw new SchedulerError("invalid-input", "Invalid or conflicting target policy");
  return structuredClone(input) as TargetInput;
}

export class AutomationTargets {
  constructor(readonly store: AutomationStore, readonly host: AutomationHost, private readonly now = Date.now,
    private readonly id: () => string = randomUUID, private readonly minimumSpacingSeconds = 30) {}

  async bind(invokingSessionID: string, input: TargetInput): Promise<AutomationTarget> {
    await this.host.inspect(invokingSessionID);
    if (input.kind === "current") return { kind: "current", sessionID: invokingSessionID };
    if (input.kind === "existing") { await this.host.inspect(input.sessionID); return { ...input }; }
    if (input.kind === "new-reuse") return { ...input, sessionID: this.host.sessionID() };
    return { ...input };
  }

  async retarget(invokingSessionID: string, id: string, input: unknown, patch: Record<string, unknown> = {}): Promise<AutomationRecord> {
    if (Object.keys(patch).some(key => !["prompt", "label", "schedule", "missedPolicy"].includes(key))) throw new SchedulerError("invalid-input", "Unsupported automation patch");
    const target = await this.bind(invokingSessionID, validateTargetInput(input));
    const info = await this.host.inspect(invokingSessionID);
    const selection: ExecutionSelection = { ...(info.agent ? { agent: info.agent } : {}), ...(info.model ? { model: info.model } : {}),
      ...(info.permissions ? { permissions: structuredClone(info.permissions) } : {}) };
    if (target.kind === "new-reuse") {
      await this.store.mutate(id, previous => {
        if (!previous || previous.removed) throw new SchedulerError("not-found", "Automation not found");
        if (previous.pendingSetup) throw new SchedulerError("unresolved", "Previous target setup is unresolved");
        if ("prompt" in patch) previous.prompt = validatePrompt(patch.prompt);
        if ("label" in patch) {
          if (typeof patch.label !== "string") throw new SchedulerError("invalid-input", "label must be text");
          previous.label = patch.label;
        }
        if ("schedule" in patch) {
          previous.recurrence = createRecurrence(validateSchedule(patch.schedule, this.minimumSpacingSeconds), this.now());
          previous.nextOccurrence = nextOccurrence(previous.recurrence, this.now()); delete previous.pendingOccurrence; delete previous.consumedThrough;
        }
        if ("missedPolicy" in patch) previous.missedPolicy = validateMissedPolicy(patch.missedPolicy);
        previous.setupEnable = previous.enabled; previous.enabled = false; previous.target = target;
        previous.selection = structuredClone(previous.selection ?? selection);
        previous.pendingSetup = true; previous.revision++; previous.updatedAt = this.now();
        return { record: previous, result: undefined };
      });
      await this.finishSetup(id); return this.store.get(id);
    }
    return new AutomationManagement(this.store, this.host, this.now, this.minimumSpacingSeconds).update(id, { ...patch, target }, selection);
  }

  async checkTarget(id: string): Promise<void> {
    const record = this.store.get(id);
    try { await this.host.validateTarget(record); }
    catch (error) {
      if (error instanceof MissingSessionError || (error instanceof SchedulerError && error.code === "invalid-input")) {
        await new AutomationManagement(this.store, this.host, this.now).pauseTarget(id, String(error));
      }
      throw error;
    }
  }

  async create(invokingSessionID: string, input: Record<string, unknown>): Promise<AutomationRecord> {
    if (Object.keys(input).some(key => !["prompt", "label", "schedule", "target", "missedPolicy"].includes(key))) throw new SchedulerError("invalid-input", "Unsupported automation input");
    const prompt = validatePrompt(input.prompt), schedule = validateSchedule(input.schedule, this.minimumSpacingSeconds), missedPolicy = validateMissedPolicy(input.missedPolicy);
    if (input.label !== undefined && typeof input.label !== "string") throw new SchedulerError("invalid-input", "label must be text");
    const target = await this.bind(invokingSessionID, validateTargetInput(input.target));
    const createdAt = this.now(), recurrence = createRecurrence(schedule, createdAt), id = this.id();
    const info = await this.host.inspect(invokingSessionID);
    const selection: ExecutionSelection = { ...(info.agent ? { agent: info.agent } : {}), ...(info.model ? { model: info.model } : {}),
      ...(info.permissions ? { permissions: structuredClone(info.permissions) } : {}) };
    const record: AutomationRecord = { schemaVersion: 1, id, owner: { ...this.store.owner }, createdAt, updatedAt: createdAt, revision: 1,
      prompt, ...(typeof input.label === "string" ? { label: input.label } : {}), recurrence, missedPolicy, target,
      nextOccurrence: nextOccurrence(recurrence, createdAt), acceptedRunCount: 0, enabled: target.kind !== "new-reuse",
      ...(target.kind === "new-reuse" || target.kind === "new-each-run" ? { selection } : {}),
      ...(target.kind === "new-reuse" ? { pendingSetup: true, setupEnable: true, pauseReason: "setup-pending" } : {}) };
    await this.store.mutate(id, previous => {
      if (previous) throw new SchedulerError("invalid-input", "Automation identity collision");
      return { record, result: undefined };
    });
    if (target.kind === "new-reuse") await this.finishSetup(id);
    return this.store.get(id);
  }

  async finishSetup(id: string): Promise<void> {
    const record = this.store.get(id, true);
    if (!record.pendingSetup || record.target.kind !== "new-reuse") return;
    const targetID = record.target.sessionID;
    try {
      // The persisted intended ID is reused even after an uncertain creation.
      let existing;
      try { existing = await this.host.get(record.target.sessionID); } catch (error) {
        if (!(error instanceof MissingSessionError)) throw error;
      }
      if (existing) await this.host.inspect(record.target.sessionID);
      else await this.host.create(record.target.sessionID, record.target.title ?? record.label ?? "Automation", record.selection ?? {});
      await this.store.mutate(id, previous => {
        if (!previous || previous.removed || !previous.pendingSetup || previous.target.kind !== "new-reuse" || previous.target.sessionID !== targetID) return { ...(previous ? { record: previous } : {}), result: undefined };
        delete previous.pendingSetup; previous.enabled = previous.setupEnable ?? true; delete previous.setupEnable;
        if (previous.enabled) delete previous.pauseReason;
        return { record: previous, result: undefined };
      });
    } catch (error) {
      await this.store.mutate(id, previous => {
        if (!previous) return { result: undefined };
        if (previous.removed || !previous.pendingSetup || previous.target.kind !== "new-reuse" || previous.target.sessionID !== targetID) return { record: previous, result: undefined };
        previous.enabled = false;
        if (previous.pauseReason !== "user-paused") previous.pauseReason = "setup-unresolved";
        previous.lastError = String(error).slice(0, 500);
        return { record: previous, result: undefined };
      }).catch(() => {});
      throw error;
    }
  }

  async prepareFreshRun(id: string, occurrence: number): Promise<AutomationRecord> {
    let prepared: AutomationRecord | undefined;
    await this.store.mutate(id, previous => {
      if (!previous || previous.removed) throw new SchedulerError("not-found", "Automation not found");
      if (!previous.enabled || previous.pendingSetup || previous.run) throw new SchedulerError("unresolved", "Automation is paused or already has an outstanding run");
      if (previous.target.kind !== "new-each-run") throw new SchedulerError("invalid-input", "Fresh target policy is not selected");
      previous.run = { occurrence, revision: previous.revision, messageID: this.host.messageID(), sessionID: this.host.sessionID(),
        prompt: previous.prompt, phase: "creating", accepted: false, delivered: false };
      prepared = previous;
      return { record: previous, result: undefined };
    });
    const intent = prepared!;
    const target = intent.target;
    try {
      await this.host.create(intent.run!.sessionID, `${"title" in target ? target.title ?? intent.label ?? "Automation" : "Automation"} ${new Date(occurrence).toISOString()}`, intent.selection ?? {});
      await this.store.mutate(id, previous => {
        if (!previous?.run || previous.run.messageID !== intent.run!.messageID) throw new SchedulerError("unresolved", "Run reservation changed during target creation");
        previous.run.phase = "preparing"; return { record: previous, result: undefined };
      });
      return this.store.get(id, true);
    } catch (error) {
      await this.store.mutate(id, previous => {
        if (!previous) return { result: undefined };
        if (previous.run?.messageID === intent.run!.messageID) previous.run.phase = "unresolved";
        previous.enabled = false; previous.pauseReason = "target-creation-error";
        previous.lastError = String(error).slice(0, 500); return { record: previous, result: undefined };
      }).catch(() => {});
      throw error;
    }
  }
}
