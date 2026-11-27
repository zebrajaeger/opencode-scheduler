import path from "node:path";

export const hardLimits = {
  conditions: 16, payloadBytes: 32 * 1024, textBytes: 16 * 1024, activationBytes: 64 * 1024,
  ownerJobs: 100, projectJobs: 1000, mailboxEntries: 100, causalHops: 8, chainActivations: 20,
  maxLifetimeSeconds: 7 * 24 * 3600,
} as const;

export interface OrchestrationOptions {
  enabled: true;
  instanceID: string;
  dataDirectory: string;
  sdk?: { baseUrl?: string; tokenEnv?: string; discover: boolean };
  limits: { -readonly [K in keyof typeof hardLimits]: number };
  retention: { days: number; unreferencedEntries: number };
}

export class OrchestrationConfigurationError extends Error {
  readonly code = "invalid-input";
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OrchestrationConfigurationError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new OrchestrationConfigurationError(`${name} contains an unsupported field`);
}

function integer(value: unknown, name: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new OrchestrationConfigurationError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

export function parseOrchestrationOptions(options: unknown): OrchestrationOptions | undefined {
  const top = object(options, "Plugin options");
  if (top.orchestration === undefined) return undefined;
  const raw = object(top.orchestration, "orchestration");
  fields(raw, ["enabled", "instanceID", "dataDirectory", "sdk", "limits", "retention"], "orchestration");
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") throw new OrchestrationConfigurationError("orchestration.enabled must be a boolean");
  if (raw.enabled !== true) return undefined;
  if (typeof raw.instanceID !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(raw.instanceID)) {
    throw new OrchestrationConfigurationError("orchestration.instanceID must be a stable local identifier of at most 128 characters");
  }
  if (typeof raw.dataDirectory !== "string" || !path.isAbsolute(raw.dataDirectory) ||
      raw.dataDirectory.includes("\0") || /^(\\\\|\/\/)/.test(raw.dataDirectory)) {
    throw new OrchestrationConfigurationError("orchestration.dataDirectory must be an absolute local directory, not a network share");
  }
  const limits: OrchestrationOptions["limits"] = { ...hardLimits };
  if (raw.limits !== undefined) {
    const values = object(raw.limits, "orchestration.limits");
    fields(values, Object.keys(hardLimits), "orchestration.limits");
    for (const key of Object.keys(hardLimits) as (keyof typeof hardLimits)[]) {
      if (values[key] !== undefined) limits[key] = integer(values[key], `orchestration.limits.${key}`, hardLimits[key]);
    }
  }
  const retention = { days: 7, unreferencedEntries: 10_000 };
  if (raw.retention !== undefined) {
    const values = object(raw.retention, "orchestration.retention");
    fields(values, ["days", "unreferencedEntries"], "orchestration.retention");
    if (values.days !== undefined) retention.days = integer(values.days, "orchestration.retention.days", 7);
    if (values.unreferencedEntries !== undefined) retention.unreferencedEntries = integer(values.unreferencedEntries, "orchestration.retention.unreferencedEntries", 10_000);
  }
  let sdk: OrchestrationOptions["sdk"];
  if (raw.sdk !== undefined) {
    const values = object(raw.sdk, "orchestration.sdk");
    fields(values, ["baseUrl", "tokenEnv", "discover"], "orchestration.sdk");
    if (values.discover !== undefined && typeof values.discover !== "boolean") throw new OrchestrationConfigurationError("orchestration.sdk.discover must be a boolean");
    if ((values.baseUrl !== undefined) === (values.discover === true)) throw new OrchestrationConfigurationError("Configure exactly one SDK baseUrl or registered-service discovery");
    sdk = { discover: values.discover === true };
    if (values.baseUrl !== undefined) {
      let url: URL;
      try { url = new URL(String(values.baseUrl)); } catch { throw new OrchestrationConfigurationError("Invalid SDK loopback URL"); }
      if (typeof values.baseUrl !== "string" || url.protocol !== "http:" ||
          !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password ||
          url.search || url.hash || url.pathname !== "/") throw new OrchestrationConfigurationError("SDK baseUrl must be an HTTP loopback origin without credentials or path");
      sdk.baseUrl = url.origin;
    }
    if (values.tokenEnv !== undefined) {
      if (typeof values.tokenEnv !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(values.tokenEnv)) throw new OrchestrationConfigurationError("SDK tokenEnv must name an environment variable");
      sdk.tokenEnv = values.tokenEnv;
    }
  }
  return { enabled: true, instanceID: raw.instanceID, dataDirectory: path.resolve(raw.dataDirectory),
    ...(sdk ? { sdk } : {}), limits, retention };
}

export type StorageCapability = { supported: true } | { supported: false; code: "unsupported-runtime" };

export async function inspectStorageRuntime(load: () => Promise<{ DatabaseSync?: unknown }> = () => import("node:sqlite")): Promise<StorageCapability> {
  try {
    const module = await load();
    return typeof module.DatabaseSync === "function" ? { supported: true } : { supported: false, code: "unsupported-runtime" };
  } catch { return { supported: false, code: "unsupported-runtime" }; }
}

export function coordinationCapabilities(storage: StorageCapability, sdkVerified = false) {
  return {
    "plugin-context": true, "passive-mailbox": storage.supported, "durable-task-signals": storage.supported,
    "durable-jobs": storage.supported, "native-log-replay": false,
    "historical-messages": sdkVerified, "interaction-reconciliation": sdkVerified,
  };
}

// One process can activate the package for multiple locations. Persistent enforcement
// across processes belongs to the repository; this guard handles local setup conflicts.
export function createPolicyBindings() {
  const bindings = new Map<string, { signature: string; references: number }>();
  const instances = new Map<string, string>();
  return (options: OrchestrationOptions): (() => void) => {
    const key = process.platform === "win32" ? options.dataDirectory.toLowerCase() : options.dataDirectory;
    const signature = JSON.stringify(options);
    const existing = bindings.get(key);
    if (instances.has(options.instanceID) && instances.get(options.instanceID) !== key) throw new OrchestrationConfigurationError("One orchestration instance cannot use multiple data directories");
    if (existing && existing.signature !== signature) throw new OrchestrationConfigurationError("Conflicting orchestration policies for one data directory");
    const binding = existing ?? { signature, references: 0 };
    binding.references++;
    bindings.set(key, binding);
    instances.set(options.instanceID, key);
    let disposed = false;
    return () => { if (!disposed) { disposed = true; if (--binding.references === 0) { bindings.delete(key); instances.delete(options.instanceID); } } };
  };
}

const bindPolicy = createPolicyBindings();

export interface OrchestrationReadiness {
  enabled: boolean;
  options?: OrchestrationOptions;
  runtime?: StorageCapability;
  error?: { code: "invalid-input" | "unsupported-runtime"; message: string };
  dispose(): void;
}

export function readinessReport(readiness: OrchestrationReadiness) {
  return {
    enabled: readiness.enabled,
    ...(readiness.error ? { error: readiness.error } : {}),
    storageRuntime: readiness.runtime ?? { supported: false },
    // Runtime support is not the same as an initialized durable repository.
    capabilities: coordinationCapabilities({ supported: false, code: "unsupported-runtime" }),
  };
}

export async function prepareOrchestration(options: unknown,
  load?: () => Promise<{ DatabaseSync?: unknown }>): Promise<OrchestrationReadiness> {
  let release: (() => void) | undefined;
  try {
    const parsed = parseOrchestrationOptions(options);
    if (!parsed) return { enabled: false, dispose() {} };
    const runtime = await inspectStorageRuntime(load);
    if (!runtime.supported) return { enabled: true, options: parsed, runtime,
      error: { code: "unsupported-runtime", message: "Durable orchestration requires a verified built-in SQLite binding; legacy timers remain available" }, dispose() {} };
    release = bindPolicy(parsed);
    return { enabled: true, options: parsed, runtime, dispose: release };
  } catch {
    release?.();
    return { enabled: true, error: { code: "invalid-input", message: "Invalid or conflicting orchestration configuration; check instanceID, dataDirectory, SDK references, and safety limits" }, dispose() {} };
  }
}
