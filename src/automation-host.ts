import type { Plugin } from "@opencode/plugin";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { sameAutomationOwner, type AutomationOwner, type AutomationRecord, type ExecutionSelection } from "./automation-store.js";
import { MissingSessionError, SchedulerError } from "./scheduler.js";

export type AutomationSession = Pick<Plugin.Context["session"], "get" | "list" | "create" | "prompt" | "context">;
export type SessionInfo = Awaited<ReturnType<AutomationSession["get"]>>;
export function selectionValidator(ctx: Pick<Plugin.Context, "agent" | "model">, owner: AutomationOwner) {
  return async (selection: ExecutionSelection): Promise<void> => {
    if (selection.agent) await ctx.agent.get({ agentID: selection.agent, location: { directory: owner.directory } });
    if (selection.model) {
      const models = await ctx.model.list({ location: { directory: owner.directory }, types: ["chat"] });
      if (!models.data.some(model => model.id === selection.model!.id && model.providerID === selection.model!.providerID)) {
        throw new SchedulerError("invalid-input", "Saved automation model is unavailable");
      }
    }
  };
}
export function sessionState(info: SessionInfo): "idle" | "busy" | "unknown" {
  const { busy, idle } = info.time;
  return busy === undefined ? "idle" : idle === undefined || busy > idle ? "busy" : idle > busy ? "idle" : "unknown";
}

export class AutomationHost {
  constructor(readonly session: AutomationSession, readonly owner: AutomationOwner,
    private readonly validateSelection: (selection: ExecutionSelection) => Promise<void> = async () => {}) {}
  sessionID(): string { return Session.ID.create(); }
  messageID(): string { return SessionMessage.ID.create(); }

  async get(sessionID: string): Promise<SessionInfo> {
    try { return await this.session.get({ sessionID }); }
    catch (error) {
      if (error && typeof error === "object" && "_tag" in error && error._tag === "Session.NotFoundError" &&
        "sessionID" in error && error.sessionID === sessionID) throw new MissingSessionError("Target session no longer exists");
      throw error;
    }
  }

  inScope(info: SessionInfo): boolean {
    return sameAutomationOwner(this.owner, { projectID: info.projectID, directory: info.location.directory,
      ...(this.owner.workspaceID !== undefined ? { workspaceID: this.owner.workspaceID } : {}) });
  }

  async inspect(sessionID: string): Promise<SessionInfo> {
    const info = await this.get(sessionID);
    if (!this.inScope(info)) throw new SchedulerError("invalid-input", "Target session is outside this project/plugin location");
    return info;
  }

  async validateTarget(record: AutomationRecord): Promise<void> {
    if (record.target.kind !== "new-each-run") await this.inspect(record.target.sessionID);
    if (record.selection) await this.validateSelection(record.selection);
  }

  async candidates(input: { search?: string; cursor?: string; limit?: number } = {}) {
    const limit = input.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new SchedulerError("invalid-input", "limit must be an integer from 1 to 100");
    if ((input.search !== undefined && typeof input.search !== "string") || (input.cursor !== undefined && typeof input.cursor !== "string")) {
      throw new SchedulerError("invalid-input", "search and cursor must be text");
    }
    const page = await this.session.list({ directory: this.owner.directory, project: this.owner.projectID, limit,
      ...(input.search !== undefined ? { search: input.search } : {}), ...(input.cursor !== undefined ? { cursor: input.cursor } : {}) });
    return { targets: page.data.filter(info => this.inScope(info)).slice(0, limit).map(info => ({ sessionID: info.id,
      title: info.title ?? "", directory: info.location.directory, projectID: info.projectID, state: sessionState(info) })),
      ...(page.cursor.next ? { cursor: page.cursor.next } : {}) };
  }

  async create(sessionID: string, title: string, selection: ExecutionSelection): Promise<SessionInfo> {
    await this.validateSelection(selection);
    const info = await this.session.create({ id: sessionID, title: title.slice(0, 200), location: { directory: this.owner.directory },
      ...selection, metadata: { scheduler: { source: "zebrajaeger.opencode-scheduler" } } });
    if (info.id !== sessionID || !this.inScope(info)) throw new SchedulerError("unresolved", "Created session identity or location does not match intent");
    if ((selection.agent && info.agent !== selection.agent) || (selection.model &&
      (info.model?.id !== selection.model.id || info.model.providerID !== selection.model.providerID || info.model.variant !== selection.model.variant)) ||
      (selection.permissions && JSON.stringify(info.permissions) !== JSON.stringify(selection.permissions))) {
      throw new SchedulerError("unresolved", "Created session did not retain saved model, agent, or permission restrictions");
    }
    return info;
  }

  async context(sessionID: string) { await this.inspect(sessionID); return this.session.context({ sessionID }); }
  async prompt(record: AutomationRecord): Promise<void> {
    if (!record.run) throw new SchedulerError("invalid-input", "Automation has no prepared run");
    await this.session.prompt({ sessionID: record.run.sessionID, id: record.run.messageID, text: record.run.prompt, delivery: "queue",
      metadata: { scheduler: { source: "zebrajaeger.opencode-scheduler", automationId: record.id,
        occurrence: record.run.occurrence, revision: record.run.revision } } });
  }
}
