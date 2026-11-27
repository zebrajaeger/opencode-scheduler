import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { expect, test } from "vitest";

test.runIf(process.env.SCHEDULER_REAL_HOST === "1")("isolated automation host persists definitions and recovers without duplicate reports", async () => {
  const temp = process.env.SCHEDULER_TEST_TMP ?? "C:/Users/Lars.Brandt/AppData/Local/Temp/opencode";
  const root = await mkdtemp(path.join(temp, "scheduler-automation-real-"));
  const project = path.join(root, "project"), config = path.join(root, "config", "opencode");
  await mkdir(project, { recursive: true }); await mkdir(config, { recursive: true });
  const requests: unknown[] = []; let sequence = 0; let hold = false;
  const handled = new Set<string>();
  const mock = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || "{}"); requests.push(body);
    if (request.url?.endsWith("/models")) { response.writeHead(200, { "content-type": "application/json" }).end('{"data":[]}'); return; }
    const last = body.messages?.at(-1); const text = typeof last?.content === "string" ? last.content : "";
    let delta: unknown = { content: "Fixture PR: [#42](https://example.invalid/pull/42)" }, finish = "stop";
    if (last?.role === "user" && text.startsWith("CONTROL:") && !handled.has(text)) {
      handled.add(text); const actions = JSON.parse(text.slice(8)).actions;
      delta = { tool_calls: actions.map((action: { name: string; args: unknown }, index: number) => ({ index,
        id: `call_${++sequence}`, type: "function", function: { name: action.name, arguments: JSON.stringify(action.args) } })) }; finish = "tool_calls";
    }
    if (hold && last?.role === "user" && text === "HELD_REPORT") return;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const frame = (part: unknown, reason: string | null) => ({ id: "fixture", object: "chat.completion.chunk", created: 1,
      model: "scheduler-test", choices: [{ index: 0, delta: part, finish_reason: reason }] });
    response.write(`data: ${JSON.stringify(frame(delta, null))}\n\n`); response.write(`data: ${JSON.stringify(frame({}, finish))}\n\n`); response.end("data: [DONE]\n\n");
  });
  mock.listen(0, "127.0.0.1"); await once(mock, "listening");
  const address = mock.address(); if (!address || typeof address === "string") throw new Error("No mock address");
  await writeFile(path.join(config, "opencode.json"), JSON.stringify({ plugins: [path.resolve(".")],
    model: { providerID: "scheduler-test", model: "scheduler-test" },
    providers: { "scheduler-test": { package: "@opencode/ai/providers/openai-compatible", env: [],
      settings: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "local-fixture-only" },
      models: { "scheduler-test": { name: "Fixture", capabilities: { toolCall: true }, limit: { context: 64000, output: 2000 } } } } } }));
  const inherited: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (/^(path|pathext|systemroot|windir|comspec|temp|tmp|programfiles|programfiles\(x86\))$/i.test(key)) inherited[key] = value;
  const env = { ...inherited, HOME: root, USERPROFILE: root, XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"), XDG_CONFIG_HOME: path.join(root, "config"),
    OPENCODE_CONFIG_DIR: config, OPENCODE_TEST_HOME: root, OPENCODE_PASSWORD: "isolated-test-password" };
  const binary = process.env.SCHEDULER_OPENCODE_BIN ?? "C:/nvm4w/nodejs/node_modules/@opencode/cli/bin/opencode.exe";
  let server: ChildProcess | undefined; let output = "", origin = "";
  const headers = { authorization: `Basic ${Buffer.from("opencode:isolated-test-password").toString("base64")}`, "content-type": "application/json" };
  const api = async (route: string, body?: unknown) => {
    const response = await fetch(origin + route, { headers, method: body === undefined ? "GET" : "POST",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error(`${route}: ${response.status} ${(await response.text()).slice(0, 2000)}`);
    return response.status === 204 ? undefined : response.json();
  };
  const start = async () => {
    let current = "";
    server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [server.stdout, server.stderr]) stream?.on("data", chunk => { current += String(chunk); output += String(chunk); });
    server.on("error", error => { current += String(error); });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) { const match = current.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { origin = match[0]; return; }
      if (server.exitCode !== null) throw new Error(current.slice(-3000)); await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Private startup timeout: ${current.slice(-3000)}`);
  };
  const stop = async () => { if (server && server.exitCode === null) { const exit = once(server, "exit"); server.kill(); await exit; } };
  const history = async (id: string) => (await api(`/api/session/${id}/message?order=asc&limit=200`)).data;
  const control = async (id: string, name: string, args: unknown) => {
    await api(`/api/session/${id}/prompt`, { text: `CONTROL:${JSON.stringify({ nonce: ++sequence, actions: [{ name, args }] })}`, delivery: "queue" });
    await api(`/api/experimental/session/${id}/wait`, {});
    const messages = await history(id);
    const tool = messages.filter((message: any) => message.type === "assistant").flatMap((message: any) => message.content)
      .filter((part: any) => part.type === "tool" && part.name === name).at(-1);
    expect(tool?.state.status).toBe("completed");
    const result = JSON.parse(tool.state.content.find((part: any) => part.type === "text").text);
    expect(result.ok, JSON.stringify(result)).toBe(true); return result.result;
  };
  try {
    await start(); const version = (await api("/api/info")).version;
    if (process.env.SCHEDULER_EXPECTED_VERSION) expect(version).toBe(process.env.SCHEDULER_EXPECTED_VERSION);
    const chat = (await api("/api/session", { location: { directory: project }, title: "Automation control" })).data.id;
    const report = (await api("/api/session", { location: { directory: project }, title: "Report target" })).data.id;
    const definition = await control(chat, "automation_create", { prompt: "FIXTURE_REPORT", label: "Fixture PRs",
      schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "existing", sessionID: report } });
    await control(chat, "automation_update", { automationId: definition.id, prompt: "UPDATED_FIXTURE_REPORT", label: "Atomic updated label" });
    await new Promise(resolve => setTimeout(resolve, 32_000)); await api(`/api/experimental/session/${report}/wait`, {});
    expect((await history(report)).filter((message: any) => message.type === "user" && message.text === "UPDATED_FIXTURE_REPORT")).toHaveLength(1);
    await control(chat, "automation_pause", { automationId: definition.id });
    await control(chat, "timer_start", { mode: "repeat", prompt: "TEMPORARY", intervalSeconds: 3600, maxLifetimeSeconds: 7200 });
    await stop(); await start();
    const listed = await control(chat, "automation_list", {});
    expect(listed.automations.find((value: any) => value.id === definition.id)).toMatchObject({ enabled: false, prompt: "UPDATED_FIXTURE_REPORT", label: "Atomic updated label", lastOutcome: "succeeded" });
    expect(await control(chat, "timer_list", {})).toEqual([]);
    const held = await control(chat, "automation_create", { prompt: "HELD_REPORT", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "existing", sessionID: report } });
    hold = true; await new Promise(resolve => setTimeout(resolve, 32_000));
    expect((await history(report)).filter((message: any) => message.type === "user" && message.text === "HELD_REPORT")).toHaveLength(1);
    await stop(); hold = false; await start();
    const recovered = await control(chat, "automation_list", {});
    expect(recovered.automations.find((value: any) => value.id === held.id).runState).toBe("unresolved");
    expect((await history(report)).filter((message: any) => message.type === "user" && message.text === "HELD_REPORT")).toHaveLength(1);
    await writeFile(path.join(root, "evidence.json"), JSON.stringify({ version, definition, listed, recovered, report: await history(report) }, null, 2));
    console.log(`Isolated automation evidence: ${root}; OpenCode ${version}`);
  } finally {
    await stop(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve()));
    await writeFile(path.join(root, "host.log"), output); await writeFile(path.join(root, "requests.json"), JSON.stringify(requests, null, 2));
  }
}, 300_000);
