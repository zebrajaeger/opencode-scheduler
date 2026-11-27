import { randomUUID } from "node:crypto";
import { CoordinationError, assertScope, type Json, type SessionRef } from "./orchestration-domain.js";
import { CoordinationStore } from "./orchestration-store.js";
import { matchesSignal } from "./coordination-commands.js";
import { SessionMessage } from "@opencode/schema/session-message";
import { createHash } from "node:crypto";
import { causalEvidence, claimActivation, dataEnvelope, newCausation, validatedCausation, type Causation } from "./coordination-safety.js";

export interface SignalCondition {
  kind: "signal";
  name: string;
  producerSessionID?: string;
  correlationID?: string;
  taskID?: string;
  evidence: "future" | "existing_or_future";
}
export interface TimeCondition { kind: "time"; dueAt?: number; intervalSeconds?: number }
export interface SessionCondition { kind: "session"; sessionID: string; predicate: "idle" | "busy" | "retry" | "succeeded" | "failed" | "interrupted"; evidence: "future" | "existing_or_future" }
export type JobCondition = SignalCondition | TimeCondition | SessionCondition;
export interface JobInput {
  label: string;
  operator: "all" | "any";
  conditions: JobCondition[];
  target: SessionRef;
  action: { mode: "prompt" | "message"; text: string };
  lifetimeSeconds?: number;
  mode?: "once" | "repeat";
  until?: { operator: "all" | "any"; conditions: SignalCondition[] };
  timeoutSeconds?: number;
  timeoutAction?: { mode: "prompt" | "message"; text: string };
  sourceFailurePolicy?: "fail" | "ignore" | "match";
  outputTaskID?: string;
}

function record(value: Json): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CoordinationError("storage-unavailable", "Invalid job record");
  return value;
}

export class OrchestrationJobs {
  constructor(private readonly store: CoordinationStore, private readonly now: () => number = Date.now,
    private readonly id: () => string = randomUUID,
    private readonly sessionState: (sessionID: string) => "idle" | "busy" | "retry" | "unknown" = () => "unknown",
    private readonly nativeReplayAvailable: boolean | (() => boolean) = false,
    private readonly minimumSpacingSeconds = 30,
    private readonly nativeWatermark: (sessionID: string) => number | undefined = () => undefined,
    private readonly limits = { conditions: 16, ownerJobs: 100, projectJobs: 1000, maxLifetimeSeconds: 604800, causalHops: 8, chainActivations: 20, textBytes: 16384, activationBytes: 65536 }) {}

  create(caller: SessionRef, input: JobInput, resolvedSources: SessionRef[] = [], causation: Causation = newCausation()) {
    causation = validatedCausation(causation);
    this.authorize(caller);
    for (const source of resolvedSources) assertScope(caller, source);
    this.validate(input);
    assertScope(caller, input.target);
    if (!["all", "any"].includes(input.operator) || !Array.isArray(input.conditions) || input.conditions.length < 1 || input.conditions.length > this.limits.conditions) throw new CoordinationError("invalid-input", "Jobs exceed the bounded ALL/ANY condition count");
    if (!input.label.trim() || input.label.length > 1024 || !input.action.text.trim() || Buffer.byteLength(input.action.text) > this.limits.textBytes || !["prompt", "message"].includes(input.action.mode)) throw new CoordinationError("invalid-input", "Invalid job label or action");
    const lifetime = input.lifetimeSeconds ?? 3600;
    if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > this.limits.maxLifetimeSeconds) throw new CoordinationError("invalid-input", "Invalid job lifetime");
    if (input.mode !== undefined && !["once", "repeat"].includes(input.mode)) throw new CoordinationError("invalid-input", "Invalid job mode");
    if (input.timeoutSeconds !== undefined && (!Number.isSafeInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > lifetime)) throw new CoordinationError("invalid-input", "Timeout must fit within lifetime");
    if (input.sourceFailurePolicy !== undefined && !["fail", "ignore", "match"].includes(input.sourceFailurePolicy)) throw new CoordinationError("invalid-input", "Invalid source failure policy");
    if (input.until && (!["all", "any"].includes(input.until.operator) || input.until.conditions.length < 1 || input.until.conditions.length > this.limits.conditions)) throw new CoordinationError("invalid-input", "Invalid stop group");
    if (input.timeoutAction && (!["prompt", "message"].includes(input.timeoutAction.mode) || !input.timeoutAction.text.trim() || Buffer.byteLength(input.timeoutAction.text) > this.limits.textBytes)) throw new CoordinationError("invalid-input", "Invalid timeout action");
    for (const condition of [...input.conditions, ...(input.until?.conditions ?? [])]) {
      if (condition.kind === "session") {
        if (!["idle", "busy", "retry", "succeeded", "failed", "interrupted"].includes(condition.predicate) || !condition.sessionID || !["future", "existing_or_future"].includes(condition.evidence)) throw new CoordinationError("invalid-input", "Invalid session condition");
        if (["succeeded", "failed", "interrupted"].includes(condition.predicate) && !(typeof this.nativeReplayAvailable === "function" ? this.nativeReplayAvailable() : this.nativeReplayAvailable)) throw new CoordinationError("unsupported-capability", "Native execution triggers require verified durable replay");
        if (["succeeded", "failed", "interrupted"].includes(condition.predicate) && this.nativeWatermark(condition.sessionID) === undefined) throw new CoordinationError("history-unavailable", "Native source has not synchronized to its watermark");
        continue;
      }
      if (condition.kind === "time") {
        if (condition.intervalSeconds !== undefined && (!Number.isSafeInteger(condition.intervalSeconds) || condition.intervalSeconds < this.minimumSpacingSeconds)) throw new CoordinationError("invalid-input", "Intervals must meet the configured minimum spacing");
        if (condition.dueAt !== undefined && (!Number.isSafeInteger(condition.dueAt) || condition.dueAt < 1)) throw new CoordinationError("invalid-input", "Invalid due time");
        if (condition.dueAt === undefined && condition.intervalSeconds === undefined) throw new CoordinationError("invalid-input", "Time condition requires dueAt or intervalSeconds");
        const due = condition.dueAt ?? this.now() + condition.intervalSeconds! * 1000;
        if (due >= this.now() + lifetime * 1000) throw new CoordinationError("invalid-input", "First due time must precede expiry");
        if (input.mode === "repeat" && condition.intervalSeconds === undefined) throw new CoordinationError("invalid-input", "A recurring time driver requires an interval");
        continue;
      }
      if (condition.kind !== "signal" || !/^[a-z][a-z0-9.-]{0,127}$/.test(condition.name) || !["future", "existing_or_future"].includes(condition.evidence)) throw new CoordinationError("invalid-input", "Invalid signal condition");
      if (condition.name.startsWith("scheduler.") && !["scheduler.task.completed", "scheduler.task.failed", "scheduler.task.cancelled"].includes(condition.name)) throw new CoordinationError("unsupported-capability", "Reserved native events require a verified session condition");
      if (condition.name.startsWith("scheduler.task.") && (!condition.taskID || !condition.producerSessionID)) throw new CoordinationError("invalid-input", "Business task conditions require a pinned producer and task");
      if (condition.taskID) {
        const task = this.store.get("tasks", condition.taskID, caller.projectID);
        if (!task || task.ownerID !== condition.producerSessionID) throw new CoordinationError("not-found", "Pinned producer task not found in this project");
      }
    }
    if (input.mode === "repeat" && !input.conditions.some(c => c.kind !== "session" || !["idle", "busy", "retry"].includes(c.predicate))) throw new CoordinationError("invalid-input", "Recurring jobs require an edge or time driver, not just levels");
    return this.store.transaction(() => {
      let ownerCount = 0, projectCount = 0, quotaCursor = "";
      while (true) {
        const rows = this.store.projectRecords("jobs", caller.projectID, quotaCursor);
        for (const row of rows) if (!["completed", "cancelled", "failed", "timed_out"].includes(String(record(row.body).state))) {
          projectCount++; if (row.ownerID === caller.sessionID) ownerCount++;
        }
        if (rows.length < 100) break;
        quotaCursor = rows.at(-1)!.id;
      }
      if (ownerCount >= this.limits.ownerJobs || projectCount >= this.limits.projectJobs) throw new CoordinationError("resource-limit", "Live job quota exhausted");
      if (input.outputTaskID) {
        const task = this.store.get("tasks", input.outputTaskID, caller.projectID);
        if (!task || task.ownerID !== caller.sessionID || input.target.sessionID !== caller.sessionID) throw new CoordinationError("scope-denied", "Output task declaration requires producer ownership");
        if (input.conditions.some(c => c.kind === "signal" && c.taskID === input.outputTaskID)) throw new CoordinationError("cycle-detected", "A task cannot wait for itself");
        const edges = new Map<string, string[]>();
        let cursor = "";
        while (true) {
          const rows = this.store.projectRecords("jobs", caller.projectID, cursor);
          for (const row of rows) {
            const job = record(row.body);
            if (typeof job.outputTaskID === "string" && !["completed", "cancelled", "failed", "timed_out"].includes(String(job.state))) {
              edges.set(job.outputTaskID, [...(edges.get(job.outputTaskID) ?? []), ...(job.conditions as unknown as JobCondition[]).flatMap(c => c.kind === "signal" && c.taskID ? [c.taskID] : [])]);
            }
          }
          if (rows.length < 100) break;
          cursor = rows.at(-1)!.id;
        }
        const dependencies = input.conditions.flatMap(c => c.kind === "signal" && c.taskID ? [c.taskID] : []);
        edges.set(input.outputTaskID, [...(edges.get(input.outputTaskID) ?? []), ...dependencies]);
        const visit = (task: string, stack: Set<string>, visited: Set<string>): void => {
          if (stack.has(task)) throw new CoordinationError("cycle-detected", "Declared task dependencies contain a cycle");
          if (visited.has(task)) return;
          stack.add(task);
          for (const dependency of edges.get(task) ?? []) visit(dependency, stack, visited);
          stack.delete(task); visited.add(task);
        };
        visit(input.outputTaskID, new Set(), new Set());
      }
      if ([...input.conditions, ...(input.until?.conditions ?? [])].some(c => c.kind !== "time" && c.evidence === "existing_or_future")) this.store.assertCompleteHistory(caller.projectID);
      const id = `job_${this.id()}`;
      const boundary = this.store.eventWatermark(caller.projectID);
      const body = JSON.parse(JSON.stringify({ id, label: input.label, ownerSessionID: caller.sessionID,
        projectID: caller.projectID, instanceID: caller.instanceID, target: input.target, action: input.action,
        owner: caller, sources: resolvedSources, causation: { ...causation },
        operator: input.operator, conditions: input.conditions, createdAt: this.now(), expiresAt: this.now() + lifetime * 1000,
        state: "waiting", boundary, mode: input.mode ?? "once", firing: 0, consumed: [],
        nativeWatermarks: Object.fromEntries(input.conditions.filter((c): c is SessionCondition => c.kind === "session").map(c => [c.sessionID, this.nativeWatermark(c.sessionID) ?? 0])),
        sourceFailurePolicy: input.sourceFailurePolicy ?? "fail",
        ...(input.until ? { until: input.until } : {}),
        ...(input.outputTaskID ? { outputTaskID: input.outputTaskID } : {}),
        ...(input.timeoutSeconds ? { deadlineAt: this.now() + input.timeoutSeconds * 1000 } : {}),
        ...(input.timeoutAction ? { timeoutAction: input.timeoutAction } : {}) })) as Json;
      this.store.insert("jobs", id, caller.projectID, caller.sessionID, body);
      this.evaluateProject(caller.projectID);
      return this.store.get("jobs", id, caller.projectID)!.body;
    });
  }

  private validate(input: JobInput): void {
    const object = (value: unknown, fields: string[]) => {
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new CoordinationError("invalid-input", "Unknown or malformed job fields");
    };
    object(input, ["label", "operator", "conditions", "target", "action", "lifetimeSeconds", "mode", "until", "timeoutSeconds", "timeoutAction", "sourceFailurePolicy", "outputTaskID"]);
    object(input.target, ["instanceID", "sessionID", "projectID", "directory", "workspaceID"]);
    if (typeof input.label !== "string") throw new CoordinationError("invalid-input", "Job label is required");
    for (const action of [input.action, ...(input.timeoutAction ? [input.timeoutAction] : [])]) {
      object(action, ["mode", "text"]);
      if (typeof action.text !== "string") throw new CoordinationError("invalid-input", "Action text is required");
    }
    if (!Array.isArray(input.conditions)) throw new CoordinationError("invalid-input", "Conditions must be an array");
    if (input.until) {
      object(input.until, ["operator", "conditions"]);
      if (!Array.isArray(input.until.conditions)) throw new CoordinationError("invalid-input", "Stop conditions must be an array");
    }
    for (const condition of [...input.conditions, ...(input.until?.conditions ?? [])]) {
      if (!condition || typeof condition !== "object") throw new CoordinationError("invalid-input", "Condition must be an object");
      if (condition.kind === "signal") object(condition, ["kind", "name", "producerSessionID", "correlationID", "taskID", "evidence"]);
      else if (condition.kind === "time") object(condition, ["kind", "dueAt", "intervalSeconds"]);
      else if (condition.kind === "session") object(condition, ["kind", "sessionID", "predicate", "evidence"]);
      else throw new CoordinationError("invalid-input", "Unknown condition kind");
      for (const [key, value] of Object.entries(condition)) {
        if (["dueAt", "intervalSeconds"].includes(key)) continue;
        if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new CoordinationError("invalid-input", "Condition fields must contain bounded text");
      }
    }
  }

  private authorize(caller: SessionRef): void {
    if (caller.instanceID !== this.store.instanceID) throw new CoordinationError("scope-denied", "Job instance does not match storage");
  }

  // Called within the same transaction that persists publication/registration.
  evaluateProject(projectID: string): void {
    let cursor = "";
    while (true) {
      const jobs = this.store.projectRecords("jobs", projectID, cursor);
      for (const row of jobs) {
        const job = record(row.body);
        if (!["waiting", "ready", "active", "paused"].includes(String(job.state))) continue;
        if (job.until) {
          const until = job.until as unknown as NonNullable<JobInput["until"]>;
          const stopped = until.conditions.map(condition => this.signalMatch(projectID, job, condition, 0) !== undefined);
          if (until.operator === "all" ? stopped.every(Boolean) : stopped.some(Boolean)) {
            this.store.update("jobs", row.id, projectID, row.ownerID, row.revision, { ...job, state: "completed", stopped: true });
            continue;
          }
        }
        if (Math.min(Number(job.expiresAt), Number(job.deadlineAt ?? job.expiresAt)) <= this.now()) {
          if (job.timeoutAction && !job.timeoutRunID) {
            const timeoutRunID = `run_${row.id}_timeout`;
            this.store.insert("runs", timeoutRunID, projectID, row.ownerID, { id: timeoutRunID, jobID: row.id, state: "pending", action: job.timeoutAction, reason: "timeout", createdAt: this.now() });
            this.delivery(projectID, row.ownerID, job, timeoutRunID, [], job.timeoutAction);
            job.timeoutRunID = timeoutRunID;
          }
          this.store.update("jobs", row.id, projectID, row.ownerID, row.revision, { ...job, state: "timed_out" });
          continue;
        }
        if (job.state !== "waiting" && !(job.mode === "repeat" && ["active", "ready"].includes(String(job.state)))) continue;
        const conditions = job.conditions as unknown as JobCondition[];
        if (conditions.some(condition => condition.kind === "session" && ["succeeded", "failed", "interrupted"].includes(condition.predicate) &&
          this.nativeWatermark(condition.sessionID) === undefined)) continue;
        if (job.sourceFailurePolicy === "fail") {
          const failure = conditions.find(condition => {
            if (condition.kind !== "signal" || !condition.taskID || condition.name !== "scheduler.task.completed") return false;
            const task = this.store.get("tasks", condition.taskID, projectID);
            if (!task || task.ownerID !== condition.producerSessionID) return true;
            return ["failed", "cancelled"].includes(String(record(task.body).state));
          });
          if (failure) {
            this.store.update("jobs", row.id, projectID, row.ownerID, row.revision, { ...job, state: "failed", error: "Required task failed, was cancelled, or no longer exists" });
            continue;
          }
        }
        const matches: ({ position: number; id: string; body: Json } | undefined)[] = conditions.map(condition => {
          if (condition.kind === "time") {
            const first = condition.dueAt ?? Number(job.createdAt) + condition.intervalSeconds! * 1000;
            const previous = Array.isArray(job.consumed) ? Number(job.consumed[conditions.indexOf(condition)] ?? 0) : 0;
            const slot = condition.intervalSeconds === undefined ? 0 : Math.floor((this.now() - first) / (condition.intervalSeconds * 1000));
            const due = first + Math.max(0, slot) * (condition.intervalSeconds ?? 0) * 1000;
            if (this.now() < first || due <= previous) return undefined;
            return { id: `time:${row.id}:${conditions.indexOf(condition)}:${due}`, position: due,
              body: { kind: "time", dueAt: due } };
          }
          if (condition.kind === "session") {
            if (["idle", "busy", "retry"].includes(condition.predicate)) {
              if (this.sessionState(condition.sessionID) !== condition.predicate) return undefined;
              return { id: `level:${condition.sessionID}:${condition.predicate}`, position: 0,
                body: { kind: "level", sessionID: condition.sessionID, predicate: condition.predicate } };
            }
            return this.signalMatch(projectID, job, { kind: "signal", name: `scheduler.execution.${condition.predicate}`,
              producerSessionID: condition.sessionID, evidence: condition.evidence },
            Array.isArray(job.consumed) ? Number(job.consumed[conditions.indexOf(condition)] ?? 0) : 0);
          }
          const consumed = Array.isArray(job.consumed) ? Number(job.consumed[conditions.indexOf(condition)] ?? 0) : 0;
          return this.signalMatch(projectID, job, condition, consumed);
        });
        const available = matches.filter((event): event is NonNullable<typeof event> => event !== undefined);
        // Partial ALL rounds and the next coalesced round must survive retention
        // while a previous execution is still active.
        for (const event of available) {
          if (!["time", "level"].includes(String(record(event.body).kind))) {
            this.store.pin(row.id, "events", event.id, projectID);
            const resultID = record(event.body).resultID;
            if (typeof resultID === "string") this.store.pin(row.id, "results", resultID, projectID);
          }
        }
        const levelIndexes = conditions.map((condition, index) => condition.kind === "session" && ["idle", "busy", "retry"].includes(condition.predicate) ? index : -1).filter(index => index >= 0);
        if (levelIndexes.some(index => matches[index] === undefined)) continue;
        if (job.operator === "all" && available.length !== conditions.length || !available.length) continue;
        const drivers = available.filter(event => record(event.body).kind !== "level");
        if (job.mode === "repeat" && !drivers.length) continue;
        if (job.state !== "waiting") {
          if (!job.pendingFiring) this.store.update("jobs", row.id, projectID, row.ownerID, row.revision, { ...job, pendingFiring: true });
          continue;
        }
        const selected = job.operator === "any" && drivers.length ? [drivers.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0]!,
          ...available.filter(event => record(event.body).kind === "level")] : available;
        const evidence = [...new Map(selected.map(event => [event.id, event])).values()].map(event => {
          const resultID = record(event.body).resultID;
          if (typeof resultID !== "string") return event;
          const result = this.store.get("results", resultID, projectID);
          if (!result) throw new CoordinationError("history-unavailable", "Matched immutable result is unavailable");
          return { ...event, body: { ...record(event.body), result: result.body } };
        });
        const firing = Number(job.firing ?? 0) + 1;
        const runID = `run_${row.id}_${firing}`;
        const resultIDs = evidence.map(event => record(event.body).resultID).filter((id): id is string => typeof id === "string");
        const run = { id: runID, jobID: row.id, state: "pending", matchedEventIDs: evidence.map(event => event.id),
          resultIDs, evidence: evidence.map(event => event.body), createdAt: this.now() };
        try {
          const cause = causalEvidence([...evidence.map(event => event.body), ...(job.causation ? [job.causation] : [])], this.limits.causalHops);
          const root = this.store.get("checkpoints", `root:${cause.rootID}`, projectID);
          if (root && Number(record(root.body).activations) >= this.limits.chainActivations) throw new CoordinationError("resource-limit", "Automatic root activation budget exhausted");
          dataEnvelope(String(record(job.action!).text), evidence.map(event => event.body), this.limits.activationBytes);
        } catch (error) {
          if (!(error instanceof CoordinationError) || error.code !== "resource-limit") throw error;
          this.store.update("jobs", row.id, projectID, row.ownerID, row.revision, { ...job, state: "paused", error: error.message });
          continue;
        }
        this.store.insert("runs", runID, projectID, row.ownerID, run);
        this.delivery(projectID, row.ownerID, job, runID, evidence.map(event => event.body), job.action!);
        for (const event of evidence) if (!["time", "level"].includes(String(record(event.body).kind))) this.store.pin(runID, "events", event.id, projectID);
        for (const id of resultIDs) this.store.pin(runID, "results", id, projectID);
        const consumed = matches.map((event, index) => {
          const previous = Array.isArray(job.consumed) ? Number(job.consumed[index] ?? 0) : 0;
          return event && evidence.some(selected => selected.id === event.id) ? event.position : previous;
        });
        this.store.update("jobs", row.id, projectID, row.ownerID, row.revision, { ...job, state: "ready", runID, firing, consumed, pendingFiring: false });
      }
      if (jobs.length < 100) break;
      cursor = jobs.at(-1)!.id;
    }
  }

  evaluate(projectID: string): void { this.store.transaction(() => this.evaluateProject(projectID)); }

  list(caller: SessionRef, limit = 20, cursor = "") {
    this.authorize(caller);
    const jobs = this.store.list("jobs", caller.projectID, caller.sessionID, limit, cursor);
    const result = jobs.map(job => {
      const body = record(job.body);
      const run = typeof body.runID === "string" ? this.store.get("runs", body.runID, caller.projectID) : undefined;
      const timeoutRun = typeof body.timeoutRunID === "string" ? this.store.get("runs", body.timeoutRunID, caller.projectID) : undefined;
      return { ...job, revision: this.store.get("jobs", job.id, caller.projectID)!.revision,
        ...(run && run.ownerID === caller.sessionID ? { run: run.body } : {}),
        ...(timeoutRun && timeoutRun.ownerID === caller.sessionID ? { timeoutRun: timeoutRun.body } : {}) };
    });
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > this.limits.activationBytes) throw new CoordinationError("resource-limit", "Job diagnostic page exceeds byte limit; request a smaller page");
    return result;
  }

  private delivery(projectID: string, ownerID: string, job: Record<string, Json>, runID: string, evidence: Json[], actionValue: Json) {
    const action = record(actionValue);
    const text = dataEnvelope(String(action.text), evidence, this.limits.activationBytes);
    const cause = causalEvidence([...evidence, ...(job.causation ? [job.causation] : [])], this.limits.causalHops);
    claimActivation(this.store, projectID, ownerID, cause, this.limits.chainActivations);
    this.store.insert("deliveries", `delivery_${runID}`, projectID, ownerID, {
      id: `delivery_${runID}`, runID, jobID: job.id!, target: job.target!, ownerSessionID: ownerID,
      mode: action.mode!, text, messageID: SessionMessage.ID.create(), state: "pending", attempts: 0,
      payloadHash: createHash("sha256").update(text).digest("hex"), createdAt: this.now(), nextAttemptAt: this.now(),
      ...cause,
    });
  }

  private signalMatch(projectID: string, job: Record<string, Json>, condition: SignalCondition, consumed: number) {
    let after = Math.max(consumed, condition.evidence === "future" ? Number(job.boundary) : 0);
    while (true) {
      const events = this.store.events(projectID, after);
      for (const event of events) if (matchesSignal(event.body, { projectID, instanceID: String(job.instanceID),
        name: condition.name, ...(condition.producerSessionID ? { producerSessionID: condition.producerSessionID } : {}),
        ...(condition.correlationID ? { correlationID: condition.correlationID } : {}),
        ...(condition.taskID ? { taskID: condition.taskID } : {}) })) {
          if (condition.name.startsWith("scheduler.execution.") && condition.evidence === "future" && condition.producerSessionID) {
            const watermarks = job.nativeWatermarks && typeof job.nativeWatermarks === "object" && !Array.isArray(job.nativeWatermarks) ? job.nativeWatermarks : {};
            if (Number(record(event.body).sourceSequence) <= Number(watermarks[condition.producerSessionID] ?? 0)) continue;
          }
          return event;
        }
      if (events.length < 100) return undefined;
      after = events.at(-1)!.position;
    }
  }

  control(caller: SessionRef, jobID: string, operation: "pause" | "resume" | "cancel", expectedRevision: number) {
    this.authorize(caller);
    if (!["pause", "resume", "cancel"].includes(operation) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new CoordinationError("invalid-input", "Invalid operation or revision");
    return this.store.transaction(() => {
      const row = this.store.get("jobs", jobID, caller.projectID);
      if (!row || row.ownerID !== caller.sessionID) throw new CoordinationError("not-found", "Owned job not found");
      const job = record(row.body);
      if (operation === "cancel" && job.state === "cancelled") return { state: job.state, revision: row.revision };
      if (row.revision !== expectedRevision) throw new CoordinationError("conflict", "Job revision changed");
      if (["completed", "cancelled", "failed", "timed_out"].includes(String(job.state))) throw new CoordinationError("conflict", "Job is terminal");
      if (operation === "resume" && job.runID) {
        const run = this.store.get("runs", String(job.runID), caller.projectID);
        if (run && !["pending", "cancelled", "failed", "settled"].includes(String(record(run.body).state))) throw new CoordinationError("uncertain-delivery", "Accepted or uncertain work must be reconciled before resuming");
      }
      let state = operation === "cancel" ? "cancelled" : operation === "pause" ? "paused" : job.runID ? "ready" : "waiting";
      if (operation === "resume" && job.runID) {
        const run = this.store.get("runs", String(job.runID), caller.projectID);
        if (run && ["settled", "cancelled", "failed"].includes(String(record(run.body).state))) {
          // Resuming permits future rounds; it must not replay the previous
          // execution's business effects or leave a ready job with no intent.
          state = job.mode === "repeat" ? "waiting" : record(run.body).hostOutcome === "succeeded" ? "completed" : "failed";
        }
      }
      const revision = this.store.update("jobs", jobID, caller.projectID, caller.sessionID, row.revision, { ...job, state });
      this.evaluateProject(caller.projectID);
      return { state, revision, acceptedWorkMayStillRun: job.state === "active" };
    });
  }

  sourceUnavailable(projectID: string, sessionID: string, reason: "deleted" | "moved"): void {
    this.store.transaction(() => {
      let cursor = "";
      while (true) {
        const rows = this.store.projectRecords("jobs", projectID, cursor);
        for (const row of rows) {
          const job = record(row.body);
          if (!["waiting", "ready", "paused"].includes(String(job.state))) continue;
          const conditions = job.conditions as unknown as JobCondition[];
          if (job.sourceFailurePolicy === "fail" && conditions.some(c => c.kind === "signal" && c.producerSessionID === sessionID)) {
            this.store.update("jobs", row.id, projectID, row.ownerID, row.revision, { ...job, state: "failed", error: `Required source ${reason}` });
          }
        }
        if (rows.length < 100) break;
        cursor = rows.at(-1)!.id;
      }
    });
  }

  finish(caller: SessionRef, jobID: string): void {
    this.store.transaction(() => {
      const row = this.store.get("jobs", jobID, caller.projectID);
      if (!row || row.ownerID !== caller.sessionID) throw new CoordinationError("not-found", "Owned job not found");
      const job = record(row.body);
      if (job.state !== "active") throw new CoordinationError("conflict", "Only a settled active run can finish a job");
      const run = this.store.get("runs", String(job.runID), caller.projectID);
      if (!run || record(run.body).state !== "settled") throw new CoordinationError("conflict", "Run settlement evidence is required");
      this.store.update("jobs", jobID, caller.projectID, caller.sessionID, row.revision,
        { ...job, state: job.mode === "repeat" ? "waiting" : "completed" });
      this.evaluateProject(caller.projectID);
    });
  }
}
