import { expect, test } from "vitest";
import { controlTool } from "./automation-acceptance-helpers.js";

test("control results come from the current invocation on a newest history page", () => {
  const old = { type: "tool", name: "automation_list", state: { status: "completed", content: [{ type: "text", text: "old" }] } };
  const current = { ...old, state: { ...old.state, content: [{ type: "text", text: "current" }] } };
  const ascending = Array.from({ length: 240 }, (_, index) => ({ type: "user", text: `past-${index}` }));
  const all = [...ascending, { type: "assistant", content: [old] }, { type: "user", text: "CONTROL:current" }, { type: "assistant", content: [current] }];
  const newestApiPage = [...all].reverse().slice(0, 200);
  expect(controlTool(newestApiPage.reverse(), "CONTROL:current", "automation_list")).toBe(current);
});

test("a missing invocation cannot fall back to a stale tool result", () => {
  const messages = [{ type: "assistant", content: [{ type: "tool", name: "automation_list" }] }];
  expect(() => controlTool(messages, "CONTROL:missing", "automation_list")).toThrow("must contain this control invocation");
});

test("a current invocation without its own result cannot reuse an earlier result", () => {
  const messages = [{ type: "assistant", content: [{ type: "tool", name: "automation_list" }] }, { type: "user", text: "CONTROL:current" }];
  expect(() => controlTool(messages, "CONTROL:current", "automation_list")).toThrow("has no automation_list tool result");
});
