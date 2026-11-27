export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type TaskState = "open" | "working" | "waiting_input" | "completed" | "failed" | "cancelled";
export type JobState = "waiting" | "ready" | "active" | "paused" | "completed" | "cancelled" | "timed_out" | "failed";
export type RunState = "pending" | "submitting" | "accepted" | "delivered" | "settled" | "cancelled" | "failed" | "uncertain";
export type HostOutcome = "succeeded" | "failed" | "interrupted";

export interface SessionRef { instanceID: string; sessionID: string; projectID: string; directory: string; workspaceID?: string }
export interface Provenance { producer: SessionRef; createdAt: number; correlationID: string; rootID: string; hops: number; causationID?: string }
export interface TaskRecord { id: string; title: string; producer: SessionRef; state: TaskState; revision: number; createdAt: number; resultID?: string }
export interface ResultRecord { id: string; schemaVersion: 1; taskID: string; outcome: "completed" | "failed" | "cancelled"; summary: string; data?: Json; references: string[]; provenance: Provenance; supersedes?: string }
export interface CoordinationEvent { id: string; name: string; provenance: Provenance; payload?: Json; taskID?: string; resultID?: string; sourceSequence?: number }
export interface JobRecord { id: string; owner: SessionRef; target: SessionRef; state: JobState; revision: number; createdAt: number; expiresAt: number }
export interface RunRecord { id: string; jobID: string; state: RunState; matchedEventIDs: string[]; resultIDs: string[]; createdAt: number; hostOutcome?: HostOutcome; executionStartedSequence?: number }
export interface DeliveryRecord { id: string; runID?: string; target: SessionRef; messageID: string; text: string; payloadHash: string; attempts: number; nextAttemptAt: number }

export class CoordinationError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) { super(message); }
}

const taskTransitions: Record<TaskState, readonly TaskState[]> = {
  open: ["working", "waiting_input", "completed", "failed", "cancelled"],
  working: ["waiting_input", "completed", "failed", "cancelled"],
  waiting_input: ["working", "completed", "failed", "cancelled"],
  completed: [], failed: [], cancelled: [],
};
const jobTransitions: Record<JobState, readonly JobState[]> = {
  waiting: ["ready", "paused", "completed", "cancelled", "timed_out", "failed"],
  ready: ["active", "paused", "completed", "cancelled", "timed_out", "failed"],
  active: ["waiting", "ready", "paused", "completed", "cancelled", "timed_out", "failed"],
  paused: ["waiting", "ready", "cancelled", "timed_out", "failed"],
  completed: [], cancelled: [], timed_out: [], failed: [],
};
const runTransitions: Record<RunState, readonly RunState[]> = {
  pending: ["submitting", "cancelled", "failed"],
  submitting: ["accepted", "delivered", "uncertain", "failed"],
  accepted: ["delivered", "uncertain"],
  delivered: ["settled", "uncertain"],
  uncertain: ["accepted", "delivered", "settled", "cancelled", "failed"],
  settled: [], cancelled: [], failed: [],
};

function transition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S): S {
  if (from === to) return from;
  if (!table[from]?.includes(to)) throw new CoordinationError("conflict", `Invalid lifecycle transition: ${from} to ${to}`);
  return to;
}

export const transitionTask = (from: TaskState, to: TaskState): TaskState => transition(taskTransitions, from, to);
export const transitionJob = (from: JobState, to: JobState): JobState => transition(jobTransitions, from, to);
export const transitionRun = (from: RunState, to: RunState): RunState => transition(runTransitions, from, to);

export function assertScope(caller: SessionRef, target: SessionRef): void {
  if (caller.instanceID !== target.instanceID || caller.projectID !== target.projectID) throw new CoordinationError("scope-denied", "Coordination is restricted to the same instance and project");
}

export function assertOwner(caller: SessionRef, owner: SessionRef): void {
  assertScope(caller, owner);
  if (caller.sessionID !== owner.sessionID) throw new CoordinationError("not-found", "Owned record not found");
}
