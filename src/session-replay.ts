import type { SDKClient } from "./opencode-sdk.js";
import { CoordinationStore } from "./orchestration-store.js";
import { CoordinationError, type Json, type SessionRef } from "./orchestration-domain.js";

export class SessionReplay {
  private readonly ready = new Set<string>();
  private readonly watermarks = new Map<string, number>();
  constructor(private readonly client: SDKClient, private readonly store: CoordinationStore,
    private readonly evaluate: (projectID: string) => void = () => {},
    private readonly observe: (event: Json) => void = () => {},
    private readonly validateSource: (source: SessionRef) => Promise<void> = async () => {}) {}

  isReady(sessionID: string): boolean { return this.ready.has(sessionID); }
  watermark(sessionID: string): number | undefined { return this.watermarks.get(sessionID); }

  async sync(source: SessionRef, signal?: AbortSignal, follow = false, synchronized: () => void = () => {}): Promise<void> {
    this.ready.delete(source.sessionID);
    this.watermarks.delete(source.sessionID);
    try {
    await this.validateSource(source);
    if (signal?.aborted) throw new CoordinationError("conflict", "Replay was stopped before reading");
    const key = `native:${source.instanceID}:${source.sessionID}`;
    const saved = this.store.get("checkpoints", key, source.projectID);
    const after = saved?.body && typeof saved.body === "object" && !Array.isArray(saved.body) ? Number(saved.body.sequence) : 0;
    let last = after;
    let pending: { id: string; sequence: number; body: Json; observation: Json }[] = [];
    const commit = (items: typeof pending, synchronized = false) => {
      if (signal?.aborted) throw new CoordinationError("conflict", "Replay was stopped before commit");
      this.store.transaction(() => {
        for (const item of items) {
          this.store.appendEvent(item.id, source.projectID, key, item.sequence, item.body);
          const current = this.store.get("checkpoints", key, source.projectID);
          if (current) {
            const body = current.body;
            const committed = body && typeof body === "object" && !Array.isArray(body) ? Number(body.sequence) : 0;
            if (item.sequence > committed) this.store.update("checkpoints", key, source.projectID, current.ownerID, current.revision, { sequence: item.sequence });
          }
          else this.store.insert("checkpoints", key, source.projectID, source.sessionID, { sequence: item.sequence });
        }
        if (items.length || synchronized) this.evaluate(source.projectID);
      });
      for (const item of items) this.observe(item.observation);
    };
    const request = signal ? { signal } : undefined;
    for await (const event of this.client.experimental.session.log({ sessionID: source.sessionID, after, follow }, request)) {
      if (event.type === "log.synced") {
        if (event.aggregateID !== source.sessionID || event.seq !== undefined && event.seq < last) throw new CoordinationError("history-unavailable", "Native log watermark does not cover processed evidence");
        await this.validateSource(source);
        // Evaluation in the atomic commit may now consume this synchronized
        // source. Any failed commit clears readiness in the enclosing catch.
        this.ready.add(source.sessionID);
        this.watermarks.set(source.sessionID, event.seq ?? 0);
        commit(pending, true);
        pending = [];
        synchronized();
        continue;
      }
      if (event.data.sessionID !== source.sessionID) throw new CoordinationError("scope-denied", "Native log contains another session's event");
      const sequence = event.durable.seq;
      if (sequence <= after) continue;
      if (sequence <= last) {
        if (sequence === last) continue;
        throw new CoordinationError("history-unavailable", "Native replay arrived out of source order");
      }
      {
        const type = event.type;
        const outcome = type === "session.execution.succeeded" ? "succeeded" : type === "session.execution.failed" ? "failed" :
          type === "session.execution.interrupted" && event.data.reason !== "shutdown" ? "interrupted" : undefined;
        const body = JSON.parse(JSON.stringify({ nativeEvent: event, ...(outcome ? { name: `scheduler.execution.${outcome}` } : {}),
          producerSessionID: source.sessionID, instanceID: source.instanceID, projectID: source.projectID,
          sourceSequence: sequence, createdAt: event.created })) as Json;
        const item = { id: event.id, sequence, body, observation: JSON.parse(JSON.stringify(event)) as Json };
        if (this.ready.has(source.sessionID)) { await this.validateSource(source); commit([item]); }
        else {
          if (pending.length >= 10_000) throw new CoordinationError("resource-limit", "Native replay window exceeds bounded capacity");
          pending.push(item);
        }
      }
      last = sequence;
    }
    if (!this.ready.has(source.sessionID)) throw new CoordinationError("history-unavailable", "Native log ended before synchronization");
    } catch (error) {
      this.ready.delete(source.sessionID);
      this.watermarks.delete(source.sessionID);
      throw error;
    }
  }

  async follow(source: SessionRef, signal: AbortSignal, retry: (attempt: number, signal: AbortSignal) => Promise<void>,
    synchronized: () => void = () => {}, failed: (code: string) => void = () => {}): Promise<void> {
    let attempt = 0;
    while (!signal.aborted) {
      try { await this.sync(source, signal, true, synchronized); }
      catch (error) {
        if (signal.aborted) return;
        failed(error instanceof CoordinationError ? error.code : "transient-host-error");
      }
      this.ready.delete(source.sessionID);
      this.watermarks.delete(source.sessionID);
      await retry(++attempt, signal);
    }
  }

  static async backoff(attempt: number, signal: AbortSignal): Promise<void> {
    const delay = Math.min(30_000, 250 * 2 ** Math.min(attempt, 7));
    if (signal.aborted) return;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
      const timer = setTimeout(finish, delay);
      timer.unref?.();
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  async reconcileAdmission(source: SessionRef, messageID: string): Promise<"queued" | "delivered" | "cancelled" | "unknown"> {
    let matched: "queued" | "delivered" | "cancelled" | "unknown" = "unknown";
    let synced = false, last = 0, count = 0;
    for await (const event of this.client.experimental.session.log({ sessionID: source.sessionID, follow: false }, { signal: AbortSignal.timeout(30_000) })) {
      if (event.type === "log.synced") {
        if (event.aggregateID !== source.sessionID || event.seq === undefined || event.seq < last) throw new CoordinationError("history-unavailable", "Admission log watermark does not cover recovery evidence");
        synced = true; continue;
      }
      if (event.data.sessionID !== source.sessionID) throw new CoordinationError("scope-denied", "Admission recovery contains foreign session evidence");
      if (event.durable.seq <= last) throw new CoordinationError("history-unavailable", "Admission recovery is not in source order");
      last = event.durable.seq;
      if (++count > 10_000) throw new CoordinationError("resource-limit", "Admission recovery exceeds bounded capacity");
      if (event.type === "session.inbox.enqueued" && event.data.inboxID === messageID) matched = "queued";
      if (event.type === "session.inbox.delivered" && event.data.inboxID === messageID) matched = "delivered";
      if (event.type === "session.inbox.cancelled" && event.data.inboxID === messageID) matched = "cancelled";
    }
    if (!synced) throw new CoordinationError("history-unavailable", "Admission recovery did not reach a watermark");
    return matched;
  }

  async recoverGate(source: SessionRef, gate: import("./admission-gate.js").AdmissionGate,
    observe: (event: import("./scheduler.js").HostEvent) => void = () => {}, signal?: AbortSignal): Promise<void> {
    // Read the complete durable sequence before releasing any unresolved gate.
    const observations: import("./scheduler.js").HostEvent[] = [];
    let synced = false;
    let last = 0;
    await this.validateSource(source);
    for await (const event of this.client.experimental.session.log({ sessionID: source.sessionID, follow: false }, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) })) {
      if (event.type === "log.synced") {
        if (event.aggregateID !== source.sessionID || event.seq === undefined || event.seq < last) throw new CoordinationError("history-unavailable", "Admission log watermark does not cover recovery evidence");
        synced = true; continue;
      }
      if (event.data.sessionID !== source.sessionID) throw new CoordinationError("scope-denied", "Admission recovery contains foreign session evidence");
      if (event.durable.seq <= last) throw new CoordinationError("history-unavailable", "Admission recovery is not in source order");
      last = event.durable.seq;
      const base = { sessionID: source.sessionID, sequence: event.durable.seq };
      switch (event.type) {
        case "session.execution.started": observations.push({ ...base, type: "busy" }); break;
        case "session.execution.succeeded": observations.push({ ...base, type: "succeeded" }); break;
        case "session.execution.failed": observations.push({ ...base, type: "failed" }); break;
        case "session.execution.interrupted":
          if (event.data.reason !== "shutdown") observations.push({ ...base, type: "interrupted" });
          break;
        case "session.inbox.delivered": observations.push({ ...base, type: "delivered", messageId: event.data.inboxID }); break;
        case "session.inbox.cancelled": observations.push({ ...base, type: "cancelled", messageId: event.data.inboxID }); break;
        case "session.inbox.enqueued": observations.push({ ...base, type: "enqueued", messageId: event.data.inboxID }); break;
      }
      if (observations.length > 10_000) throw new CoordinationError("resource-limit", "Admission recovery log exceeds bounded capacity");
    }
    if (!synced) throw new CoordinationError("history-unavailable", "Admission recovery did not reach a watermark");
    if (signal?.aborted) throw new CoordinationError("conflict", "Admission recovery was stopped");
    await this.validateSource(source);
    for (const event of observations) { gate.observe(source, event, Date.now()); observe(event); }
  }
}
