import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, cp, symlink, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { expect, test } from "vitest";

// Real isolated OpenCode, deterministic loopback model, no paid provider or user data.
test.runIf(process.env.SCHEDULER_ORCHESTRATION_HOST === "1")("independent sessions coordinate explicit results, early findings and ALL aggregation", async () => {
  const root = await mkdtemp(path.join("C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-orchestration-host-"));
  const project = path.join(root, "project"), config = path.join(root, "config", "opencode");
  await Promise.all([mkdir(project, { recursive: true }), mkdir(config, { recursive: true })]);
  // Host reloads must be caused by this test, never by builds in the checkout.
  const pluginCopy = path.join(root, "plugin-snapshot");
  await mkdir(pluginCopy);
  await cp(path.resolve("dist"), path.join(pluginCopy, "dist"), { recursive: true });
  await writeFile(path.join(pluginCopy, "package.json"), await readFile(path.resolve("package.json")));
  await symlink(path.resolve("node_modules"), path.join(pluginCopy, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  execFileSync("git", ["init", project], { stdio: "ignore" });
  execFileSync("git", ["-C", project, "-c", "user.name=Scheduler Test", "-c", "user.email=test@invalid", "commit", "--allow-empty", "-m", "primary fixture"], { stdio: "ignore" });
  let sequence = 0, calls = 0;
  const withSDK = process.env.SCHEDULER_ORCHESTRATION_NO_SDK !== "1";
  let releaseBusy: (() => void) | undefined, markBusy!: () => void;
  const busyStarted = new Promise<void>(resolve => { markBusy = resolve; });
  const portReservation = createServer(); portReservation.listen(0, "127.0.0.1"); await once(portReservation, "listening");
  const reserved = portReservation.address(); if (!reserved || typeof reserved === "string") throw new Error("Missing host port");
  const hostPort = reserved.port; await new Promise<void>(resolve => portReservation.close(() => resolve()));
  const pluginOptions = { orchestration: { enabled: true, instanceID: "orchestration-e2e", dataDirectory: path.join(root, "coordination"),
    ...(withSDK ? { sdk: { baseUrl: `http://127.0.0.1:${hostPort}`, tokenEnv: "OPENCODE_PASSWORD" } } : {}) } };
  const handled = new Set<string>();
  const mock = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || "{}");
    if (request.url?.endsWith("/models")) { response.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}'); return; }
    calls++;
    const last = body.messages?.at(-1);
    const marker = typeof last?.content === "string" ? last.content : "";
    if (last?.role === "user" && marker === "HOLD_BUSY_FIXTURE") {
      await new Promise<void>(resolve => { releaseBusy = resolve; markBusy(); });
    }
    let delta: unknown = { content: "Deterministic orchestration acknowledgement" }, reason = "stop";
    if (last?.role === "user" && marker.startsWith("CONTROL:") && !handled.has(marker)) {
      handled.add(marker);
      const instruction = JSON.parse(marker.slice(8));
      delta = { tool_calls: instruction.actions.map((action: { name: string; args: unknown }, index: number) => ({
        index, id: `call_${++sequence}`, type: "function", function: { name: action.name, arguments: JSON.stringify(action.args) },
      })) };
      reason = "tool_calls";
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    const frame = (value: unknown, finish: string | null) => ({ id: "chatcmpl_orchestration", object: "chat.completion.chunk", created: 1,
      model: "scheduler-test", choices: [{ index: 0, delta: value, finish_reason: finish }] });
    response.write(`data: ${JSON.stringify(frame(delta, null))}\n\n`);
    response.write(`data: ${JSON.stringify(frame({}, reason))}\n\n`); response.end("data: [DONE]\n\n");
  });
  mock.listen(0, "127.0.0.1"); await once(mock, "listening");
  const address = mock.address(); if (!address || typeof address === "string") throw new Error("Missing mock port");
  await writeFile(path.join(config, "opencode.json"), JSON.stringify({
    plugins: [{ package: pluginCopy, options: pluginOptions }],
    model: { providerID: "scheduler-test", model: "scheduler-test" },
    providers: { "scheduler-test": { package: "@opencode/ai/providers/openai-compatible", env: [],
      settings: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "fixture-only" },
      models: { "scheduler-test": { name: "Scheduler Test", capabilities: { toolCall: true }, limit: { context: 64000, output: 2000 } } } } },
  }));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(path|pathext|systemroot|windir|comspec|temp|tmp|programfiles|programfiles\(x86\))$/i.test(key)));
  let server: ChildProcess | undefined, output = "";
  try {
    const binary = process.env.SCHEDULER_OPENCODE_BIN ?? path.join(path.dirname(execFileSync("where.exe", ["node"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]!), "node_modules", "@opencode", "cli", "bin", "opencode.exe");
    server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(hostPort)], { cwd: project, env: { ...inherited,
      HOME: root, USERPROFILE: root, OPENCODE_TEST_HOME: root, XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"), XDG_CONFIG_HOME: path.join(root, "config"), OPENCODE_CONFIG_DIR: config, OPENCODE_PASSWORD: "fixture-password" },
      stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", chunk => { output += String(chunk); }); server.stderr?.on("data", chunk => { output += String(chunk); });
    const startDeadline = Date.now() + 90000;
    while (!output.match(/http:\/\/127\.0\.0\.1:\d+/) && Date.now() < startDeadline) {
      if (server.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    let origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (!origin) throw new Error("No private host URL");
    const api = async (route: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(`${origin}${route}`, { method,
        headers: { authorization: `Basic ${Buffer.from("opencode:fixture-password").toString("base64")}`, "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`${route}: ${response.status} ${(await response.text()).slice(0, 1000)}`);
      return response.status === 204 ? undefined : response.json();
    };
    const create = async (title: string, directory = project) => (await api("/api/session", { title, location: { directory } })).data.id as string;
    const history = async (id: string) => (await api(`/api/session/${id}/message?order=asc&limit=200`)).data as any[];
    const control = async (id: string, name: string, args: unknown) => {
      await api(`/api/session/${id}/prompt`, { text: `CONTROL:${JSON.stringify({ nonce: ++sequence, actions: [{ name, args }] })}`, delivery: "queue" });
      await api(`/api/experimental/session/${id}/wait`, {});
      const messages = await history(id);
      const tool = messages.filter(message => message.type === "assistant").flatMap(message => message.content)
        .filter(part => part.type === "tool" && part.name === name).at(-1);
      if (!tool || tool.state.status !== "completed") throw new Error(`Missing ${name}: ${JSON.stringify(messages).slice(-2000)}`);
      const text = tool.state.content.find((part: any) => part.type === "text").text;
      try { return JSON.parse(text); }
      catch { throw new Error(`${name} returned non-JSON: ${text.slice(0, 4000)}`); }
    };
    const ok = async (id: string, name: string, args: unknown) => {
      const result = await control(id, name, args); expect(result, `${name}: ${JSON.stringify(result)}`).toHaveProperty("ok", true); return result.result;
    };
    const awaitText = async (id: string, marker: string) => {
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        const messages = await history(id);
        if (messages.some(message => message.type === "user" && message.text.startsWith(marker))) {
          await api(`/api/experimental/session/${id}/wait`, {}); return messages;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error(`No activation ${marker}: ${JSON.stringify(await history(id)).slice(-3000)}`);
    };
    const reviewer = await create("Reviewer"), consumer = await create("Spec owner");
    expect((await api(`/api/session/${reviewer}`)).data.parentID).toBeUndefined();
    expect((await api(`/api/session/${consumer}`)).data.parentID).toBeUndefined();
    const task = await ok(reviewer, "task_update", { title: "Review", state: "working", idempotencyKey: "review" });
    await ok(consumer, "job_create", { label: "Update after review", operator: "all", conditions: [{ kind: "signal", name: "scheduler.task.completed",
      producerSessionID: reviewer, taskID: task.taskID, evidence: "existing_or_future" }], action: { mode: "prompt", text: "UPDATE_SPEC_FROM_REVIEW" } });
    const idleCalls = calls;
    await new Promise(resolve => setTimeout(resolve, 2000));
    expect(calls).toBe(idleCalls);
    expect((await history(consumer)).filter(message => message.type === "user" && message.text.startsWith("UPDATE_SPEC_FROM_REVIEW"))).toHaveLength(0);
    const result = await ok(reviewer, "task_update", { taskID: task.taskID, state: "completed", expectedRevision: 0,
      summary: "REVIEW_RESULT_LITERAL", idempotencyKey: "review-complete" });
    const activated = await awaitText(consumer, "UPDATE_SPEC_FROM_REVIEW");
    expect(activated.filter(message => message.type === "user" && message.text.startsWith("UPDATE_SPEC_FROM_REVIEW"))).toHaveLength(1);
    expect(activated.find(message => message.type === "user" && message.text.startsWith("UPDATE_SPEC_FROM_REVIEW")).text).toContain(result.resultID);
    expect(activated.find(message => message.type === "user" && message.text.startsWith("UPDATE_SPEC_FROM_REVIEW")).text).toContain("REVIEW_RESULT_LITERAL");
    const earlyConsumer = await create("Critical finding consumer");
    const continuing = await ok(reviewer, "task_update", { title: "Ongoing review", state: "working", idempotencyKey: "ongoing" });
    await ok(earlyConsumer, "job_create", { label: "Critical finding", operator: "any", conditions: [{ kind: "signal", name: "review.critical-finding",
      producerSessionID: reviewer, taskID: continuing.taskID, evidence: "future" }], action: { mode: "prompt", text: "HANDLE_CRITICAL_FINDING" } });
    await ok(reviewer, "signal_emit", { name: "review.critical-finding", taskID: continuing.taskID, payload: { severity: "critical" }, idempotencyKey: "critical" });
    await awaitText(earlyConsumer, "HANDLE_CRITICAL_FINDING");
    const tasks = await ok(reviewer, "session_read", { sessionID: reviewer, view: "tasks" });
    expect(tasks.tasks.find((row: any) => row.id === continuing.taskID).body.state).toBe("working");
    const implementer = await create("Second implementation"), tests = await create("Test runner");
    const a = await ok(reviewer, "task_update", { title: "Implementation A", state: "working", idempotencyKey: "impl-a" });
    const b = await ok(implementer, "task_update", { title: "Implementation B", state: "working", idempotencyKey: "impl-b" });
    await ok(tests, "job_create", { label: "ALL implementations", operator: "all", conditions: [
      { kind: "signal", name: "scheduler.task.completed", producerSessionID: reviewer, taskID: a.taskID, evidence: "existing_or_future" },
      { kind: "signal", name: "scheduler.task.completed", producerSessionID: implementer, taskID: b.taskID, evidence: "existing_or_future" },
    ], action: { mode: "prompt", text: "RUN_ALL_TESTS" } });
    const ar = await ok(reviewer, "task_update", { taskID: a.taskID, state: "completed", expectedRevision: 0, summary: "A done", idempotencyKey: "a-done" });
    expect((await history(tests)).some(message => message.type === "user" && message.text.startsWith("RUN_ALL_TESTS"))).toBe(false);
    const br = await ok(implementer, "task_update", { taskID: b.taskID, state: "completed", expectedRevision: 0, summary: "B done", idempotencyKey: "b-done" });
    const testHistory = await awaitText(tests, "RUN_ALL_TESTS");
    const input = testHistory.find(message => message.type === "user" && message.text.startsWith("RUN_ALL_TESTS"));
    expect(input.text).toContain(ar.resultID); expect(input.text).toContain(br.resultID);
    const reporter = await create("Periodic status reporter");
    const statusTask = await ok(reviewer, "task_update", { title: "Status review", state: "working", idempotencyKey: "status-task" });
    const status = await ok(reporter, "job_create", { label: "Five-minute status until review complete", operator: "all", mode: "repeat",
      conditions: [{ kind: "time", dueAt: Date.now() + 2000, intervalSeconds: 300 }],
      until: { operator: "all", conditions: [{ kind: "signal", name: "scheduler.task.completed", producerSessionID: reviewer,
        taskID: statusTask.taskID, evidence: "existing_or_future" }] }, action: { mode: "prompt", text: "FIVE_MINUTE_STATUS" } });
    await awaitText(reporter, "FIVE_MINUTE_STATUS");
    await ok(reviewer, "task_update", { taskID: statusTask.taskID, state: "completed", expectedRevision: 0,
      summary: "Status review done", idempotencyKey: "status-complete" });
    const statusJobs = await ok(reporter, "job_list", {});
    expect(statusJobs.find((row: any) => row.id === status.job.id).body).toMatchObject({ state: "completed", stopped: true });
    expect((await history(reporter)).filter(message => message.type === "user" && message.text.startsWith("FIVE_MINUTE_STATUS"))).toHaveLength(1);
    // Same ALL mechanism is also the all-reviewer result aggregator, with exact result set.
    expect(input.text.match(new RegExp(ar.resultID, "g"))!.length).toBeGreaterThanOrEqual(1);
    const denied = await create("Foreign project caller", await (async () => {
      const directory = path.join(root, "foreign"); await mkdir(directory); execFileSync("git", ["init", directory], { stdio: "ignore" });
      execFileSync("git", ["-C", directory, "-c", "user.name=Scheduler Test", "-c", "user.email=test@invalid", "commit", "--allow-empty", "-m", "foreign fixture"], { stdio: "ignore" }); return directory;
    })());
    expect(await control(denied, "session_read", { sessionID: reviewer, view: "tasks" })).toMatchObject({ ok: false, error: { code: "scope-denied" } });
    expect(await control(denied, "job_control", { jobID: status.job.id, operation: "cancel", expectedRevision: 0 })).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await control(consumer, "job_create", { label: "No producer contract", operator: "all", conditions: [
      { kind: "signal", name: "scheduler.task.completed", producerSessionID: reviewer, evidence: "future" },
    ], action: { mode: "message", text: "No accidental work" } })).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    // Durable wait survives a location reload; legacy timer definitions do not.
    const reloadTarget = await create("Reload target");
    await ok(reloadTarget, "timer_start", { mode: "once", delaySeconds: 60, prompt: "EPHEMERAL_MUST_NOT_RUN" });
    const reloadJob = await ok(reloadTarget, "job_create", { label: "After reload", operator: "all", conditions: [
      { kind: "signal", name: "reload.ready", producerSessionID: reviewer, evidence: "future" },
    ], action: { mode: "prompt", text: "DURABLE_AFTER_RELOAD" } });
    await api("/api/location/reload", {});
    expect(await ok(reloadTarget, "timer_list", {})).toEqual([]);
    expect((await ok(reloadTarget, "job_list", {})).some((row: any) => row.id === reloadJob.job.id)).toBe(true);
    await ok(reviewer, "signal_emit", { name: "reload.ready", idempotencyKey: "reload-ready" });
    await awaitText(reloadTarget, "DURABLE_AFTER_RELOAD");
    const worktree = path.join(root, "worktree");
    execFileSync("git", ["-C", project, "worktree", "add", "-b", "fixture-worktree", worktree], { stdio: "ignore" });
    const worktreeSession = await create("Worktree peer", worktree);
    expect((await api(`/api/session/${worktreeSession}`)).data.projectID).toBe((await api(`/api/session/${reviewer}`)).data.projectID);
    const passive = await ok(worktreeSession, "session_send", { sessionID: reviewer, mode: "message", text: "WORKTREE_MAILBOX_ONLY", idempotencyKey: "worktree-message" });
    expect(passive.activated).toBe(false);
    expect((await ok(reviewer, "session_read", { sessionID: reviewer, view: "mailbox" })).entries.some((entry: any) => entry.body.text === "WORKTREE_MAILBOX_ONLY")).toBe(true);
    expect((await history(reviewer)).some(message => message.type === "user" && message.text === "WORKTREE_MAILBOX_ONLY")).toBe(false);
    const missing = await control(consumer, "session_read", { sessionID: "ses_missing_fixture", view: "state" });
    expect(missing).toMatchObject({ ok: false, error: { code: "not-found" } });
    await create("Ambiguous reviewer"); await create("Ambiguous reviewer");
    expect(await ok(consumer, "session_find", { query: "Ambiguous reviewer" })).toMatchObject({ status: "ambiguous-session" });
    const form = await api(`/api/session/${reviewer}/form`, { title: "Approval fixture", fields: [{ key: "approve", type: "boolean", required: true }] });
    const observedWait = await ok(consumer, "session_read", { sessionID: reviewer, view: "state" });
    expect([true, "unknown"]).toContain(observedWait.waitingInput);
    const forms = await api(`/api/session/${reviewer}/form`);
    expect(forms.data.some((item: any) => item.id === form.data.id)).toBe(true);
    const restartedTarget = await create("Server restart target");
    const restartJob = await ok(restartedTarget, "job_create", { label: "After server restart", operator: "all", conditions: [
      { kind: "signal", name: "server.restarted", producerSessionID: reviewer, evidence: "future" },
    ], action: { mode: "prompt", text: "AFTER_SERVER_RESTART" } });
    const previousServer = server;
    const previousOutput = output;
    const exited = once(previousServer, "exit"); previousServer.kill(); await exited;
    output = "";
    server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(hostPort)], { cwd: project, env: { ...inherited,
      HOME: root, USERPROFILE: root, OPENCODE_TEST_HOME: root, XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"), XDG_CONFIG_HOME: path.join(root, "config"), OPENCODE_CONFIG_DIR: config, OPENCODE_PASSWORD: "fixture-password" },
      stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", chunk => { output += String(chunk); }); server.stderr?.on("data", chunk => { output += String(chunk); });
    const restartDeadline = Date.now() + 30000;
    while (!output.match(/http:\/\/127\.0\.0\.1:\d+/) && Date.now() < restartDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (!origin) throw new Error("Restarted private server did not announce URL");
    await writeFile(path.join(root, "before-restart.log"), previousOutput);
    expect((await ok(restartedTarget, "job_list", {})).some((row: any) => row.id === restartJob.job.id)).toBe(true);
    await ok(reviewer, "signal_emit", { name: "server.restarted", idempotencyKey: "restart-signal" });
    await awaitText(restartedTarget, "AFTER_SERVER_RESTART");
    await ok(reviewer, "signal_emit", { name: "server.restarted", idempotencyKey: "restart-signal" });
    expect((await history(restartedTarget)).filter(message => message.type === "user" && message.text.startsWith("AFTER_SERVER_RESTART"))).toHaveLength(1);
    expect(await ok(consumer, "orchestration_status", {})).toMatchObject({ capabilities: { "historical-messages": withSDK } });
    const approvalState = await ok(consumer, "session_read", { sessionID: reviewer, view: "state" });
    // Forms are ephemeral across restart, so create a new supported snapshot.
    await api(`/api/session/${reviewer}/form`, { title: "SDK approval fixture", fields: [{ key: "approve", type: "boolean", required: true }] });
    expect((await ok(consumer, "session_read", { sessionID: reviewer, view: "state" })).waitingInput).toBe(withSDK ? true : "unknown");
    if (withSDK) {
      expect(await ok(consumer, "session_read", { sessionID: reviewer, view: "history", limit: 1 })).toMatchObject({ coverage: "historical-messages" });
      expect(approvalState.interactions.coverage).toBe("interaction-snapshot");
    } else {
      expect(await control(consumer, "session_read", { sessionID: reviewer, view: "history", limit: 1 })).toMatchObject({ ok: false, error: { code: "unsupported-capability" } });
      expect(await ok(consumer, "session_read", { sessionID: reviewer, view: "context" })).toMatchObject({ coverage: "current-compacted-context" });
    }
    const nativeSource = await create("Native execution source"), nativeTarget = await create("Native execution follower");
    // Regression for the observed host limitation, NOT native-trigger acceptance.
    expect(await control(nativeTarget, "job_create", { label: "Native success edge", operator: "all", conditions: [
      { kind: "session", sessionID: nativeSource, predicate: "succeeded", evidence: "future" },
    ], action: { mode: "prompt", text: "NATIVE_EXECUTION_FOLLOWUP" } })).toMatchObject({ ok: false, error: { code: "unsupported-capability" } });
    expect((await ok(nativeTarget, "job_list", {}))).toEqual([]);
    expect(await ok(nativeTarget, "orchestration_status", {})).toMatchObject({ capabilities: { "native-log-replay": false } });
    const mixed = await create("Mixed timer and job target"), unrelated = await create("Unrelated target progress");
    await ok(mixed, "job_create", { label: "Signal job shares timer cooldown", operator: "all", conditions: [
      { kind: "signal", name: "mixed.ready", producerSessionID: reviewer, evidence: "future" },
    ], action: { mode: "prompt", text: "MIXED_JOB_ACTIVATION" } });
    await ok(mixed, "timer_start", { mode: "once", delaySeconds: 30, prompt: "MIXED_TIMER_ACTIVATION" });
    await ok(unrelated, "job_create", { label: "Independent target", operator: "all", conditions: [
      { kind: "time", dueAt: Date.now() + 1000 },
    ], action: { mode: "prompt", text: "UNRELATED_ACTIVATION" } });
    await awaitText(unrelated, "UNRELATED_ACTIVATION");
    expect((await history(mixed)).some(message => message.type === "user" && message.text.startsWith("MIXED_"))).toBe(false);
    await awaitText(mixed, "MIXED_TIMER_ACTIVATION");
    await ok(reviewer, "signal_emit", { name: "mixed.ready", idempotencyKey: "mixed-ready" });
    const mixedHistory = await awaitText(mixed, "MIXED_JOB_ACTIVATION");
    const timerInput = mixedHistory.filter(message => message.type === "user" && message.text === "MIXED_TIMER_ACTIVATION");
    const jobInput = mixedHistory.filter(message => message.type === "user" && message.text.startsWith("MIXED_JOB_ACTIVATION"));
    expect(timerInput).toHaveLength(1); expect(jobInput).toHaveLength(1);
    expect(jobInput[0].time.created - timerInput[0].time.created).toBeGreaterThanOrEqual(30000);
    expect(await control(consumer, "session_send", { sessionID: "ses_missing_fixture", mode: "prompt",
      text: "MUST_NOT_DELIVER", idempotencyKey: "missing-target" })).toMatchObject({ ok: false, error: { code: "not-found" } });
    const deletedTarget = await create("Deleted target fixture");
    await api(`/api/session/${deletedTarget}`, undefined, "DELETE");
    expect(await control(consumer, "session_send", { sessionID: deletedTarget, mode: "prompt",
      text: "DELETED_MUST_NOT_DELIVER", idempotencyKey: "deleted-target" })).toMatchObject({ ok: false, error: { code: "not-found" } });
    const aggregator = await create("All reviewers aggregator");
    const resolved = await ok(aggregator, "session_find", { query: "Reviewer" });
    expect(JSON.stringify(resolved)).toContain(reviewer);
    const reviewA = await ok(reviewer, "task_update", { title: "Aggregate review A", state: "working", idempotencyKey: "aggregate-a" });
    const reviewB = await ok(implementer, "task_update", { title: "Aggregate review B", state: "working", idempotencyKey: "aggregate-b" });
    await ok(aggregator, "job_create", { label: "Aggregate resolved reviewers", operator: "all", conditions: [
      { kind: "signal", name: "scheduler.task.completed", producerSessionID: reviewer, taskID: reviewA.taskID, evidence: "existing_or_future" },
      { kind: "signal", name: "scheduler.task.completed", producerSessionID: implementer, taskID: reviewB.taskID, evidence: "existing_or_future" },
    ], action: { mode: "prompt", text: "AGGREGATE_REVIEWERS" } });
    const extraReviewer = await create("Later reviewer outside frozen set");
    await ok(extraReviewer, "task_update", { title: "Later review", state: "working", idempotencyKey: "later-review" });
    const aggregateA = await ok(reviewer, "task_update", { taskID: reviewA.taskID, state: "completed", expectedRevision: 0,
      summary: "Aggregate A", idempotencyKey: "aggregate-a-done" });
    expect((await history(aggregator)).some(message => message.type === "user" && message.text.startsWith("AGGREGATE_REVIEWERS"))).toBe(false);
    const aggregateB = await ok(implementer, "task_update", { taskID: reviewB.taskID, state: "completed", expectedRevision: 0,
      summary: "Aggregate B", idempotencyKey: "aggregate-b-done" });
    const aggregateHistory = await awaitText(aggregator, "AGGREGATE_REVIEWERS");
    const aggregateInput = aggregateHistory.find(message => message.type === "user" && message.text.startsWith("AGGREGATE_REVIEWERS"));
    expect(aggregateInput.text).toContain(aggregateA.resultID); expect(aggregateInput.text).toContain(aggregateB.resultID);
    expect(aggregateInput.text).not.toContain(extraReviewer);
    const busyTarget = await create("Busy activation target");
    await api(`/api/session/${busyTarget}/prompt`, { text: "HOLD_BUSY_FIXTURE", delivery: "queue" });
    await Promise.race([busyStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("Busy model fixture did not start")), 10000))]);
    await ok(consumer, "session_send", { sessionID: busyTarget, mode: "prompt", text: "BUSY_QUEUED_ACTIVATION", idempotencyKey: "busy-send" });
    expect((await history(busyTarget)).some(message => message.type === "user" && message.text.startsWith("BUSY_QUEUED_ACTIVATION"))).toBe(false);
    releaseBusy!();
    const busyHistory = await awaitText(busyTarget, "BUSY_QUEUED_ACTIVATION");
    expect(busyHistory.filter(message => message.type === "user" && message.text.startsWith("BUSY_QUEUED_ACTIVATION"))).toHaveLength(1);
    const ambiguity = await ok(consumer, "session_find", { query: "Implementation" });
    expect(ambiguity.candidates).toBeDefined();
    await writeFile(path.join(root, "evidence.json"), JSON.stringify({ reviewer, consumer, earlyConsumer, tests, result, ar, br, calls,
      history: await history(consumer), early: await history(earlyConsumer), aggregation: testHistory }, null, 2));
    console.log(`Orchestration real-host evidence: ${root}`);
  } finally {
    releaseBusy?.();
    await writeFile(path.join(root, "server.log"), output);
    server?.kill(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve()));
  }
}, 180000);
