import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";
import { OrchestrationJobs } from "../src/orchestration-jobs.js";
import { CoordinationCommands } from "../src/coordination-commands.js";
import { AdmissionGate } from "../src/admission-gate.js";

test.each(["event", "outbox", "send", "accepted", "delivered", "checkpoint"])("restart boundary %s preserves logical IDs and conservative admission evidence", async boundary => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-restart-boundary-"));
  const options = parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!;
  let store = await CoordinationStore.open(options);
  const owner = { instanceID: "local", sessionID: "owner", projectID: "p", directory: "C:/p" };
  const input = { label: "After signal", operator: "all" as const, target: owner, conditions: [
    { kind: "signal" as const, name: "review.done", evidence: "existing_or_future" as const },
  ], action: { mode: "prompt" as const, text: "Follow up" } };
  let messageID: unknown;
  try {
    const jobs = new OrchestrationJobs(store, () => 1000, () => "stable");
    jobs.create(owner, input);
    const commands = new CoordinationCommands(store, undefined, () => 1000, () => "root", project => jobs.evaluateProject(project));
    if (boundary === "event") {
      expect(() => store.transaction(() => {
        store.appendEvent("injected", "p", "local", undefined, { name: "review.done", instanceID: "local", projectID: "p" });
        jobs.evaluateProject("p");
        throw new Error("Crash before transaction commit");
      })).toThrow("Crash");
    }
    commands.signal(owner, { name: "review.done", idempotencyKey: "done" });
    const delivery = store.list("deliveries", "p", "owner")[0]!;
    if (!delivery.body || typeof delivery.body !== "object" || Array.isArray(delivery.body)) throw new Error("Missing delivery");
    messageID = delivery.body.messageID;
    if (["send", "accepted", "delivered", "checkpoint"].includes(boundary)) {
      const state = boundary === "send" ? "submitting" : boundary === "accepted" ? "accepted" : "delivered";
      store.update("deliveries", delivery.id, "p", "owner", 0, { ...delivery.body, state });
      new AdmissionGate(store, 30).acquire(owner, String(messageID), 1000);
    }
    if (boundary === "checkpoint") store.transaction(() => {
      store.appendEvent("native", "p", "native-source", 7, { name: "native-evidence" });
      store.insert("checkpoints", "native-source", "p", "owner", { sequence: 7 });
    });
    store.close(); store = await CoordinationStore.open(options);
    const recovered = new OrchestrationJobs(store, () => 1000);
    recovered.evaluate("p");
    expect(store.list("runs", "p", "owner")).toHaveLength(1);
    expect(store.list("deliveries", "p", "owner")).toHaveLength(1);
    expect(store.list("deliveries", "p", "owner")[0]!.body).toHaveProperty("messageID", messageID);
    if (["send", "accepted", "delivered", "checkpoint"].includes(boundary)) expect(new AdmissionGate(store, 30).acquire(owner, "replacement", 999999)).toBe(false);
    if (boundary === "event") expect(store.events("p").some(event => event.id === "injected")).toBe(false);
    if (boundary === "checkpoint") expect(store.get("checkpoints", "native-source", "p")?.body).toEqual({ sequence: 7 });
  } finally { store.close(); }
});
