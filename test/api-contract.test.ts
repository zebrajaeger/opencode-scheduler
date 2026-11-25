import type { Plugin } from "@opencode/plugin";
import type { Plugin as Plugin241 } from "opencode-plugin-241";
import { SessionMessage } from "@opencode/schema/session-message";
import { expect, test } from "vitest";

type Context232 = Plugin.Context;
type Context241 = Plugin241.Context;
type Event232 = Context232["event"]["subscribe"] extends (...args: never[]) => AsyncIterable<infer E> ? E : never;
type Event241 = Context241["event"]["subscribe"] extends (...args: never[]) => AsyncIterable<infer E> ? E : never;

// These compile-time assertions must remain errors on both target versions.
type NoInbox232 = Context232["session"] extends { inbox: unknown } ? false : true;
type NoInbox241 = Context241["session"] extends { inbox: unknown } ? false : true;
const noInbox: [NoInbox232, NoInbox241] = [true, true];

function compileHostContract(ctx: Context232 | Context241) {
  const sessionID = "test-session";
  void ctx.session.get({ sessionID });
  void ctx.session.prompt({
    sessionID,
    id: SessionMessage.ID.create(),
    text: "Check status",
    delivery: "queue",
    metadata: { scheduler: { timerId: "timer-1" } },
  });
}

function compileSubscriptions(ctx232: Context232, ctx241: Context241) {
  void ctx232.event.subscribe({ types: ["session.inbox.delivered", "session.execution.interrupted"] });
  void ctx241.event.subscribe({ types: ["session.inbox.delivered", "session.execution.interrupted"] });
}

function compileToolContract(ctx: Context232) {
  return ctx.tool.transform((editor) => {
    editor.add({
      name: "contract_timer",
      description: "Compile-time tool registration check",
      options: { codemode: false },
      input: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_input, invocation) => ({ content: invocation.sessionID }),
    });
  });
}

function compileToolContract241(ctx: Context241) {
  return ctx.tool.transform((editor) => {
    editor.add({
      name: "contract_timer",
      description: "Compile-time tool registration check",
      options: { codemode: false },
      input: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_input, invocation) => ({ content: invocation.sessionID }),
    });
  });
}

function compileEventContract(event: Event232 | Event241) {
  if (event.type === "session.inbox.delivered") {
    const sessionID: string = event.data.sessionID;
    const inboxID: string = event.data.inboxID;
    return [sessionID, inboxID];
  }
  return undefined;
}

test("official message IDs are unique and plugin sessions do not expose inbox", () => {
  const first = SessionMessage.ID.create();
  expect(first).not.toBe(SessionMessage.ID.create());
  expect(first).toMatch(/^msg_/);
  expect(noInbox).toEqual([true, true]);
  // Referencing the compile-only contract keeps it in the checked test source;
  // it must not execute network/session operations in this unit test.
  expect(typeof compileHostContract).toBe("function");
  expect(typeof compileEventContract).toBe("function");
  expect(typeof compileSubscriptions).toBe("function");
  expect(typeof compileToolContract).toBe("function");
  expect(typeof compileToolContract241).toBe("function");
});
