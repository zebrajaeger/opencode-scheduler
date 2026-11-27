import { expect, test, vi } from "vitest";
import { Agent } from "@opencode/schema/agent";
import { Project } from "@opencode/schema/project";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Tool } from "@opencode/schema/tool";
import { SessionCommunication } from "../src/session-communication.js";
import { communicationTools } from "../src/coordination-tools.js";
import { sessionInfo } from "./helpers.js";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";
import { CoordinationCommands } from "../src/coordination-commands.js";
import { OrchestrationJobs } from "../src/orchestration-jobs.js";

const invocation = { sessionID: Session.ID.create(), agent: Agent.ID.make("build"), messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("communication"), signal: new AbortController().signal, progress: async () => {} };

test("communication tools derive identity, reject forged scope, and explain ambiguity/history", async () => {
  const host = { get: vi.fn(async ({ sessionID }: { sessionID: string }) => sessionInfo(sessionID)),
    list: vi.fn(async () => ({ data: [sessionInfo("reviewer")], cursor: {} })), context: vi.fn(async () => []) };
  const tools = communicationTools(new SessionCommunication(host, "local"), { instanceID: "local", projectID: "p1", directory: "/project" });
  expect(tools.map(t => t.name)).toEqual(["session_find", "session_read", "session_send"]);
  expect(tools[0]!.description).toContain("clarification");
  expect(tools[1]!.description).toContain("private jobs");
  for (const tool of tools) expect(tool.input).toMatchObject({ additionalProperties: false });
  const bad = await tools[0]!.execute({ projectID: "forged" }, invocation);
  expect(JSON.parse(String(bad.content)).error.code).toBe("invalid-input");
  expect(host.list).not.toHaveBeenCalled();
  const found = await tools[0]!.execute({ query: "review" }, invocation);
  expect(JSON.parse(String(found.content)).result.status).toBe("resolved");
  const history = await tools[1]!.execute({ sessionID: "reviewer", view: "history" }, invocation);
  expect(JSON.parse(String(history.content)).error.code).toBe("unsupported-capability");
  const privateJobs = await tools[1]!.execute({ sessionID: "reviewer", view: "jobs" }, invocation);
  expect(JSON.parse(String(privateJobs.content)).error.code).toBe("invalid-input");
  const prompt = await tools[2]!.execute({ sessionID: "reviewer", mode: "prompt", text: "Run", idempotencyKey: "one" }, invocation);
  expect(JSON.parse(String(prompt.content)).error.code).toBe("unsupported-capability");
});

test("task and signal tools enforce finite bounded publication with completion guidance", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-command-tools-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  try {
    const host = { get: vi.fn(async ({ sessionID }: { sessionID: string }) => sessionInfo(sessionID)), list: vi.fn(async () => ({ data: [], cursor: {} })), context: vi.fn(async () => []) };
    const tools = communicationTools(new SessionCommunication(host, "local"), { instanceID: "local", projectID: "p1", directory: "/project" }, new CoordinationCommands(store));
    const task = tools.find(t => t.name === "task_update")!, signal = tools.find(t => t.name === "signal_emit")!;
    expect(task.description).toContain("relevant subagent/background");
    const created = JSON.parse(String((await task.execute({ state: "open", title: "Review", idempotencyKey: "create" }, invocation)).content));
    expect(created.ok).toBe(true);
    const bad = await signal.execute({ name: "review.finding", idempotencyKey: "bad", payload: { count: NaN } }, invocation);
    expect(JSON.parse(String(bad.content)).error.code).toBe("invalid-input");
    const oversized = await signal.execute({ name: "review.finding", idempotencyKey: "big", payload: "x".repeat(33000) }, invocation);
    expect(JSON.parse(String(oversized.content)).error.code).toBe("resource-limit");
    expect(store.events("p1")).toHaveLength(0);
  } finally { store.close(); }
});

test("job tools reject nested forged scope and inspect stop sources as well as trigger sources", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-job-tools-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const host = { get: vi.fn(async ({ sessionID }: { sessionID: string }) => {
    const info = sessionInfo(sessionID);
    if (sessionID === "foreign") info.projectID = Project.ID.make("foreign-project");
    return info;
  }), list: vi.fn(async () => ({ data: [], cursor: {} })), context: vi.fn(async () => []) };
  try {
    const tools = communicationTools(new SessionCommunication(host, "local"), { instanceID: "local", projectID: "p1", directory: "/project" }, undefined, new OrchestrationJobs(store));
    const create = tools.find(t => t.name === "job_create")!;
    const base = { label: "Status", operator: "all", conditions: [{ kind: "signal", name: "review.done", evidence: "future" }], action: { mode: "message", text: "Report" } };
    const forged = await create.execute({ ...base, conditions: [{ ...base.conditions[0], projectID: "forged" }] }, invocation);
    expect(JSON.parse(String(forged.content)).error.code).toBe("invalid-input");
    const foreign = await create.execute({ ...base, until: { operator: "all", conditions: [
      { kind: "signal", name: "review.done", producerSessionID: "foreign", evidence: "future" },
    ] } }, invocation);
    expect(JSON.parse(String(foreign.content)).error.code).toBe("scope-denied");
    expect(store.list("jobs", "p1", invocation.sessionID)).toHaveLength(0);
  } finally { store.close(); }
});

test("moved caller cannot read, publish, or cancel through an old location registration", async () => {
  const host = { get: vi.fn(async ({ sessionID }: { sessionID: string }) => sessionInfo(sessionID, "/moved")),
    list: vi.fn(async () => ({ data: [], cursor: {} })), context: vi.fn(async () => []) };
  const tools = communicationTools(new SessionCommunication(host, "local"), { instanceID: "local", projectID: "p1", directory: "/project" });
  const result = await tools[0]!.execute({ query: "review" }, invocation);
  expect(JSON.parse(String(result.content)).error.code).toBe("scope-denied");
  expect(host.list).not.toHaveBeenCalled();
});
