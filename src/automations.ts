import { AutomationStore, type AutomationRecord } from "./automation-store.js";
import { AutomationHost, sessionState } from "./automation-host.js";
import { AutomationTargets } from "./automation-target.js";
import { AutomationManagement } from "./automation-management.js";
import { nextOccurrence } from "./automation-schedule.js";
import { Scheduler, MissingSessionError, SchedulerError, type HostEvent } from "./scheduler.js";

export class Automations {
  readonly management: AutomationManagement;
  readonly targets: AutomationTargets;
  private closed = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private readonly checking = new Set<string>();
  private readonly deliveries = new Set<string>();
  private readonly sequences = new Map<string, number>();
  private readonly generations = new Map<string, number>();
  private readonly tasks = new Map<string, Promise<void>>();
  private streamFailed = false;

  constructor(readonly store: AutomationStore, readonly host: AutomationHost, readonly scheduler: Scheduler,
    private readonly now = Date.now) {
    this.management = new AutomationManagement(store, host, now, scheduler.minimumSpacingSeconds);
    this.targets = new AutomationTargets(store, host, now, undefined, scheduler.minimumSpacingSeconds);
  }

  async activate(): Promise<void> {
    await this.store.load();
    for (const record of this.store.list(true)) {
      if (this.closed) return;
      if (record.run) {
        this.scheduler.reserveExternal({ ...record.owner, sessionID: record.run.sessionID }, record.run.messageID, true);
        await this.store.mutate(record.id, previous => {
          if (!previous?.run) return { ...(previous ? { record: previous } : {}), result: undefined };
          previous.run.phase = "unresolved"; return { record: previous, result: undefined };
        });
        // A context message is delivery evidence only. It cannot prove completion
        // while offline and therefore does not release the restored barrier.
        // Context reads can wait for this location's plugin setup. They must not
        // be awaited from setup itself; the persisted barrier is already rebuilt.
        void this.host.context(record.run.sessionID).catch(() => {});
        continue;
      }
      if (record.pendingSetup) { void this.targets.finishSetup(record.id).then(() => this.wake()).catch(() => {}); continue; }
      if (!record.enabled || record.removed) continue;
      await this.store.mutate(record.id, previous => {
        if (!previous) return { result: undefined };
        if (previous.missedPolicy === "catch-up-once" && previous.nextOccurrence <= this.now()) previous.pendingOccurrence = previous.nextOccurrence;
        else delete previous.pendingOccurrence;
        previous.nextOccurrence = nextOccurrence(previous.recurrence, this.now(), previous.consumedThrough);
        return { record: previous, result: undefined };
      });
    }
    this.wake();
  }

  wake(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.closed || this.streamFailed) return;
    if (this.checking.size === 0 && this.store.list().length === 0) return;
    const records = this.store.list().filter(record => record.enabled && !record.run && !record.pendingSetup && !this.checking.has(record.id));
    const due = records.filter(record => record.pendingOccurrence !== undefined || record.nextOccurrence <= this.now())
      .sort((a, b) => (a.pendingOccurrence ?? a.nextOccurrence) - (b.pendingOccurrence ?? b.nextOccurrence) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const record of due) {
      this.checking.add(record.id);
      const task = this.dispatch(record).catch(error => this.fail(record.id, error)).finally(() => {
        this.checking.delete(record.id); this.tasks.delete(record.id); this.arm();
      });
      this.tasks.set(record.id, task);
    }
    this.arm();
  }

  private arm(): void {
    if (this.timeout !== undefined) clearTimeout(this.timeout);
    this.timeout = undefined;
    if (this.closed || this.streamFailed) return;
    let deadline = Infinity;
    for (const record of this.store.list()) {
      if (!record.enabled || record.run || record.pendingSetup || this.checking.has(record.id)) continue;
      const due = record.pendingOccurrence ?? record.nextOccurrence;
      deadline = Math.min(deadline, due > this.now() ? due : this.now() + this.scheduler.minimumSpacingSeconds * 1000);
    }
    if (!Number.isFinite(deadline)) return;
    this.timeout = setTimeout(() => { this.timeout = undefined; this.wake(); }, Math.min(2_147_483_647, Math.max(1, deadline - this.now())));
    this.timeout.unref?.();
  }

  private async dispatch(snapshot: AutomationRecord): Promise<void> {
    const occurrence = snapshot.pendingOccurrence ?? snapshot.nextOccurrence;
    let sessionID = snapshot.target.kind === "new-each-run" ? undefined : snapshot.target.sessionID;
    let messageID: string | undefined;
    let reserved = false;
    const generation = sessionID ? this.generations.get(sessionID) ?? 0 : 0;
    const valid = () => {
      if (this.closed || this.streamFailed) return false;
      const current = this.store.get(snapshot.id, true);
      return current.enabled && !current.removed && current.revision === snapshot.revision &&
        (!sessionID || (this.generations.get(sessionID) ?? 0) === generation);
    };
    try {
      if (sessionID) {
        const info = await this.host.inspect(sessionID);
        if (!valid() || sessionState(info) !== "idle") return;
        messageID = this.host.messageID();
        reserved = this.scheduler.reserveExternal({ ...snapshot.owner, sessionID }, messageID, false, occurrence);
        if (!reserved) return;
      }
      if (!valid()) return;
      let prepared: AutomationRecord;
      if (snapshot.target.kind === "new-each-run") {
        prepared = await this.targets.prepareFreshRun(snapshot.id, occurrence);
        sessionID = prepared.run!.sessionID; messageID = prepared.run!.messageID;
        reserved = this.scheduler.reserveExternal({ ...snapshot.owner, sessionID }, messageID, false, occurrence);
        if (!reserved) throw new SchedulerError("unresolved", "Fresh target session reservation unavailable");
      } else {
        await this.store.mutate(snapshot.id, previous => {
          if (!previous || !previous.enabled || previous.removed || previous.revision !== snapshot.revision || previous.run) throw new SchedulerError("invalid-input", "Automation changed before admission");
          previous.run = { occurrence, revision: previous.revision, sessionID: sessionID!, messageID: messageID!, prompt: snapshot.prompt,
            phase: "preparing", accepted: false, delivered: false };
          return { record: previous, result: undefined };
        });
        prepared = this.store.get(snapshot.id, true);
      }
      if (!valid()) {
        await this.discardPrepared(snapshot.id, messageID!); this.scheduler.releaseExternal(sessionID!, messageID!, false); return;
      }
      await this.host.inspect(sessionID!);
      if (!valid()) {
        await this.discardPrepared(snapshot.id, messageID!); this.scheduler.releaseExternal(sessionID!, messageID!, false); return;
      }
      await this.host.prompt(prepared);
      if (this.closed) return;
      await this.store.mutate(snapshot.id, previous => {
        if (!previous?.run || previous.run.messageID !== messageID) return { ...(previous ? { record: previous } : {}), result: undefined };
        if (!previous.run.accepted) previous.acceptedRunCount++;
        previous.run.accepted = true;
        if (previous.run.phase === "preparing") previous.run.phase = "queued";
        return { record: previous, result: undefined };
      });
    } catch (error) {
      if (!this.closed && reserved && sessionID && messageID && !this.store.list(true).some(record => record.run?.messageID === messageID)) this.scheduler.releaseExternal(sessionID, messageID, false);
      throw error;
    } finally {
      if (!this.closed && reserved && sessionID && messageID && !this.store.list(true).some(record => record.run?.messageID === messageID)) this.scheduler.releaseExternal(sessionID, messageID, false);
    }
  }

  private async discardPrepared(id: string, messageID: string): Promise<void> {
    await this.store.mutate(id, previous => {
      if (!previous) return { result: undefined };
      if (previous.run?.messageID === messageID) delete previous.run;
      if (previous.removed) return { result: undefined };
      return { record: previous, result: undefined };
    });
  }

  private async fail(id: string, error: unknown): Promise<void> {
    if (this.closed) return;
    await this.store.mutate(id, previous => {
      if (!previous) return { result: undefined };
      previous.enabled = false;
      previous.pauseReason = error instanceof MissingSessionError ? "target-unavailable" : "execution-error";
      previous.lastError = String(error).slice(0, 500);
      if (previous.run) previous.run.phase = "unresolved";
      return { record: previous, result: undefined };
    }).catch(() => { this.streamFailed = true; });
  }

  async event(event: HostEvent): Promise<void> {
    if (this.closed) return;
    if (event.sequence !== undefined) {
      if ((this.sequences.get(event.sessionID) ?? -Infinity) >= event.sequence) return;
      this.sequences.set(event.sessionID, event.sequence);
    }
    this.generations.set(event.sessionID, (this.generations.get(event.sessionID) ?? 0) + 1);
    for (const record of this.store.list(true)) {
      const run = record.run;
      if (event.type === "deleted" && record.target.kind !== "new-each-run" && record.target.sessionID === event.sessionID) {
        await this.management.pauseTarget(record.id, "Target session deleted");
      }
      if (!run || run.sessionID !== event.sessionID) continue;
      if ((event.type === "enqueued" || event.type === "delivered") && event.messageId === run.messageID) {
        if (event.type === "delivered") this.deliveries.add(run.messageID);
        await this.store.mutate(record.id, previous => {
          if (!previous?.run || previous.run.messageID !== run.messageID) return { ...(previous ? { record: previous } : {}), result: undefined };
          if (!previous.run.accepted) previous.acceptedRunCount++;
          previous.run.accepted = true;
          if (event.type === "delivered") { previous.run.delivered = true; previous.run.phase = "running"; }
          else if (previous.run.phase !== "running") previous.run.phase = "queued";
          return { record: previous, result: undefined };
        });
      }
      const cancelled = event.type === "cancelled" && event.messageId === run.messageID;
      const terminal = this.deliveries.has(run.messageID) && ["succeeded", "failed", "interrupted"].includes(event.type);
      if (cancelled || terminal) {
        const outcome = cancelled ? "cancelled" : event.type === "interrupted" ? "interrupted" : event.type === "failed" ? "failed" : "succeeded";
        await this.management.complete(record.id, run.messageID, outcome, event.error);
        this.deliveries.delete(run.messageID); this.scheduler.releaseExternal(run.sessionID, run.messageID);
      }
    }
    this.wake();
  }

  failEventStream(): void { this.streamFailed = true; if (this.timeout !== undefined) clearTimeout(this.timeout); this.timeout = undefined; }
  close(): void { this.closed = true; if (this.timeout !== undefined) clearTimeout(this.timeout); this.timeout = undefined; this.store.close(); }
  async settled(): Promise<void> { await Promise.all(this.tasks.values()); }
}
