import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { OpenCode } from "@opencode/client";
import { expect, test } from "vitest";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";
import { SessionReplay } from "../src/session-replay.js";
import { AdmissionGate } from "../src/admission-gate.js";
import { deferred } from "./helpers.js";

test("native log replay persists events and checkpoint together and resumes without duplicates", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-replay-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const requests: string[] = [];
  let evaluation = 0;
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url.searchParams.get("after")!);
    const events = Number(url.searchParams.get("after")) < 2 ? [{ id: "event-complete", type: "session.execution.succeeded", created: 1,
      data: { sessionID: "s" }, durable: { aggregateID: "s", seq: 2, version: 1 } }] : [];
    return new Response([...events, { type: "log.synced", aggregateID: "s", seq: 2 }].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  try {
    const replay = new SessionReplay(client, store, () => { evaluation++; });
    const source = { instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" };
    await replay.sync(source);
    await replay.sync(source);
    expect(requests).toEqual(["0", "2"]);
    expect(evaluation).toBe(2);
    expect(store.events("p")).toHaveLength(1);
    expect(replay.isReady("s")).toBe(true);
  } finally { store.close(); }
});

test("failed evaluation rolls native ingestion and checkpoint back", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-replay-rollback-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const event = { id: "event", type: "session.execution.succeeded", created: 1, data: { sessionID: "s" }, durable: { aggregateID: "s", seq: 1, version: 1 } };
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => new Response(`data: ${JSON.stringify(event)}\n\ndata: {"type":"log.synced","aggregateID":"s","seq":1}\n\n`, { headers: { "content-type": "text/event-stream" } }) });
  try {
    const replay = new SessionReplay(client, store, () => { throw new Error("Injected transaction failure"); });
    await expect(replay.sync({ instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" })).rejects.toThrow("Injected");
    expect(store.events("p")).toHaveLength(0);
    expect(store.get("checkpoints", "native:local:s", "p")).toBeUndefined();
    expect(replay.isReady("s")).toBe(false);
  } finally { store.close(); }
});

test("duplicate and out-of-order streams never skip older unprocessed replay evidence", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-replay-order-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  let ordered = true;
  const event = (seq: number) => ({ id: `event-${seq}`, type: "session.execution.succeeded", created: seq, data: { sessionID: "s" }, durable: { aggregateID: "s", seq, version: 1 } });
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => new Response(
    (ordered ? [event(1), event(1), event(2), { type: "log.synced", aggregateID: "s", seq: 2 }] : [event(4), event(3)])
      .map(value => `data: ${JSON.stringify(value)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }) });
  try {
    const replay = new SessionReplay(client, store);
    const source = { instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" };
    await replay.sync(source);
    expect(store.events("p")).toHaveLength(2);
    ordered = false;
    await expect(replay.sync(source)).rejects.toMatchObject({ code: "history-unavailable" });
    expect(replay.isReady("s")).toBe(false);
  } finally { store.close(); }
});

test("failed follow clears synchronized capabilities before reconnect backoff", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-replay-reconnect-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const controller = new AbortController();
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => new Response(new ReadableStream({
    start(output) {
      output.enqueue(new TextEncoder().encode('data: {"type":"log.synced","aggregateID":"s","seq":0}\n\n'));
    },
    pull(output) { output.error(new Error("Disconnected after synced")); },
  }), { headers: { "content-type": "text/event-stream" } }) });
  try {
    const replay = new SessionReplay(client, store);
    let retries = 0;
    await replay.follow({ instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" }, controller.signal, async () => {
      retries++;
      expect(replay.isReady("s")).toBe(false);
      expect(replay.watermark("s")).toBeUndefined();
      controller.abort();
    });
    expect(retries).toBe(1);
  } finally { controller.abort(); store.close(); }
});

test.each(["unsynced", "foreign", "out-of-order", "cancelled"])("admission recovery requires ordered same-source watermark: %s", async mode => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-admission-recovery-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const source = { instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" };
  const gate = new AdmissionGate(store, 30);
  gate.acquire(source, "message", 1);
  const event = (seq: number) => ({ id: `e-${seq}`, type: "session.inbox.cancelled", created: 1,
    data: { sessionID: mode === "foreign" ? "other" : "s", inboxID: "message" }, durable: { aggregateID: "s", seq, version: 1 } });
  const events = [event(2), ...(mode === "out-of-order" ? [event(1)] : []),
    ...(mode !== "unsynced" ? [{ type: "log.synced", aggregateID: "s", seq: 2 }] : [])];
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => new Response(
    events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }) });
  try {
    const replay = new SessionReplay(client, store);
    if (mode === "cancelled") {
      await replay.recoverGate(source, gate);
      expect(await replay.reconcileAdmission(source, "message")).toBe("cancelled");
      expect(gate.acquire(source, "next", Date.now() + 31000)).toBe(true);
    } else {
      await expect(replay.recoverGate(source, gate)).rejects.toMatchObject({ code: mode === "foreign" ? "scope-denied" : "history-unavailable" });
      await expect(replay.reconcileAdmission(source, "message")).rejects.toMatchObject({ code: mode === "foreign" ? "scope-denied" : "history-unavailable" });
      expect(gate.acquire(source, "next", Date.now() + 31000)).toBe(false);
    }
  } finally { store.close(); }
});

test("concurrent replay cannot move a committed checkpoint backwards", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-replay-concurrent-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const releaseOlder = deferred<void>(), enteredOlder = deferred<void>();
  const event = (seq: number) => ({ id: `e-${seq}`, type: "session.execution.succeeded", created: seq,
    data: { sessionID: "s" }, durable: { aggregateID: "s", seq, version: 1 } });
  let requests = 0;
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => {
    const older = ++requests === 1;
    if (older) { enteredOlder.resolve(); await releaseOlder.promise; }
    const events = older ? [event(1)] : [event(1), event(2)];
    return new Response([...events, { type: "log.synced", aggregateID: "s", seq: older ? 1 : 2 }]
      .map(e => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  try {
    const source = { instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" };
    const older = new SessionReplay(client, store).sync(source);
    await enteredOlder.promise;
    await new SessionReplay(client, store).sync(source);
    releaseOlder.resolve();
    await older;
    expect(store.get("checkpoints", "native:local:s", "p")?.body).toEqual({ sequence: 2 });
    expect(store.events("p")).toHaveLength(2);
  } finally { releaseOlder.resolve(); store.close(); }
});

test("shutdown interruption is durable technical evidence, not a business interruption trigger", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-replay-shutdown-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const event = { id: "shutdown", type: "session.execution.interrupted", created: 1,
    data: { sessionID: "s", reason: "shutdown" }, durable: { aggregateID: "s", seq: 1, version: 1 } };
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => new Response(
    [event, { type: "log.synced", aggregateID: "s", seq: 1 }].map(e => `data: ${JSON.stringify(e)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } }) });
  try {
    await new SessionReplay(client, store).sync({ instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" });
    expect(store.events("p")[0]!.body).not.toHaveProperty("name");
    expect(store.events("p")[0]!.body).toHaveProperty("nativeEvent.type", "session.execution.interrupted");
  } finally { store.close(); }
});

test("supervised reconnect recovers downtime completion once from the last committed checkpoint", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-reconnect-downtime-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  const controller = new AbortController();
  let requests = 0, synchronized = 0;
  const after: string[] = [], failures: string[] = [];
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    after.push(url.searchParams.get("after")!);
    if (++requests === 1) return new Response('data: {"type":"log.synced","aggregateID":"s","seq":0}\n\n', { headers: { "content-type": "text/event-stream" } });
    const event = { id: "downtime-completion", type: "session.execution.succeeded", created: 1,
      data: { sessionID: "s" }, durable: { aggregateID: "s", seq: 1, version: 1 } };
    return new Response([event, { type: "log.synced", aggregateID: "s", seq: 1 }].map(e => `data: ${JSON.stringify(e)}\n\n`).join(""),
      { headers: { "content-type": "text/event-stream" } });
  } });
  try {
    const replay = new SessionReplay(client, store);
    await replay.follow({ instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" }, controller.signal,
      async () => {}, () => { if (++synchronized === 2) controller.abort(); }, code => failures.push(code));
    expect(after).toEqual(["0", "0"]);
    expect(store.events("p")).toHaveLength(1);
    expect(store.get("checkpoints", "native:local:s", "p")?.body).toEqual({ sequence: 1 });
    expect(failures).toEqual([]);
  } finally { controller.abort(); store.close(); }
});

test("source validation failure prevents reconnect from ingesting moved-session history", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-source-revalidation-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  let fetched = false;
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => { fetched = true; return new Response(); } });
  try {
    const replay = new SessionReplay(client, store, undefined, undefined, async () => { throw new Error("Moved source"); });
    await expect(replay.sync({ instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" })).rejects.toThrow("Moved source");
    expect(fetched).toBe(false);
    expect(replay.isReady("s")).toBe(false);
    expect(replay.watermark("s")).toBeUndefined();
  } finally { store.close(); }
});

test("source moving during replay cannot commit buffered evidence at its watermark", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-source-move-during-replay-"));
  const store = await CoordinationStore.open(parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!);
  let checks = 0;
  const event = { id: "old-scope", type: "session.execution.succeeded", created: 1,
    data: { sessionID: "s" }, durable: { aggregateID: "s", seq: 1, version: 1 } };
  const client = OpenCode.make({ baseUrl: "http://replay.invalid", fetch: async () => new Response(
    [event, { type: "log.synced", aggregateID: "s", seq: 1 }].map(e => `data: ${JSON.stringify(e)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } }) });
  try {
    const replay = new SessionReplay(client, store, undefined, undefined, async () => { if (++checks > 1) throw new Error("Source moved"); });
    await expect(replay.sync({ instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" })).rejects.toThrow("Source moved");
    expect(store.events("p")).toHaveLength(0);
    expect(store.get("checkpoints", "native:local:s", "p")).toBeUndefined();
    expect(replay.isReady("s")).toBe(false);
  } finally { store.close(); }
});
