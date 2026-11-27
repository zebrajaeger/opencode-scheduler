import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { AutomationManagement } from "../src/automation-management.js";
import { AutomationStore } from "../src/automation-store.js";
import { memoryStorage, record } from "./automation-store.test.js";

async function fixture() {
  const { storage, values } = memoryStorage(); const store = new AutomationStore(storage, record().owner); await store.load();
  await store.mutate("a1", () => ({ record: record(), result: undefined }));
  const host = { validateTarget: vi.fn(async () => {}) };
  const manager = new AutomationManagement(store, host, () => 100_000);
  return { storage, values, store, manager, host };
}

test("pause persists and edits do not reactivate; explicit resume skips missed slots", async () => {
  const { store, manager, storage, host } = await fixture();
  await manager.pause("a1"); await manager.pause("a1");
  await manager.update("a1", { prompt: "Edited" });
  expect(store.get("a1").enabled).toBe(false);
  const restored = new AutomationStore(storage, record().owner); await restored.load(); expect(restored.get("a1").enabled).toBe(false);
  await manager.resume("a1"); expect(host.validateTarget).toHaveBeenCalledOnce();
  expect(store.get("a1")).toMatchObject({ enabled: true, nextOccurrence: 120_000 });
  expect(store.get("a1").pendingOccurrence).toBeUndefined();
});

test("resume rejects bad target and unresolved run, and explicit catch-up retains one due occurrence", async () => {
  const { store, manager, host } = await fixture(); await manager.pause("a1");
  host.validateTarget.mockRejectedValueOnce(new Error("Missing target"));
  await expect(manager.resume("a1")).rejects.toThrow("Missing target"); expect(store.get("a1").enabled).toBe(false);
  await manager.update("a1", { missedPolicy: "catch-up-once" }); await manager.resume("a1");
  expect(store.get("a1").pendingOccurrence).toBe(30_000);
  await store.mutate("a1", previous => ({ record: { ...previous!, run: { occurrence: 30_000, revision: 1, messageID: "m1", sessionID: "s1", prompt: "Check", phase: "unresolved", accepted: false, delivered: false } }, result: undefined }));
  await expect(manager.resume("a1")).rejects.toThrow("unresolved");
});

test("removal is idempotent and recovery tombstone survives until matching terminal evidence", async () => {
  const { store, manager } = await fixture();
  await store.mutate("a1", previous => ({ record: { ...previous!, run: { occurrence: 30_000, revision: 1, messageID: "m1", sessionID: "s1", prompt: "Check", phase: "queued", accepted: true, delivered: false } }, result: undefined }));
  expect(await manager.remove("a1")).toMatchObject({ removed: true, warning: expect.any(String) });
  expect(manager.list()).toEqual([]); expect(store.list(true)).toHaveLength(1);
  expect(await manager.remove("a1")).toEqual({ removed: false });
  await expect(manager.complete("a1", "foreign", "succeeded")).rejects.toThrow("does not match");
  expect(store.list(true)).toHaveLength(1); await manager.complete("a1", "m1", "succeeded");
  expect(store.list(true)).toEqual([]); expect(await manager.remove("a1")).toEqual({ removed: false });
});

test("invalid updates and failed persistence retain previous state", async () => {
  const { manager, store, storage } = await fixture();
  for (const patch of [{}, { prompt: "" }, { id: "other" }, { schedule: { kind: "interval", intervalSeconds: 1 } }]) await expect(manager.update("a1", patch)).rejects.toThrow();
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Disk full")); await expect(manager.pause("a1")).rejects.toThrow("Disk full");
  expect(store.get("a1").enabled).toBe(true); expect(store.get("a1").revision).toBe(1);
});

test("failure while a new target is being set up cannot implicitly reactivate the automation", async () => {
  const { manager, store } = await fixture();
  await store.mutate("a1", previous => ({ record: { ...previous!, enabled: false, pendingSetup: true, setupEnable: true,
    target: { kind: "new-reuse", sessionID: "new" }, run: { occurrence: 30_000, revision: 1, messageID: "m1", sessionID: "s1", prompt: "Check", phase: "running", accepted: true, delivered: true } }, result: undefined }));
  await manager.complete("a1", "m1", "failed", "Fixture failure");
  expect(store.get("a1")).toMatchObject({ enabled: false, setupEnable: false, pauseReason: "execution-error" });
});

test("inspection distinguishes due queued running unresolved and successful outcome", async () => {
  const { manager, store } = await fixture(); expect(manager.list()[0]!.runState).toBe("due");
  for (const phase of ["preparing", "queued", "running", "unresolved"] as const) {
    await store.mutate("a1", previous => ({ record: { ...previous!, run: { occurrence: 30_000, revision: 1, messageID: "m1", sessionID: "s1", prompt: "Check", phase, accepted: true, delivered: phase === "running" } }, result: undefined }));
    expect(manager.list()[0]!.runState).toBe(phase === "preparing" ? "checking" : phase); expect(manager.list()[0]!.lastOutcome).toBeUndefined();
  }
  await manager.complete("a1", "m1", "succeeded"); expect(manager.list()[0]!).toMatchObject({ runState: "scheduled", lastOutcome: "succeeded" });
});

test("list retains schedule target pause reason counters and due/future times in a defensive snapshot", async () => {
  const { manager, store } = await fixture(); await manager.pause("a1");
  expect(manager.list()[0]!).toMatchObject({ id: "a1", runState: "paused", pauseReason: "user-paused", nextOccurrence: 30_000,
    acceptedRunCount: 0, target: { kind: "existing", sessionID: "s1" } });
  manager.list()[0]!.target = { kind: "existing", sessionID: "foreign" };
  expect(store.get("a1").target).toEqual({ kind: "existing", sessionID: "s1" });
});

test("storage and management documentation matches namespace and observable states", () => {
  const docs = readFileSync(new URL("../docs/development.md", import.meta.url), "utf8");
  for (const value of ["automations/v1/<encoded-scope>/<automationId>", "scheduled", "due", "checking", "queued", "running", "unresolved", "paused", "dormant", "tombstone"])
    expect(docs).toContain(value);
});
