import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

const tempRoot = process.env.SCHEDULER_TEST_TMP ?? "C:/Users/Lars.Brandt/AppData/Local/Temp/opencode";

test("local Node SQLite commits, rolls back, and reopens plugin-owned storage", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const root = await mkdtemp(path.join(tempRoot, "scheduler-sqlite-node-"));
  const file = path.join(root, "qualification.sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TABLE qualification (id TEXT PRIMARY KEY); BEGIN IMMEDIATE; INSERT INTO qualification VALUES ('committed'); COMMIT;");
    db.exec("BEGIN IMMEDIATE; INSERT INTO qualification VALUES ('rolled-back'); ROLLBACK;");
  } finally { db.close(); }
  const reopened = new DatabaseSync(file);
  try {
    expect(reopened.prepare("SELECT id FROM qualification ORDER BY id").all().map(row => row.id)).toEqual(["committed"]);
  } finally { reopened.close(); }
});

// Runtime qualification only. No model/provider calls, user config, or shared server.
test.runIf(process.env.SCHEDULER_SQLITE_HOST === "1")("qualify built-in SQLite inside an isolated OpenCode plugin host", async () => {
  const root = await mkdtemp(path.join(tempRoot, "scheduler-sqlite-host-"));
  const project = path.join(root, "project");
  const config = path.join(root, "config", "opencode");
  const plugin = path.join(root, "probe-plugin");
  const report = path.join(root, "runtime-report.json");
  await Promise.all([project, config, plugin].map(dir => mkdir(dir, { recursive: true })));
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ name: "scheduler-sqlite-qualification", type: "module", main: "index.js" }));
  await writeFile(path.join(plugin, "index.js"), `
import { writeFile } from "node:fs/promises";
export default { id: "scheduler.sqlite-qualification", async setup() {
  const report = { node: process.version, bun: process.versions.bun, bindings: {} };
  for (const specifier of ["node:sqlite", "bun:sqlite"]) {
    try {
      const mod = await import(specifier);
      const file = ${JSON.stringify(path.join(root, "host-"))} + (specifier === "node:sqlite" ? "node" : "bun") + ".sqlite";
      const db = specifier === "node:sqlite" ? new mod.DatabaseSync(file) : new mod.Database(file);
      db.exec("CREATE TABLE qualification (id TEXT PRIMARY KEY); BEGIN IMMEDIATE; INSERT INTO qualification VALUES ('committed'); COMMIT; BEGIN IMMEDIATE; INSERT INTO qualification VALUES ('rolled-back'); ROLLBACK;");
      db.close();
      const reopened = specifier === "node:sqlite" ? new mod.DatabaseSync(file) : new mod.Database(file);
      const rows = reopened.prepare("SELECT id FROM qualification ORDER BY id").all();
      reopened.close();
      report.bindings[specifier] = { supported: true, rows };
    } catch (error) { report.bindings[specifier] = { supported: false, error: String(error).slice(0, 1000) }; }
  }
  await writeFile(${JSON.stringify(report)}, JSON.stringify(report));
} };
`);
  await writeFile(path.join(config, "opencode.json"), JSON.stringify({ plugins: [plugin,
    { package: path.resolve("."), options: { orchestration: { enabled: true, instanceID: "qualification", dataDirectory: path.join(root, "orchestration") } } },
  ] }));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(path|pathext|systemroot|windir|comspec|temp|tmp|programfiles|programfiles\(x86\))$/i.test(key)));
  const binary = process.env.SCHEDULER_OPENCODE_BIN ?? path.join(
    path.dirname(execFileSync("where.exe", ["node"], { encoding: "utf8" }).trim().split(/\r?\n/)[0]!),
    "node_modules", "@opencode", "cli", "bin", "opencode.exe");
  let server: ChildProcess | undefined;
  let output = "";
  try {
    server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: project,
      env: { ...inherited, HOME: root, USERPROFILE: root, OPENCODE_TEST_HOME: root,
        XDG_DATA_HOME: path.join(root, "data"), XDG_CACHE_HOME: path.join(root, "cache"),
        XDG_STATE_HOME: path.join(root, "state"), XDG_CONFIG_HOME: path.join(root, "config"),
        OPENCODE_CONFIG_DIR: config, OPENCODE_PASSWORD: "isolated-sqlite-qualification" },
      stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", chunk => { output += String(chunk); });
    server.stderr?.on("data", chunk => { output += String(chunk); });
    server.on("error", error => { output += String(error); });
    const deadline = Date.now() + 90_000;
    let origin: string | undefined;
    while (Date.now() < deadline) {
      origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (origin) break;
      if (server.exitCode !== null) throw new Error(output.slice(-3000));
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!origin) throw new Error(`Private server did not start: ${output.slice(-3000)}`);
    const response = await fetch(`${origin}/api/session`, { method: "POST",
      headers: { authorization: `Basic ${Buffer.from("opencode:isolated-sqlite-qualification").toString("base64")}`,
        "content-type": "application/json" },
      body: JSON.stringify({ location: { directory: project } }), signal: AbortSignal.timeout(30_000) });
    expect(response.ok, await response.text()).toBe(true);
    const activate = await fetch(`${origin}/api/agent?location.directory=${encodeURIComponent(project)}`, {
      headers: { authorization: `Basic ${Buffer.from("opencode:isolated-sqlite-qualification").toString("base64")}` },
      signal: AbortSignal.timeout(30_000),
    });
    expect(activate.ok, await activate.text()).toBe(true);
    let result: { bindings: Record<string, { supported: boolean; rows?: { id: string }[] }> } | undefined;
    while (Date.now() < deadline) {
      try { result = JSON.parse(await readFile(report, "utf8")); break; } catch { /* Wait for private plugin activation only. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(result, `No probe report: ${output.slice(-3000)}`).toBeDefined();
    let catalogText = "";
    const catalogDeadline = Date.now() + 15_000;
    while (Date.now() < catalogDeadline) {
      const catalog = await fetch(`${origin}/api/plugin?location.directory=${encodeURIComponent(project)}`, {
        headers: { authorization: `Basic ${Buffer.from("opencode:isolated-sqlite-qualification").toString("base64")}` },
        signal: AbortSignal.timeout(30_000),
      });
      catalogText = await catalog.text();
      expect(catalog.ok, catalogText).toBe(true);
      const entries = JSON.parse(catalogText).data as { id: string; state: { status: string } }[];
      if (entries.some(entry => entry.id === "zebrajaeger.opencode-scheduler" && entry.state.status === "active")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await writeFile(path.join(root, "plugin-catalog.json"), catalogText);
    expect(JSON.parse(catalogText).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "zebrajaeger.opencode-scheduler", state: expect.objectContaining({ status: "active" }) }),
    ]));
    for (const binding of Object.values(result!.bindings)) {
      if (binding.supported) expect(binding.rows).toEqual([{ id: "committed" }]);
    }
    console.log(`SQLite runtime evidence: ${report}`);
    console.log(JSON.stringify(result));
  } finally {
    server?.kill();
    await writeFile(path.join(root, "server.log"), output);
  }
}, 120_000);
