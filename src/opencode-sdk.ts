import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { CoordinationError, type SessionRef } from "./orchestration-domain.js";
import type { OrchestrationOptions } from "./orchestration-options.js";

export type SDKClient = ReturnType<typeof OpenCode.make>;
const nativeReplayQualifications = new WeakMap<SDKClient, boolean>();
export function nativeReplayAvailable(client: SDKClient): boolean {
  return nativeReplayQualifications.get(client) === true;
}

export async function connectSDK(options: NonNullable<OrchestrationOptions["sdk"]>, identity: SessionRef,
  dependencies: { discover?: typeof Service.discover; make?: typeof OpenCode.make; environment?: NodeJS.ProcessEnv } = {}): Promise<SDKClient> {
  let baseUrl = options.baseUrl;
  let headers: Record<string, string> = {};
  if (options.discover) {
    const endpoint = await (dependencies.discover ?? Service.discover)();
    if (!endpoint) throw new CoordinationError("unsupported-capability", "No compatible registered same-server service was discovered");
    baseUrl = endpoint.url;
    if (endpoint.auth) headers = { authorization: `Basic ${Buffer.from(`${endpoint.auth.username}:${endpoint.auth.password}`).toString("base64")}` };
  }
  if (!baseUrl) throw new CoordinationError("invalid-input", "SDK endpoint is required");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new CoordinationError("scope-denied", "SDK endpoint must be a loopback origin");
  if (options.tokenEnv) {
    const token = (dependencies.environment ?? process.env)[options.tokenEnv];
    if (!token) throw new CoordinationError("authentication-required", "Configured SDK credential reference is unavailable");
    // Official 2.x server accepts Basic credentials; a pairing token is used in
    // the password slot too. Bearer is not supported by its middleware.
    headers = { authorization: `Basic ${Buffer.from(`opencode:${token}`).toString("base64")}` };
  }
  const client = (dependencies.make ?? OpenCode.make)({ baseUrl: url.origin, headers });
  try {
    const request = { signal: AbortSignal.timeout(10_000) };
    const server = await client.server.info(request);
    if (!["2.3.2", "2.4.1", "2.4.2"].includes(server.version)) throw new CoordinationError("unsupported-capability", "SDK host version has not been qualified");
    const session = await client.session.get({ sessionID: identity.sessionID }, request);
    if (session.id !== identity.sessionID || session.projectID !== identity.projectID || session.location.directory !== identity.directory) throw new CoordinationError("scope-denied", "SDK endpoint does not match the invoking session/project/location");
    // SDK connectivity and log.synced do not prove retained event payloads.
    // No accepted CLI host is qualified for durable replay yet: 2.4.2 defaults
    // persistence off and its CLI does not expose ServerOptions.events.persist.
    nativeReplayQualifications.set(client, false);
    return client;
  } catch (error) {
    if (error instanceof CoordinationError) throw error;
    throw new CoordinationError("authentication-required", "Cannot verify same-server SDK binding; check endpoint and authentication");
  }
}
