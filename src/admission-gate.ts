import type { CoordinationStore } from "./orchestration-store.js";
import type { SessionRef } from "./orchestration-domain.js";

export class AdmissionGate {
  constructor(private readonly store: CoordinationStore, private readonly spacingSeconds: number) {}

  acquire(target: SessionRef, messageID: string, now: number,
    contender?: { id: string; expiresAt: number }): boolean {
    return this.store.transaction(() => {
      const row = this.store.get("target_gates", target.sessionID, target.projectID);
      const previous = row?.body && typeof row.body === "object" && !Array.isArray(row.body) ? row.body : {};
      const waiting = (Array.isArray(previous.waiting) ? previous.waiting : []).filter(item => item && typeof item === "object" &&
        !Array.isArray(item) && typeof item.id === "string" && Number(item.expiresAt) > now) as { id: string; expiresAt: number; enqueuedAt: number }[];
      if (contender) {
        const existing = waiting.find(item => item.id === contender.id);
        // Waiter leases are arbitration hints, not timer definitions or permission
        // to submit. Abandoned activations cannot indefinitely block a target.
        const expiresAt = Math.min(contender.expiresAt, now + Math.max(60_000, this.spacingSeconds * 3000));
        if (existing) existing.expiresAt = expiresAt;
        else waiting.push({ id: contender.id, expiresAt, enqueuedAt: now });
      }
      waiting.sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id.localeCompare(b.id));
      const saveWaiting = () => {
        const body = { ...previous, waiting };
        if (row) this.store.update("target_gates", target.sessionID, target.projectID, row.ownerID, row.revision, body);
        else this.store.insert("target_gates", target.sessionID, target.projectID, target.sessionID, body);
      };
      if (row && row.body && typeof row.body === "object" && !Array.isArray(row.body)) {
        if (row.body.messageID) { saveWaiting(); return row.body.messageID === messageID; }
        if (Number(row.body.nextAllowedAt) > now) { saveWaiting(); return false; }
      }
      if (waiting.length && waiting[0]!.id !== contender?.id) { saveWaiting(); return false; }
      const body = { messageID, directory: target.directory, nextAllowedAt: 0, acquiredAt: now,
        waiting: contender ? waiting.filter(item => item.id !== contender.id) : waiting };
      if (row) this.store.update("target_gates", target.sessionID, target.projectID, row.ownerID, row.revision, body);
      else this.store.insert("target_gates", target.sessionID, target.projectID, target.sessionID, body);
      return true;
    });
  }

  finish(target: SessionRef, messageID: string, now: number): void {
    this.store.transaction(() => {
      const row = this.store.get("target_gates", target.sessionID, target.projectID);
      if (!row || !row.body || typeof row.body !== "object" || Array.isArray(row.body) || row.body.messageID !== messageID) return;
      this.store.update("target_gates", target.sessionID, target.projectID, row.ownerID, row.revision,
        { messageID: null, directory: target.directory, nextAllowedAt: now + this.spacingSeconds * 1000,
          waiting: Array.isArray(row.body.waiting) ? row.body.waiting : [] });
    });
  }

  observe(target: SessionRef, event: { type: string; messageId?: string; sequence?: number }, now: number): void {
    this.store.transaction(() => {
      const row = this.store.get("target_gates", target.sessionID, target.projectID);
      if (!row || !row.body || typeof row.body !== "object" || Array.isArray(row.body) || !row.body.messageID) return;
      const body = row.body;
      if (event.sequence !== undefined && typeof body.lastSequence === "number" && event.sequence <= body.lastSequence) return;
      if (event.type === "busy" && event.sequence !== undefined) {
        if (body.delivered === true) {
          this.store.update("target_gates", target.sessionID, target.projectID, row.ownerID, row.revision,
            { ...body, associationUncertain: true, lastSequence: event.sequence });
          return;
        }
        this.store.update("target_gates", target.sessionID, target.projectID, row.ownerID, row.revision, { ...body, executionStartedSequence: event.sequence, lastSequence: event.sequence });
      } else if (event.type === "delivered" && event.messageId === body.messageID) {
        this.store.update("target_gates", target.sessionID, target.projectID, row.ownerID, row.revision, { ...body, delivered: true,
          ...(event.sequence !== undefined ? { lastSequence: event.sequence } : {}) });
      } else if (event.type === "cancelled" && event.messageId === body.messageID ||
        body.delivered === true && body.associationUncertain !== true && ["succeeded", "failed", "interrupted"].includes(event.type) && event.sequence !== undefined &&
        typeof body.executionStartedSequence === "number" && event.sequence > body.executionStartedSequence) {
        this.store.update("target_gates", target.sessionID, target.projectID, row.ownerID, row.revision,
          { messageID: null, directory: target.directory, nextAllowedAt: now + this.spacingSeconds * 1000,
            waiting: Array.isArray(body.waiting) ? body.waiting : [] });
      }
    });
  }
}
