import { expect, test, vi } from "vitest";
import type { Plugin } from "@opencode/plugin";
import { Project } from "@opencode/schema/project";
import { sessionInfo } from "./helpers.js";
import { SessionCommunication } from "../src/session-communication.js";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";
import { OpenCode } from "@opencode/client";
import { SessionMessage } from "@opencode/schema/session-message";

function fixture() {
  const first = sessionInfo("a", "C:/p"); first.title = "Review";
  const second = sessionInfo("b", "C:/worktree"); second.title = "Review";
  const host: Pick<Plugin.Context["session"], "list" | "get" | "context"> = {
    get: vi.fn(async ({ sessionID }) => {
      if (sessionID === "missing") throw { _tag: "Session.NotFoundError", sessionID };
      if (sessionID === "caller") return sessionInfo("caller", "C:/p");
      return sessionID === "b" ? second : first;
    }),
    list: vi.fn(async () => ({ data: [first, second], cursor: {} })),
    context: vi.fn(async () => []),
  };
  const caller = { instanceID: "local", sessionID: "caller", projectID: "p1", directory: "C:/p" };
  return { first, second, host, caller, service: new SessionCommunication(host, "local", () => 123) };
}

test("same-title discovery returns ambiguity and freezes same-project worktree identities", async () => {
  const { service, caller, host } = fixture();
  const found = await service.find(caller, { query: "Review" });
  expect(found.status).toBe("ambiguous-session");
  expect(found.candidates.map(c => c.identity.directory)).toEqual(["C:/p", "C:/worktree"]);
  expect(Object.isFrozen(found.candidates[0]!.identity)).toBe(true);
  expect(host.list).toHaveBeenCalledWith({ project: "p1", limit: 20, search: "Review", archived: false });
});

test("exact IDs resolve without title selection and missing/foreign sessions do not expose data", async () => {
  const { service, caller, second } = fixture();
  expect((await service.find(caller, { sessionID: "b" })).status).toBe("resolved");
  await expect(service.find(caller, { sessionID: "missing" })).rejects.toMatchObject({ code: "not-found" });
  second.projectID = Project.ID.make("other");
  await expect(service.find(caller, { sessionID: "b" })).rejects.toMatchObject({ code: "scope-denied" });
});

test("one candidate with another page is not silently selected", async () => {
  const { service, caller, host, first } = fixture();
  vi.mocked(host.list).mockResolvedValue({ data: [first], cursor: { next: "next-page" } });
  const found = await service.find(caller, { query: "Review", limit: 1 });
  expect(found.status).toBe("ambiguous-session");
  expect(found.cursor.next).toBe("next-page");
});

test("technical state and compacted context do not infer business completion", async () => {
  const { service, caller, first, host } = fixture();
  first.time.busy = 10; first.time.idle = 10;
  expect((await service.inspect(caller, "a")).execution).toBe("unknown");
  first.time.idle = 20;
  first.outcome = "succeeded";
  const result = await service.context(caller, "a");
  expect(result).toMatchObject({ coverage: "current-compacted-context", trustedInstructions: false,
    source: { execution: "idle", lastOutcome: "succeeded", inspectedAt: 123 } });
  expect(result).not.toHaveProperty("taskCompleted");
  expect(host.context).toHaveBeenCalledExactlyOnceWith({ sessionID: "a" });
});

test("live retry evidence is fresh and stale observations fall back to snapshots", async () => {
  const { caller, host, first } = fixture();
  let now = 100;
  const service = new SessionCommunication(host, "local", () => now);
  first.time.busy = 10;
  service.observe("a", "retry");
  expect((await service.inspect(caller, "a")).execution).toBe("retry");
  now += 20_000;
  expect((await service.inspect(caller, "a")).execution).toBe("retry");
  now += 10_001;
  expect((await service.inspect(caller, "a")).execution).toBe("busy");
  await expect(service.result(caller, "a", "unknown")).rejects.toMatchObject({ code: "unsupported-capability" });
});

test("search rejects a foreign instance before touching the host", async () => {
  const { service, caller, host } = fixture();
  await expect(service.find({ ...caller, instanceID: "foreign" }, { query: "Review" })).rejects.toMatchObject({ code: "scope-denied" });
  expect(host.list).not.toHaveBeenCalled();
});

test("exact inspection rejects a mismatched host response identity", async () => {
  const { service, caller, host, first } = fixture();
  vi.mocked(host.get).mockResolvedValue(first);
  await expect(service.inspect(caller, "different")).rejects.toMatchObject({ code: "scope-denied" });
});

test("SDK history and interaction snapshots are bounded and reject a moved source", async () => {
  const { service, caller, second } = fixture();
  let moveDuringRead = false;
  const client = OpenCode.make({ baseUrl: "http://session-read.invalid", fetch: async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (moveDuringRead) second.location.directory = sessionInfo("b", "C:/moved").location.directory;
    if (url.pathname.endsWith("/message")) return Response.json({ data: [], cursor: { next: "next-page" } });
    if (url.pathname.endsWith("/form")) return Response.json({ data: [{ id: "approval", sessionID: "b" }] });
    return Response.json({ data: [] });
  } });
  service.connectSDK(client);
  expect(await service.history(caller, "b", 1)).toMatchObject({ coverage: "historical-messages", cursor: { next: "next-page" }, trustedInstructions: false });
  expect(await service.interactions(caller, "b")).toMatchObject({ coverage: "interaction-snapshot", forms: [{ id: "approval" }], permissions: [] });
  moveDuringRead = true;
  await expect(service.history(caller, "b")).rejects.toMatchObject({ code: "scope-denied" });
});

test("interaction waits and foreground/descendant background snapshots remain ephemeral evidence", async () => {
  const { caller, host } = fixture();
  let now = 1000, pending = true;
  const service = new SessionCommunication(host, "local", () => now);
  expect(await service.state(caller, "a")).toMatchObject({ waitingInput: "unknown", background: { coverage: "unknown" } });
  service.connectSDK(OpenCode.make({ baseUrl: "http://interactions.invalid", fetch: async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return Response.json({ data: pending && url.pathname.endsWith("/form") ? [{ id: "approval", sessionID: "a" }] : [] });
  } }));
  service.observeBackground("a", [{ type: "subagent", sessionID: "a", id: "foreground-child" },
    { type: "shell", sessionID: "descendant", id: "descendant-background" }]);
  expect(await service.state(caller, "a")).toMatchObject({ waitingInput: true,
    interactions: { coverage: "interaction-snapshot", replayable: false, plainTextQuestions: "not-classifiable", automaticApproval: false },
    background: { coverage: "experimental-idle-hook-snapshot", replayable: false, items: [
      { sessionID: "a" }, { sessionID: "descendant" },
    ] }, businessCompletion: "explicit-task-result-only" });
  pending = false;
  now += 30001;
  expect(await service.state(caller, "a")).toMatchObject({ waitingInput: false, background: { coverage: "unknown" } });
});

test("publication causation follows the invoking message, not later queued user input", async () => {
  const { host, first } = fixture();
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-invocation-cause-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const inputID = SessionMessage.ID.create(), invocationID = SessionMessage.ID.create(), newerID = SessionMessage.ID.create();
  vi.mocked(host.context).mockResolvedValue([
    { id: inputID, type: "user", text: "Scheduled review", time: { created: 1 } },
    { id: invocationID, type: "user", text: "Invocation marker", time: { created: 2 } },
    { id: newerID, type: "user", text: "New queued request", time: { created: 3 } },
  ]);
  try {
    store.insert("deliveries", "scheduled", "p1", "owner", { messageID: invocationID, target: { sessionID: "a" }, rootID: "root", hops: 3 });
    const service = new SessionCommunication(host, "local", () => 123, store);
    const caller = { instanceID: "local", projectID: "p1", sessionID: first.id, directory: "C:/p" };
    expect(await service.invocationCausation(caller, invocationID)).toEqual({ rootID: "root", hops: 3, causationID: "scheduled" });
    await expect(service.invocationCausation(caller, "compacted-away")).rejects.toMatchObject({ code: "history-unavailable" });
  } finally { store.close(); }
});

test("task and result selectors expose explicit waiting state and immutable stored data", async () => {
  const { caller, host } = fixture();
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-read-"));
  const options = parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!;
  const store = await CoordinationStore.open(options);
  try {
    store.insert("tasks", "review", "p1", "a", { state: "waiting_input", title: "Review" });
    store.insert("results", "result", "p1", "a", { summary: "Original review" });
    const service = new SessionCommunication(host, "local", () => 123, store);
    expect((await service.tasks(caller, "a")).tasks[0]!.body).toMatchObject({ state: "waiting_input" });
    expect((await service.result(caller, "a", "result")).result).toEqual({ summary: "Original review" });
    await expect(service.result(caller, "b", "result")).rejects.toMatchObject({ code: "not-found" });
    const sent = await service.sendMessage(caller, "b", "A finding; do not activate", "once", { textBytes: 100, mailboxEntries: 1, projectEntries: 100 });
    expect(sent).toMatchObject({ status: "stored", activated: false, message: { producerSessionID: "caller", targetSessionID: "b", projectID: "p1" } });
    expect((await service.sendMessage(caller, "b", "A finding; do not activate", "once")).id).toBe(sent.id);
    await expect(service.sendMessage(caller, "b", "Different", "once")).rejects.toMatchObject({ code: "conflict" });
    await expect(service.sendMessage(caller, "b", "More", "another", { textBytes: 100, mailboxEntries: 1, projectEntries: 100 })).rejects.toMatchObject({ code: "resource-limit" });
    expect((await service.mailbox(caller, "b")).entries).toHaveLength(1);
    // This adapter deliberately does not possess a host.prompt method.
    expect(host).not.toHaveProperty("prompt");
    const intent = await service.activatingIntent(caller, "b", "Activate once", "activate");
    expect(await service.activatingIntent(caller, "b", "Activate once", "activate")).toEqual(intent);
    await expect(service.activatingIntent(caller, "b", "Changed", "activate")).rejects.toMatchObject({ code: "conflict" });
    expect(store.list("deliveries", "p1", "caller")).toHaveLength(1);
    expect(intent.messageID).toMatch(/^msg_/);
  } finally { store.close(); }
});
