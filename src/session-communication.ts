import type { Plugin } from "@opencode/plugin";
import { assertScope, CoordinationError, type SessionRef } from "./orchestration-domain.js";
import type { CoordinationStore } from "./orchestration-store.js";
import { createHash, randomUUID } from "node:crypto";
import { SessionMessage } from "@opencode/schema/session-message";
import type { SDKClient } from "./opencode-sdk.js";
import { causalEvidence, claimActivation, newCausation, persistedCausation, type Causation } from "./coordination-safety.js";

type SessionAPI = Pick<Plugin.Context["session"], "list" | "get" | "context">;
export interface FindInput { sessionID?: string; query?: string; directory?: string; parentID?: string; cursor?: string; limit?: number }
export interface SessionCandidate {
  identity: SessionRef;
  title?: string;
  parentID?: string;
  execution: "idle" | "busy" | "retry" | "unknown";
  lastOutcome?: "succeeded" | "failed" | "interrupted";
  inspectedAt: number;
  coverage: "session-snapshot";
}

export class SessionCommunication {
  private readonly observations = new Map<string, { execution: "idle" | "busy" | "retry"; observedAt: number }>();
  private sdk: SDKClient | undefined;
  private readonly background = new Map<string, { items: unknown[]; inspectedAt: number }>();
  constructor(private readonly host: SessionAPI, private readonly instanceID: string,
    private readonly now: () => number = Date.now, private readonly store?: CoordinationStore,
    private readonly limits = { textBytes: 16 * 1024, mailboxEntries: 100, projectEntries: 10_000 },
    private readonly causalLimits = { causalHops: 8, chainActivations: 20 }) {}

  connectSDK(client: SDKClient): void { this.sdk = client; }
  async validateCaller(caller: SessionRef): Promise<void> {
    const snapshot = await this.inspect(caller, caller.sessionID);
    if (snapshot.identity.directory !== caller.directory) throw new CoordinationError("scope-denied", "Invoking session moved from this plugin location");
  }
  async invocationCausation(caller: SessionRef, messageID: string): Promise<Causation> {
    const source = await this.inspect(caller, caller.sessionID);
    const messages = await this.host.context({ sessionID: caller.sessionID });
    this.sameLocation(source, await this.inspect(caller, caller.sessionID));
    if (source.identity.directory !== caller.directory) throw new CoordinationError("scope-denied", "Publication caller moved from its recorded location");
    const index = messages.findIndex(message => message.id === messageID);
    if (index < 0) throw new CoordinationError("history-unavailable", "Invoking message is outside verified context; cannot attribute publication safely");
    // User work can arrive while a tool is running. Only the user input before
    // this invocation belongs to its causal lane, never the latest queued input.
    const user = messages.slice(0, index + 1).reverse().find(message => message.type === "user");
    if (!user) throw new CoordinationError("history-unavailable", "Invoking message has no verifiable user-input origin");
    return this.store ? persistedCausation(this.store, caller.projectID, caller.sessionID, user.id) ?? newCausation() : newCausation();
  }
  observeBackground(sessionID: string, items: readonly unknown[]): void {
    this.background.set(sessionID, { items: [...items], inspectedAt: this.now() });
  }

  async state(caller: SessionRef, sessionID: string) {
    const snapshot = await this.inspect(caller, sessionID);
    const interactions = await this.interactions(caller, sessionID);
    const background = this.background.get(sessionID);
    return { ...snapshot, interactions,
      waitingInput: interactions.coverage === "interaction-snapshot" ? Boolean(interactions.forms?.length || interactions.permissions?.length) : "unknown",
      background: background && this.now() - background.inspectedAt <= 30_000
        ? { ...background, coverage: "experimental-idle-hook-snapshot", replayable: false, completeness: "host-reported-only" }
        : { coverage: "unknown" },
      businessCompletion: "explicit-task-result-only" };
  }

  async history(caller: SessionRef, sessionID: string, limit = 20, cursor?: string) {
    const source = await this.inspect(caller, sessionID);
    if (!this.sdk) throw new CoordinationError("unsupported-capability", "Historical messages require a verified SDK connection");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CoordinationError("invalid-input", "History limit must be from 1 to 100");
    const result = await this.sdk.message.list({ sessionID, limit, ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(10_000) });
    this.sameLocation(source, await this.inspect(caller, sessionID));
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > 64 * 1024) throw new CoordinationError("resource-limit", "History page exceeds byte limit; request a smaller page");
    return { source, ...result, coverage: "historical-messages", trustedInstructions: false };
  }

  async interactions(caller: SessionRef, sessionID: string) {
    const source = await this.inspect(caller, sessionID);
    if (!this.sdk) return { coverage: "unknown", forms: null, permissions: null };
    const [forms, permissions] = await Promise.all([
      this.sdk.session.form.list({ sessionID }, { signal: AbortSignal.timeout(10_000) }),
      this.sdk.permission.list({ sessionID }, { signal: AbortSignal.timeout(10_000) }),
    ]);
    this.sameLocation(source, await this.inspect(caller, sessionID));
    if (Buffer.byteLength(JSON.stringify({ forms, permissions }), "utf8") > 64 * 1024) throw new CoordinationError("resource-limit", "Interaction snapshot exceeds byte limit");
    return { forms, permissions, inspectedAt: this.now(), coverage: "interaction-snapshot", replayable: false,
      plainTextQuestions: "not-classifiable", automaticApproval: false };
  }

  private sameLocation(before: SessionCandidate, after: SessionCandidate): void {
    if (before.identity.sessionID !== after.identity.sessionID || before.identity.directory !== after.identity.directory ||
      before.identity.workspaceID !== after.identity.workspaceID) throw new CoordinationError("scope-denied", "Session location changed during read");
  }

  observe(sessionID: string, execution: "idle" | "busy" | "retry"): void {
    this.observations.set(sessionID, { execution, observedAt: this.now() });
  }

  observedState(sessionID: string): "idle" | "busy" | "retry" | "unknown" {
    const observation = this.observations.get(sessionID);
    return observation && this.now() - observation.observedAt <= 30_000 ? observation.execution : "unknown";
  }

  private candidate(info: Awaited<ReturnType<SessionAPI["get"]>>): SessionCandidate {
    const busy = info.time.busy, idle = info.time.idle;
    const snapshot = busy === undefined ? "idle" : idle === undefined || busy > idle ? "busy" : idle > busy ? "idle" : "unknown";
    const observation = this.observations.get(info.id);
    const execution = observation && this.now() - observation.observedAt <= 30_000 &&
      observation.observedAt >= Math.max(busy ?? 0, idle ?? 0) ? observation.execution : snapshot;
    const identity: SessionRef = { instanceID: this.instanceID, sessionID: info.id, projectID: info.projectID,
      directory: info.location.directory };
    return { identity: Object.freeze(identity), ...(info.title !== undefined ? { title: info.title } : {}),
      ...(info.parentID !== undefined ? { parentID: info.parentID } : {}), execution,
      ...(info.outcome !== undefined ? { lastOutcome: info.outcome } : {}),
      inspectedAt: this.now(), coverage: "session-snapshot" };
  }

  async inspect(caller: SessionRef, sessionID: string): Promise<SessionCandidate> {
    if (caller.instanceID !== this.instanceID) throw new CoordinationError("scope-denied", "Session transport instance mismatch");
    let info: Awaited<ReturnType<SessionAPI["get"]>>;
    try { info = await this.host.get({ sessionID }); }
    catch (error) {
      if (error && typeof error === "object" && "_tag" in error && error._tag === "Session.NotFoundError" &&
        "sessionID" in error && error.sessionID === sessionID) throw new CoordinationError("not-found", "Session not found");
      throw new CoordinationError("transient-host-error", "Cannot inspect session", true);
    }
    const candidate = this.candidate(info);
    if (candidate.identity.sessionID !== sessionID) throw new CoordinationError("scope-denied", "Host returned a different session identity");
    assertScope(caller, candidate.identity);
    const observation = this.observations.get(sessionID);
    // Reading a cached live status does not renew its original freshness window.
    if (candidate.execution !== "unknown" && (!observation || this.now() - observation.observedAt > 30_000 ||
      observation.observedAt < Math.max(info.time.busy ?? 0, info.time.idle ?? 0))) this.observe(sessionID, candidate.execution);
    return candidate;
  }

  async find(caller: SessionRef, input: FindInput) {
    if (caller.instanceID !== this.instanceID) throw new CoordinationError("scope-denied", "Session transport instance mismatch");
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new CoordinationError("invalid-input", "Session search limit must be between 1 and 100");
    if (input.sessionID) return { status: "resolved" as const, candidates: [await this.inspect(caller, input.sessionID)], cursor: {} };
    const result = await this.host.list({ project: caller.projectID, limit: input.limit ?? 20,
      ...(input.query !== undefined ? { search: input.query } : {}),
      ...(input.directory !== undefined ? { directory: input.directory } : {}),
      ...(input.parentID !== undefined ? { parentID: input.parentID } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}), archived: false });
    const candidates = result.data.filter(info => info.projectID === caller.projectID).map(info => this.candidate(info));
    // Pagination means a single row is not necessarily a unique match.
    return { status: candidates.length === 0 ? "not-found" as const : candidates.length === 1 && !result.cursor.next && !input.cursor
      ? "resolved" as const : "ambiguous-session" as const, candidates, cursor: result.cursor };
  }

  async context(caller: SessionRef, sessionID: string, limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CoordinationError("invalid-input", "Context limit must be between 1 and 100");
    const source = await this.inspect(caller, sessionID);
    const messages = await this.host.context({ sessionID });
    // Recheck because session movement can race an asynchronous context read.
    const current = await this.inspect(caller, sessionID);
    this.sameLocation(source, current);
    const selected = messages.slice(-limit);
    while (selected.length && Buffer.byteLength(JSON.stringify(selected), "utf8") > 64 * 1024) selected.shift();
    return { source, coverage: "current-compacted-context" as const, messages: selected,
      truncated: messages.length > selected.length, inspectedAt: this.now(), trustedInstructions: false };
  }

  async tasks(caller: SessionRef, sessionID: string, limit = 20, cursor = "") {
    const source = await this.inspect(caller, sessionID);
    if (!this.store) throw new CoordinationError("unsupported-capability", "Durable task storage is unavailable");
    const rows = this.store.list("tasks", caller.projectID, sessionID, limit, cursor);
    this.boundedPage(rows);
    return { source, tasks: rows, cursor: rows.length === limit ? rows.at(-1)!.id : undefined, inspectedAt: this.now() };
  }

  async result(caller: SessionRef, sessionID: string, resultID: string) {
    const source = await this.inspect(caller, sessionID);
    if (!this.store) throw new CoordinationError("unsupported-capability", "Durable result storage is unavailable");
    const row = this.store.get("results", resultID, caller.projectID);
    if (!row || row.ownerID !== sessionID) throw new CoordinationError("not-found", "Result not found");
    return { source, result: row.body, trustedInstructions: false, coverage: "immutable-result" as const };
  }

  async sendMessage(caller: SessionRef, sessionID: string, text: string, idempotencyKey: string,
    limits = this.limits) {
    if (!text.trim() || Buffer.byteLength(text, "utf8") > limits.textBytes || !idempotencyKey.trim() || idempotencyKey.length > 128) {
      throw new CoordinationError("invalid-input", "Message text and idempotency key must be nonempty and within limits");
    }
    const target = await this.inspect(caller, sessionID);
    await this.validateCaller(caller);
    if (!this.store) throw new CoordinationError("unsupported-capability", "Durable mailbox is unavailable");
    const store = this.store;
    const id = createHash("sha256").update(JSON.stringify([caller.instanceID, caller.projectID, caller.sessionID, idempotencyKey])).digest("hex");
    return store.transaction(() => {
      const previous = store.get("mailbox", id, caller.projectID);
      if (previous) {
        const body = previous.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || body.text !== text || body.targetSessionID !== sessionID) throw new CoordinationError("conflict", "Message key already used for a different payload");
        return { status: "stored" as const, activated: false, id, message: body };
      }
      store.enforceCapacity(caller.projectID, limits.projectEntries);
      if (store.list("mailbox", caller.projectID, sessionID, 100).length >= limits.mailboxEntries) throw new CoordinationError("resource-limit", "Target mailbox is full");
      const body = { id, text, targetSessionID: sessionID, producerSessionID: caller.sessionID,
        projectID: caller.projectID, instanceID: caller.instanceID, createdAt: this.now(),
        correlationID: randomUUID(), targetDirectory: target.identity.directory };
      store.insert("mailbox", id, caller.projectID, sessionID, body);
      return { status: "stored" as const, activated: false, id, message: body };
    });
  }

  async mailbox(caller: SessionRef, sessionID: string, limit = 20, cursor = "") {
    const source = await this.inspect(caller, sessionID);
    if (!this.store) throw new CoordinationError("unsupported-capability", "Durable mailbox is unavailable");
    const entries = this.store.list("mailbox", caller.projectID, sessionID, limit, cursor);
    this.boundedPage(entries);
    return { source, entries, cursor: entries.length === limit ? entries.at(-1)!.id : undefined, trustedInstructions: false };
  }

  private boundedPage(value: unknown): void {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 64 * 1024) throw new CoordinationError("resource-limit", "Stored page exceeds byte limit; request a smaller page");
  }

  async activatingIntent(caller: SessionRef, sessionID: string, text: string, idempotencyKey: string, causation: Causation = newCausation()) {
    if (!text.trim() || Buffer.byteLength(text) > this.limits.textBytes || !idempotencyKey.trim() || idempotencyKey.length > 128) throw new CoordinationError("invalid-input", "Invalid bounded prompt or idempotency key");
    const target = await this.inspect(caller, sessionID);
    await this.validateCaller(caller);
    if (!this.store) throw new CoordinationError("unsupported-capability", "Durable outbox is unavailable");
    const store = this.store;
    const key = createHash("sha256").update(JSON.stringify([caller.instanceID, caller.projectID, caller.sessionID, "prompt", idempotencyKey])).digest("hex");
    return store.transaction(() => {
      const previous = store.get("deliveries", `manual_${key}`, caller.projectID);
      if (previous) {
        const body = previous.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || body.text !== text ||
          !body.target || typeof body.target !== "object" || Array.isArray(body.target) || body.target.sessionID !== sessionID) throw new CoordinationError("conflict", "Prompt key already used with a different payload");
        return { id: `manual_${key}`, messageID: body.messageID, state: body.state };
      }
      store.enforceCapacity(caller.projectID, this.limits.projectEntries);
      const cause = causalEvidence([{ ...causation }], this.causalLimits.causalHops);
      claimActivation(store, caller.projectID, caller.sessionID, cause, this.causalLimits.chainActivations);
      const messageID = SessionMessage.ID.create(), runID = `run_manual_${key}`, jobID = `job_manual_${key}`;
      store.insert("jobs", jobID, caller.projectID, caller.sessionID, { id: jobID, ownerSessionID: caller.sessionID,
        owner: JSON.parse(JSON.stringify(caller)), sources: [],
        target: JSON.parse(JSON.stringify(target.identity)), state: "ready", mode: "once", runID,
        createdAt: this.now(), expiresAt: this.now() + 3600000, conditions: [], operator: "all" });
      store.insert("runs", runID, caller.projectID, caller.sessionID, { id: runID, jobID, state: "pending", matchedEventIDs: [], resultIDs: [], createdAt: this.now() });
      store.insert("deliveries", `manual_${key}`, caller.projectID, caller.sessionID, { id: `manual_${key}`, jobID, runID,
        target: JSON.parse(JSON.stringify(target.identity)), mode: "prompt", text, messageID, state: "pending", attempts: 0,
        ...cause,
        nextAttemptAt: this.now(), createdAt: this.now(), payloadHash: createHash("sha256").update(text).digest("hex") });
      return { id: `manual_${key}`, messageID, state: "pending" };
    });
  }
}
