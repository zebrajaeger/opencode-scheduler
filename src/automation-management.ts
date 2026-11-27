import { nextOccurrence, createRecurrence, validateMissedPolicy, validatePrompt, validateSchedule } from "./automation-schedule.js";
import { AutomationStore, type AutomationRecord } from "./automation-store.js";
import { SchedulerError } from "./scheduler.js";
import type { AutomationTarget, ExecutionSelection } from "./automation-store.js";

export interface ManagementHost {
  validateTarget(record: AutomationRecord): Promise<void>;
}

const warning = "Already admitted OpenCode input can still execute; this operation does not interrupt the session.";
function requireRecord(record: AutomationRecord | undefined): AutomationRecord {
  if (!record || record.removed) throw new SchedulerError("not-found", "Automation not found in this location");
  return record;
}

export class AutomationManagement {
  constructor(readonly store: AutomationStore, private readonly host: ManagementHost, private readonly now = Date.now,
    private readonly minimumSpacingSeconds = 30) {}

  async pause(id: string): Promise<AutomationRecord> {
    return this.store.mutate(id, previous => {
      const record = requireRecord(previous);
      record.enabled = false; record.pauseReason = "user-paused"; record.updatedAt = this.now();
      if (record.pendingSetup) record.setupEnable = false;
      delete record.pendingOccurrence;
      return { record, result: record };
    });
  }

  async resume(id: string): Promise<AutomationRecord> {
    return this.store.mutate(id, async previous => {
      const record = requireRecord(previous);
      if (record.run || record.pendingSetup) throw new SchedulerError("unresolved", "Previous automation setup or run is unresolved");
      await this.host.validateTarget(record);
      if (!record.enabled) {
        const now = this.now();
        if (record.missedPolicy === "catch-up-once" && record.nextOccurrence <= now) record.pendingOccurrence = record.nextOccurrence;
        else delete record.pendingOccurrence;
        record.nextOccurrence = nextOccurrence(record.recurrence, now, record.consumedThrough);
        record.enabled = true; record.updatedAt = now; delete record.pauseReason; delete record.lastError;
      }
      return { record, result: record };
    });
  }

  async update(id: string, patch: Record<string, unknown>, selection?: ExecutionSelection): Promise<AutomationRecord> {
    const keys = Object.keys(patch);
    if (!keys.length || keys.some(key => !["prompt", "label", "schedule", "missedPolicy", "target"].includes(key))) {
      throw new SchedulerError("invalid-input", "Supply a non-empty supported automation patch");
    }
    return this.store.mutate(id, async previous => {
      const record = requireRecord(previous), now = this.now();
      if ("prompt" in patch) record.prompt = validatePrompt(patch.prompt);
      if ("label" in patch) {
        if (typeof patch.label !== "string") throw new SchedulerError("invalid-input", "label must be text");
        record.label = patch.label;
      }
      if ("missedPolicy" in patch) record.missedPolicy = validateMissedPolicy(patch.missedPolicy);
      if ("target" in patch) {
        if (record.pendingSetup) throw new SchedulerError("unresolved", "Previous target setup is unresolved");
        const target = patch.target as AutomationTarget;
        record.target = structuredClone(target);
        if (target.kind === "new-each-run" || target.kind === "new-reuse") record.selection = structuredClone(record.selection ?? selection ?? {});
        else delete record.selection;
        await this.host.validateTarget(record);
      }
      if ("schedule" in patch) {
        record.recurrence = createRecurrence(validateSchedule(patch.schedule, this.minimumSpacingSeconds), now);
        delete record.pendingOccurrence; delete record.consumedThrough;
        record.nextOccurrence = nextOccurrence(record.recurrence, now);
      }
      record.revision++; record.updatedAt = now;
      return { record, result: record };
    });
  }

  async pauseTarget(id: string, reason: string): Promise<void> {
    await this.store.mutate(id, previous => {
      if (!previous) return { result: undefined };
      previous.enabled = false; previous.pauseReason = "target-unavailable"; previous.lastError = reason.slice(0, 500);
      delete previous.pendingOccurrence;
      return { record: previous, result: undefined };
    });
  }

  async remove(id: string): Promise<{ removed: boolean; warning?: string }> {
    return this.store.mutate<{ removed: boolean; warning?: string }>(id, previous => {
      if (!previous || previous.removed) return { ...(previous ? { record: previous } : {}), result: { removed: false } };
      if (previous.run || previous.pendingSetup) {
        previous.removed = true; previous.enabled = false; delete previous.pendingOccurrence;
        return { record: previous, result: { removed: true, warning } };
      }
      return { result: { removed: true } };
    });
  }

  /** Called only when the dispatch coordinator has proven this run's terminal outcome. */
  async complete(id: string, messageID: string, outcome: NonNullable<AutomationRecord["lastOutcome"]>, error?: string): Promise<void> {
    await this.store.mutate(id, previous => {
      if (!previous) return { result: undefined };
      if (previous.run?.messageID !== messageID) throw new SchedulerError("unresolved", "Terminal evidence does not match the outstanding run");
      if (previous.removed) return { result: undefined };
      const sameRevision = previous.run.revision === previous.revision;
      if (sameRevision) previous.consumedThrough = Math.max(previous.consumedThrough ?? -Infinity, previous.run.occurrence, this.now());
      delete previous.run; delete previous.pendingOccurrence;
      previous.lastOutcome = outcome; previous.updatedAt = this.now();
      if (outcome === "failed" || outcome === "cancelled") {
        if (previous.pendingSetup) previous.setupEnable = false;
        previous.enabled = false; previous.pauseReason = "execution-error"; previous.lastError = (error ?? outcome).slice(0, 500);
      }
      previous.nextOccurrence = nextOccurrence(previous.recurrence, this.now(), previous.consumedThrough);
      return { record: previous, result: undefined };
    });
  }

  list(): (AutomationRecord & { runState: string })[] {
    return this.store.list().map(record => ({ ...record, runState: record.pendingSetup ? "unresolved" : record.run?.phase === "preparing" ? "checking" : record.run?.phase ??
      (!record.enabled ? "paused" : record.pendingOccurrence !== undefined || record.nextOccurrence <= this.now() ? "due" : "scheduled") }));
  }
}
