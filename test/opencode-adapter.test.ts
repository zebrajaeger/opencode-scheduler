import { afterEach, expect, test, vi } from "vitest";
import { Location } from "@opencode/schema/location";
import { Project } from "@opencode/schema/project";
import { AbsolutePath } from "@opencode/schema/schema";
import { SessionMessage } from "@opencode/schema/session-message";
import { createHost, normalizeEvent, setup, type SetupContext } from "../src/opencode-adapter.js";
import { deferred, sessionHostFixture, sessionInfo } from "./helpers.js";
import { MissingSessionError } from "../src/scheduler.js";
import { Agent } from "@opencode/schema/agent";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";

afterEach(() => vi.useRealTimers());

test("host sends only queued prompt fields and preserves session agent/model defaults", async () => {
  const session = sessionHostFixture();
  const host = createHost({ session });
  const owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
  const id = SessionMessage.ID.create();
  await host.prompt(owner, id, "Check container", "timer1");
  expect(session.prompt).toHaveBeenCalledExactlyOnceWith({
    sessionID: "s1", id, text: "Check container", delivery: "queue",
    metadata: { scheduler: { timerId: "timer1", source: "zebrajaeger.opencode-scheduler" } },
  });
  expect(vi.mocked(session.prompt).mock.calls[0]![0]).not.toHaveProperty("resume");
  expect(vi.mocked(session.prompt).mock.calls[0]![0]).not.toHaveProperty("model");
  expect(vi.mocked(session.prompt).mock.calls[0]![0]).not.toHaveProperty("agent");
});

function setupFixture(directory: string) {
  const tools: ReturnType<typeof import("../src/tools.js").timerTools> = [];
  const calls: string[] = [];
  const dispose = vi.fn(async () => {});
  const session = sessionHostFixture();
  vi.mocked(session.get).mockImplementation(async input => sessionInfo(input.sessionID, directory));
  const ctx: SetupContext = {
    location: new Location.Info({ directory: AbsolutePath.make(directory),
      project: { id: Project.ID.make("p1"),
        directory: AbsolutePath.make(directory), canonical: AbsolutePath.make(directory) } }),
    options: {}, session,
    event: { subscribe: options => {
      calls.push("subscribe");
      return { async *[Symbol.asyncIterator]() {
        const done = deferred<void>();
        if (options?.signal?.aborted) done.resolve();
        else options?.signal?.addEventListener("abort", () => done.resolve(), { once: true });
        await done.promise;
      } };
    } },
    tool: { transform: async edit => {
      calls.push("tools");
      edit({ add: tool => tools.push(tool), list: () => [], get: () => undefined,
        namespace: () => {}, update: () => {}, remove: () => {} });
      return { dispose };
    } },
  };
  return { ctx, tools, calls, dispose };
}

test("setup subscribes before registration and each location receives one independent tool set", async () => {
  const first = setupFixture("/first");
  const second = setupFixture("/second");
  const closeFirst = await setup(first.ctx);
  const closeSecond = await setup(second.ctx);
  expect(first.calls).toEqual(["subscribe", "tools"]);
  expect(first.tools).toHaveLength(5);
  expect(second.tools).toHaveLength(5);
  await closeFirst(); await closeFirst(); await closeSecond();
  expect(first.dispose).toHaveBeenCalledTimes(1);
  expect(second.dispose).toHaveBeenCalledTimes(1);
});

test("invalid configuration fails setup before any registration", async () => {
  const fixture = setupFixture("/project");
  await expect(setup({ ...fixture.ctx, options: { minimumSpacingSeconds: 1 } })).rejects.toThrow("minimumSpacingSeconds");
  expect(fixture.tools).toEqual([]);
});

test.each([
  [undefined, undefined, "idle"], [10, undefined, "busy"], [20, 10, "busy"],
  [10, 20, "idle"], [10, 10, "unknown"],
] as const)("session timestamps busy=%s idle=%s reconcile to %s", async (busy, idle, expected) => {
  const session = sessionHostFixture();
  const info = sessionInfo("s1");
  if (busy !== undefined) info.time.busy = busy;
  if (idle !== undefined) info.time.idle = idle;
  vi.mocked(session.get).mockResolvedValue(info);
  expect((await createHost({ session }).inspect({ sessionID: "s1", projectID: "p1", directory: "/project" })).state).toBe(expected);
});

test("retry status is busy and durable sequence is retained", () => {
  expect(normalizeEvent({ type: "session.status", id: "evt_status", created: 1,
    data: { sessionID: "s1", status: { type: "retry", attempt: 1, message: "Retry", next: 100 } } })).toEqual({ sessionID: "s1", type: "busy" });
  expect(normalizeEvent({ type: "session.execution.succeeded", id: "evt_terminal", created: 2,
    durable: { aggregateID: "s1", seq: 7, version: 1 }, data: { sessionID: "s1" } })).toEqual({ sessionID: "s1", type: "succeeded", sequence: 7 });
});

test("only exact official Session.NotFoundError for the owner becomes deletion", async () => {
  const session = sessionHostFixture();
  const host = createHost({ session });
  const owner = { sessionID: "s1", projectID: "p1", directory: "/project" };
  vi.mocked(session.get).mockRejectedValue({ _tag: "Session.NotFoundError", sessionID: "s1" });
  await expect(host.inspect(owner)).rejects.toBeInstanceOf(MissingSessionError);
  const transient = new Error("Timeout");
  vi.mocked(session.get).mockRejectedValue(transient);
  await expect(host.inspect(owner)).rejects.toBe(transient);
});

test("unload closes event consumer and timeouts without awaiting pending host inspection", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const fixture = setupFixture("/project");
  const inspection = deferred<ReturnType<typeof sessionInfo>>();
  vi.mocked(fixture.ctx.session.get).mockReturnValue(inspection.promise);
  const close = await setup(fixture.ctx);
  await fixture.tools[0]!.execute({ mode: "once", prompt: "Check", delaySeconds: 30 }, {
    sessionID: Session.ID.create(), agent: Agent.ID.make("build"), messageID: SessionMessage.ID.create(),
    id: Tool.CallID.make("call"), signal: new AbortController().signal, progress: async () => {},
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(fixture.ctx.session.get).toHaveBeenCalledTimes(1);
  await close();
  expect(vi.getTimerCount()).toBe(0);
  inspection.reject(new Error("Late host failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(fixture.ctx.session.prompt).not.toHaveBeenCalled();
  expect(fixture.dispose).toHaveBeenCalledTimes(1);
});
