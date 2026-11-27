import type { Plugin } from "@opencode/plugin";
import { SessionMessage } from "@opencode/schema/session-message";
import { MissingSessionError, Scheduler, type Host, type HostEvent, type Owner } from "./scheduler.js";
import { timerTools } from "./tools.js";
import { prepareOrchestration, readinessReport } from "./orchestration-options.js";
import { CoordinationStore } from "./orchestration-store.js";
import { SessionCommunication } from "./session-communication.js";
import { communicationTools } from "./coordination-tools.js";
import { CoordinationCommands } from "./coordination-commands.js";
import { AdmissionGate } from "./admission-gate.js";
import { OrchestrationJobs } from "./orchestration-jobs.js";
import { OrchestrationDispatch } from "./orchestration-dispatch.js";
import { connectSDK, nativeReplayAvailable, type SDKClient } from "./opencode-sdk.js";
import { CoordinationError } from "./orchestration-domain.js";
import { SessionReplay } from "./session-replay.js";

export function createHost(ctx: { session: Pick<Plugin.Context["session"], "get" | "prompt"> }): Host {
  return {
    messageId: () => SessionMessage.ID.create(),
    inspect: async owner => {
      const info = await ctx.session.get({ sessionID: owner.sessionID }).catch((error: unknown) => {
        if (error && typeof error === "object" && "_tag" in error && error._tag === "Session.NotFoundError" &&
          "sessionID" in error && error.sessionID === owner.sessionID) throw new MissingSessionError("Owning session no longer exists");
        throw error;
      });
      const busy = info.time.busy;
      const idle = info.time.idle;
      const state = busy === undefined ? "idle" : idle === undefined || busy > idle ? "busy" : idle > busy ? "idle" : "unknown";
      return {
        owner: { sessionID: info.id, projectID: info.projectID, directory: info.location.directory,
          ...(owner.workspaceID !== undefined ? { workspaceID: owner.workspaceID } : {}) },
        state,
      };
    },
    prompt: async (owner, id, text, timerId) => {
      await ctx.session.prompt({ sessionID: owner.sessionID, id, text, delivery: "queue",
        metadata: { scheduler: { timerId, source: "zebrajaeger.opencode-scheduler" } } });
    },
  };
}

type Event = ReturnType<Plugin.Context["event"]["subscribe"]> extends AsyncIterable<infer E> ? E : never;

function normalizePayload(event: Event): HostEvent | undefined {
  switch (event.type) {
    case "session.deleted": return { sessionID: event.data.sessionID, type: "deleted" };
    case "session.execution.started": return { sessionID: event.data.sessionID, type: "busy" };
    case "session.execution.interrupted": return { sessionID: event.data.sessionID, type: "interrupted" };
    case "session.execution.succeeded": return { sessionID: event.data.sessionID, type: "succeeded" };
    case "session.execution.failed": return { sessionID: event.data.sessionID, type: "failed", error: JSON.stringify(event.data.error).slice(0, 500) };
    case "session.status": return { sessionID: event.data.sessionID, type: event.data.status.type === "idle" ? "idle" : "busy" };
    case "session.inbox.enqueued": return { sessionID: event.data.sessionID, type: "enqueued", messageId: event.data.inboxID };
    case "session.inbox.delivered": return { sessionID: event.data.sessionID, type: "delivered", messageId: event.data.inboxID };
    case "session.inbox.cancelled": return { sessionID: event.data.sessionID, type: "cancelled", messageId: event.data.inboxID };
    default: return undefined;
  }
}

export function normalizeEvent(event: Event): HostEvent | undefined {
  const normalized = normalizePayload(event);
  if (!normalized) return undefined;
  return { ...normalized, ...("durable" in event ? { sequence: event.durable.seq } : {}) };
}

export type SetupContext = Pick<Plugin.Context, "options" | "location" | "event"> & {
  session: Pick<Plugin.Context["session"], "get" | "prompt"> & Partial<Pick<Plugin.Context["session"], "list" | "context" | "hook">>;
  tool: Pick<Plugin.Context["tool"], "transform">;
};

export async function setup(ctx: SetupContext): Promise<() => Promise<void>> {
  const scheduler = new Scheduler(ctx.options);
  const orchestration = await prepareOrchestration(ctx.options);
  let store: CoordinationStore | undefined;
  let communication: SessionCommunication | undefined;
  let storageError: string | undefined;
  let gate: AdmissionGate | undefined;
  let jobs: OrchestrationJobs | undefined;
  let dispatcher: OrchestrationDispatch | undefined;
  let sdkError: string | undefined;
  let sdk: SDKClient | undefined;
  let sdkConnection: Promise<SDKClient> | undefined;
  let replay: SessionReplay | undefined;
  let dispatchEnabled = false;
  const following = new Set<string>();
  const sourceReadiness = new Map<string, Promise<void>>();
  const followers = new Set<Promise<void>>();
  let backgroundRegistration: { dispose(): Promise<void> } | undefined;
  if (orchestration.options && !orchestration.error && "list" in ctx.session && "context" in ctx.session) {
    try {
      store = await CoordinationStore.open(orchestration.options);
      gate = new AdmissionGate(store, scheduler.minimumSpacingSeconds);
      communication = new SessionCommunication(ctx.session as Pick<Plugin.Context["session"], "list" | "get" | "context">,
        orchestration.options.instanceID, Date.now, store, { textBytes: orchestration.options.limits.textBytes,
          mailboxEntries: orchestration.options.limits.mailboxEntries, projectEntries: orchestration.options.retention.unreferencedEntries }, orchestration.options.limits);
      jobs = new OrchestrationJobs(store, Date.now, undefined, sessionID => communication!.observedState(sessionID),
        () => sdk !== undefined, scheduler.minimumSpacingSeconds, sessionID => replay?.watermark(sessionID), orchestration.options.limits);
      dispatcher = new OrchestrationDispatch(store, gate, ctx.session, jobs);
      if (ctx.session.hook) backgroundRegistration = await ctx.session.hook("experimental.idle", event => {
        communication?.observeBackground(event.sessionID, event.background);
      });
    } catch {
      await backgroundRegistration?.dispose().catch(() => {});
      dispatcher?.close();
      store?.close();
      backgroundRegistration = undefined;
      dispatcher = undefined; jobs = undefined; communication = undefined; gate = undefined; store = undefined;
      storageError = "storage-unavailable";
    }
  }
  const controller = new AbortController();
  let closed = false;
  const ensureSDK = async (caller: import("./orchestration-domain.js").SessionRef) => {
    if (closed) throw new Error("Plugin is unloaded");
    if (sdk) return sdk;
    if (!orchestration.options?.sdk) throw new Error("SDK connection is not configured");
    sdkConnection ??= connectSDK(orchestration.options.sdk, caller);
    try {
      const connected = await sdkConnection;
      if (closed) throw new Error("Plugin is unloaded");
      if (!sdk) {
        sdk = connected;
        communication?.connectSDK(connected);
        if (store) replay = new SessionReplay(connected, store, projectID => jobs?.evaluateProject(projectID), undefined, async source => {
          const current = await communication!.inspect(source, source.sessionID);
          if (current.identity.directory !== source.directory) throw new Error("Native source moved from its recorded location");
        });
      }
      return connected;
    } finally { sdkConnection = undefined; }
  };
  const events = ctx.event.subscribe({ types: [
    "session.deleted", "session.execution.started", "session.execution.interrupted",
    "session.execution.succeeded", "session.execution.failed", "session.status",
    "session.inbox.enqueued", "session.inbox.delivered", "session.inbox.cancelled",
  ], signal: controller.signal });
  const consume = (async () => {
    try {
      for await (const event of events) {
        if (closed) break;
          const normalized = normalizeEvent(event);
          const shutdown = event.type === "session.execution.interrupted" && event.data.reason === "shutdown";
          if (normalized) scheduler.event(normalized);
          try {
            if (normalized && !shutdown && gate && orchestration.options) gate.observe({
              instanceID: orchestration.options.instanceID, sessionID: normalized.sessionID,
              projectID: ctx.location.project.id, directory: ctx.location.directory,
            }, normalized, Date.now());
            if (normalized && !shutdown) dispatcher?.event(ctx.location.project.id, normalized);
          } catch {
            // A durable-store failure must not terminate the legacy live stream.
            // Preserve unresolved gates and stop durable activation instead.
            storageError = "storage-unavailable";
            dispatchEnabled = false;
            dispatcher?.close();
          }
          if (event.type === "session.status") communication?.observe(event.data.sessionID, event.data.status.type);
      }
      if (!closed) scheduler.failEventStream("Event subscription ended; timer dispatch disabled");
    } catch (error) {
      if (!closed) scheduler.failEventStream(`Event subscription failed: ${String(error).slice(0, 300)}`);
    }
  })();
  const host = createHost(ctx);
  if (gate && orchestration.options) {
    const activeGate = gate;
    host.acquire = (owner, messageID, contender) => activeGate.acquire({ ...owner, instanceID: orchestration.options!.instanceID }, messageID, Date.now(), contender);
    host.finish = () => {
      // The legacy scheduler can settle on a weaker live observation. Durable
      // gates are released only by the independently validated observation lane.
    };
  }
  scheduler.connect(host);
  const location: Omit<Owner, "sessionID"> = {
    projectID: ctx.location.project.id, directory: ctx.location.directory,
    ...(ctx.location.workspaceID !== undefined ? { workspaceID: ctx.location.workspaceID } : {}),
  };
  let wake: ReturnType<typeof setTimeout> | undefined;
  let dispatchWork: Promise<void> | undefined;
  const recoveryAttempts = new Map<string, number>();
  let recover: (() => Promise<void>) | undefined;
  const pulse = () => {
    if (closed || !dispatcher || !dispatchEnabled) return;
    dispatchWork = (async () => { await recover?.(); if (!closed) await dispatcher!.pulse(ctx.location.project.id); })().catch(() => {
      // Storage/runtime failures do not become unhandled rejections or disable legacy tools.
      storageError = "storage-unavailable";
    }).finally(() => { if (!closed) { wake = setTimeout(pulse, 1000); wake.unref?.(); } });
  };
  const prepareSource = async (caller: import("./orchestration-domain.js").SessionRef, sessionID: string) => {
    if (!orchestration.options?.sdk || !store || !communication || !gate) throw new CoordinationError("unsupported-capability", "Native replay requires configured same-server SDK access");
    await ensureSDK(caller);
    if (!nativeReplayAvailable(sdk!)) throw new CoordinationError("unsupported-capability", "Durable native event retention is not qualified for this host; log synchronization alone is insufficient");
    const source = (await communication.inspect(caller, sessionID)).identity;
    const waitReady = async (readiness: Promise<void>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([readiness, new Promise<void>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Native source synchronization timed out")), 10000);
          timer.unref?.();
        })]);
      } finally { if (timer) clearTimeout(timer); }
    };
    if (following.has(sessionID)) {
      await waitReady(sourceReadiness.get(sessionID)!);
      if (!replay!.isReady(sessionID)) throw new Error("Source replay is reconnecting; retry registration after synchronization");
      return;
    }
    if (!following.has(sessionID)) {
      following.add(sessionID);
      let markReady!: () => void;
      const readiness = new Promise<void>(resolve => { markReady = resolve; });
      sourceReadiness.set(sessionID, readiness);
      const follower = replay!.follow(source, controller.signal, SessionReplay.backoff, () => { sdkError = undefined; markReady(); }, code => {
        sdkError = `Native source synchronization unavailable: ${code}`;
      }).catch(() => {
        if (!closed) sdkError = "Native replay supervision ended; source state is uncertain";
      }).finally(() => { markReady(); following.delete(sessionID); sourceReadiness.delete(sessionID); followers.delete(follower); });
      followers.add(follower);
      await waitReady(readiness);
      if (!replay!.isReady(sessionID)) throw new Error("Native source has not synchronized");
    }
  };
  recover = async () => {
    if (!orchestration.options?.sdk || !store || !communication || closed) return;
    const active: { id: string; ownerID: string; body: import("./orchestration-domain.js").Json }[] = [];
    let cursor = "";
    while (true) {
      const rows = store.projectRecords("jobs", location.projectID, cursor);
      active.push(...rows.filter(row => row.body && typeof row.body === "object" && !Array.isArray(row.body) &&
        ["waiting", "ready", "active", "paused"].includes(String(row.body.state))));
      if (rows.length < 100) break;
      cursor = rows.at(-1)!.id;
    }
    for (const row of active) {
      if (closed) return;
      const job = row.body as Record<string, import("./orchestration-domain.js").Json>;
      const sources = Array.isArray(job.conditions) ? job.conditions : [];
      for (const item of sources) {
        if (!item || typeof item !== "object" || Array.isArray(item) || item.kind !== "session" ||
          !["succeeded", "failed", "interrupted"].includes(String(item.predicate)) || typeof item.sessionID !== "string" || following.has(item.sessionID)) continue;
        try {
          const owner = await communication.inspect({ ...location, instanceID: orchestration.options.instanceID, sessionID: row.ownerID }, row.ownerID);
          await prepareSource(owner.identity, item.sessionID);
        } catch { sdkError = "Native source recovery is unavailable; dependent work remains blocked"; }
      }
    }
    if (!sdk && active.length) {
      try {
        const owner = await communication.inspect({ ...location, instanceID: orchestration.options.instanceID, sessionID: active[0]!.ownerID }, active[0]!.ownerID);
        await ensureSDK(owner.identity);
      } catch { sdkError = "SDK recovery connection is unavailable; unresolved gates remain blocked"; }
    }
    if (replay && sdk && nativeReplayAvailable(sdk) && gate && !closed) {
      let after = "";
      while (true) {
        const rows = store.projectRecords("target_gates", location.projectID, after);
        for (const row of rows) {
          const body = row.body;
          if (!body || typeof body !== "object" || Array.isArray(body) || !body.messageID || typeof body.directory !== "string") continue;
          const recoveryKey = `${row.id}:${body.messageID}`;
          if (Date.now() - (recoveryAttempts.get(recoveryKey) ?? 0) < 30000) continue;
          recoveryAttempts.set(recoveryKey, Date.now());
          try {
            await replay.recoverGate({ ...location, instanceID: orchestration.options.instanceID, sessionID: row.id, directory: body.directory }, gate,
              event => { if (!closed) dispatcher?.event(location.projectID, event); }, controller.signal);
          } catch { sdkError = "Admission recovery lacks synchronized evidence; gate preserved"; }
        }
        if (rows.length < 100 || closed) break;
        after = rows.at(-1)!.id;
      }
    }
  };
  try {
    const registration = await ctx.tool.transform(editor => {
      for (const tool of timerTools(scheduler, location)) editor.add(tool);
      if (orchestration.enabled) editor.add({
        name: "orchestration_status",
        options: { codemode: false },
        description: "Inspect orchestration configuration and verified capabilities. Runtime support alone does not mean durable operations are available. Does not activate sessions or expose credentials.",
        input: { type: "object", properties: {}, additionalProperties: false },
        execute: async (_input, invocation) => {
          if (!closed && orchestration.options?.sdk) {
            try {
              await ensureSDK({ ...location, instanceID: orchestration.options.instanceID, sessionID: invocation.sessionID });
              if (store && gate && replay && sdk && nativeReplayAvailable(sdk)) {
                let cursor = "";
                while (true) {
                  const rows = store.projectRecords("target_gates", location.projectID, cursor);
                  for (const row of rows) {
                    const body = row.body;
                    if (!body || typeof body !== "object" || Array.isArray(body) || !body.messageID || typeof body.directory !== "string") continue;
                    await replay.recoverGate({ instanceID: orchestration.options.instanceID, sessionID: row.id,
                      projectID: location.projectID, directory: body.directory }, gate, event => dispatcher?.event(location.projectID, event), controller.signal);
                  }
                  if (rows.length < 100) break;
                  cursor = rows.at(-1)!.id;
                }
              }
              sdkError = undefined;
            } catch { sdkError = "SDK endpoint/authentication/session binding could not be verified"; }
          }
          return { content: JSON.stringify({ ok: true, result: {
          ...readinessReport(orchestration), ...(storageError ? { error: { code: storageError, message: "Durable storage is unavailable; legacy timers remain available" } } : {}),
          capabilities: { ...readinessReport(orchestration).capabilities, "passive-mailbox": store !== undefined,
            "durable-jobs": jobs !== undefined, "durable-task-signals": store !== undefined,
            "automatic-dispatch": dispatchEnabled,
            "historical-messages": sdk !== undefined, "interaction-reconciliation": sdk !== undefined },
          ...(sdkError ? { sdkError } : {}),
        } }) };
        },
      });
      if (communication && orchestration.options) for (const tool of communicationTools(communication, {
        ...location, instanceID: orchestration.options.instanceID,
      }, store ? new CoordinationCommands(store, { payloadBytes: orchestration.options.limits.payloadBytes,
        textBytes: orchestration.options.limits.textBytes, projectEntries: orchestration.options.retention.unreferencedEntries }, Date.now, undefined,
        projectID => jobs?.evaluateProject(projectID)) : undefined, jobs, async (sessionID, messageID) => {
          return communication!.invocationCausation({ ...location, instanceID: orchestration.options!.instanceID, sessionID }, messageID);
         }, prepareSource, () => dispatchEnabled)) editor.add(tool);
    });
    // Gates persist across reload; only safely reconciled evidence releases them.
    // Fresh plugin-owned signal/time work can run without SDK while unresolved
    // targets remain blocked. Native sources must synchronize before matching.
    if (store && dispatcher && !storageError) {
      dispatchEnabled = true;
      pulse();
    }
    return async () => {
      if (closed) return;
      closed = true; if (wake) clearTimeout(wake); dispatcher?.close(); scheduler.close(); controller.abort();
      try { await registration.dispose(); await backgroundRegistration?.dispose(); }
      finally {
        await Promise.allSettled([consume, ...(dispatchWork ? [dispatchWork] : []), ...followers]);
        store?.close(); orchestration.dispose();
      }
    };
  } catch (error) {
    closed = true; if (wake) clearTimeout(wake); dispatcher?.close(); scheduler.close(); controller.abort();
    try { await backgroundRegistration?.dispose(); }
    finally { await Promise.allSettled([consume, ...(dispatchWork ? [dispatchWork] : []), ...followers]); store?.close(); orchestration.dispose(); }
    throw error;
  }
}
