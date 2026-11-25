import { randomUUID } from "node:crypto";

export interface Owner {
  sessionID: string;
  projectID: string;
  directory: string;
  workspaceID?: string;
}

export interface StartInput {
  mode: "once" | "repeat";
  prompt: string;
  label?: string;
  delaySeconds?: number;
  intervalSeconds?: number;
  maxLifetimeSeconds?: number;
}

export type TimerStatus = "scheduled" | "deferred" | "in-flight" | "disabled";

export interface TimerRecord {
  id: string;
  owner: Owner;
  mode: "once" | "repeat";
  prompt: string;
  label?: string;
  createdAt: number;
  expiresAt: number;
  nextDueAt: number;
  anchorAt: number;
  intervalSeconds?: number;
  revision: number;
  status: TimerStatus;
  acceptedRunCount: number;
  lastError?: string;
}

export interface SchedulerOptions {
  defaultMaxLifetimeSeconds?: number;
  minimumSpacingSeconds?: number;
}

export type UpdateInput = Omit<Partial<StartInput>, "mode">;

export interface Host {
  inspect(owner: Owner): Promise<{ owner: Owner; state: "idle" | "busy" | "unknown" }>;
  prompt(owner: Owner, messageId: string, prompt: string, timerId: string): Promise<void>;
  messageId(): string;
}

export class MissingSessionError extends Error {}

export type HostEvent = {
  sessionID: string;
  type: "busy" | "idle" | "deleted" | "interrupted" | "delivered" | "enqueued" | "cancelled" | "succeeded" | "failed";
  messageId?: string;
  error?: string;
  sequence?: number;
};

interface Reservation {
  token: object;
  timerId: string;
  messageId: string;
  revision: number;
  phase: "checking" | "submitting";
  accepted: boolean;
  delivered: boolean;
  terminal: boolean;
  cancelled: boolean;
  error?: string;
}

interface SessionState {
  owner: Owner;
  state: "idle" | "busy" | "unknown";
  generation: number;
  nextAllowedAt: number;
  lastSequence?: number;
  watchdog?: ReturnType<typeof setTimeout>;
  reservation?: Reservation;
}

export class SchedulerError extends Error {
  constructor(readonly code: "invalid-input" | "not-found" | "closed" | "unresolved", message: string) {
    super(message);
  }
}

function duration(value: number, name: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new SchedulerError("invalid-input", `${name} must be a safe integer of at least ${minimum} seconds`);
  }
  return value;
}

function timestamp(base: number, seconds: number): number {
  const result = base + seconds * 1000;
  if (!Number.isSafeInteger(result)) throw new SchedulerError("invalid-input", "Duration exceeds safe timestamp range");
  return result;
}

export function sameOwner(a: Owner, b: Owner): boolean {
  return a.sessionID === b.sessionID && a.projectID === b.projectID &&
    a.directory === b.directory && a.workspaceID === b.workspaceID;
}

export class Scheduler {
  private readonly timers = new Map<string, TimerRecord>();
  readonly defaultMaxLifetimeSeconds: number;
  readonly minimumSpacingSeconds: number;
  private expiryTimeout: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly sessions = new Map<string, SessionState>();
  private host: Host | undefined;
  private eventStreamFailed = false;

  constructor(
    options: SchedulerOptions = {},
    private readonly now: () => number = Date.now,
    private readonly id: () => string = randomUUID,
  ) {
    this.defaultMaxLifetimeSeconds = duration(options.defaultMaxLifetimeSeconds ?? 3600, "defaultMaxLifetimeSeconds");
    this.minimumSpacingSeconds = duration(options.minimumSpacingSeconds ?? 30, "minimumSpacingSeconds", 30);
  }

  connect(host: Host): void { this.host = host; this.armExpiry(); }

  start(owner: Owner, input: StartInput): TimerRecord {
    if (this.closed) throw new SchedulerError("closed", "Scheduler is closed");
    if (input.mode !== "once" && input.mode !== "repeat") throw new SchedulerError("invalid-input", "mode must be once or repeat");
    if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new SchedulerError("invalid-input", "prompt must contain text");
    if (input.label !== undefined && typeof input.label !== "string") throw new SchedulerError("invalid-input", "label must be a string");
    if (input.mode === "once" && input.intervalSeconds !== undefined) throw new SchedulerError("invalid-input", "A one-shot timer cannot have an interval");
    if (input.mode === "repeat") duration(input.intervalSeconds!, "intervalSeconds", this.minimumSpacingSeconds);
    const createdAt = this.now();
    const delay = duration(input.delaySeconds ?? input.intervalSeconds!, "delaySeconds", this.minimumSpacingSeconds);
    const nextDueAt = timestamp(createdAt, delay);
    const expiresAt = timestamp(createdAt, duration(input.maxLifetimeSeconds ?? this.defaultMaxLifetimeSeconds, "maxLifetimeSeconds"));
    if (nextDueAt >= expiresAt) throw new SchedulerError("invalid-input", "First due time must precede expiry");
    const timer: TimerRecord = {
      id: this.id(), owner: { ...owner }, mode: input.mode, prompt: input.prompt,
      createdAt, expiresAt,
      nextDueAt, anchorAt: nextDueAt, revision: 1, status: "scheduled", acceptedRunCount: 0,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.intervalSeconds !== undefined ? { intervalSeconds: input.intervalSeconds } : {}),
    };
    if (this.timers.has(timer.id)) throw new Error("Generated timer ID is not unique");
    this.timers.set(timer.id, timer);
    if (!this.sessions.has(owner.sessionID)) this.sessions.set(owner.sessionID, {
      owner: { ...owner }, state: "unknown", generation: 0, nextAllowedAt: 0,
    });
    this.armExpiry();
    return structuredClone(timer);
  }

  list(owner: Owner): TimerRecord[] {
    this.expire();
    return [...this.timers.values()].filter(timer => sameOwner(timer.owner, owner)).map(timer => structuredClone(timer));
  }

  update(owner: Owner, timerId: string, patch: UpdateInput): TimerRecord {
    this.expire();
    const timer = this.timers.get(timerId);
    if (!timer || !sameOwner(timer.owner, owner)) throw new SchedulerError("not-found", "Timer not found in this session");
    if (!Object.keys(patch).length) throw new SchedulerError("invalid-input", "Provide a non-empty update");
    const keys = ["prompt", "label", "delaySeconds", "intervalSeconds", "maxLifetimeSeconds"];
    if (Object.keys(patch).some(key => !keys.includes(key))) throw new SchedulerError("invalid-input", "Unsupported update field");
    const next = structuredClone(timer);
    const reservation = this.sessions.get(owner.sessionID)?.reservation;
    if (timer.mode === "once" && (timer.acceptedRunCount > 0 || (reservation?.timerId === timerId && reservation.phase === "submitting"))) {
      throw new SchedulerError("unresolved", "A submitted one-shot cannot be rearmed");
    }
    if (patch.prompt !== undefined) {
      if (typeof patch.prompt !== "string" || !patch.prompt.trim()) throw new SchedulerError("invalid-input", "prompt must contain text");
      next.prompt = patch.prompt;
    }
    if (patch.label !== undefined) {
      if (typeof patch.label !== "string") throw new SchedulerError("invalid-input", "label must be a string");
      next.label = patch.label;
    }
    if (patch.intervalSeconds !== undefined) {
      if (timer.mode !== "repeat") throw new SchedulerError("invalid-input", "A one-shot timer cannot have an interval");
      next.intervalSeconds = duration(patch.intervalSeconds, "intervalSeconds", this.minimumSpacingSeconds);
    }
    if (patch.delaySeconds !== undefined || patch.intervalSeconds !== undefined) {
      const delay = duration(patch.delaySeconds ?? next.intervalSeconds!, "delaySeconds", this.minimumSpacingSeconds);
      next.nextDueAt = timestamp(this.now(), delay);
      next.anchorAt = next.nextDueAt;
    }
    if (patch.maxLifetimeSeconds !== undefined) next.expiresAt = timestamp(next.createdAt, duration(patch.maxLifetimeSeconds, "maxLifetimeSeconds"));
    if (next.expiresAt <= this.now() || next.nextDueAt >= next.expiresAt) throw new SchedulerError("invalid-input", "Next due time must precede a future expiry");
    if (JSON.stringify({ ...next, revision: timer.revision }) === JSON.stringify(timer) && timer.status !== "disabled") throw new SchedulerError("invalid-input", "Update makes no change");
    if (next.status === "disabled") {
      if (reservation?.timerId === timerId) throw new SchedulerError("unresolved", "Previous handoff is unresolved");
      next.status = "scheduled";
      delete next.lastError;
    }
    next.revision++;
    this.timers.set(timerId, next);
    this.armExpiry();
    return structuredClone(next);
  }

  stop(owner: Owner, timerId: string): { removed: boolean; warning?: string } {
    const timer = this.timers.get(timerId);
    if (!timer || !sameOwner(timer.owner, owner)) return { removed: false };
    this.timers.delete(timerId);
    this.armExpiry();
    return { removed: true, ...this.cancellationWarning(owner) };
  }

  stopAll(owner: Owner): { removedCount: number; warning?: string } {
    let removedCount = 0;
    for (const [id, timer] of this.timers) if (sameOwner(timer.owner, owner)) {
      this.timers.delete(id);
      removedCount++;
    }
    this.armExpiry();
    return { removedCount, ...this.cancellationWarning(owner) };
  }

  private cancellationWarning(owner: Owner): { warning?: string } {
    return this.sessions.get(owner.sessionID)?.reservation?.phase === "submitting"
      ? { warning: "A prompt already submitted to OpenCode can still run; stopping timers does not retract accepted input." }
      : {};
  }

  close(): void {
    this.closed = true;
    this.timers.clear();
    for (const session of this.sessions.values()) if (session.watchdog !== undefined) clearTimeout(session.watchdog);
    this.sessions.clear();
    if (this.expiryTimeout !== undefined) clearTimeout(this.expiryTimeout);
    this.expiryTimeout = undefined;
  }

  private expire(): void {
    for (const [id, timer] of this.timers) if (timer.expiresAt <= this.now()) this.timers.delete(id);
  }

  private armExpiry(): void {
    if (this.expiryTimeout !== undefined) clearTimeout(this.expiryTimeout);
    this.expiryTimeout = undefined;
    this.expire();
    if (this.closed || !this.timers.size) return;
    let next = Infinity;
    for (const timer of this.timers.values()) {
      next = Math.min(next, timer.expiresAt);
      if (!this.host || timer.status === "disabled") continue;
      const session = this.sessions.get(timer.owner.sessionID);
      if (!session || session.reservation) continue;
      const due = Math.max(timer.nextDueAt, session.nextAllowedAt);
      next = Math.min(next, due > this.now() ? due : this.now() + this.minimumSpacingSeconds * 1000);
    }
    this.expiryTimeout = setTimeout(() => {
      this.expiryTimeout = undefined;
      this.pulse();
    }, Math.min(2_147_483_647, Math.max(1, next - this.now())));
    this.expiryTimeout.unref?.();
  }

  event(event: HostEvent): void {
    if (this.closed) return;
    const session = this.sessions.get(event.sessionID);
    if (!session) return;
    if (event.sequence !== undefined) {
      if (session.lastSequence !== undefined && event.sequence <= session.lastSequence) return;
      session.lastSequence = event.sequence;
    }
    session.generation++;
    if (event.type === "deleted" || event.type === "interrupted") {
      for (const [id, timer] of this.timers) if (timer.owner.sessionID === event.sessionID) this.timers.delete(id);
      session.state = event.type === "deleted" ? "unknown" : "idle";
      if (session.reservation?.phase === "checking") delete session.reservation;
      // An admitted prompt can survive interruption; keep its barrier until
      // matching delivery/cancellation proves it no longer remains queued.
      if (session.reservation?.delivered) this.finish(session, session.reservation);
      this.armExpiry();
      return;
    }
    if (event.type === "busy") session.state = "busy";
    if (event.type === "idle") session.state = "idle";
    const reservation = session.reservation;
    if (reservation && event.messageId === reservation.messageId) {
      if (event.type === "enqueued" || event.type === "delivered") this.accept(session, reservation);
      if (event.type === "delivered") reservation.delivered = true;
      if (event.type === "cancelled") reservation.cancelled = true;
    }
    if (event.type === "succeeded" || event.type === "failed") {
      session.state = "idle";
      if (reservation?.delivered) {
        reservation.terminal = true;
        if (event.type === "failed") reservation.error = event.error ?? "Timer-associated execution failed";
      }
    }
    if (reservation && (reservation.cancelled || (reservation.delivered && reservation.terminal))) this.finish(session, reservation);
    this.pulse();
  }

  failEventStream(message: string): void {
    this.eventStreamFailed = true;
    this.host = undefined;
    for (const timer of this.timers.values()) { timer.status = "disabled"; timer.lastError = message.slice(0, 500); }
    this.armExpiry();
  }

  private pulse(): void {
    this.expire();
    if (this.closed || !this.host || this.eventStreamFailed) { this.armExpiry(); return; }
    const due = [...this.timers.values()].filter(timer => timer.status !== "disabled" && timer.nextDueAt <= this.now())
      .sort((a, b) => a.nextDueAt - b.nextDueAt || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const timer of due) {
      const session = this.sessions.get(timer.owner.sessionID)!;
      if (session.reservation || session.nextAllowedAt > this.now()) { if (timer.status !== "in-flight") timer.status = "deferred"; continue; }
      const reservation: Reservation = {
        token: {}, timerId: timer.id, messageId: this.host.messageId(), revision: timer.revision,
        phase: "checking", accepted: false, delivered: false, terminal: false, cancelled: false,
      };
      session.reservation = reservation;
      timer.status = "deferred";
      void this.dispatch(session, reservation).catch(error => this.reject(session, reservation, error));
    }
    this.armExpiry();
  }

  private current(session: SessionState, reservation: Reservation): boolean {
    return !this.closed && this.sessions.get(session.owner.sessionID) === session && session.reservation === reservation;
  }

  private async dispatch(session: SessionState, reservation: Reservation): Promise<void> {
    const host = this.host!;
    const generation = session.generation;
    const inspected = await host.inspect(session.owner);
    if (!this.current(session, reservation) || this.eventStreamFailed) return;
    const timer = this.timers.get(reservation.timerId);
    if (!sameOwner(inspected.owner, session.owner)) { this.event({ sessionID: session.owner.sessionID, type: "deleted" }); return; }
    if (!timer || timer.revision !== reservation.revision || timer.expiresAt <= this.now()) {
      delete session.reservation; this.armExpiry(); return;
    }
    if (session.generation === generation) session.state = inspected.state;
    if (session.state !== "idle") { delete session.reservation; this.armExpiry(); return; }
    reservation.phase = "submitting";
    timer.status = "in-flight";
    session.watchdog = setTimeout(() => {
      if (!this.current(session, reservation) || reservation.accepted) return;
      const current = this.timers.get(reservation.timerId);
      if (current) { current.status = "disabled"; current.lastError = "Prompt acknowledgement unresolved; this session is blocked to prevent duplicate admission."; }
      this.armExpiry();
    }, 30_000);
    session.watchdog.unref?.();
    await host.prompt(timer.owner, reservation.messageId, timer.prompt, timer.id);
    if (!this.current(session, reservation)) return;
    this.accept(session, reservation);
    if (reservation.cancelled || (reservation.delivered && reservation.terminal)) this.finish(session, reservation);
    this.armExpiry();
  }

  private accept(session: SessionState, reservation: Reservation): void {
    if (reservation.accepted) return;
    if (session.watchdog !== undefined) clearTimeout(session.watchdog);
    delete session.watchdog;
    reservation.accepted = true;
    const timer = this.timers.get(reservation.timerId);
    if (timer) { timer.acceptedRunCount++; timer.status = "in-flight"; }
  }

  private reject(session: SessionState, reservation: Reservation, error: unknown): void {
    if (!this.current(session, reservation)) return;
    if (error instanceof MissingSessionError) { this.event({ sessionID: session.owner.sessionID, type: "deleted" }); return; }
    if (session.watchdog !== undefined) clearTimeout(session.watchdog);
    delete session.watchdog;
    const timer = this.timers.get(reservation.timerId);
    if (timer) { timer.status = "disabled"; timer.lastError = String(error).slice(0, 500); }
    if (reservation.phase === "checking") delete session.reservation;
    // A rejected acknowledgement does not prove non-admission. Do not retry.
    this.armExpiry();
  }

  private finish(session: SessionState, reservation: Reservation): void {
    if (!this.current(session, reservation)) return;
    delete session.reservation;
    if (session.watchdog !== undefined) clearTimeout(session.watchdog);
    delete session.watchdog;
    session.nextAllowedAt = this.now() + this.minimumSpacingSeconds * 1000;
    const timer = this.timers.get(reservation.timerId);
    if (!timer) { this.armExpiry(); return; }
    if (timer.expiresAt <= this.now() || (timer.mode === "once" && !reservation.error)) this.timers.delete(timer.id);
    else if (reservation.error || reservation.cancelled) {
      timer.status = "disabled"; timer.lastError = (reservation.error ?? "Accepted timer input was cancelled").slice(0, 500);
    } else {
      timer.status = "scheduled";
      const interval = timer.intervalSeconds! * 1000;
      if (timer.revision === reservation.revision || timer.nextDueAt <= this.now()) {
        timer.nextDueAt = timer.anchorAt + (Math.floor((this.now() - timer.anchorAt) / interval) + 1) * interval;
      }
    }
    this.armExpiry();
  }
}
