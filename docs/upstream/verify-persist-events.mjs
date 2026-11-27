// Isolated source-host probe. Never attaches to or replaces an installed service.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import assert from "node:assert/strict";

const source = process.env.OPENCODE_UPSTREAM_SOURCE;
if (!source || !path.isAbsolute(source)) throw new Error("Set OPENCODE_UPSTREAM_SOURCE to an isolated patched checkout");
const root = await mkdtemp(path.join(process.env.SCHEDULER_TEST_TMP ?? process.env.TEMP, "persist-events-probe-"));
const project = path.join(root, "project"), config = path.join(root, "config", "opencode");
await mkdir(project, { recursive: true }); await mkdir(config, { recursive: true });
execFileSync("git", ["init", project], { stdio: "ignore" });
let modelCalls = 0;
const model = createServer(async (req, res) => {
  for await (const _chunk of req) { /* consume the request without logging content */ }
  if (req.url?.endsWith("/models")) { res.writeHead(200).end('{"data":[]}'); return; }
  modelCalls++;
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [delta, finish_reason] of [[{ content: "Native retention probe complete" }, null], [{}, "stop"]]) {
    res.write(`data: ${JSON.stringify({ id: "probe", object: "chat.completion.chunk", created: 1, model: "probe",
      choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  }
  res.end("data: [DONE]\n\n");
});
model.listen(0, "127.0.0.1"); await once(model, "listening");
await writeFile(path.join(config, "opencode.json"), JSON.stringify({
  model: { providerID: "probe", model: "probe" },
  providers: { probe: { package: "@opencode/ai/providers/openai-compatible", env: [],
    settings: { baseURL: `http://127.0.0.1:${model.address().port}/v1`, apiKey: "fixture-only" },
    models: { probe: { name: "Probe", capabilities: { toolCall: true }, limit: { context: 64000, output: 1000 } } } } },
}));
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(path|pathext|systemroot|windir|comspec|temp|tmp|programfiles|programfiles\(x86\))$/i.test(key)));
let child, origin, output = "";
async function start(persist = true) {
  output = "";
  child = spawn("bun", ["run", "src/index.ts", "serve", "--hostname", "127.0.0.1", "--port", "0",
    ...(persist ? ["--experimental-persist-events"] : [])], {
    cwd: path.join(source, "packages", "cli"), env: { ...inherited, HOME: root, USERPROFILE: root, OPENCODE_TEST_HOME: root,
      XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
      XDG_CONFIG_HOME: path.join(root, "config"), OPENCODE_CONFIG_DIR: config, OPENCODE_PASSWORD: "fixture-password",
      OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_FILEWATCHER: "true" }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const deadline = Date.now() + 60000;
  while (!(origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0])) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Private host failed: ${output.slice(-6000)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function stop() {
  if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
}
async function api(route, body) {
  const response = await fetch(origin + route, { method: body === undefined ? "GET" : "POST", headers: {
    authorization: `Basic ${Buffer.from("opencode:fixture-password").toString("base64")}`, "content-type": "application/json",
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${route}: ${response.status} ${(await response.text()).slice(0, 1000)}`);
  return response;
}
async function log(id) {
  const text = await (await api(`/api/experimental/session/${id}/log?follow=false`)).text();
  return text.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5).trim()));
}
try {
  await start();
  const session = (await (await api("/api/session", { title: "Native retention probe", location: { directory: project } })).json()).data.id;
  // Plugin/provider registration is asynchronous; wait on the client, not inside the host.
  const providerDeadline = Date.now() + 30000;
  while (true) {
    const providers = await (await api("/api/model")).json();
    if (JSON.stringify(providers).includes('"probe"')) break;
    if (Date.now() > providerDeadline) throw new Error("Local fixture model did not become available");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await api(`/api/session/${session}/prompt`, { text: "Complete this technical execution", delivery: "queue" });
  await api(`/api/experimental/session/${session}/wait`, {});
  const before = await log(session);
  assert(before.some(event => event.type === "session.execution.started"));
  assert(before.some(event => event.type === "session.execution.succeeded"));
  const events = before.filter(event => event.type !== "log.synced");
  assert(events.length > 0); assert(modelCalls > 0);
  await stop(); await start();
  const after = await log(session);
  assert.deepEqual(after.filter(event => event.type !== "log.synced").map(event => [event.id, event.durable.seq]),
    events.map(event => [event.id, event.durable.seq]));
  await stop(); await start(false);
  const defaultSession = (await (await api("/api/session", { title: "Default-off session", location: { directory: project } })).json()).data.id;
  await api(`/api/session/${defaultSession}/prompt`, { text: "Run without native event retention", delivery: "queue" });
  await api(`/api/experimental/session/${defaultSession}/wait`, {});
  const defaultLog = await log(defaultSession);
  assert.equal(defaultLog.filter(event => event.type !== "log.synced").length, 0);
  await stop(); await start();
  const gapLog = await log(defaultSession);
  assert.equal(gapLog.filter(event => event.type !== "log.synced").length, 0,
    "Enabling persistence cannot reconstruct earlier payloads");
  await writeFile(path.join(root, "evidence.json"), JSON.stringify({ session, defaultSession, modelCalls, before, after, defaultLog, gapLog }, null, 2));
  console.log(`PASS retained payloads/IDs after restart; default off and unrecoverable historical gap confirmed: ${root}`);
} finally {
  await writeFile(path.join(root, "server.log"), output);
  await stop(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve));
}
