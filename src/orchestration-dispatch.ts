import type { Plugin } from "@opencode/plugin";
import { randomUUID } from "node:crypto";
import { CoordinationStore } from "./orchestration-store.js";
import { AdmissionGate } from "./admission-gate.js";
import type { HostEvent } from "./scheduler.js";
import type { Json, SessionRef } from "./orchestration-domain.js";
import { OrchestrationJobs } from "./orchestration-jobs.js";

function record(value: Json): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid delivery record");
  return value;
}

export class OrchestrationDispatch {
  private closed = false;
  private running = false;
  private readonly worker = randomUUID();
  private readonly epochs = new Map<string, number>();
  private readonly sequences = new Map<string, number>();
  constructor(private readonly store: CoordinationStore, private readonly gate: AdmissionGate,
    private readonly host: Pick<Plugin.Context["session"], "get" | "prompt">,
    private readonly jobs: OrchestrationJobs, private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random) {}

  async pulse(projectID: string): Promise<void> {
    if (this.closed || this.running) return;
    this.running = true;
    try {
      this.jobs.evaluate(projectID);
      let cursor = "";
      while (!this.closed) {
        const rows = this.store.projectRecords("deliveries", projectID, cursor);
        for (const row of rows) {
          if (this.closed) break;
          const delivery = record(row.body);
          if (delivery.state !== "pending" || Number(delivery.nextAttemptAt) > this.now()) continue;
          const fence = this.store.claim(row.id, this.worker, this.now(), 30_000);
          if (fence === undefined) continue;
          try { await this.submit(projectID, row.id, fence); }
          finally { if (!this.closed) this.store.release(row.id, this.worker, fence); }
        }
        if (rows.length < 100) break;
        cursor = rows.at(-1)!.id;
      }
    } finally { this.running = false; }
  }

  private async submit(projectID: string, id: string, fence: number): Promise<void> {
    const first = this.store.get("deliveries", id, projectID)!;
    const before = record(first.body);
    const target = before.target as unknown as SessionRef;
    let submitted = false;
    let gateAcquired = false;
    try {
      const info = await this.host.get({ sessionID: target.sessionID });
      if (this.closed || !this.store.ownsClaim(id, this.worker, fence, this.now())) return;
      if (info.id !== target.sessionID || info.projectID !== projectID || info.location.directory !== target.directory || target.instanceID !== this.store.instanceID) {
        this.fail(projectID, id, "Target moved outside recorded location", true); return;
      }
      const originalJob = this.store.get("jobs", String(before.jobID), projectID);
      if (!originalJob) { this.fail(projectID, id, "Job no longer exists", true); return; }
      const snapshot = record(originalJob.body);
      const identities = [snapshot.owner, ...(Array.isArray(snapshot.sources) ? snapshot.sources : [])]
        .filter((identity): identity is NonNullable<typeof identity> => identity !== undefined && identity !== null);
      for (const identity of identities) {
        const expected = identity as unknown as SessionRef;
        const current = expected.sessionID === target.sessionID ? info : await this.host.get({ sessionID: expected.sessionID });
        if (this.closed || !this.store.ownsClaim(id, this.worker, fence, this.now())) return;
        if (current.id !== expected.sessionID || current.projectID !== projectID || current.location.directory !== expected.directory) {
          this.fail(projectID, id, "Owner or source moved outside its recorded scope", true); return;
        }
      }
      const busy = info.time.busy, idle = info.time.idle;
      if (before.mode !== "message" && busy !== undefined && (idle === undefined || busy >= idle)) return;
      this.jobs.evaluate(projectID);
      const row = this.store.get("deliveries", id, projectID)!;
      const delivery = record(row.body);
      if (delivery.state !== "pending") return;
      const jobRow = this.store.get("jobs", String(delivery.jobID), projectID);
      if (!jobRow) { this.fail(projectID, id, "Job no longer exists", true); return; }
      const job = record(jobRow.body);
      if (jobRow.revision !== originalJob.revision) return;
      const timeout = String(delivery.runID).endsWith("_timeout");
      if (timeout ? job.state !== "timed_out" : job.state !== "ready") return;
      if (delivery.mode === "message") {
        this.store.withClaim(id, this.worker, fence, this.now(), () => {
          this.store.enforceCapacity(projectID, 10_000);
          if (this.store.list("mailbox", projectID, target.sessionID, 100).length >= 100) throw new Error("Target mailbox capacity exhausted");
          this.store.insert("mailbox", id, projectID, target.sessionID, { text: delivery.text!, producerSessionID: row.ownerID,
            targetSessionID: target.sessionID, jobID: delivery.jobID!, runID: delivery.runID!, createdAt: this.now() });
          this.store.update("deliveries", id, projectID, row.ownerID, row.revision, { ...delivery, state: "settled" });
          const run = this.store.get("runs", String(delivery.runID), projectID)!;
          this.store.update("runs", String(delivery.runID), projectID, run.ownerID, run.revision, { ...record(run.body), state: "settled" });
          if (!timeout) this.store.update("jobs", String(delivery.jobID), projectID, jobRow.ownerID, jobRow.revision, { ...job, state: "active" });
        });
        if (!timeout) this.jobs.finish({ ...target, sessionID: jobRow.ownerID }, String(delivery.jobID));
        return;
      }
      if (!this.gate.acquire(target, String(delivery.messageID), this.now(), { id: `job:${id}`, expiresAt: Number(job.expiresAt) })) return;
      gateAcquired = true;
      this.store.withClaim(id, this.worker, fence, this.now(), () => {
        const latestJob = this.store.get("jobs", String(delivery.jobID), projectID);
        if (!latestJob || latestJob.revision !== jobRow.revision ||
          (!timeout && Math.min(Number(job.expiresAt), Number(job.deadlineAt ?? job.expiresAt)) <= this.now()) ||
          (timeout ? record(latestJob.body).state !== "timed_out" : record(latestJob.body).state !== "ready")) throw new Error("Job changed before final admission");
        this.store.update("deliveries", id, projectID, row.ownerID, row.revision, { ...delivery, state: "submitting", attempts: Number(delivery.attempts) + 1 });
        const run = this.store.get("runs", String(delivery.runID), projectID)!;
        this.store.update("runs", String(delivery.runID), projectID, run.ownerID, run.revision, { ...record(run.body), state: "submitting" });
        if (!timeout) this.store.update("jobs", String(delivery.jobID), projectID, jobRow.ownerID, jobRow.revision, { ...job, state: "active" });
      });
      submitted = true;
      await this.host.prompt({ sessionID: target.sessionID, id: String(delivery.messageID), text: String(delivery.text), delivery: "queue",
        metadata: { scheduler: { source: "zebrajaeger.opencode-scheduler", jobID: delivery.jobID!, runID: delivery.runID!, producerSessionID: row.ownerID } } });
      if (this.closed || !this.store.ownsClaim(id, this.worker, fence, this.now())) return;
      const current = this.store.get("deliveries", id, projectID)!;
      const body = record(current.body);
      if (body.state === "submitting") this.store.withClaim(id, this.worker, fence, this.now(), () => {
        this.store.update("deliveries", id, projectID, current.ownerID, current.revision, { ...body, state: "accepted" });
        const run = this.store.get("runs", String(body.runID), projectID)!;
        if (record(run.body).state === "submitting") this.store.update("runs", String(body.runID), projectID, run.ownerID, run.revision, { ...record(run.body), state: "accepted" });
      });
    } catch (error) {
      if (this.closed || !this.store.ownsClaim(id, this.worker, fence, this.now())) return;
      const observed = this.store.get("deliveries", id, projectID);
      if (observed && ["delivered", "settled", "cancelled", "failed"].includes(String(record(observed.body).state))) return;
      const missing = error && typeof error === "object" && "_tag" in error && error._tag === "Session.NotFoundError" &&
        "sessionID" in error && error.sessionID === target.sessionID;
      if (!submitted && !missing) {
        if (gateAcquired) this.gate.finish(target, String(before.messageID), this.now());
        const current = this.store.get("deliveries", id, projectID);
        if (!current) return;
        const body = record(current.body);
        const tag = error && typeof error === "object" && "_tag" in error ? error._tag : undefined;
        if (tag === "UnauthorizedError" || tag === "InvalidRequestError") {
          this.fail(projectID, id, tag === "UnauthorizedError" ? "Authentication required before admission" : "Invalid admission configuration", true);
          return;
        }
        if (body.state === "pending") {
          const attempts = Number(body.inspectAttempts ?? 0) + 1;
          const delay = Math.min(30_000, Math.floor(500 * 2 ** attempts * (1 + Math.max(0, Math.min(1, this.random())) * 0.25)));
          const job = this.store.get("jobs", String(body.jobID), projectID);
          const deadline = job ? Math.min(Number(record(job.body).expiresAt), Number(record(job.body).deadlineAt ?? record(job.body).expiresAt)) : 0;
          if (attempts <= 5 && this.now() + delay < deadline) {
            this.store.update("deliveries", id, projectID, current.ownerID, current.revision,
              { ...body, inspectAttempts: attempts, nextAttemptAt: this.now() + delay, error: "Pre-admission session inspection failed; safe bounded retry" });
            return;
          }
          this.fail(projectID, id, "Proven non-admission retry budget or deadline exhausted", true);
          return;
        }
      }
      this.fail(projectID, id, missing ? "Target no longer exists" : "Admission outcome requires reconciliation", Boolean(missing));
    }
  }

  private fail(projectID: string, id: string, message: string, permanent: boolean): void {
    this.store.transaction(() => {
      const row = this.store.get("deliveries", id, projectID);
      if (!row) return;
      const delivery = record(row.body);
      // Host events may have settled/cancelled the intent before prompt() rejects.
      // A late transport callback must never retract that stronger evidence.
      if (["settled", "cancelled", "failed"].includes(String(delivery.state))) return;
      const uncertain = ["submitting", "accepted", "delivered"].includes(String(delivery.state)) || !permanent;
      const state = uncertain ? "uncertain" : "failed";
      this.store.update("deliveries", id, projectID, row.ownerID, row.revision, { ...delivery, state, error: message });
      const run = this.store.get("runs", String(delivery.runID), projectID);
      if (run) this.store.update("runs", String(delivery.runID), projectID, run.ownerID, run.revision, { ...record(run.body), state, error: message });
      const job = this.store.get("jobs", String(delivery.jobID), projectID);
      if (job) this.store.update("jobs", String(delivery.jobID), projectID, job.ownerID, job.revision, { ...record(job.body), state: "paused", error: message });
    });
  }

  event(projectID: string, event: HostEvent): void {
    if (this.closed) return;
    if (event.sequence !== undefined) {
      const previous = this.sequences.get(event.sessionID);
      if (previous !== undefined && event.sequence <= previous) return;
      this.sequences.set(event.sessionID, event.sequence);
    }
    if (event.type === "busy" && event.sequence !== undefined) this.epochs.set(event.sessionID, event.sequence);
    let cursor = "";
    while (true) {
      const rows = this.store.projectRecords("deliveries", projectID, cursor);
      for (const row of rows) {
        const delivery = record(row.body), target = delivery.target as unknown as SessionRef;
        if (target.sessionID !== event.sessionID || !["submitting", "accepted", "delivered", "uncertain"].includes(String(delivery.state))) continue;
        if (event.sequence !== undefined && typeof delivery.lastSequence === "number" && event.sequence <= delivery.lastSequence) continue;
        const matched = event.messageId === delivery.messageID;
        let state = String(delivery.state);
        if (matched && event.type === "cancelled") {
          this.store.transaction(() => {
            this.store.update("deliveries", row.id, projectID, row.ownerID, row.revision, { ...delivery, state: "cancelled",
              ...(event.sequence !== undefined ? { lastSequence: event.sequence } : {}) });
            const run = this.store.get("runs", String(delivery.runID), projectID)!;
            this.store.update("runs", String(delivery.runID), projectID, run.ownerID, run.revision, { ...record(run.body), state: "cancelled" });
          });
          this.gate.finish(target, String(delivery.messageID), this.now());
          const job = this.store.get("jobs", String(delivery.jobID), projectID);
          if (job && record(job.body).state === "active") this.jobs.control({ ...target, sessionID: job.ownerID }, String(delivery.jobID), "pause", job.revision);
          continue;
        }
        if (matched && event.type === "enqueued" && ["submitting", "uncertain"].includes(state)) state = "accepted";
        if (matched && event.type === "delivered") state = "delivered";
        const terminal = state === "delivered" && ["succeeded", "failed", "interrupted"].includes(event.type);
        const epoch = typeof delivery.executionStartedSequence === "number" ? delivery.executionStartedSequence : undefined;
        const settled = terminal && epoch !== undefined && event.sequence !== undefined && event.sequence > epoch && this.epochs.get(event.sessionID) === epoch;
        if (!matched && !terminal) continue;
        if (terminal && !settled) {
          this.fail(projectID, row.id, "Execution epoch association is uncertain", false);
          continue;
        }
        if (settled) state = "settled";
        this.store.transaction(() => {
          const current = this.store.get("deliveries", row.id, projectID)!;
          this.store.update("deliveries", row.id, projectID, current.ownerID, current.revision, { ...record(current.body), state,
            ...(event.sequence !== undefined ? { lastSequence: event.sequence } : {}),
            ...(matched && event.type === "delivered" && this.epochs.has(event.sessionID) ? { executionStartedSequence: this.epochs.get(event.sessionID)! } : {}),
            ...(settled ? { hostOutcome: event.type } : {}) });
          const run = this.store.get("runs", String(delivery.runID), projectID)!;
          this.store.update("runs", String(delivery.runID), projectID, run.ownerID, run.revision, { ...record(run.body), state,
            ...(settled ? { hostOutcome: event.type } : {}) });
        });
        if (settled) {
          this.gate.finish(target, String(delivery.messageID), this.now());
          const job = this.store.get("jobs", String(delivery.jobID), projectID);
          if (job && record(job.body).state === "active") {
            if (event.type === "succeeded") this.jobs.finish({ ...target, sessionID: job.ownerID }, String(delivery.jobID));
            else this.jobs.control({ ...target, sessionID: job.ownerID }, String(delivery.jobID), "pause", job.revision);
          }
        }
      }
      if (rows.length < 100) break;
      cursor = rows.at(-1)!.id;
    }
  }

  close(): void { this.closed = true; }
}
