import type { Plugin } from "@opencode/plugin";
import { SessionMessage } from "@opencode/schema/session-message";
import { MissingSessionError, Scheduler, type Host, type HostEvent, type Owner } from "./scheduler.js";
import { timerTools } from "./tools.js";

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
  session: Pick<Plugin.Context["session"], "get" | "prompt">;
  tool: Pick<Plugin.Context["tool"], "transform">;
};

export async function setup(ctx: SetupContext): Promise<() => Promise<void>> {
  const scheduler = new Scheduler(ctx.options);
  const controller = new AbortController();
  let closed = false;
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
        if (normalized) scheduler.event(normalized);
      }
      if (!closed) scheduler.failEventStream("Event subscription ended; timer dispatch disabled");
    } catch (error) {
      if (!closed) scheduler.failEventStream(`Event subscription failed: ${String(error).slice(0, 300)}`);
    }
  })();
  scheduler.connect(createHost(ctx));
  const location: Omit<Owner, "sessionID"> = {
    projectID: ctx.location.project.id, directory: ctx.location.directory,
    ...(ctx.location.workspaceID !== undefined ? { workspaceID: ctx.location.workspaceID } : {}),
  };
  try {
    const registration = await ctx.tool.transform(editor => {
      for (const tool of timerTools(scheduler, location)) editor.add(tool);
    });
    return async () => {
      if (closed) return;
      closed = true; scheduler.close(); controller.abort();
      try { await registration.dispose(); } finally { await consume; }
    };
  } catch (error) {
    closed = true; scheduler.close(); controller.abort();
    await consume;
    throw error;
  }
}
