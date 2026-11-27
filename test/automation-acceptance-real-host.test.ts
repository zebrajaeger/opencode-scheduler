import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { expect, test } from "vitest";
import { controlTool } from "./automation-acceptance-helpers.js";

// Private, opt-in servers only; real production spacing and fixture permissions.
test.runIf(process.env.SCHEDULER_REAL_HOST === "1")("isolated automation host exercises misfires, new targets, mixed dispatch and terminal outcomes", async () => {
  const binary = process.env.SCHEDULER_OPENCODE_BIN;
  if (!binary || !process.env.SCHEDULER_EXPECTED_VERSION) throw new Error("Acceptance requires an explicit pinned binary and SCHEDULER_EXPECTED_VERSION");
  const root = await mkdtemp(path.join(process.env.SCHEDULER_TEST_TMP ?? "C:/Users/Lars.Brandt/AppData/Local/Temp/opencode", "scheduler-automation-acceptance-"));
  const project = path.join(root, "project"), config = path.join(root, "config", "opencode");
  await mkdir(project, { recursive: true }); await mkdir(config, { recursive: true });
  const requests: { at: number; text: string; body: unknown }[] = [];
  const handled = new Set<string>(); let sequence = 0, hold = true;
  const mock = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const last = body.messages?.at(-1), text = typeof last?.content === "string" ? last.content : "";
    requests.push({ at: Date.now(), text, body });
    if (last?.role === "user" && text === "FAIL_REPORT") {
      response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Private fixture execution failure", type: "invalid_request_error" } })); return;
    }
    if (last?.role === "user" && (text === "HELD_FOREGROUND" || hold && text === "HELD_MIXED_REPORT")) return;
    let delta: unknown = { content: "Fixture report only; no provider access." }, finish = "stop";
    if (last?.role === "user" && text.startsWith("CONTROL:") && !handled.has(text)) {
      handled.add(text); const actions = JSON.parse(text.slice(8)).actions;
      delta = { tool_calls: actions.map((action: { name: string; args: unknown }, index: number) => ({ index,
        id: `call_${++sequence}`, type: "function", function: { name: action.name, arguments: JSON.stringify(action.args) } })) }; finish = "tool_calls";
    }
    const frame = (part: unknown, reason: string | null) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "scheduler-test", choices: [{ index: 0, delta: part, finish_reason: reason }] });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(`data: ${JSON.stringify(frame(delta, null))}\n\n`); response.write(`data: ${JSON.stringify(frame({}, finish))}\n\n`); response.end("data: [DONE]\n\n");
  });
  mock.listen(0, "127.0.0.1"); await once(mock, "listening");
  const address = mock.address(); if (!address || typeof address === "string") throw new Error("No mock address");
  await writeFile(path.join(config, "opencode.json"), JSON.stringify({ plugins: [path.resolve(".")],
    model: { providerID: "scheduler-test", model: "scheduler-test" },
    permissions: [{ action: "shell", resource: "*", effect: "ask" }],
    providers: { "scheduler-test": { package: "@opencode/ai/providers/openai-compatible", env: [], settings: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "local-fixture-only" },
      models: { "scheduler-test": { name: "Fixture", capabilities: { toolCall: true }, limit: { context: 64000, output: 2000 } } } } } }));
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (/^(path|pathext|systemroot|windir|comspec|temp|tmp|programfiles|programfiles\(x86\))$/i.test(key)) env[key] = value;
  Object.assign(env, { HOME: root, USERPROFILE: root, OPENCODE_TEST_HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
    XDG_STATE_HOME: path.join(root, "state"), XDG_CACHE_HOME: path.join(root, "cache"), OPENCODE_CONFIG_DIR: config, OPENCODE_PASSWORD: "isolated-test-password" });
  let server: ChildProcess | undefined, origin = "", output = "";
  const headers = { authorization: "Basic " + Buffer.from("opencode:isolated-test-password").toString("base64"), "content-type": "application/json" };
  const api = async (route: string, body?: unknown) => {
    const res = await fetch(origin + route, { headers, method: body === undefined ? "GET" : "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`${route}: ${res.status} ${(await res.text()).slice(0, 2000)}`);
    return res.status === 204 ? undefined : res.json();
  };
  const eventually = async <T>(read: () => Promise<T>, valid: (value: T) => boolean, timeout = 45_000): Promise<T> => {
    const until = Date.now() + timeout; let value: T;
    do { value = await read(); if (valid(value)) return value; await new Promise(resolve => setTimeout(resolve, 200)); } while (Date.now() < until);
    throw new Error(`Private acceptance timeout: ${JSON.stringify(value!).slice(0, 2000)}`);
  };
  const start = async () => {
    let current = "";
    server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [server.stdout, server.stderr]) stream?.on("data", chunk => { current += String(chunk); output += String(chunk); });
    server.on("error", error => { current += String(error); });
    await eventually(async () => { if (server?.exitCode !== null) throw new Error(current); return current; }, value => /http:\/\/127\.0\.0\.1:\d+/.test(value), 90_000);
    origin = current.match(/http:\/\/127\.0\.0\.1:\d+/)![0];
    expect((await api("/api/info")).version).toBe(process.env.SCHEDULER_EXPECTED_VERSION);
  };
  const stop = async () => { if (server && server.exitCode === null) { const exit = once(server, "exit"); server.kill(); await exit; } };
  // Repeated list polling can exceed one page. Read the newest page so a
  // control invocation can never accidentally reuse its first-page result.
  const history = async (id: string): Promise<any[]> => (await api(`/api/session/${id}/message?order=desc&limit=200`)).data.reverse();
  const control = async (id: string, actions: { name: string; args: unknown }[]) => {
    const text = "CONTROL:" + JSON.stringify({ nonce: ++sequence, actions });
    await api(`/api/session/${id}/prompt`, { text, delivery: "queue" });
    await api(`/api/experimental/session/${id}/wait`, {});
    const hist = await history(id);
    return actions.map(({ name }) => {
      const tool = controlTool(hist, text, name);
      expect(tool.state?.status).toBe("completed");
      const output = tool.state?.content?.find(part => part.type === "text")?.text;
      if (!output) throw new Error("Control tool has no JSON output");
      const out = JSON.parse(output);
      expect(out.ok, JSON.stringify(out)).toBe(true); return out.result;
    });
  };
  const call = async (id: string, name: string, args: unknown = {}) => (await control(id, [{ name, args }]))[0];
  const prompts = async (id: string, text: string) => (await history(id)).filter(m => m.type === "user" && m.text === text);
  const create = async (chat: string, prompt: string, target: unknown, missedPolicy = "skip") => call(chat, "automation_create", { prompt, schedule: { kind: "interval", intervalSeconds: 30 }, target, missedPolicy });
  const evidence: Record<string, unknown> = { phase: process.env.SCHEDULER_ACCEPTANCE_PHASE === "mixed" ? "mixed" : "full" };
  try {
    await start();
    const chat = (await api("/api/session", { location: { directory: project }, title: "Acceptance control" })).data.id;
    const routines: { id: string }[] = [];
    if (process.env.SCHEDULER_ACCEPTANCE_PHASE !== "mixed") {
    const skipTarget = (await api("/api/session", { location: { directory: project }, title: "Skip target" })).data.id;
    const catchTarget = (await api("/api/session", { location: { directory: project }, title: "Catch-up target" })).data.id;
    const skip = await create(chat, "SKIP_REPORT", { kind: "existing", sessionID: skipTarget });
    const catchup = await create(chat, "CATCH_REPORT", { kind: "existing", sessionID: catchTarget }, "catch-up-once");
    const reuse = await create(chat, "REUSE_REPORT", { kind: "new-reuse", title: "Reusable fixture" });
    const fresh = await create(chat, "FRESH_REPORT", { kind: "new-each-run", title: "Fresh fixture" });
    await stop(); const offlineAt = Date.now(); await new Promise(resolve => setTimeout(resolve, 65_000)); await start();
    await call(chat, "automation_list"); // Activate the owning location without editing its records.
    await eventually(() => prompts(catchTarget, "CATCH_REPORT"), values => values.length === 1, 10_000);
    expect(await prompts(skipTarget, "SKIP_REPORT")).toHaveLength(0);
    expect(await prompts(reuse.target.sessionID, "REUSE_REPORT")).toHaveLength(0);
    const firstList = await call(chat, "automation_list");
    expect(firstList.automations.find((x: any) => x.id === fresh.id).acceptedRunCount).toBe(0);
    const savedSkip = firstList.automations.find((x: any) => x.id === skip.id);
    expect((savedSkip.nextOccurrence - skip.recurrence.anchorAt) % 30_000).toBe(0);
    evidence.misfire = { offlineAt, resumedAt: Date.now(), firstList, skip: await history(skipTarget), catchup: await history(catchTarget) };
    await eventually(() => prompts(reuse.target.sessionID, "REUSE_REPORT"), values => values.length >= 2, 70_000);
    const completed = await eventually(() => call(chat, "automation_list"), result => result.automations.find((x: any) => x.id === fresh.id)?.acceptedRunCount >= 2 && !result.automations.find((x: any) => x.id === fresh.id)?.run, 15_000);
    const sessions = (await api("/api/session?limit=100")).data;
    // The host may auto-title a chat after its first answer. Match delivered
    // prompt identities, not mutable titles (the same rule as production binding).
    const freshSessions = [];
    for (const session of sessions) if ((await prompts(session.id, "FRESH_REPORT")).length) freshSessions.push(session);
    evidence.observedSessions = sessions;
    expect(freshSessions).toHaveLength(2);
    for (const target of freshSessions) expect(await prompts(target.id, "FRESH_REPORT")).toHaveLength(1);
    const reuseMessages = await history(reuse.target.sessionID);
    expect(reuseMessages.filter(m => m.type === "user").every(m => m.text === "REUSE_REPORT")).toBe(true);
    evidence.targets = { completed, freshSessions, freshMessages: await Promise.all(freshSessions.map((x: any) => history(x.id))), reuseMessages };
    for (const routine of [skip, catchup, reuse, fresh]) await call(chat, "automation_pause", { automationId: routine.id });
    routines.push(skip, catchup, reuse, fresh);
    }

    const mixed = (await api("/api/session", { location: { directory: project }, title: "Mixed target" })).data.id;
    const [held] = await control(mixed, [
      { name: "automation_create", args: { prompt: "HELD_MIXED_REPORT", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "current" } } },
      { name: "timer_start", args: { mode: "once", delaySeconds: 35, prompt: "MIXED_TIMER" } },
    ]);
    await eventually(() => prompts(mixed, "HELD_MIXED_REPORT"), values => values.length === 1);
    await new Promise(resolve => setTimeout(resolve, 7_000));
    expect(await prompts(mixed, "MIXED_TIMER")).toHaveLength(0);
    expect((await api(`/api/session/${mixed}/interrupt`, {})).interrupted).toBe(true);
    hold = false; await api(`/api/experimental/session/${mixed}/wait`, {});
    const interrupted = await call(chat, "automation_list");
    expect(interrupted.automations.find((x: any) => x.id === held.id)).toMatchObject({ enabled: true, lastOutcome: "interrupted" });
    expect(await call(mixed, "timer_list")).toEqual([]);
    // A new timer shares the same gate with the next durable occurrence.
    await call(mixed, "timer_start", { mode: "once", delaySeconds: 30, prompt: "MIXED_TIMER_AFTER_STOP" });
    // An older timer now wins the next cooldown slot; allow the automation's
    // following slot as well instead of assuming the old starvation order.
    await eventually(() => prompts(mixed, "HELD_MIXED_REPORT"), values => values.length >= 2, 80_000);
    try {
      await eventually(() => prompts(mixed, "MIXED_TIMER_AFTER_STOP"), values => values.length === 1, 65_000);
    } finally {
      evidence.mixedObservation = { list: await call(chat, "automation_list"), timers: await call(mixed, "timer_list"), messages: await history(mixed) };
    }
    const admissions = requests.filter(x => x.text === "HELD_MIXED_REPORT" || x.text === "MIXED_TIMER_AFTER_STOP");
    for (const [index, admission] of admissions.entries()) {
      const previous = admissions[index - 1];
      if (previous) expect(admission.at - previous.at).toBeGreaterThanOrEqual(29_500);
    }
    evidence.mixed = { interrupted, messages: await history(mixed), admissions: admissions.map(({ at, text }) => ({ at, text })) };
    await call(mixed, "timer_start", { mode: "repeat", intervalSeconds: 3600, maxLifetimeSeconds: 7200, prompt: "FOREGROUND_STOP_TIMER" });
    await api(`/api/session/${mixed}/prompt`, { text: "HELD_FOREGROUND", delivery: "queue" });
    await eventually(async () => requests.filter(x => x.text === "HELD_FOREGROUND"), values => values.length > 0, 10_000);
    expect((await api(`/api/session/${mixed}/interrupt`, {})).interrupted).toBe(true);
    await api(`/api/experimental/session/${mixed}/wait`, {});
    const afterForeground = await call(chat, "automation_list");
    expect(afterForeground.automations.find((x: any) => x.id === held.id).enabled).toBe(true);
    expect(await call(mixed, "timer_list")).toEqual([]);
    const beforeLater = (await prompts(mixed, "HELD_MIXED_REPORT")).length;
    try {
      // The shared cooldown can reject the next nominal deadline; a deferred
      // automation retries at minimum-spacing boundaries rather than spinning.
      await eventually(() => prompts(mixed, "HELD_MIXED_REPORT"), values => values.length > beforeLater, 80_000);
    } finally {
      evidence.foregroundObservation = { list: await call(chat, "automation_list"), session: await api(`/api/session/${mixed}`), messages: await history(mixed) };
    }
    evidence.foregroundInterruption = { afterForeground, messages: await history(mixed) };
    await call(chat, "automation_pause", { automationId: held.id });

    const failureTarget = (await api("/api/session", { location: { directory: project }, title: "Failure target" })).data.id;
    const failing = await create(chat, "FAIL_REPORT", { kind: "existing", sessionID: failureTarget });
    const failed = await eventually(async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return call(chat, "automation_list");
    }, result => result.automations.find((x: any) => x.id === failing.id)?.lastOutcome === "failed", 50_000);
    expect(failed.automations.find((x: any) => x.id === failing.id)).toMatchObject({ enabled: false, pauseReason: "execution-error" });
    await new Promise(resolve => setTimeout(resolve, 32_000));
    expect(await prompts(failureTarget, "FAIL_REPORT")).toHaveLength(1);
    evidence.failure = { failed, messages: await history(failureTarget) };
    for (const routine of [...routines, held, failing]) await call(chat, "automation_remove", { automationId: routine.id });
    evidence.final = await call(chat, "automation_list");
    expect((evidence.final as any).automations).toEqual([]);
    console.log(`Isolated acceptance evidence: ${root}; OpenCode ${process.env.SCHEDULER_EXPECTED_VERSION}`);
  } finally {
    await stop(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve()));
    await writeFile(path.join(root, "host.log"), output); await writeFile(path.join(root, "requests.json"), JSON.stringify(requests, null, 2));
    await writeFile(path.join(root, "evidence.json"), JSON.stringify({ version: process.env.SCHEDULER_EXPECTED_VERSION, ...evidence }, null, 2));
  }
}, 480_000);
