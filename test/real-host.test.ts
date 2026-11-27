import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { expect, test } from "vitest";

// Opt-in only: private data/config roots and a loopback deterministic model.
// Never attach this suite to the user's shared OpenCode/OpenChamber service.
test.runIf(process.env.SCHEDULER_REAL_HOST === "1")("real plugin executes one-shot and recurring prompts in the original session", async () => {
  const root = await mkdtemp(path.join(process.env.SCHEDULER_TEST_TMP ?? tmpdir(), "scheduler-real-"));
  const project = path.join(root, "project");
  const config = path.join(root, "config", "opencode");
  await mkdir(project, { recursive: true }); await mkdir(config, { recursive: true });
  let initial = true;
  let timerCalls = 0;
  let callSequence = 0;
  const handled = new Set<string>();
  const requests: { url: string | undefined; body: unknown }[] = [];
  let automationHoldSeen = false;
  const mock = createServer(async (request, response) => {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || "{}");
    requests.push({ url: request.url, body });
    if (request.url?.endsWith("/models")) { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [] })); return; }
    const messages: { role: string; content?: string }[] = body.messages ?? [];
    const last = messages.at(-1);
    let delta: Record<string, unknown> = { content: "Scheduler test response" };
    let reason = "stop";
    const marker = typeof last?.content === "string" ? last.content : "";
    if (last?.role === "user" && marker === "AUTOMATION_HOLD") {
      automationHoldSeen = true;
      // Keep the isolated report active until its private host is terminated.
      // This request is intentionally unfinished; no unrelated service is used.
      request.on("close", () => {});
      return;
    }
    const toolCall = (name: string, args: unknown, index = 0) => ({ index, id: `call_${++callSequence}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
    if (last?.role === "user" && marker.startsWith("CONTROL:") && !handled.has(marker)) {
      handled.add(marker); reason = "tool_calls";
      const parsed = JSON.parse(marker.slice("CONTROL:".length)) as { actions: { name: string; args: unknown }[] } | { name: string; args: unknown }[];
      const instructions = Array.isArray(parsed) ? parsed : parsed.actions;
      delta = { tool_calls: instructions.map((instruction, index) => toolCall(instruction.name, instruction.args, index)) };
    } else if (initial && last?.role === "user") {
      initial = false; reason = "tool_calls";
      delta = { tool_calls: [
        { index: 0, id: "call_once", type: "function", function: { name: "timer_start", arguments: JSON.stringify({ mode: "once", prompt: "ONE_SHOT_CHECK", delaySeconds: 30, maxLifetimeSeconds: 180 }) } },
        { index: 1, id: "call_repeat", type: "function", function: { name: "timer_start", arguments: JSON.stringify({ mode: "repeat", prompt: "REPEAT_CHECK", intervalSeconds: 30, maxLifetimeSeconds: 180 }) } },
      ] };
    } else if (last?.role === "user" && (last.content?.includes("ONE_SHOT_CHECK") || last.content?.includes("REPEAT_CHECK"))) timerCalls++;
    response.writeHead(200, { "content-type": "text/event-stream" });
    const frame = (delta: unknown, finish: string | null) => ({ id: "chatcmpl_test", object: "chat.completion.chunk", created: 1, model: "scheduler-test", choices: [{ index: 0, delta, finish_reason: finish }] });
    response.write(`data: ${JSON.stringify(frame(delta, null))}\n\n`);
    response.write(`data: ${JSON.stringify(frame({}, reason))}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  mock.listen(0, "127.0.0.1"); await once(mock, "listening");
  const address = mock.address(); if (!address || typeof address === "string") throw new Error("No mock port");
  await writeFile(path.join(config, "opencode.json"), JSON.stringify({
    plugins: [process.env.SCHEDULER_PLUGIN_PACKAGE ?? path.resolve(".")], model: { providerID: "scheduler-test", model: "scheduler-test" },
    permissions: [{ action: "shell", resource: "*", effect: "allow" }],
    providers: { "scheduler-test": { package: "@opencode/ai/providers/openai-compatible", env: [],
      settings: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "local-fixture-only" },
      models: { "scheduler-test": { name: "Scheduler Test", capabilities: { toolCall: true }, limit: { context: 32000, output: 2000 } } } } },
  }));
  const inherited: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(path|pathext|systemroot|windir|comspec|temp|tmp|programfiles|programfiles\(x86\))$/i.test(key)) inherited[key] = value;
  }
  const env: NodeJS.ProcessEnv = { ...inherited, HOME: root, USERPROFILE: root,
    XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"),
    XDG_STATE_HOME: path.join(root, "state"), XDG_CONFIG_HOME: path.join(root, "config"), OPENCODE_CONFIG_DIR: config,
    OPENCODE_TEST_HOME: root, OPENCODE_PASSWORD: "isolated-test-password" };
  let server: ChildProcess | undefined;
  let output = "";
  try {
    const binary = process.env.SCHEDULER_OPENCODE_BIN ?? (process.platform === "win32"
      ? path.join(path.dirname(execFileSync("where.exe", ["node"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]!), "node_modules", "@opencode", "cli", "bin", "opencode.exe") : "opencode");
    server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", chunk => { output += String(chunk); });
    server.stderr?.on("data", chunk => { output += String(chunk); });
    server.on("error", error => { output += String(error); });
    const deadline = Date.now() + 90_000;
    let origin: string | undefined;
    while (Date.now() < deadline) {
      origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (origin) break;
      if (server.exitCode !== null) throw new Error(`Private server exited: ${output.slice(-3000)}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!origin) throw new Error(`Private server did not announce URL: ${output.slice(-3000)}`);
    const headers = { authorization: `Basic ${Buffer.from("opencode:isolated-test-password").toString("base64")}`, "content-type": "application/json" };
    const api = async (route: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
      const response = await fetch(`${origin}${route}`, { method, headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(90_000) });
      if (!response.ok) throw new Error(`${route}: ${response.status} ${(await response.text()).slice(0, 2000)}`);
      return response.status === 204 ? undefined : await response.json();
    };
    const health = await api("/api/info");
    expect(health.version).toMatch(/^2\./);
    const created = await api("/api/session", { location: { directory: project }, title: "Scheduler isolated integration" });
    const sessionID: string = created.data.id;
    await api(`/api/session/${sessionID}/prompt`, { text: "Create the two test timers", delivery: "queue" });
    const until = Date.now() + 150_000;
    while (Date.now() < until && timerCalls < 3) {
      if (/Failed to drain Session|failed to load plugin/i.test(output)) throw new Error(output.slice(-4000));
      const current = await api(`/api/session/${sessionID}`);
      if (current.data.outcome === "failed") throw new Error(`Session failed: ${JSON.stringify(current.data)}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    expect(timerCalls, output.slice(-3000)).toBeGreaterThanOrEqual(3);
    const info = await api(`/api/session/${sessionID}`);
    expect(info.data.id).toBe(sessionID);
    expect(info.data.location.directory.toLowerCase()).toBe(project.toLowerCase());
    const history = await api(`/api/session/${sessionID}/message?order=asc&limit=200`);
    const users = history.data.filter((message: { type: string }) => message.type === "user");
    expect(users.filter((message: { text: string }) => message.text === "ONE_SHOT_CHECK")).toHaveLength(1);
    expect(users.filter((message: { text: string }) => message.text === "REPEAT_CHECK").length).toBeGreaterThanOrEqual(2);
    expect(users[0].text).toBe("Create the two test timers");
    expect(history.data.filter((message: { type: string }) => message.type === "assistant").every((message: { model: { providerID: string } }) => message.model.providerID === "scheduler-test")).toBe(true);
    await writeFile(path.join(root, "history.json"), JSON.stringify(history, null, 2));

    const waitIdle = async (id: string) => api(`/api/experimental/session/${id}/wait`, {});
    const readHistory = async (id: string) => (await api(`/api/session/${id}/message?order=asc&limit=200`)).data;
    const control = async (id: string, actions: { name: string; args: unknown }[]) => {
      const message = `CONTROL:${JSON.stringify({ nonce: `${id}-${++callSequence}`, actions })}`;
      await api(`/api/session/${id}/prompt`, { text: message });
      await waitIdle(id);
      return readHistory(id);
    };
    const resultFor = (messages: any[], name: string) => {
      const tool = messages.filter(message => message.type === "assistant").flatMap(message => message.content)
        .filter(part => part.type === "tool" && part.name === name).at(-1);
      expect(tool?.state.status).toBe("completed");
      const result = JSON.parse(tool.state.content.find((content: any) => content.type === "text").text);
      expect(result.ok).toBe(true);
      return result.result;
    };
    const otherProject = path.join(root, "second-project"); await mkdir(otherProject);
    const other = (await api("/api/session", { location: { directory: otherProject } })).data.id;
    const secondHistory = await control(other, [
      { name: "timer_start", args: { mode: "once", prompt: "SECOND_PROJECT_CHECK", delaySeconds: 30, maxLifetimeSeconds: 120 } },
      { name: "shell", args: { command: 'node -e "setTimeout(()=>console.log(\'background done\'),65000)"', background: true } },
    ]);
    const secondTimer = resultFor(secondHistory, "timer_start");
    expect(secondTimer.owner.sessionID).toBe(other);
    expect(secondTimer.owner.directory.toLowerCase()).toBe(otherProject.toLowerCase());
    // A foreground tool keeps this session busy while the other project's
    // genuinely backgrounded process does not prevent its timer check.
    await control(sessionID, [{ name: "timer_stop_all", args: {} }]);
    const foregroundStart = Date.now();
    const foreground = control(sessionID, [
      { name: "timer_start", args: { mode: "once", prompt: "AFTER_FOREGROUND", delaySeconds: 30, maxLifetimeSeconds: 120 } },
      { name: "shell", args: { command: 'node -e "setTimeout(()=>console.log(\'foreground done\'),45000)"', timeout: 90000 } },
    ]);
    await new Promise(resolve => setTimeout(resolve, 35_000));
    const duringBusy = await readHistory(sessionID);
    expect(duringBusy.filter((message: any) => message.type === "user" && message.text === "AFTER_FOREGROUND")).toHaveLength(0);
    const otherHistory = await readHistory(other);
    expect(otherHistory.filter((message: any) => message.type === "user" && message.text === "SECOND_PROJECT_CHECK")).toHaveLength(1);
    expect(Date.now() - foregroundStart).toBeLessThan(65_000);
    await foreground;
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect((await readHistory(sessionID)).filter((message: any) => message.type === "user" && message.text === "AFTER_FOREGROUND")).toHaveLength(1);

    const managed = resultFor(await control(other, [{ name: "timer_start", args: { mode: "repeat", prompt: "MUST_NOT_RUN", intervalSeconds: 90, maxLifetimeSeconds: 300 } }]), "timer_start");
    const foreignStop = resultFor(await control(sessionID, [{ name: "timer_stop", args: { timerId: managed.id } }]), "timer_stop");
    expect(foreignStop.removed).toBe(false);
    const updated = resultFor(await control(other, [{ name: "timer_update", args: { timerId: managed.id, intervalSeconds: 120, prompt: "UPDATED_MUST_NOT_RUN" } }]), "timer_update");
    expect(updated.expiresAt).toBe(managed.expiresAt);
    expect(resultFor(await control(other, [{ name: "timer_stop", args: { timerId: managed.id } }]), "timer_stop").removed).toBe(true);

    // Interrupt a real busy execution after its timer tool returned.
    const interruptSession = (await api("/api/session", { location: { directory: project } })).data.id;
    await api(`/api/session/${interruptSession}/prompt`, { text: `CONTROL:${JSON.stringify([
      { name: "timer_start", args: { mode: "repeat", prompt: "INTERRUPTED_MUST_NOT_RUN", intervalSeconds: 60, maxLifetimeSeconds: 180 } },
      { name: "shell", args: { command: 'node -e "setTimeout(()=>{},45000)"', timeout: 90000 } },
    ])}` });
    await new Promise(resolve => setTimeout(resolve, 1000));
    expect((await api(`/api/session/${interruptSession}/interrupt`, {})).interrupted).toBe(true);
    await waitIdle(interruptSession);
    expect(resultFor(await control(interruptSession, [{ name: "timer_list", args: {} }]), "timer_list")).toEqual([]);

    const deleted = (await api("/api/session", { location: { directory: otherProject } })).data.id;
    await control(deleted, [{ name: "timer_start", args: { mode: "once", prompt: "DELETED_MUST_NOT_RUN", delaySeconds: 30, maxLifetimeSeconds: 120 } }]);
    await api(`/api/session/${deleted}`, undefined, "DELETE");
    await control(other, [{ name: "timer_start", args: { mode: "repeat", prompt: "RELOAD_MUST_NOT_RUN", intervalSeconds: 60, maxLifetimeSeconds: 180 } }]);
    await api("/api/location/reload", {});
    expect(resultFor(await control(other, [{ name: "timer_list", args: {} }]), "timer_list")).toEqual([]);
    const finalHistory = await readHistory(other);
    expect(finalHistory.filter((message: any) => message.type === "user" && /^(?:UPDATED_|RELOAD_)?MUST_NOT_RUN$/.test(message.text))).toHaveLength(0);
    await writeFile(path.join(root, "lifecycle-history.json"), JSON.stringify({ first: await readHistory(sessionID), second: finalHistory, interrupted: await readHistory(interruptSession) }, null, 2));

    // Durable automation integration uses a management chat separate from its
    // report target, so a recovered unresolved report cannot block inspection.
    const managerID = (await api("/api/session", { location: { directory: project }, title: "Automation manager" })).data.id;
    const reportID = (await api("/api/session", { location: { directory: project }, title: "Automation report" })).data.id;
    const automation = resultFor(await control(managerID, [{ name: "automation_create", args: {
      prompt: "AUTOMATION_REPORT", label: "Durable test", schedule: { kind: "interval", intervalSeconds: 30 },
      target: { kind: "existing", sessionID: reportID },
    } }]), "automation_create");
    await new Promise(resolve => setTimeout(resolve, 32_000)); await waitIdle(reportID);
    const completed = resultFor(await control(managerID, [{ name: "automation_list", args: {} }]), "automation_list").automations.find((item: any) => item.id === automation.id);
    expect(completed.lastOutcome).toBe("succeeded"); expect(completed.acceptedRunCount).toBeGreaterThanOrEqual(1);
    await control(managerID, [{ name: "automation_pause", args: { automationId: automation.id } }]);
    await control(managerID, [{ name: "automation_update", args: { automationId: automation.id, prompt: "PERSISTED_UPDATE" } }]);
    const restart = async () => {
      const old = server!; old.kill(); if (old.exitCode === null) await once(old, "exit");
      output = "";
      server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
      server.stdout?.on("data", chunk => { output += String(chunk); }); server.stderr?.on("data", chunk => { output += String(chunk); });
      const ready = Date.now() + 90_000;
      while (Date.now() < ready) {
        const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if (url) { origin = url; return; }
        if (server.exitCode !== null) throw new Error(`Restart failed: ${output.slice(-3000)}`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("Isolated restart did not become ready");
    };
    await restart();
    const persisted = resultFor(await control(managerID, [{ name: "automation_list", args: {} }]), "automation_list").automations.find((item: any) => item.id === automation.id);
    expect(persisted).toMatchObject({ enabled: false, pauseReason: "user-paused", prompt: "PERSISTED_UPDATE", lastOutcome: "succeeded" });
    expect(resultFor(await control(managerID, [{ name: "timer_list", args: {} }]), "timer_list")).toEqual([]);
    const held = resultFor(await control(managerID, [{ name: "automation_create", args: {
      prompt: "AUTOMATION_HOLD", schedule: { kind: "interval", intervalSeconds: 30 }, target: { kind: "existing", sessionID: reportID },
    } }]), "automation_create");
    const heldDeadline = Date.now() + 65_000;
    while (!automationHoldSeen && Date.now() < heldDeadline) await new Promise(resolve => setTimeout(resolve, 200));
    expect(automationHoldSeen).toBe(true);
    await restart();
    const recovered = resultFor(await control(managerID, [{ name: "automation_list", args: {} }]), "automation_list").automations.find((item: any) => item.id === held.id);
    expect(recovered.runState).toBe("unresolved");
    expect((await readHistory(reportID)).filter((message: any) => message.type === "user" && message.text === "AUTOMATION_HOLD")).toHaveLength(1);
    await writeFile(path.join(root, "automation-evidence.json"), JSON.stringify({ completed, persisted, recovered }, null, 2));
  } finally {
    // Only our child process and loopback mock are stopped. Preserve isolated
    // logs/data on disk for debugging; never recursively remove broad paths.
    await writeFile(path.join(root, "test-output.log"), output);
    await writeFile(path.join(root, "requests.json"), JSON.stringify(requests, null, 2));
    server?.kill(); mock.closeAllConnections(); await new Promise<void>(resolve => mock.close(() => resolve()));
  }
}, 600_000);
