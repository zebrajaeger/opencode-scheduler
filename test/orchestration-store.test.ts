import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";
import { DatabaseSync } from "node:sqlite";

async function fixture() {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-store-"));
  const options = parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "test", dataDirectory } })!;
  return { options, store: await CoordinationStore.open(options) };
}

test("records and atomic event/outbox work survive reopen without partial writes", async () => {
  const { options, store } = await fixture();
  store.transaction(() => {
    store.appendEvent("event", "p", "local", undefined, { completed: true });
    store.insert("deliveries", "delivery", "p", "a", { messageID: "fixed" });
  });
  expect(() => store.transaction(() => {
    store.appendEvent("rolled-back", "p", "local", undefined, {});
    store.insert("deliveries", "rolled-back", "p", "a", {});
    throw new Error("Injected disk/write boundary failure");
  })).toThrow("Injected");
  store.close();
  const reopened = await CoordinationStore.open(options);
  try {
    expect(reopened.get("deliveries", "delivery", "p")?.body).toEqual({ messageID: "fixed" });
    expect(reopened.get("deliveries", "rolled-back", "p")).toBeUndefined();
    expect(reopened.appendEvent("event", "p", "local", undefined, { completed: true }).inserted).toBe(false);
    expect(reopened.appendEvent("rolled-back", "p", "local", undefined, {}).inserted).toBe(true);
  } finally { reopened.close(); }
});

test("record scope, unique identity, and expected revision are enforced", async () => {
  const { store } = await fixture();
  try {
    store.insert("tasks", "task", "p", "a", { state: "open" });
    expect(store.get("tasks", "task", "other")).toBeUndefined();
    expect(() => store.insert("tasks", "task", "p", "a", {})).toThrow();
    expect(store.update("tasks", "task", "p", "a", 0, { state: "working" })).toBe(1);
    expect(() => store.update("tasks", "task", "p", "a", 0, {})).toThrow("changed");
    expect(() => store.update("tasks", "task", "p", "b", 1, {})).toThrow("owned");
    expect(store.list("tasks", "p", "b")).toEqual([]);
  } finally { store.close(); }
});

test("two connections fence expired workers while persistent target gates survive", async () => {
  const { store: first, options } = await fixture();
  const second = await CoordinationStore.open(options);
  try {
    const a = first.claim("worker", "a", 100, 10)!;
    expect(second.claim("worker", "b", 105, 10)).toBeUndefined();
    first.withClaim("worker", "a", a, 106, () => first.insert("target_gates", "target", "p", "a", { messageID: "fixed", uncertain: true }));
    const b = second.claim("worker", "b", 111, 10)!;
    expect(b).toBeGreaterThan(a);
    expect(() => first.withClaim("worker", "a", a, 112, () => first.update("target_gates", "target", "p", "a", 0, {}))).toThrow("stale");
    expect(first.release("worker", "a", a)).toBe(false);
    expect(second.get("target_gates", "target", "p")?.body).toEqual({ messageID: "fixed", uncertain: true });
    expect(second.release("worker", "b", b)).toBe(true);
    expect(first.claim("worker", "a", 113, 10)).toBeGreaterThan(b);
  } finally { first.close(); second.close(); }
});

test("policy binding persists across activations and rejects a different namespace", async () => {
  const { store, options } = await fixture();
  store.close();
  await expect(CoordinationStore.open({ ...options, instanceID: "wrong" })).rejects.toThrow("policy");
  const restored = await CoordinationStore.open(options);
  restored.close();
});

test("version-one pending message identities and checkpoints reopen unchanged", async () => {
  const { store, options } = await fixture();
  store.transaction(() => {
    store.insert("runs", "run", "p", "a", { state: "accepted", messageID: "msg_original" });
    store.insert("checkpoints", "source", "p", "a", { sequence: 42 });
  });
  store.close();
  const reopened = await CoordinationStore.open(options);
  try {
    expect(reopened.get("runs", "run", "p")?.body).toEqual({ state: "accepted", messageID: "msg_original" });
    expect(reopened.get("checkpoints", "source", "p")?.body).toEqual({ sequence: 42 });
  } finally { reopened.close(); }
});

test("newer schema and corrupt storage fail closed without rewriting data", async () => {
  const { store, options } = await fixture();
  store.close();
  const file = path.join(options.dataDirectory, "orchestration.sqlite");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA user_version = 999");
  db.close();
  const before = await readFile(file);
  await expect(CoordinationStore.open(options)).rejects.toMatchObject({ code: "storage-unavailable" });
  expect(await readFile(file)).toEqual(before);
  const corrupt = await fixture();
  corrupt.store.close();
  const corruptFile = path.join(corrupt.options.dataDirectory, "orchestration.sqlite");
  await writeFile(corruptFile, "not-a-sqlite-database");
  await expect(CoordinationStore.open(corrupt.options)).rejects.toMatchObject({ code: "storage-unavailable" });
  expect(await readFile(corruptFile, "utf8")).toBe("not-a-sqlite-database");
});

test("unversioned nonempty data is not assumed to be a historical scheduler format", async () => {
  const { store, options } = await fixture();
  store.close();
  const db = new DatabaseSync(path.join(options.dataDirectory, "orchestration.sqlite"));
  db.exec("PRAGMA user_version = 0");
  db.close();
  await expect(CoordinationStore.open(options)).rejects.toThrow("Unversioned nonempty");
});

test("version-one migration preserves pending state while adding retention metadata", async () => {
  const { store, options } = await fixture();
  store.insert("deliveries", "pending", "p", "a", { messageID: "msg_original" });
  store.insert("checkpoints", "cursor", "p", "a", { sequence: 13 });
  store.close();
  const db = new DatabaseSync(path.join(options.dataDirectory, "orchestration.sqlite"));
  db.exec("DROP TABLE retention_pins; DROP TABLE retention_items; PRAGMA user_version = 1;");
  db.close();
  const migrated = await CoordinationStore.open(options);
  try {
    expect(migrated.get("deliveries", "pending", "p")?.body).toEqual({ messageID: "msg_original" });
    expect(migrated.get("checkpoints", "cursor", "p")?.body).toEqual({ sequence: 13 });
    migrated.prune("p", Date.now() + 1, 1);
    expect(migrated.get("deliveries", "pending", "p")).toBeDefined();
  } finally { migrated.close(); }
});

test("retention pins preserve waiting evidence and unread mailbox entries", async () => {
  const { store } = await fixture();
  try {
    store.transaction(() => {
      store.appendEvent("needed", "p", "local", undefined, {});
      store.pin("waiting-job", "events", "needed", "p");
      store.insert("results", "needed", "p", "a", {});
      store.pin("active-run", "results", "needed", "p");
      store.insert("mailbox", "unread", "p", "b", {});
      store.insert("deliveries", "unresolved", "p", "a", {});
      store.appendEvent("obsolete", "p", "local", undefined, {});
    });
    expect(() => store.enforceCapacity("p", 5)).toThrow("capacity exhausted");
    expect(store.prune("p", Date.now() + 100, 1)).toBe(1);
    expect(store.get("results", "needed", "p")).toBeDefined();
    expect(store.get("mailbox", "unread", "p")).toBeDefined();
    expect(store.get("deliveries", "unresolved", "p")).toBeDefined();
    expect(() => store.pin("new-job", "events", "obsolete", "p")).toThrow("unavailable");
    store.markRead("unread", "p", "wrong");
    expect(store.prune("p", Date.now() + 100, 1)).toBe(0);
    store.markRead("unread", "p", "b");
    store.unpin("waiting-job"); store.unpin("active-run");
    expect(store.prune("p", Date.now() + 100, 1)).toBe(3);
  } finally { store.close(); }
});
