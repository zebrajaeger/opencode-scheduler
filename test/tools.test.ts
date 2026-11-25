import { afterEach, expect, test } from "vitest";
import { Agent } from "@opencode/schema/agent";
import { Session } from "@opencode/schema/session";
import { SessionMessage } from "@opencode/schema/session-message";
import { Tool } from "@opencode/schema/tool";
import { Scheduler } from "../src/scheduler.js";
import { timerTools } from "../src/tools.js";

const scheduler = new Scheduler();
const tools = timerTools(scheduler, { projectID: "p1", directory: "/project" });
const context = {
  sessionID: Session.ID.create(), agent: Agent.ID.make("build"), messageID: SessionMessage.ID.create(),
  id: Tool.CallID.make("call1"), signal: new AbortController().signal,
  progress: async () => {},
};
afterEach(() => scheduler.stopAll({ sessionID: context.sessionID, projectID: "p1", directory: "/project" }));

test("five directly discoverable tools document natural-language semantics", () => {
  expect(tools.map(tool => tool.name)).toEqual(["timer_start", "timer_list", "timer_stop", "timer_update", "timer_stop_all"]);
  expect(tools.every(tool => tool.options?.codemode === false)).toBe(true);
  expect(tools[0]!.description).toContain("3600");
  expect(tools[0]!.description).toContain("background");
  expect(tools[3]!.description).toContain("do NOT extend expiry");
  expect(tools[2]!.description).toContain("cannot be retracted");
});

test("tools return structured success and controlled validation errors", async () => {
  const start = tools[0]!;
  const bad = await start.execute({ mode: "once", prompt: " ", delaySeconds: 120 }, context);
  expect(JSON.parse(String(bad.content)).ok).toBe(false);
  const good = await start.execute({ mode: "once", prompt: "Check container", delaySeconds: 120 }, context);
  expect(JSON.parse(String(good.content)).result.owner.sessionID).toBe(context.sessionID);
  const foreign = await start.execute({ mode: "once", prompt: "Check", delaySeconds: 120, sessionID: "foreign" }, context);
  expect(JSON.parse(String(foreign.content)).error.code).toBe("invalid-input");
  const list = await tools[1]!.execute({}, context);
  expect(JSON.parse(String(list.content)).result).toHaveLength(1);
  const stop = await tools[4]!.execute({}, context);
  expect(JSON.parse(String(stop.content)).result.removedCount).toBe(1);
});
