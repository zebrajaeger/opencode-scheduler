import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { AdmissionGate } from "../src/admission-gate.js";
import { CoordinationStore } from "../src/orchestration-store.js";
import { parseOrchestrationOptions } from "../src/orchestration-options.js";

test("timer and job contenders share persistent FIFO fairness across connections and cooldown", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-fairness-"));
  const options = parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!;
  const a = await CoordinationStore.open(options), b = await CoordinationStore.open(options);
  const timer = new AdmissionGate(a, 30), job = new AdmissionGate(b, 30);
  const target = { instanceID: "local", projectID: "p", sessionID: "target", directory: "C:/p" };
  try {
    expect(timer.acquire(target, "first", 1000, { id: "timer:first", expiresAt: 900000 })).toBe(true);
    expect(job.acquire(target, "job-message", 2000, { id: "job:second", expiresAt: 900000 })).toBe(false);
    expect(timer.acquire(target, "timer-message", 3000, { id: "timer:third", expiresAt: 900000 })).toBe(false);
    expect(job.acquire({ ...target, sessionID: "unrelated" }, "other", 3000)).toBe(true);
    timer.finish(target, "first", 4000);
    expect(timer.acquire(target, "timer-message", 34000, { id: "timer:third", expiresAt: 900000 })).toBe(false);
    expect(job.acquire(target, "job-message", 34000, { id: "job:second", expiresAt: 900000 })).toBe(true);
    job.finish(target, "job-message", 35000);
    expect(timer.acquire(target, "timer-message", 65000, { id: "timer:third", expiresAt: 900000 })).toBe(true);
  } finally { a.close(); b.close(); }
});

test("abandoned arbitration hints expire but unresolved admission gates never do", async () => {
  const dataDirectory = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-fairness-expiry-"));
  const options = parseOrchestrationOptions({ orchestration: { enabled: true, instanceID: "local", dataDirectory } })!;
  const store = await CoordinationStore.open(options), gate = new AdmissionGate(store, 30);
  const target = { instanceID: "local", projectID: "p", sessionID: "target", directory: "C:/p" };
  try {
    gate.acquire(target, "active", 1000);
    gate.acquire(target, "abandoned", 2000, { id: "timer:abandoned", expiresAt: 999999 });
    gate.finish(target, "active", 3000);
    expect(gate.acquire(target, "next", 92001, { id: "job:next", expiresAt: 999999 })).toBe(true);
    expect(gate.acquire(target, "replacement", 99999999, { id: "job:replacement", expiresAt: 999999999 })).toBe(false);
  } finally { store.close(); }
});
