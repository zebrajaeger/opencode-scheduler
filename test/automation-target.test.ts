import { expect, test, vi } from "vitest";
import { AutomationTargets } from "../src/automation-target.js";
import { AutomationStore } from "../src/automation-store.js";
import { memoryStorage, record } from "./automation-store.test.js";
import { hostFixture } from "./automation-host.test.js";
import { sessionInfo } from "./helpers.js";
import { AutomationManagement } from "../src/automation-management.js";
import { readFileSync } from "node:fs";
import { validateTargetInput } from "../src/automation-target.js";

export async function targetFixture() {
  const memory = memoryStorage(), h = hostFixture(); const store = new AutomationStore(memory.storage, record().owner); await store.load();
  const targets = new AutomationTargets(store, h.host, () => 0, () => "a1");
  return { ...memory, ...h, store, targets };
}

test("here binds invocation identity and existing targets survive rename title reuse and forks", async () => {
  const { targets, store, session } = await targetFixture();
  const created = await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } });
  expect(created.target).toEqual({ kind: "current", sessionID: "s1" });
  vi.mocked(session.get).mockResolvedValue({ ...sessionInfo("s1"), title: "Renamed" });
  expect(store.get("a1").target).toEqual({ kind: "current", sessionID: "s1" });
  expect(await targets.bind("s1", { kind: "existing", sessionID: "s2" })).toEqual({ kind: "existing", sessionID: "s2" });
  expect(session.list).not.toHaveBeenCalled();
});

test("invalid or foreign destination cannot create a routine", async () => {
  const { targets, store, session } = await targetFixture();
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => sessionInfo(sessionID, sessionID === "other" ? "/foreign" : "/project"));
  await expect(targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "existing", sessionID: "other" } })).rejects.toThrow("outside");
  expect(store.list()).toEqual([]);
  await expect(targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 } })).rejects.toThrow("target");
});

test("new reusable target persists intent before creation and restart uses the same session", async () => {
  const { targets, store, storage, session, host } = await targetFixture();
  const sessions = new Map([["s1", sessionInfo("s1")]]);
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => { const info = sessions.get(sessionID); if (!info) throw { _tag: "Session.NotFoundError", sessionID }; return info; });
  vi.mocked(session.create).mockImplementation(async input => {
    expect(store.get("a1").pendingSetup).toBe(true);
    const info = sessionInfo(input!.id!); sessions.set(input!.id!, info); return info;
  });
  const created = await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "new-reuse", title: "My PRs" } });
  expect(created.enabled).toBe(true); expect(created.pendingSetup).toBeUndefined(); expect(session.create).toHaveBeenCalledOnce();
  const restored = new AutomationStore(storage, record().owner); await restored.load();
  await new AutomationTargets(restored, host).finishSetup("a1");
  expect(session.create).toHaveBeenCalledOnce(); expect(restored.get("a1").target).toEqual(created.target);
});

test("uncertain create acknowledgement is repaired by inspecting the persisted intended ID", async () => {
  const { targets, store, session } = await targetFixture(); let targetID: string | undefined;
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => {
    if (sessionID === "s1" || sessionID === targetID) return sessionInfo(sessionID);
    throw { _tag: "Session.NotFoundError", sessionID };
  });
  vi.mocked(session.create).mockImplementation(async input => { targetID = input!.id!; throw new Error("Lost acknowledgement"); });
  await expect(targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "new-reuse" } })).rejects.toThrow("Lost");
  expect(store.get("a1")).toMatchObject({ enabled: false, pendingSetup: true });
  await targets.finishSetup("a1"); expect(session.create).toHaveBeenCalledOnce(); expect(store.get("a1").enabled).toBe(true);
});

test("storage failure after chat creation never deletes that chat or generates another ID", async () => {
  const { targets, store, session, storage } = await targetFixture(); let targetID: string | undefined;
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => {
    if (sessionID === "s1" || sessionID === targetID) return sessionInfo(sessionID);
    throw { _tag: "Session.NotFoundError", sessionID };
  });
  vi.mocked(session.create).mockImplementation(async input => { targetID = input!.id!; vi.mocked(storage.set).mockRejectedValueOnce(new Error("Disk full")); return sessionInfo(input!.id!); });
  await expect(targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "new-reuse" } })).rejects.toThrow("Disk full");
  expect(store.get("a1").pendingSetup).toBe(true); await targets.finishSetup("a1"); expect(session.create).toHaveBeenCalledOnce();
});

test("fresh-run policy creates separate chats only for reserved runs and never overlaps", async () => {
  const { targets, host, store, session } = await targetFixture();
  await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "new-each-run" } });
  expect(session.create).not.toHaveBeenCalled();
  const first = await targets.prepareFreshRun("a1", 30_000);
  await expect(targets.prepareFreshRun("a1", 60_000)).rejects.toThrow("outstanding"); expect(session.create).toHaveBeenCalledOnce();
  const manager = new AutomationManagement(store, host, () => 45_000);
  await manager.complete("a1", first.run!.messageID, "succeeded");
  const second = await targets.prepareFreshRun("a1", 60_000);
  expect(first.run!.sessionID).not.toBe(second.run!.sessionID); expect(session.create).toHaveBeenCalledTimes(2);
});

test("new targets capture configuring session selections without history and existing targets keep theirs", async () => {
  const { targets, store, session } = await targetFixture();
  vi.mocked(session.get).mockResolvedValue({ ...sessionInfo("s1"), agent: "report", model: { providerID: "test", id: "small" },
    permissions: [{ action: "edit", resource: "*", effect: "deny" }] });
  const created = await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "new-each-run" } });
  expect(created.selection).toEqual({ agent: "report", model: { providerID: "test", id: "small" }, permissions: [{ action: "edit", resource: "*", effect: "deny" }] });
  expect(session.context).not.toHaveBeenCalled(); expect(store.get("a1").selection).toEqual(created.selection);
});

test("unavailable fresh-chat selection pauses the definition instead of falling back", async () => {
  const { targets, store, session } = await targetFixture();
  await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "new-each-run" } });
  vi.mocked(session.create).mockRejectedValueOnce(new Error("Saved model unavailable"));
  await expect(targets.prepareFreshRun("a1", 30_000)).rejects.toThrow("unavailable");
  expect(store.get("a1")).toMatchObject({ enabled: false, pauseReason: "target-creation-error" });
});

test("confirmed missing/moved target pauses without replacement and retarget needs explicit resume", async () => {
  const { targets, host, store, session } = await targetFixture();
  await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "existing", sessionID: "s2" } });
  vi.mocked(session.get).mockRejectedValueOnce({ _tag: "Session.NotFoundError", sessionID: "s2" });
  await expect(targets.checkTarget("a1")).rejects.toThrow("no longer exists"); expect(store.get("a1").pauseReason).toBe("target-unavailable");
  expect(session.create).not.toHaveBeenCalled();
  await targets.retarget("s1", "a1", { kind: "existing", sessionID: "s3" }); expect(store.get("a1").enabled).toBe(false);
  await new AutomationManagement(store, host, () => 0).resume("a1"); expect(store.get("a1").enabled).toBe(true);
  vi.mocked(session.get).mockResolvedValueOnce(sessionInfo("s3", "/moved"));
  await expect(targets.checkTarget("a1")).rejects.toThrow("outside"); expect(store.get("a1").enabled).toBe(false);
});

test("transient target failures are not misreported as deleted", async () => {
  const { targets, store, session } = await targetFixture();
  await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } });
  vi.mocked(session.get).mockRejectedValueOnce(new Error("Temporary network failure"));
  await expect(targets.checkTarget("a1")).rejects.toThrow("network"); expect(store.get("a1").pauseReason).toBeUndefined();
});

test("combined retarget patches persist atomically and invalid patches never create chats", async () => {
  const { targets, store, storage, session } = await targetFixture();
  await targets.create("s1", { prompt: "Before", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } });
  const before = store.get("a1");
  await expect(targets.retarget("s1", "a1", { kind: "new-reuse" }, { prompt: "After", schedule: { kind: "interval", intervalSeconds: 1 } })).rejects.toThrow();
  expect(store.get("a1")).toEqual(before); expect(session.create).not.toHaveBeenCalled();
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Disk full"));
  await expect(targets.retarget("s1", "a1", { kind: "existing", sessionID: "s2" }, { prompt: "After", label: "Updated" })).rejects.toThrow("Disk full");
  expect(store.get("a1")).toEqual(before);
  const changed = await targets.retarget("s1", "a1", { kind: "existing", sessionID: "s2" }, { prompt: "After", label: "Updated", missedPolicy: "catch-up-once" });
  expect(changed).toMatchObject({ prompt: "After", label: "Updated", missedPolicy: "catch-up-once", revision: before.revision + 1, target: { sessionID: "s2" } });
});

test("pause during reusable retarget setup wins and pending setup cannot be redirected", async () => {
  const { targets, host, store, session } = await targetFixture();
  await targets.create("s1", { prompt: "Before", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), creating = new Promise<void>(resolve => { entered = resolve; });
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => {
    if (sessionID === "s1" || sessionID === "s2") return sessionInfo(sessionID);
    throw { _tag: "Session.NotFoundError", sessionID };
  });
  vi.mocked(session.create).mockImplementation(async input => { entered(); await waiting; return sessionInfo(input!.id!); });
  const update = targets.retarget("s1", "a1", { kind: "new-reuse" }, { prompt: "After" }); await creating;
  await new AutomationManagement(store, host, () => 0).pause("a1");
  await expect(targets.retarget("s1", "a1", { kind: "existing", sessionID: "s2" })).rejects.toThrow("unresolved");
  release(); await update;
  expect(store.get("a1")).toMatchObject({ enabled: false, pauseReason: "user-paused", prompt: "After", target: { kind: "new-reuse" } });
  expect(store.get("a1").pendingSetup).toBeUndefined();
});

test("retargeting to new chats captures restrictions and retargeting existing drops saved selections", async () => {
  const { targets, store, session } = await targetFixture();
  await targets.create("s1", { prompt: "Check", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } });
  const selection = { agent: "report", model: { providerID: "test", id: "small" }, permissions: [{ action: "edit", resource: "*", effect: "deny" as const }] };
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => ({ ...sessionInfo(sessionID), ...selection }));
  await targets.retarget("s1", "a1", { kind: "new-each-run" });
  expect(store.get("a1").selection).toEqual(selection);
  await targets.retarget("s1", "a1", { kind: "existing", sessionID: "s2" });
  expect(store.get("a1").selection).toBeUndefined(); expect(session.create).not.toHaveBeenCalled();
});

test("bilingual target examples correspond to validated target schemas", () => {
  const docs = readFileSync(new URL("../docs/development.md", import.meta.url), "utf8");
  const examples = [...docs.matchAll(/`(\{ "kind": "(?:current|existing|new-reuse|new-each-run)"[^`]+\})`/g)];
  expect(examples).toHaveLength(4); for (const example of examples) expect(validateTargetInput(JSON.parse(example[1]!))).toBeTruthy();
  for (const phrase of ["hier", "dieser Chat", "jedes Mal ein neuer Chat", "ambiguity", "mehreren passenden Chats"]) expect(docs).toContain(phrase);
});

test("combined retarget patches persist together and invalid fields leave no setup or chat", async () => {
  const { targets, store, storage, session } = await targetFixture();
  await targets.create("s1", { prompt: "Old", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } });
  const before = store.get("a1");
  await expect(targets.retarget("s1", "a1", { kind: "new-reuse" }, { prompt: "New", schedule: { kind: "interval", intervalSeconds: 1 } })).rejects.toThrow();
  expect(store.get("a1")).toEqual(before); expect(session.create).not.toHaveBeenCalled();
  await expect(targets.retarget("s1", "a1", { kind: "new-reuse" }, { unexpected: true })).rejects.toThrow();
  expect(store.get("a1")).toEqual(before);
  vi.mocked(storage.set).mockRejectedValueOnce(new Error("Disk full"));
  await expect(targets.retarget("s1", "a1", { kind: "existing", sessionID: "s2" }, { prompt: "New" })).rejects.toThrow("Disk full");
  expect(store.get("a1")).toEqual(before);
  const updated = await targets.retarget("s1", "a1", { kind: "existing", sessionID: "s2" }, { prompt: "New", label: "Report", missedPolicy: "catch-up-once" });
  expect(updated).toMatchObject({ prompt: "New", label: "Report", missedPolicy: "catch-up-once", target: { sessionID: "s2" }, revision: 2 });
});

test("retarget to a new chat captures restrictions and pause during setup cannot reenable", async () => {
  const { targets, host, store, session } = await targetFixture();
  const restrictions = { agent: "report", model: { providerID: "test", id: "small" }, permissions: [{ action: "edit", resource: "*", effect: "deny" as const }] };
  vi.mocked(session.get).mockImplementation(async ({ sessionID }) => {
    if (sessionID === "s1") return { ...sessionInfo(sessionID), ...restrictions };
    throw { _tag: "Session.NotFoundError", sessionID };
  });
  await targets.create("s1", { prompt: "Old", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } });
  let release!: () => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  vi.mocked(session.create).mockImplementation(async input => {
    started(); await new Promise<void>(resolve => { release = resolve; });
    return { ...sessionInfo(input!.id!), ...restrictions };
  });
  const update = targets.retarget("s1", "a1", { kind: "new-reuse" }, { prompt: "Restricted report" });
  await entered;
  expect(store.get("a1").selection).toEqual(restrictions);
  await expect(targets.retarget("s1", "a1", { kind: "current" })).rejects.toThrow("setup");
  await new AutomationManagement(store, host).pause("a1"); release(); await update;
  expect(store.get("a1")).toMatchObject({ enabled: false, pauseReason: "user-paused", prompt: "Restricted report" });
  expect(store.get("a1").pendingSetup).toBeUndefined();
});
