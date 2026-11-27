import { createHash, randomUUID } from "node:crypto";
import { CoordinationError, transitionTask, type Json, type SessionRef, type TaskState } from "./orchestration-domain.js";
import { CoordinationStore } from "./orchestration-store.js";
import { newCausation, validatedCausation, type Causation } from "./coordination-safety.js";

export interface TaskInput { taskID?: string; title?: string; state: TaskState; expectedRevision?: number; idempotencyKey: string; summary?: string; data?: Json; references?: string[] }
export interface CommandLimits { payloadBytes: number; textBytes: number; projectEntries: number }
const defaults: CommandLimits = { payloadBytes: 32 * 1024, textBytes: 16 * 1024, projectEntries: 10_000 };

export function matchesSignal(event: Json, filter: { projectID: string; instanceID: string; name: string; producerSessionID?: string; correlationID?: string; taskID?: string }): boolean {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false;
  return event.projectID === filter.projectID && event.instanceID === filter.instanceID && event.name === filter.name &&
    (filter.producerSessionID === undefined || event.producerSessionID === filter.producerSessionID) &&
    (filter.correlationID === undefined || event.correlationID === filter.correlationID) &&
    (filter.taskID === undefined || event.taskID === filter.taskID);
}

export class CoordinationCommands {
  constructor(private readonly store: CoordinationStore, private readonly limits = defaults,
    private readonly now: () => number = Date.now, private readonly id: () => string = randomUUID,
    private readonly evaluate: (projectID: string) => void = () => {}) {}

  private text(text: string, maximum = this.limits.textBytes): void {
    if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text, "utf8") > maximum) throw new CoordinationError("invalid-input", "Text is empty or exceeds its UTF-8 byte limit");
  }

  private json(value: unknown): Json {
    const visit = (item: unknown, depth: number): void => {
      if (depth > 32) throw new CoordinationError("invalid-input", "Payload nesting exceeds limit");
      if (item === null || typeof item === "boolean" || typeof item === "string") return;
      if (typeof item === "number" && Number.isFinite(item)) return;
      if (Array.isArray(item)) { for (const child of item) visit(child, depth + 1); return; }
      if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) { for (const child of Object.values(item)) visit(child, depth + 1); return; }
      throw new CoordinationError("invalid-input", "Payload must be finite JSON data");
    };
    visit(value, 0);
    const encoded = JSON.stringify(value);
    if (Buffer.byteLength(encoded, "utf8") > this.limits.payloadBytes) throw new CoordinationError("resource-limit", "JSON payload exceeds byte limit");
    return JSON.parse(encoded) as Json;
  }

  private key(caller: SessionRef, namespace: string, key: string): string {
    if (caller.instanceID !== this.store.instanceID) throw new CoordinationError("scope-denied", "Command instance does not match storage");
    this.text(key, 128);
    return createHash("sha256").update(JSON.stringify([caller.instanceID, caller.projectID, caller.sessionID, namespace, key])).digest("hex");
  }

  private body(value: Json): Record<string, Json> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new CoordinationError("storage-unavailable", "Invalid persisted command record");
    return value;
  }

  task(caller: SessionRef, input: TaskInput, causation: Causation = newCausation()) {
    causation = validatedCausation(causation);
    if (Object.keys(input).some(key => !["taskID", "title", "state", "expectedRevision", "idempotencyKey", "summary", "data", "references"].includes(key))) throw new CoordinationError("invalid-input", "Unknown task publication field");
    const terminal = ["completed", "failed", "cancelled"].includes(input.state);
    if (!["open", "working", "waiting_input", "completed", "failed", "cancelled"].includes(input.state)) throw new CoordinationError("invalid-input", "Unknown task state");
    if (input.title !== undefined) this.text(input.title, 1024);
    if (terminal) this.text(input.summary ?? "");
    const data = input.data === undefined ? undefined : this.json(input.data);
    const references = input.references ?? [];
    if (!Array.isArray(references) || references.length > 16) throw new CoordinationError("resource-limit", "Result references must be an array of at most 16 strings");
    for (const reference of references) this.text(reference, 2048);
    const publication = this.key(caller, "task", input.idempotencyKey);
    const request = this.json({ ...input });
    return this.store.transaction(() => {
      const replay = this.store.get("checkpoints", `command:${publication}`, caller.projectID);
      if (replay) {
        const saved = this.body(replay.body);
        if (JSON.stringify(saved.request) !== JSON.stringify(request)) throw new CoordinationError("conflict", "Task command key already used with different content");
        return saved.response;
      }
      this.store.enforceCapacity(caller.projectID, this.limits.projectEntries);
      const taskID = input.taskID ?? `task_${publication}`;
      const existing = this.store.get("tasks", taskID, caller.projectID);
      if (existing && existing.ownerID !== caller.sessionID) throw new CoordinationError("not-found", "Owned task not found");
      if (!existing && input.taskID) throw new CoordinationError("not-found", "Owned task not found");
      if (!existing && !input.title) throw new CoordinationError("invalid-input", "A new task requires a title");
      const previous = existing ? this.body(existing.body) : undefined;
      if (existing && input.expectedRevision !== existing.revision) throw new CoordinationError("conflict", "Expected task revision does not match");
      if (previous && ["completed", "failed", "cancelled"].includes(String(previous.state))) throw new CoordinationError("conflict", "Terminal task publication is immutable; retry the original publication key");
      if (previous) transitionTask(previous.state as TaskState, input.state);
      const revision = existing ? existing.revision + 1 : 0;
      const resultID = terminal ? `result_${publication}` : undefined;
      const task = { id: taskID, title: input.title ?? previous?.title ?? "", state: input.state, producerSessionID: caller.sessionID,
        projectID: caller.projectID, instanceID: caller.instanceID, createdAt: previous?.createdAt ?? this.now(), updatedAt: this.now(),
        ...(resultID ? { resultID } : {}) };
      if (existing) this.store.update("tasks", taskID, caller.projectID, caller.sessionID, existing.revision, task);
      else this.store.insert("tasks", taskID, caller.projectID, caller.sessionID, task);
      if (terminal && resultID) {
        const result = { id: resultID, schemaVersion: 1, taskID, outcome: input.state, summary: input.summary!,
          ...(data !== undefined ? { data } : {}), references, producerSessionID: caller.sessionID,
          projectID: caller.projectID, instanceID: caller.instanceID, createdAt: this.now(), correlationID: taskID, ...causation };
        this.store.insert("results", resultID, caller.projectID, caller.sessionID, result);
        this.store.pin(`task:${taskID}`, "results", resultID, caller.projectID);
        this.store.appendEvent(`event_${publication}`, caller.projectID, `${caller.instanceID}:plugin`, undefined,
          { name: `scheduler.task.${input.state}`, taskID, resultID, producerSessionID: caller.sessionID,
            projectID: caller.projectID, instanceID: caller.instanceID, correlationID: taskID, createdAt: this.now(), ...causation });
      }
      const response = { taskID, state: input.state, revision, ...(resultID ? { resultID } : {}) };
      this.store.insert("checkpoints", `command:${publication}`, caller.projectID, caller.sessionID, { request, response });
      this.evaluate(caller.projectID);
      return response;
    });
  }

  signal(caller: SessionRef, input: { name: string; payload?: Json; correlationID?: string; taskID?: string; idempotencyKey: string }, causation: Causation = newCausation()) {
    causation = validatedCausation(causation);
    if (Object.keys(input).some(key => !["name", "payload", "correlationID", "taskID", "idempotencyKey"].includes(key))) throw new CoordinationError("invalid-input", "Unknown signal publication field");
    if (!/^[a-z][a-z0-9.-]{0,127}$/.test(input.name) || input.name.startsWith("scheduler.")) throw new CoordinationError("invalid-input", "Signal name is invalid or reserved");
    if (input.correlationID !== undefined) this.text(input.correlationID, 128);
    const payload = input.payload === undefined ? undefined : this.json(input.payload);
    const key = this.key(caller, "signal", input.idempotencyKey);
    const id = `signal_${key}`;
    const request = this.json({ ...input });
    return this.store.transaction(() => {
      const replay = this.store.get("checkpoints", `signal:${key}`, caller.projectID);
      if (replay) {
        const saved = this.body(replay.body);
        if (JSON.stringify(saved.request) !== JSON.stringify(request)) throw new CoordinationError("conflict", "Signal key already used with a different payload");
        return saved.response;
      }
      this.store.enforceCapacity(caller.projectID, this.limits.projectEntries);
      if (input.taskID) {
        const task = this.store.get("tasks", input.taskID, caller.projectID);
        if (!task || task.ownerID !== caller.sessionID) throw new CoordinationError("not-found", "Producer task not found");
      }
      const event = { id, name: input.name, ...(payload !== undefined ? { payload } : {}),
        ...(input.taskID ? { taskID: input.taskID } : {}), correlationID: input.correlationID ?? input.taskID ?? this.id(),
        producerSessionID: caller.sessionID, instanceID: caller.instanceID, projectID: caller.projectID, createdAt: this.now(), ...causation };
      this.store.appendEvent(id, caller.projectID, `${caller.instanceID}:plugin`, undefined, event);
      const response = { id, stored: true };
      this.store.insert("checkpoints", `signal:${key}`, caller.projectID, caller.sessionID, { request, response });
      this.evaluate(caller.projectID);
      return response;
    });
  }
}
