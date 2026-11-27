import { expect, test } from "vitest";
import { parseOrchestrationOptions, inspectStorageRuntime, coordinationCapabilities, createPolicyBindings, prepareOrchestration, readinessReport } from "../src/orchestration-options.js";
import { Scheduler } from "../src/scheduler.js";

const config = () => ({ orchestration: { enabled: true, instanceID: "local-test", dataDirectory: "C:/scheduler-data" } });

test("orchestration is opt-in and does not change legacy timer defaults", () => {
  expect(parseOrchestrationOptions({})).toBeUndefined();
  expect(parseOrchestrationOptions({ minimumSpacingSeconds: 30 })).toBeUndefined();
  expect(parseOrchestrationOptions({ orchestration: { enabled: false } })).toBeUndefined();
  const options = parseOrchestrationOptions(config())!;
  expect(options.limits.conditions).toBe(16);
  expect(options.limits.maxLifetimeSeconds).toBe(604800);
  expect(options.retention).toEqual({ days: 7, unreferencedEntries: 10000 });
  const scheduler = new Scheduler({});
  expect(scheduler.defaultMaxLifetimeSeconds).toBe(3600);
  scheduler.close();
});

test.each([
  { enabled: "true" }, { enabled: true },
  { ...config().orchestration, dataDirectory: "relative" },
  { ...config().orchestration, dataDirectory: "\\\\server\\share" },
  { ...config().orchestration, limits: { conditions: 17 } },
  { ...config().orchestration, limits: { conditions: 1.5 } },
  { ...config().orchestration, limits: { unknown: 1 } },
  { ...config().orchestration, retention: { days: 8 } },
  { ...config().orchestration, sdk: { baseUrl: "https://remote.example" } },
  { ...config().orchestration, sdk: { baseUrl: "http://user:secret@127.0.0.1:1234" } },
  { ...config().orchestration, sdk: { baseUrl: "http://127.0.0.1:1234/api" } },
  { ...config().orchestration, sdk: { baseUrl: "http://127.0.0.1:1234", discover: true } },
  { ...config().orchestration, sdk: { discover: true, tokenEnv: "literal-secret!" } },
  { ...config().orchestration, extra: true },
])("invalid or unsafe settings are rejected", orchestration => {
  expect(() => parseOrchestrationOptions({ orchestration })).toThrow();
});

test("lower limits and secret references are accepted without resolving secrets", () => {
  const options = parseOrchestrationOptions({ orchestration: { ...config().orchestration,
    limits: { ownerJobs: 5 }, sdk: { baseUrl: "http://127.0.0.1:1234", tokenEnv: "SCHEDULER_TOKEN" } } })!;
  expect(options.limits.ownerJobs).toBe(5);
  expect(options.sdk).toEqual({ baseUrl: "http://127.0.0.1:1234", tokenEnv: "SCHEDULER_TOKEN", discover: false });
});

test("unavailable SQLite disables durable capabilities, not legacy timers", async () => {
  const runtime = await inspectStorageRuntime(async () => { throw new Error("Unavailable builtin with secret details"); });
  expect(runtime).toEqual({ supported: false, code: "unsupported-runtime" });
  expect(coordinationCapabilities(runtime)).toMatchObject({ "plugin-context": true, "durable-jobs": false, "native-log-replay": false });
  const scheduler = new Scheduler({});
  const timer = scheduler.start({ sessionID: "a", projectID: "p", directory: "C:/p" }, { mode: "once", delaySeconds: 30, prompt: "Check" });
  expect(timer.id).toBeTruthy();
  scheduler.close();
});

test("runtime import alone does not advertise an SDK connection", async () => {
  const storage = await inspectStorageRuntime(async () => ({ DatabaseSync: class {} }));
  expect(coordinationCapabilities(storage)).toMatchObject({ "durable-jobs": true, "native-log-replay": false, "historical-messages": false });
});

test("location policy bindings are reference counted and reject conflicting policy", () => {
  const bind = createPolicyBindings();
  const options = parseOrchestrationOptions(config())!;
  const releaseA = bind(options), releaseB = bind(options);
  expect(() => bind({ ...options, instanceID: "different" })).toThrow("Conflicting");
  releaseA(); releaseA();
  expect(() => bind({ ...options, instanceID: "different" })).toThrow("Conflicting");
  releaseB();
  expect(() => bind({ ...options, instanceID: "different" })).not.toThrow();
});

test("one instance cannot be split across data directories", () => {
  const bind = createPolicyBindings();
  const options = parseOrchestrationOptions(config())!;
  const release = bind(options);
  expect(() => bind({ ...options, dataDirectory: "C:/another" })).toThrow("multiple");
  release();
});

test("readiness reports configuration/runtime failures without leaking secret values", async () => {
  const invalid = await prepareOrchestration({ orchestration: { enabled: true, password: "never-report-me" } });
  expect(invalid.error?.code).toBe("invalid-input");
  expect(JSON.stringify(readinessReport(invalid))).not.toContain("never-report-me");
  const unsupported = await prepareOrchestration(config(), async () => { throw new Error("Unavailable"); });
  expect(unsupported.error?.code).toBe("unsupported-runtime");
  const ready = await prepareOrchestration(config(), async () => ({ DatabaseSync: class {} }));
  expect(ready.runtime?.supported).toBe(true);
  expect(readinessReport(ready).capabilities["durable-jobs"]).toBe(false);
  ready.dispose();
});
