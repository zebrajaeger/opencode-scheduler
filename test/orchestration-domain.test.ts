import { expect, test } from "vitest";
import { transitionTask, transitionJob, transitionRun, assertScope, assertOwner } from "../src/orchestration-domain.js";

test.each([
  ["open", "working"], ["working", "waiting_input"], ["waiting_input", "working"],
  ["working", "completed"], ["waiting_input", "failed"], ["open", "cancelled"],
] as const)("task %s to %s is explicit", (from, to) => expect(transitionTask(from, to)).toBe(to));

test.each(["completed", "failed", "cancelled"] as const)("terminal task %s cannot reopen", state => {
  expect(() => transitionTask(state, "working")).toThrow("Invalid lifecycle");
  expect(transitionTask(state, state)).toBe(state);
});

test("job readiness, timeout, and pause are distinct from execution success", () => {
  expect(transitionJob("waiting", "ready")).toBe("ready");
  expect(transitionJob("ready", "active")).toBe("active");
  expect(transitionJob("active", "paused")).toBe("paused");
  expect(transitionJob("paused", "waiting")).toBe("waiting");
  expect(transitionJob("waiting", "timed_out")).toBe("timed_out");
  expect(() => transitionJob("completed", "ready")).toThrow();
  expect(() => transitionJob("waiting", "active")).toThrow();
});

test("admission is not delivery or settlement and uncertainty requires reconciliation", () => {
  expect(transitionRun("pending", "submitting")).toBe("submitting");
  expect(transitionRun("submitting", "accepted")).toBe("accepted");
  expect(() => transitionRun("accepted", "settled")).toThrow();
  expect(() => transitionRun("accepted", "cancelled")).toThrow();
  expect(transitionRun("submitting", "delivered")).toBe("delivered");
  expect(transitionRun("accepted", "uncertain")).toBe("uncertain");
  expect(transitionRun("uncertain", "delivered")).toBe("delivered");
  expect(transitionRun("delivered", "settled")).toBe("settled");
  expect(() => transitionRun("settled", "submitting")).toThrow();
});

test("same-project independent sessions communicate but cannot mutate foreign ownership", () => {
  const a = { instanceID: "local", projectID: "p", sessionID: "a", directory: "C:/p" };
  const b = { ...a, sessionID: "b", directory: "C:/worktree" };
  expect(() => assertScope(a, b)).not.toThrow();
  expect(() => assertOwner(a, b)).toThrow("Owned record not found");
  expect(() => assertScope(a, { ...b, projectID: "other" })).toThrow("same instance and project");
  expect(() => assertScope(a, { ...b, instanceID: "remote" })).toThrow();
});
