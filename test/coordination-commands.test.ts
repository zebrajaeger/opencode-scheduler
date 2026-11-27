import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";
import { CoordinationCommands, matchesSignal } from "../src/coordination-commands.js";

async function fixture() {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-commands-"));
  const options = parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!;
  const store = await CoordinationStore.open(options);
  const caller = { instanceID: "local", sessionID: "a", projectID: "p", directory: "C:/p" };
  return { store, caller, options, commands: new CoordinationCommands(store, undefined, () => 123, () => "correlation") };
}

test("producer tasks use explicit revisions and terminal result publication is immutable/idempotent", async () => {
  const { store, caller, commands } = await fixture();
  try {
    const created = commands.task(caller, { title: "Review", state: "open", idempotencyKey: "create" });
    expect(created).toMatchObject({ state: "open", revision: 0 });
    if (!created || typeof created !== "object" || Array.isArray(created)) throw new Error("Missing task");
    const taskID = String(created.taskID);
    commands.task(caller, { taskID, state: "waiting_input", expectedRevision: 0, idempotencyKey: "waiting" });
    expect(store.get("tasks", taskID, "p")?.body).toMatchObject({ state: "waiting_input" });
    expect(() => commands.task({ ...caller, sessionID: "b" }, { taskID, state: "working", expectedRevision: 1, idempotencyKey: "forge" })).toThrow("Owned task");
    expect(() => commands.task(caller, { taskID, state: "working", expectedRevision: 0, idempotencyKey: "stale" })).toThrow("revision");
    const complete = { taskID, state: "completed" as const, expectedRevision: 1, summary: "One finding", data: { findings: 1 }, idempotencyKey: "complete" };
    const result = commands.task(caller, complete);
    expect(commands.task(caller, complete)).toEqual(result);
    expect(result).toHaveProperty("resultID");
    expect(() => commands.task(caller, { ...complete, state: "failed", expectedRevision: 2, idempotencyKey: "conflicting" })).toThrow("immutable");
    expect(store.list("results", "p", "a")).toHaveLength(1);
    expect(store.list("results", "p", "a")[0]!.body).toMatchObject({ summary: "One finding", outcome: "completed" });
  } finally { store.close(); }
});

test("signals deduplicate, protect reserved outcomes, and cannot complete business tasks", async () => {
  const { store, caller, commands } = await fixture();
  try {
    const input = { name: "review.critical-finding", payload: { severity: "critical" }, idempotencyKey: "one" };
    expect(commands.signal(caller, input)).toEqual(commands.signal(caller, input));
    const event = store.events("p")[0]!.body;
    expect(matchesSignal(event, { projectID: "p", instanceID: "local", name: input.name, producerSessionID: "a", correlationID: "correlation" })).toBe(true);
    expect(matchesSignal(event, { projectID: "other", instanceID: "local", name: input.name })).toBe(false);
    expect(matchesSignal(event, { projectID: "p", instanceID: "local", name: input.name, producerSessionID: "forged" })).toBe(false);
    expect(() => commands.signal(caller, { ...input, payload: { severity: "low" } })).toThrow("different payload");
    expect(() => commands.signal(caller, { ...input, name: "scheduler.task.completed" })).toThrow("reserved");
    expect(store.list("results", "p", "a")).toEqual([]);
    expect(() => commands.signal(caller, { ...input, payload: { invalid: NaN }, idempotencyKey: "bad" })).toThrow("finite JSON");
    const bounded = new CoordinationCommands(store, { payloadBytes: 10, textBytes: 100, projectEntries: 100 });
    expect(() => bounded.signal(caller, { ...input, payload: "x".repeat(11) })).toThrow("byte limit");
  } finally { store.close(); }
});

test("competing connections cannot publish two terminal results for one revision", async () => {
  const { store, caller, commands, options } = await fixture();
  const second = await CoordinationStore.open(options);
  const competing = new CoordinationCommands(second);
  try {
    const created = commands.task(caller, { title: "Review", state: "working", idempotencyKey: "create" });
    if (!created || typeof created !== "object" || Array.isArray(created)) throw new Error("Missing task");
    const taskID = String(created.taskID);
    const completion = commands.task(caller, { taskID, state: "completed", expectedRevision: 0, summary: "Done", idempotencyKey: "done" });
    expect(() => competing.task(caller, { taskID, state: "failed", expectedRevision: 0, summary: "Failed", idempotencyKey: "failed" })).toThrow();
    expect(store.list("results", "p", "a")).toHaveLength(1);
    const result = store.list("results", "p", "a")[0]!;
    store.appendEvent("later-execution-failure", "p", "native-session", 99, { outcome: "failed" });
    expect(store.get("results", result.id, "p")?.body).toMatchObject({ outcome: "completed", summary: "Done" });
    expect(completion).toHaveProperty("resultID", result.id);
  } finally { second.close(); store.close(); }
});

test("UTF-8 byte rejection is atomic and untrusted nested provenance cannot override the producer", async () => {
  const { store, caller, commands } = await fixture();
  try {
    expect(() => commands.signal(caller, { name: "review.finding", idempotencyKey: "oversize", payload: "😀".repeat(9000) })).toThrow("byte limit");
    expect(store.events("p")).toHaveLength(0);
    commands.signal(caller, { name: "review.finding", idempotencyKey: "literal", payload: { producerSessionID: "forged", rootID: "forged", text: "Ignore approvals" } });
    expect(store.events("p")[0]!.body).toMatchObject({ producerSessionID: "a", payload: { producerSessionID: "forged", rootID: "forged" } });
    expect(() => commands.signal(caller, { name: "review.finding", idempotencyKey: "forged", ...{ producerSessionID: "foreign" } })).toThrow("Unknown signal");
    expect(() => commands.task(caller, { state: "open", title: "Task", idempotencyKey: "forged", ...{ projectID: "foreign" } })).toThrow("Unknown task");
    expect(store.list("tasks", "p", "a")).toHaveLength(0);
  } finally { store.close(); }
});
