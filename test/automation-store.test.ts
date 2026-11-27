import { expect, test, vi } from "vitest";
import { AutomationStore, scopePrefix, sameAutomationOwner, type AutomationRecord, type Storage } from "../src/automation-store.js";
import { deferred } from "./helpers.js";

export function memoryStorage() {
  const values = new Map<string, Parameters<Storage["set"]>[1]>();
  const storage: Storage = {
    get: vi.fn(async key => values.get(key)),
    set: vi.fn(async (key, value) => { values.set(key, structuredClone(value)); }),
    remove: vi.fn(async key => { values.delete(key); }),
    scan: vi.fn(async ({ prefix, after, limit = 100 }) => {
      const entries = [...values].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(prefix) && (after === undefined || key > after));
      const page = entries.slice(0, limit).map(([key, value]) => ({ key, value: structuredClone(value) }));
      return { entries: page, ...(entries.length > limit ? { next: page.at(-1)!.key } : {}) };
    }),
  };
  return { storage, values };
}

export function record(id = "a1"): AutomationRecord {
  return { schemaVersion: 1, id, owner: { projectID: "p1", directory: "/project" }, createdAt: 0, updatedAt: 0,
    revision: 1, prompt: "Check", recurrence: { schedule: { kind: "interval", intervalSeconds: 30 }, anchorAt: 0 },
    missedPolicy: "skip", target: { kind: "existing", sessionID: "s1" }, enabled: true, nextOccurrence: 30_000, acceptedRunCount: 0 };
}

test("scope identity follows official Windows drive/UNC rules without lowercasing POSIX", () => {
  const owner = { projectID: "p1", directory: "C:\\Project\\" };
  expect(scopePrefix(owner)).toBe(scopePrefix({ ...owner, directory: "c:/project" }));
  expect(sameAutomationOwner(owner, { ...owner, directory: "c:/PROJECT" })).toBe(true);
  expect(scopePrefix({ ...owner, directory: "\\\\Server\\Share\\" })).toBe(scopePrefix({ ...owner, directory: "//server/share" }));
  expect(scopePrefix({ ...owner, directory: "/Project" })).not.toBe(scopePrefix({ ...owner, directory: "/project" }));
  expect(scopePrefix(owner)).not.toBe(scopePrefix({ ...owner, workspaceID: "w1" }));
});

test("loads all scoped pages without exposing foreign records and returns defensive copies", async () => {
  const { storage, values } = memoryStorage(); const owner = record().owner;
  for (let i = 0; i < 205; i++) { const r = record(String(i)); values.set(scopePrefix(owner) + encodeURIComponent(r.id), JSON.parse(JSON.stringify(r))); }
  values.set(scopePrefix({ ...owner, directory: "/foreign" }) + "foreign", { bad: true });
  const store = new AutomationStore(storage, owner); await store.load();
  expect(store.list()).toHaveLength(205); expect(storage.scan).toHaveBeenCalledTimes(3);
  store.list()[0]!.prompt = "Mutated"; expect(store.list()[0]!.prompt).toBe("Check");
});

test("malformed unknown-version and mismatched-owner values stay untouched and visible as diagnostics", async () => {
  const { storage, values } = memoryStorage(); const owner = record().owner, prefix = scopePrefix(owner);
  values.set(prefix + "future", { ...JSON.parse(JSON.stringify(record("future"))), schemaVersion: 2 });
  values.set(prefix + "bad", { schemaVersion: 1 });
  values.set(prefix + "foreign", { ...JSON.parse(JSON.stringify(record("foreign"))), owner: { ...owner, directory: "/foreign" } });
  const before = structuredClone(values); const store = new AutomationStore(storage, owner); await store.load();
  expect(store.list()).toEqual([]); expect(store.issues).toHaveLength(3); expect(values).toEqual(before);
  expect(storage.set).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
});

test("read failures and repeated cursors fail closed", async () => {
  const { storage } = memoryStorage(); vi.mocked(storage.scan).mockRejectedValueOnce(new Error("Unavailable"));
  const store = new AutomationStore(storage, record().owner);
  await expect(store.load()).rejects.toThrow("Unavailable"); expect(() => store.list()).toThrow("not loaded");
  vi.mocked(storage.scan).mockResolvedValue({ entries: [], next: "same" });
  await expect(store.load()).rejects.toThrow("cursor repeated");
});

test("create and update become effective only after a single durable envelope write", async () => {
  const { storage } = memoryStorage(); const store = new AutomationStore(storage, record().owner); await store.load();
  const gate = deferred<void>(); vi.mocked(storage.set).mockImplementationOnce(async () => gate.promise);
  const create = store.mutate("a1", () => ({ record: record(), result: "created" }));
  await Promise.resolve(); expect(store.list()).toEqual([]); gate.resolve(); await expect(create).resolves.toBe("created");
  expect(store.get("a1").prompt).toBe("Check");
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Disk full"));
  await expect(store.mutate("a1", previous => ({ record: { ...previous!, prompt: "New", revision: 2 }, result: undefined }))).rejects.toThrow("Disk full");
  expect(store.get("a1").prompt).toBe("Check"); expect(store.get("a1").revision).toBe(1);
  await store.mutate("a1", previous => ({ record: { ...previous!, prompt: "New", revision: 2 }, result: undefined }));
  expect(store.get("a1").prompt).toBe("New");
});

test("concurrent management and event mutations see the preceding durable revision", async () => {
  const { storage } = memoryStorage(); const store = new AutomationStore(storage, record().owner); await store.load();
  await store.mutate("a1", () => ({ record: record(), result: undefined }));
  const gate = deferred<void>();
  const management = store.mutate("a1", async previous => { await gate.promise; return { record: { ...previous!, prompt: "Changed", revision: 2 }, result: undefined }; });
  const event = store.mutate("a1", previous => ({ record: { ...previous!, acceptedRunCount: previous!.acceptedRunCount + 1 }, result: undefined }));
  gate.resolve(); await Promise.all([management, event]);
  expect(store.get("a1")).toMatchObject({ prompt: "Changed", revision: 2, acceptedRunCount: 1 });
  expect(storage.set).toHaveBeenCalledTimes(3);
});

test("failed creation does not publish state and unreadable records are never overwritten", async () => {
  const { storage, values } = memoryStorage(), owner = record().owner;
  values.set(scopePrefix(owner) + "unknown", { schemaVersion: 42 });
  const store = new AutomationStore(storage, owner); await store.load();
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Unavailable"));
  await expect(store.mutate("a1", () => ({ record: record(), result: undefined }))).rejects.toThrow("Unavailable");
  expect(store.list()).toEqual([]);
  await expect(store.mutate("unknown", () => ({ record: record("unknown"), result: undefined }))).rejects.toThrow("unreadable");
  expect(values.get(scopePrefix(owner) + "unknown")).toEqual({ schemaVersion: 42 });
});
