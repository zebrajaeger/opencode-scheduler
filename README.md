# opencode-scheduler

![OpenCode Scheduler – scheduled and recurring tasks for OpenCode](docs/banner.png)

[![npm version](https://img.shields.io/npm/v/%40zebrajaeger%2Fopencode-scheduler)](https://www.npmjs.com/package/@zebrajaeger/opencode-scheduler)
[![CI on master](https://github.com/zebrajaeger/opencode-scheduler/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/zebrajaeger/opencode-scheduler/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/npm/l/%40zebrajaeger%2Fopencode-scheduler)](LICENSE)
[![Declared Node engine](https://img.shields.io/node/v/%40zebrajaeger%2Fopencode-scheduler)](package.json)

[Deutsch](README.de.md) | [English](README.md)

Repository: [zebrajaeger/opencode-scheduler](https://github.com/zebrajaeger/opencode-scheduler) · [npm](https://www.npmjs.com/package/@zebrajaeger/opencode-scheduler) · [MIT](LICENSE)

<a id="english"></a>
## English

Bounded one-shot and recurring prompts for OpenCode agents, always in their original session. Ask your agent to check a container later or monitor a background test regularly without interrupting current work.

[Installation](#en-installation) · [Configuration](#en-configuration) · [Examples and tools](#en-tools) · [Compatibility](#en-compatibility) · [Limits and safety](#en-limits) · [Development](#en-development)

<a id="en-installation"></a>
### Installation

The package is public on npm. Enable it globally in `~/.config/opencode/opencode.jsonc`, or for a project in `opencode.jsonc` or `.opencode/opencode.jsonc`:

```json
{
  "plugins": ["@zebrajaeger/opencode-scheduler"]
}
```

For a specific published version:

```json
{
  "plugins": ["@zebrajaeger/opencode-scheduler@0.1.1"]
}
```

OpenCode retrieves the public package and its dependencies internally. No manual clone, `npm install` or npm credentials are required; network access remains necessary. Normal configuration trust and tool permissions still apply.

Configure the plugin once per effective location. Do not mix multiple versions, local package paths and the npm package for the same plugin identity. Global and project plugin arrays are processed in precedence order, not simply replaced. Relative paths resolve from the configuration file.

OpenChamber uses the same OpenCode server plugin; no separate extension or panel is needed. Enable it in the selected server's effective configuration. Do not restart a shared service with important active work just to test installation.

<a id="en-configuration"></a>
### Configuration

Optional plugin defaults:

```json
{
  "plugins": [
    {
      "package": "@zebrajaeger/opencode-scheduler",
      "options": {
        "defaultMaxLifetimeSeconds": 3600,
        "minimumSpacingSeconds": 30
      }
    }
  ]
}
```

All timing uses whole seconds. By default a timer ends **one hour after its original creation**, including waiting and execution time. Minimum spacing is **30 seconds per session across all timers**; it can be increased, never reduced below 30. Explicit `maxLifetimeSeconds` overrides the default.

<a id="en-tools"></a>
### Examples and tools

Ask the agent in ordinary language, for example:

- “Check in two minutes whether the container has started.”
- “Give me test status every five minutes, for at most half an hour.”
- “List my active timers.”
- “Change the status interval to ten minutes.”
- “Stop that timer.” / “Stop all timers in this session.”

No extra AGENTS.md instructions or slash commands are needed. The server registers five tools:

| Tool | Purpose |
| --- | --- |
| `timer_start` | Create a timer with `mode` (`once` or `repeat`), `prompt`, optional `label` and timing arguments. |
| `timer_list` | List your active timers; no arguments. |
| `timer_update` | Update a timer by `timerId`: prompt, label, schedule or lifetime. |
| `timer_stop` | Stop an owned timer by its exact `timerId`. |
| `timer_stop_all` | Stop all timers in this session; no arguments. |

`once` requires `delaySeconds`. `repeat` requires `intervalSeconds`; the first delay defaults to that interval. `maxLifetimeSeconds` bounds lifetime. Mode and ownership cannot change. When a reference is ambiguous, the agent should list timers first.

Changing only the interval does **not** extend expiry. An explicit lifetime update also remains relative to original creation. Timers belong to the calling session, project and location; another session cannot inspect or modify them.

Tools return JSON with `ok` and `result`, or `ok: false` and `error` with a stable `code` and bounded `message`. Listed records show schedule, expiry, status (`scheduled`, `deferred`, `in-flight` or disabled), accepted run count and last error. An accepted run does not mean the downstream task completed successfully.

<a id="en-compatibility"></a>
### Compatibility

- **OpenCode 2.3.2 and 2.4.1:** published API contracts and isolated real-server tests verified on Windows x64, including public npm package 0.1.1.
- **OpenCode Web/server 2.4.1 and OpenChamber Web 2.8.0:** interactive smoke checks passed on Windows x64.
- **OpenCode V1, other versions and other operating systems:** unverified.
- Declared Node requirement: **Node.js >=22**. The Node badge shows the package engine range, not a complete test matrix.

[Verification](docs/verification.md) · [Release evidence](docs/release-verification.md) · [Smoke test](docs/smoke-test.md)

<a id="en-limits"></a>
### Limits and safety

- **A due time is not a guaranteed answer time.** Active agent work and foreground tools defer timers. Real background processes do not block an otherwise idle session once their initiating tool returns. The agent must inspect actual status with its normal tools; elapsed time alone is not evidence.
- Prompts use `delivery: "queue"` in the existing session. History, agent, model, permissions and working context remain intact. No replacement session, plugin-owned LLM request or interruption of unrelated work.
- At most one scheduler handoff is pending or executing per session. Its barrier survives acceptance until matching delivery and terminal execution evidence arrive. Each completed check starts the minimum cooldown; other sessions progress independently.
- Recurrence uses fixed nominal slots. Missed intervals coalesce into one check, not a catch-up burst, including after long work or sleep. The next slot is in the future; expired timers do not restart.
- Admission/execution errors disable the timer instead of looping. A valid explicit update can rearm a resolved recurring timer. Ambiguous or stalled admissions keep a conservative session barrier; stopping and recreating timers cannot bypass it. An already submitted one-shot cannot rearm. Event-stream failure blocks dispatch instead of guessing eligibility.
- **In-memory only:** unload, reload, server restart or exit loses all timers. No recovery file, database or separate background service. Cleanup clears timeouts, subscriptions and registrations without waiting for ongoing agent work.
- `session.execution.interrupted` stops all timers in the interrupted session. A normal answer or switching chats does not. Hidden sessions can continue. Deletion removes timers; moving to another project/worktree requires creating new ones at the destination. Forks do not inherit timers.
- **Permissions remain in force.** A scheduled prompt can wait for required tool approval. The plugin never auto-approves; unattended scheduling does not guarantee unattended execution.
- **Already accepted OpenCode input cannot reliably be retracted.** Stop, expiry, interruption and unload prevent new local admissions, but a submitted prompt can still run, including after reload. The plugin does not interrupt the whole session to remove a monitoring prompt.
- Ownership and serialization apply within one server and plugin location. Separate server processes do not coordinate their timers.

<a id="en-development"></a>
### Developer documentation

Use Node.js >=22 and npm for development:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

These commands do not publish anything. The build produces the ESM entry `dist/index.js` and declarations. For a local installation after building, configure the absolute **package directory**, not a single compiled file:

```json
{
  "plugins": ["C:/ws.inc/opencode-scheduler"]
}
```

Unwatched local dependencies may require restarting OpenCode; this discards in-memory timers. Use an isolated test instance.

Architecture: a location-local scheduler holds timer records and one admission barrier per session. One next-deadline timeout with bounded acknowledgement watchdogs replaces an async `setInterval` loop. A thin host adapter reads session state and uses the official session API.

[Development and API evidence](docs/development.md) · [Scenario audit](docs/scenario-audit.md) · [Release guide](docs/releasing.md)

License: [MIT](LICENSE). These repository READMEs do not update existing immutable npm releases; a new separately authorized release is required for that.
