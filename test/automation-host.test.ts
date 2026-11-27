import { expect, test, vi } from "vitest";
import { AutomationHost, type AutomationSession } from "../src/automation-host.js";
import { sessionInfo } from "./helpers.js";
import { MissingSessionError } from "../src/scheduler.js";

export function hostFixture() {
  const session: AutomationSession = { get: vi.fn(async ({ sessionID }) => sessionInfo(sessionID)),
    list: vi.fn(async () => ({ data: [sessionInfo("s1")], cursor: {} })),
    create: vi.fn(async input => ({ ...sessionInfo(input.id!), ...(input.agent ? { agent: input.agent } : {}),
      ...(input.model ? { model: input.model } : {}), ...(input.permissions ? { permissions: [...input.permissions] } : {}) })),
    prompt: vi.fn(), context: vi.fn(async () => []) };
  return { session, host: new AutomationHost(session, { projectID: "p1", directory: "/project" }) };
}

test("target candidates are bounded scoped filtered and paginated", async () => {
  const { host, session } = hostFixture();
  vi.mocked(session.list).mockResolvedValue({ data: [{ ...sessionInfo("s1"), title: "Deployment" }, sessionInfo("other", "/foreign"), sessionInfo("foreign", "/project", "p2")], cursor: { next: "page2" } });
  expect(await host.candidates({ search: "deploy", limit: 20 })).toEqual({ targets: [{ sessionID: "s1", title: "Deployment", projectID: "p1", directory: "/project", state: "idle" }], cursor: "page2" });
  expect(session.list).toHaveBeenCalledWith({ directory: "/project", project: "p1", limit: 20, search: "deploy" });
  await host.candidates({ cursor: "page2" }); expect(session.list).toHaveBeenLastCalledWith({ directory: "/project", project: "p1", limit: 20, cursor: "page2" });
  for (const limit of [0, 101, 1.5, Infinity]) await expect(host.candidates({ limit })).rejects.toThrow("limit");
});

test("target inspection separates exact missing target from transient failures and rejects scope mismatch", async () => {
  const { host, session } = hostFixture();
  vi.mocked(session.get).mockRejectedValueOnce({ _tag: "Session.NotFoundError", sessionID: "s1" });
  await expect(host.inspect("s1")).rejects.toBeInstanceOf(MissingSessionError);
  vi.mocked(session.get).mockRejectedValueOnce(new Error("Network")); await expect(host.inspect("s1")).rejects.toThrow("Network");
  vi.mocked(session.get).mockResolvedValueOnce(sessionInfo("s1", "/foreign")); await expect(host.inspect("s1")).rejects.toThrow("outside");
});

test("new session receives saved selections and permissions and rejects widening or unavailable selection", async () => {
  const { session } = hostFixture(); const check = vi.fn(async () => {});
  const host = new AutomationHost(session, { projectID: "p1", directory: "/project" }, check);
  const selection = { agent: "report", model: { providerID: "test", id: "small" }, permissions: [{ action: "edit", resource: "*", effect: "deny" as const }] };
  await host.create("new", "Report", selection);
  expect(session.create).toHaveBeenCalledWith(expect.objectContaining(selection));
  check.mockRejectedValueOnce(new Error("Saved model unavailable")); await expect(host.create("another", "Report", selection)).rejects.toThrow("unavailable");
  expect(session.create).toHaveBeenCalledOnce();
  vi.mocked(session.create).mockResolvedValueOnce(sessionInfo("unsafe"));
  await expect(host.create("unsafe", "Report", selection)).rejects.toThrow("retain");
});
