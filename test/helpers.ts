import type { Plugin } from "@opencode/plugin";
import { vi } from "vitest";

export type SessionHost = Pick<Plugin.Context["session"], "get" | "prompt">;

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function deterministicIds(prefix = "timer") {
  let sequence = 0;
  return () => `${prefix}_${++sequence}`;
}

export function sessionHostFixture(): SessionHost {
  return {
    get: vi.fn<SessionHost["get"]>(),
    prompt: vi.fn<SessionHost["prompt"]>(),
  };
}

export function sessionInfo(sessionID: string, directory = "/project", projectID = "p1"): Awaited<ReturnType<SessionHost["get"]>> {
  return {
    id: sessionID, projectID, location: { directory }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  };
}
