import { expect, test, vi } from "vitest";
import { OpenCode } from "@opencode/client";
import { connectSDK, nativeReplayAvailable } from "../src/opencode-sdk.js";

const identity = { instanceID: "local", projectID: "p", sessionID: "s", directory: "C:/p" };
function clientFixture(projectID = "p") {
  const requests: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url.pathname);
    if (url.pathname === "/api/info") return Response.json({ version: "2.4.2", pid: 123, urls: [], paths: { tmp: "C:/tmp" } });
    return Response.json({ data: { id: "s", projectID, location: { directory: "C:/p" } } });
  };
  const make: typeof OpenCode.make = options => OpenCode.make({ ...options, fetch: fetcher });
  return { make, requests };
}

test("SDK verifies configured version/session binding without exposing a credential", async () => {
  const fixture = clientFixture();
  const make = vi.fn(fixture.make);
  const client = await connectSDK({ baseUrl: "http://127.0.0.1:1234", tokenEnv: "TEST_TOKEN", discover: false }, identity,
    { make, environment: { TEST_TOKEN: "private-fixture-token" } });
  expect(fixture.requests).toEqual(["/api/info", "/api/session/s"]);
  expect(nativeReplayAvailable(client)).toBe(false);
  expect(make).toHaveBeenCalledWith({ baseUrl: "http://127.0.0.1:1234", headers: { authorization: `Basic ${Buffer.from("opencode:private-fixture-token").toString("base64")}` } });
});

test("wrong project, unconfigured credentials, and remote endpoint fail closed", async () => {
  await expect(connectSDK({ baseUrl: "http://127.0.0.1:1234", discover: false }, identity, clientFixture("foreign"))).rejects.toMatchObject({ code: "scope-denied" });
  await expect(connectSDK({ baseUrl: "http://127.0.0.1:1234", tokenEnv: "MISSING", discover: false }, identity,
    { environment: {} })).rejects.toMatchObject({ code: "authentication-required" });
  await expect(connectSDK({ baseUrl: "http://remote.invalid", discover: false }, identity)).rejects.toMatchObject({ code: "scope-denied" });
});

test("discovery does not ensure/start services and validates the discovered endpoint", async () => {
  const discover = vi.fn(async () => ({ url: "http://127.0.0.1:1234", auth: undefined }));
  await connectSDK({ discover: true }, identity, { discover, ...clientFixture() });
  expect(discover).toHaveBeenCalledTimes(1);
  await expect(connectSDK({ discover: true }, identity, { discover: async () => undefined })).rejects.toMatchObject({ code: "unsupported-capability" });
});
