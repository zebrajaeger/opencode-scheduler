import type { Plugin } from "@opencode/plugin";
import { comparablePath, sameDirectory } from "@opencode/util/path";
import { validateMissedPolicy, validatePrompt, validateSchedule, type Recurrence, type MissedPolicy } from "./automation-schedule.js";
import { SchedulerError, type Owner } from "./scheduler.js";

export type AutomationOwner = Omit<Owner, "sessionID">;
export type AutomationTarget =
  | { kind: "current"; sessionID: string }
  | { kind: "existing"; sessionID: string }
  | { kind: "new-reuse"; sessionID: string; title?: string }
  | { kind: "new-each-run"; title?: string };

export interface ExecutionSelection {
  agent?: string;
  model?: { providerID: string; id: string; variant?: string };
  permissions?: { action: string; resource: string; effect: "allow" | "deny" | "ask" }[];
}

export interface AutomationRun {
  occurrence: number;
  revision: number;
  messageID: string;
  sessionID: string;
  prompt: string;
  phase: "creating" | "preparing" | "queued" | "running" | "unresolved";
  accepted: boolean;
  delivered: boolean;
}

export interface AutomationRecord {
  schemaVersion: 1;
  id: string;
  owner: AutomationOwner;
  createdAt: number;
  updatedAt: number;
  revision: number;
  prompt: string;
  label?: string;
  recurrence: Recurrence;
  missedPolicy: MissedPolicy;
  target: AutomationTarget;
  selection?: ExecutionSelection;
  enabled: boolean;
  pauseReason?: string;
  nextOccurrence: number;
  consumedThrough?: number;
  pendingOccurrence?: number;
  acceptedRunCount: number;
  lastOutcome?: "succeeded" | "failed" | "interrupted" | "cancelled";
  lastError?: string;
  pendingSetup?: boolean;
  setupEnable?: boolean;
  run?: AutomationRun;
  removed?: boolean;
}

export type Storage = Plugin.Context["storage"];
export interface StoreIssue { key: string; message: string }

export function sameAutomationOwner(a: AutomationOwner, b: AutomationOwner): boolean {
  return a.projectID === b.projectID && a.workspaceID === b.workspaceID && sameDirectory(a.directory, b.directory);
}

export function scopePrefix(owner: AutomationOwner): string {
  const path = comparablePath(owner.directory);
  // This is the official sameDirectory Windows rule, not lowercasing POSIX paths.
  const directory = /^[a-z]:\//i.test(path) || path.startsWith("//") ? path.toLowerCase() : path;
  return `automations/v1/${encodeURIComponent(JSON.stringify([owner.projectID, directory, owner.workspaceID ?? null]))}/`;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
function time(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) < 8_640_000_000_000_000; }

export function decodeRecord(value: unknown): AutomationRecord {
  const input = object(value), owner = object(input.owner), recurrence = object(input.recurrence), target = object(input.target);
  if (input.schemaVersion !== 1) throw new Error("Unsupported automation schemaVersion");
  if (!text(input.id) || !text(owner.projectID) || !text(owner.directory) ||
    (owner.workspaceID !== undefined && !text(owner.workspaceID)) ||
    !time(input.createdAt) || !time(input.updatedAt) || !time(input.nextOccurrence) || !time(recurrence.anchorAt) ||
    !Number.isSafeInteger(input.revision) || Number(input.revision) < 1 ||
    !Number.isSafeInteger(input.acceptedRunCount) || Number(input.acceptedRunCount) < 0 || typeof input.enabled !== "boolean") {
    throw new Error("Malformed automation definition");
  }
  validatePrompt(input.prompt); validateMissedPolicy(input.missedPolicy); validateSchedule(recurrence.schedule);
  if (!["current", "existing", "new-reuse", "new-each-run"].includes(String(target.kind)) ||
    (target.kind !== "new-each-run" && !text(target.sessionID))) throw new Error("Malformed automation target");
  for (const key of ["label", "pauseReason", "lastError"]) if (input[key] !== undefined && typeof input[key] !== "string") throw new Error(`Malformed ${key}`);
  for (const key of ["consumedThrough", "pendingOccurrence"]) if (input[key] !== undefined && !time(input[key])) throw new Error(`Malformed ${key}`);
  for (const key of ["removed", "pendingSetup", "setupEnable"]) if (input[key] !== undefined && typeof input[key] !== "boolean") throw new Error(`Malformed ${key}`);
  if (target.title !== undefined && typeof target.title !== "string") throw new Error("Malformed target title");
  if (input.lastOutcome !== undefined && !["succeeded", "failed", "interrupted", "cancelled"].includes(String(input.lastOutcome))) throw new Error("Malformed outcome");
  if (input.run !== undefined) {
    const run = object(input.run);
    if (!time(run.occurrence) || !Number.isSafeInteger(run.revision) || Number(run.revision) < 1 || !text(run.sessionID) ||
      !text(run.messageID) || !text(run.prompt) || typeof run.accepted !== "boolean" || typeof run.delivered !== "boolean" ||
      !["creating", "preparing", "queued", "running", "unresolved"].includes(String(run.phase))) throw new Error("Malformed recovery record");
  }
  if (input.selection !== undefined) {
    const selection = object(input.selection);
    if (selection.agent !== undefined && !text(selection.agent)) throw new Error("Malformed agent selection");
    if (selection.model !== undefined) { const model = object(selection.model); if (!text(model.id) || !text(model.providerID) || (model.variant !== undefined && !text(model.variant))) throw new Error("Malformed model selection"); }
    if (selection.permissions !== undefined && (!Array.isArray(selection.permissions) || selection.permissions.some(rule => {
      const r = object(rule); return !text(r.action) || !text(r.resource) || !["allow", "deny", "ask"].includes(String(r.effect));
    }))) throw new Error("Malformed permissions");
  }
  return structuredClone(input) as unknown as AutomationRecord;
}

export class AutomationStore {
  private readonly records = new Map<string, AutomationRecord>();
  private readonly writers = new Map<string, Promise<unknown>>();
  readonly issues: StoreIssue[] = [];
  private loaded = false;
  private closed = false;
  readonly prefix: string;

  constructor(private readonly storage: Storage, readonly owner: AutomationOwner) { this.prefix = scopePrefix(owner); }

  async load(): Promise<void> {
    if (this.loaded) return;
    const found = new Map<string, AutomationRecord>();
    const issues: StoreIssue[] = [];
    let after: string | undefined;
    const cursors = new Set<string>();
    do {
      const page = await this.storage.scan({ prefix: this.prefix, limit: 100, ...(after !== undefined ? { after } : {}) });
      for (const entry of page.entries) {
        if (!entry.key.startsWith(this.prefix)) continue;
        try {
          const record = decodeRecord(entry.value);
          if (!sameAutomationOwner(record.owner, this.owner) || entry.key !== this.key(record.id)) throw new Error("Automation ownership/key mismatch");
          found.set(record.id, record);
        } catch (error) { issues.push({ key: entry.key, message: String(error).slice(0, 500) }); }
      }
      after = page.next;
      if (after !== undefined && cursors.has(after)) throw new Error("Storage pagination cursor repeated");
      if (after !== undefined) cursors.add(after);
    } while (after !== undefined);
    this.records.clear(); for (const [id, record] of found) this.records.set(id, record);
    this.issues.splice(0, this.issues.length, ...issues); this.loaded = true;
  }

  key(id: string): string { return this.prefix + encodeURIComponent(id); }
  list(includeRemoved = false): AutomationRecord[] {
    this.assertLoaded();
    return [...this.records.values()].filter(record => includeRemoved || !record.removed).map(record => structuredClone(record));
  }
  get(id: string, includeRemoved = false): AutomationRecord {
    this.assertLoaded(); const record = this.records.get(id);
    if (!record || (record.removed && !includeRemoved)) throw new SchedulerError("not-found", "Automation not found in this location");
    return structuredClone(record);
  }

  async mutate<T>(id: string, change: (previous: AutomationRecord | undefined) => Promise<{ record?: AutomationRecord; result: T }> | { record?: AutomationRecord; result: T }): Promise<T> {
    this.assertLoaded();
    const operation = (this.writers.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      this.assertLoaded();
      if (this.issues.some(issue => issue.key === this.key(id))) throw new SchedulerError("invalid-input", "Cannot overwrite an unreadable automation record");
      const previous = this.records.get(id);
      const next = await change(previous ? structuredClone(previous) : undefined);
      this.assertLoaded();
      if (next.record) {
        const record = decodeRecord(next.record);
        if (record.id !== id || !sameAutomationOwner(record.owner, this.owner)) throw new SchedulerError("invalid-input", "Cannot change automation identity or ownership");
        await this.storage.set(this.key(id), JSON.parse(JSON.stringify(record)));
        if (!this.closed) this.records.set(id, record);
      } else {
        await this.storage.remove(this.key(id)); this.records.delete(id);
      }
      return next.result;
    });
    this.writers.set(id, operation);
    try { return await operation; } finally { if (this.writers.get(id) === operation) this.writers.delete(id); }
  }

  close(): void { this.closed = true; }
  private assertLoaded(): void { if (!this.loaded || this.closed) throw new SchedulerError("closed", "Automation storage is not loaded or has closed"); }
}
