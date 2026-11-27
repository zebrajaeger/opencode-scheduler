import { afterEach, expect, test, vi } from "vitest";
import { Agent } from "@opencode/schema/agent";
import { SessionMessage } from "@opencode/schema/session-message";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { Automations } from "../src/automations.js";
import { AutomationStore } from "../src/automation-store.js";
import { Scheduler } from "../src/scheduler.js";
import { automationTools } from "../src/automation-tools.js";
import { memoryStorage, record } from "./automation-store.test.js";
import { hostFixture } from "./automation-host.test.js";
import { sessionInfo } from "./helpers.js";

const instances: { runtime: Automations; scheduler: Scheduler }[] = [];
afterEach(() => { instances.forEach(({ runtime, scheduler }) => { runtime.close(); scheduler.close(); }); instances.length = 0; });
async function fixture(minimumSpacingSeconds = 30) {
  const { storage } = memoryStorage(), { host, session } = hostFixture();
  const store = new AutomationStore(storage, record().owner); await store.load();
  const scheduler = new Scheduler({ minimumSpacingSeconds }), runtime = new Automations(store, host, scheduler); instances.push({ scheduler, runtime });
  const tools = automationTools(runtime);
  const call = async (name: string, input: unknown, sessionID = "ses_test") => {
    const output = await tools.find(tool => tool.name === name)!.execute(input, { sessionID: Session.ID.make(sessionID), agent: Agent.ID.make("build"),
      messageID: SessionMessage.ID.create(), id: Tool.CallID.make("test"), signal: new AbortController().signal, progress: async () => {} });
    return JSON.parse(output.content as string);
  };
  return { tools, call, session, store, runtime };
}
test("automation tool inventory schemas defaults and control operations are discoverable", async () => {
  const { tools, call } = await fixture();
  expect(tools.map(tool => tool.name)).toEqual(["automation_create", "automation_list", "automation_update", "automation_pause", "automation_resume", "automation_remove", "automation_targets"]);
  const created = await call("automation_create", { prompt: "PR report with links", schedule: { kind: "interval", intervalSeconds: 3600 }, target: { kind: "current" } });
  expect(created).toMatchObject({ ok: true, result: { missedPolicy: "skip", target: { kind: "current", sessionID: "ses_test" } } });
  const automationId = created.result.id;
  expect((await call("automation_pause", { automationId })).result.enabled).toBe(false);
  expect((await call("automation_resume", { automationId })).result.enabled).toBe(true);
  expect((await call("automation_remove", { automationId })).result.removed).toBe(true);
  expect((await call("automation_list", {})).result.automations).toEqual([]);
});

test("automation create and updates enforce configured minimum spacing including combined retarget", async () => {
  const { call, store } = await fixture(60);
  const input = { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } };
  expect(await call("automation_create", input)).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  const created = await call("automation_create", { ...input, schedule: { kind: "interval", intervalSeconds: 60 } });
  const automationId = created.result.id, before = store.get(automationId);
  for (const patch of [{ schedule: input.schedule }, { target: { kind: "new-reuse" }, schedule: input.schedule }]) {
    expect(await call("automation_update", { automationId, ...patch })).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(store.get(automationId)).toEqual(before);
  }
});
test("invalid calendar targets foreign IDs and ownership overrides return controlled errors", async () => {
  const { call, session } = await fixture();
  for (const input of [
    { prompt: "Check", schedule: { kind: "cron", expression: "0 9 * * *" }, target: { kind: "current" } },
    { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 } },
    { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" }, projectID: "other" },
  ]) expect((await call("automation_create", input)).ok).toBe(false);
  expect(await call("automation_update", { automationId: "foreign", prompt: "Change" })).toMatchObject({ ok: false, error: { code: "not-found" } });
  vi.mocked(session.get).mockResolvedValueOnce(sessionInfo("ses_foreign", "/foreign"));
  expect((await call("automation_list", {}, "ses_foreign")).ok).toBe(false);
});
test("described-chat requests expose clarification guidance and persist only resolved IDs", async () => {
  const { tools, call, session } = await fixture();
  vi.mocked(session.list).mockResolvedValue({ data: [{ ...sessionInfo("s2"), title: "Deployment one" }, { ...sessionInfo("s3"), title: "Deployment two" }], cursor: {} });
  const candidates = await call("automation_targets", { search: "Deployment" }); expect(candidates.result.targets).toHaveLength(2);
  expect(tools.find(tool => tool.name === "automation_create")!.description).toContain("ask when ambiguous");
  expect((await call("automation_list", {})).result.automations).toEqual([]);
  const result = await call("automation_create", { prompt: "Inspect deployment status", schedule: { kind: "interval", intervalSeconds: 3600 }, target: { kind: "existing", sessionID: "s2" }, missedPolicy: "catch-up-once" });
  expect(result.result.target.sessionID).toBe("s2"); expect(result.result.missedPolicy).toBe("catch-up-once");
});

test("weekday PR-link request uses explicit zone and reusable-new-chat policy without provider integration", async () => {
  // Deterministic agent-boundary acceptance: natural-language intent -> explicit tool arguments.
  // This fixture does not claim a probabilistic model correctly interpreted the sentence.
  const request = "Every weekday at 09:00 Europe/Berlin check my open PRs and post a report with links in a new chat.";
  const { call, tools, session } = await fixture();
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => {
    if (sessionID === "ses_test") return sessionInfo(sessionID);
    throw { _tag: "Session.NotFoundError", sessionID };
  });
  const result = await call("automation_create", { prompt: request, schedule: { kind: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" }, target: { kind: "new-reuse", title: "PR report" } });
  expect(result).toMatchObject({ ok: true, result: { prompt: request, missedPolicy: "skip", target: { kind: "new-reuse" }, enabled: true } });
  expect(session.create).toHaveBeenCalledOnce(); expect(session.prompt).not.toHaveBeenCalled();
  expect(tools.every(tool => tool.description.includes("No automatic tool approval"))).toBe(true);
  expect(tools.find(tool => tool.name === "automation_create")!.description).toContain("'In a new chat' means new-reuse");
});

test("unique described deployment chat interval request supports explicit catch-up pause resume and every-run chats", async () => {
  const { call, tools, session } = await fixture();
  const prompt = "Every 30 minutes check the deployment in the chat where deployment is running; catch up once after downtime.";
  vi.mocked(session.list).mockResolvedValue({ data: [{ ...sessionInfo("ses_deploy"), title: "Deployment" }], cursor: {} });
  const candidates = (await call("automation_targets", { search: "Deployment" })).result.targets;
  expect(candidates).toHaveLength(1);
  const created = await call("automation_create", { prompt, schedule: { kind: "interval", intervalSeconds: 1800 }, target: { kind: "existing", sessionID: candidates[0].sessionID }, missedPolicy: "catch-up-once" });
  const automationId = created.result.id;
  expect((await call("automation_pause", { automationId })).result.enabled).toBe(false);
  expect((await call("automation_update", { automationId, target: { kind: "new-each-run" }, prompt: "Every time a new chat: check the deployment" })).result.enabled).toBe(false);
  expect((await call("automation_resume", { automationId })).result.enabled).toBe(true);
  expect(session.create).not.toHaveBeenCalled();
  expect(tools.find(tool => tool.name === "automation_create")!.description).toContain("only for an explicit new chat every time");
});

test("weekday PR request maps to explicit calendar zone and reports without provider configuration", async () => {
  const { tools, call } = await fixture();
  const prompt = "Check my open PRs every weekday at 09:00 Europe/Berlin and report links here.";
  const result = await call("automation_create", { prompt, schedule: { kind: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" }, target: { kind: "current" } });
  expect(result).toMatchObject({ ok: true, result: { prompt, missedPolicy: "skip", recurrence: { schedule: { expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" } } } });
  for (const tool of tools) expect(tool.description).toContain("No automatic tool approval");
  expect(result.result).not.toHaveProperty("credentials"); expect(result.result).not.toHaveProperty("provider");
});

test("new-chat request reuses one chat while explicit every-run policy creates none at configuration", async () => {
  const { call, session } = await fixture();
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => {
    if (sessionID === "ses_test") return sessionInfo(sessionID);
    throw { _tag: "Session.NotFoundError", sessionID };
  });
  const reusable = await call("automation_create", { prompt: "Report in a new chat", schedule: { kind: "interval", intervalSeconds: 3600 }, target: { kind: "new-reuse" } });
  expect(reusable.ok).toBe(true); expect(session.create).toHaveBeenCalledOnce();
  const fresh = await call("automation_create", { prompt: "Report in a new chat every time", schedule: { kind: "interval", intervalSeconds: 3600 }, target: { kind: "new-each-run" } });
  expect(fresh.ok).toBe(true); expect(session.create).toHaveBeenCalledOnce();
  expect((await call("automation_pause", { automationId: fresh.result.id })).result.enabled).toBe(false);
  expect((await call("automation_resume", { automationId: fresh.result.id })).result.enabled).toBe(true);
});
