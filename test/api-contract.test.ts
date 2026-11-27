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

type NoHistoricalMethods<C extends { session: unknown }> =
  Extract<keyof C["session"], "inbox" | "message" | "messages" | "history" | "log"> extends never ? true : false;
const noHistoricalMethods: [NoHistoricalMethods<Context232>, NoHistoricalMethods<Context241>] = [true, true];

function compileCoordinationContract(ctx: Context232 | Context241) {
  const sessionID = "test-session";
  void ctx.session.list({ search: "review", project: "test-project", directory: "C:/project", limit: 10 });
  void ctx.session.context({ sessionID }).then(messages => {
    for (const message of messages) {
      const id: string = message.id;
      void id;
    }
  });
  void ctx.session.get({ sessionID }).then(info => {
    const identity: string[] = [info.id, info.projectID, info.location.directory];
    const outcome: "succeeded" | "failed" | "interrupted" | undefined = info.outcome;
    return { identity, outcome, parentID: info.parentID };
  });
  void ctx.session.synthetic({ sessionID, text: "Stored input is not a passive mailbox", resume: false, delivery: "queue" });
  void ctx.session.hook("experimental.idle", event => {
    const id: string = event.sessionID;
    for (const job of event.background) {
      const producer: string = job.sessionID;
      void producer;
    }
    void id;
  });
  void ctx.session.hook("prompt", event => {
    event.delivery = "queue";
    event.metadata = { source: "contract-test" };
  });
  void ctx.storage.set("contract", { version: 1 });
  void ctx.storage.get("contract");
  void ctx.storage.scan({ prefix: "contract", limit: 10 });
  void ctx.storage.remove("contract");
}

function compileCoordinationEvents(event: Event232 | Event241) {
  if (event.type === "session.execution.succeeded" || event.type === "session.execution.failed" ||
      event.type === "session.execution.interrupted" || event.type === "session.execution.started") {
    const sessionID: string = event.data.sessionID;
    const sequence: number = event.durable.seq;
    return { sessionID, sequence };
  }
  if (event.type === "form.created") return { sessionID: event.data.form.sessionID };
  if (event.type === "permission.asked") return { sessionID: event.data.sessionID };
  return undefined;
}

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
  const types = ["session.inbox.delivered", "session.execution.started", "session.execution.succeeded",
    "session.execution.failed", "session.execution.interrupted", "session.status", "permission.asked",
    "permission.replied", "form.created", "form.replied", "form.cancelled"] as const;
  void ctx232.event.subscribe({ types });
  void ctx241.event.subscribe({ types });
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
  expect(noHistoricalMethods).toEqual([true, true]);
  // Referencing the compile-only contract keeps it in the checked test source;
  // it must not execute network/session operations in this unit test.
  expect(typeof compileHostContract).toBe("function");
  expect(typeof compileEventContract).toBe("function");
  expect(typeof compileSubscriptions).toBe("function");
  expect(typeof compileToolContract).toBe("function");
  expect(typeof compileToolContract241).toBe("function");
  expect(typeof compileCoordinationContract).toBe("function");
  expect(typeof compileCoordinationEvents).toBe("function");
});
