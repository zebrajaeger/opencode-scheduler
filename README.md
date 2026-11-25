# @zebrajaeger/opencode-scheduler

Bounded, same-session prompt scheduling for OpenCode agents. Real-server integration and interactive client smoke checks are verified for the versions below.

Repository: https://github.com/zebrajaeger/opencode-scheduler

License: [MIT](LICENSE). Maintainers: see [public release setup](docs/releasing.md)
and [release verification](docs/release-verification.md).

## Development

Use Node.js 22 or newer and npm:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

The package builds to an ESM server-plugin entry at `dist/index.js`. No publication is performed by these commands.

## Compatibility

OpenCode **2.3.2 and 2.4.1** are verified with the published API contracts and an isolated real-server integration suite on Windows x64. Interactive smoke checks passed with **OpenCode Web/server 2.4.1** and **OpenChamber Web 2.8.0** on Windows x64. OpenCode V1, other versions and other operating systems are unverified. See [verification results](docs/verification.md).

## Installation

This package is not published yet. After publication, enable it globally in
`~/.config/opencode/opencode.jsonc`, or for a project in `opencode.jsonc` or
`.opencode/opencode.jsonc`:

```json
{
  "plugins": ["@zebrajaeger/opencode-scheduler"]
}
```

For a specific published version, use
`"@zebrajaeger/opencode-scheduler@0.1.0"` instead (example version; publication is
not yet verified). OpenCode retrieves the public package and its dependencies
internally: no manual clone or `npm install` is required, but this is not a
download-free runtime. Normal configuration trust and permissions still apply.

For local development, run `npm ci` and `npm run build`, then configure the
absolute path to this **package directory**, not `dist/index.js`:

```json
{
  "plugins": ["C:/ws.inc/opencode-scheduler"]
}
```

Relative paths resolve from the configuration file. Configure the package once
per effective location; do not mix multiple versions, a local directory, and the
published package for the same plugin identity. Global and project plugin arrays
are processed in precedence order rather than simply replacing each other.
Unwatched local dependencies can require restarting OpenCode; any restart loses
in-memory timers. Do not restart a shared service containing important active work
just to test this package; use an isolated test environment.

## Configuration

The plugin accepts these options:

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

The lifetime is measured from timer creation. Minimum spacing cannot be less than
30 seconds. See [development and API evidence](docs/development.md).

## Agent tools and examples

The five tools are registered by the server plugin.
Ask the agent in ordinary language, for example:

- “Check in two minutes whether the container has started.”
- “Give me test status every five minutes, for at most half an hour.”
- “List my active timers.”
- “Change the status interval to ten minutes.”
- “Stop that monitoring timer.” / “Stop all timers in this session.”

`timer_start` takes `mode` (`once` or `repeat`), `prompt`, optional `label`,
`delaySeconds`, `intervalSeconds`, and `maxLifetimeSeconds`. Once requires a delay;
repeat requires an interval and defaults its first delay to that interval.
`timer_list` and `timer_stop_all` take no arguments. `timer_stop` and `timer_update`
use an exact `timerId`; update accepts prompt/label/timing/lifetime changes but
cannot change mode or ownership. The agent lists timers when a reference is ambiguous.

All timing uses whole seconds. Maximum lifetime defaults to one hour, measured
from original creation including busy time. Updating only an interval does not
extend expiry. An explicit lifetime update also remains relative to creation.
Tools return JSON with `ok` and `result`, or `ok: false` and an `error` with stable
`code` and bounded `message`. Listed records expose scheduled, deferred, in-flight,
or disabled status, accepted run count, schedule, expiry and last error. Accepted
run count does not mean a downstream task completed successfully.

Stopping timers prevents new submissions, but a submitted/accepted OpenCode prompt
can still execute. No tool interrupts unrelated agent activity.

## Architecture and timing limits

A location-local in-memory scheduler keeps timer records and one admission gate
per session. It uses one next-deadline timeout plus bounded acknowledgement
watchdogs, not an async setInterval loop. The thin host adapter obtains existing
session information and uses the official `session.prompt` with `delivery: "queue"`.
It does not create sessions, switch models, interrupt work, or connect to an LLM.

A due time is not a guaranteed answer time. Foreground tools and active agent
executions defer checks; genuine background processes whose initiating tool has
returned do not block an otherwise idle session. Start tests in the background
and let the scheduled prompt inspect their output with the agent's normal tools.

At most one scheduler handoff is pending or executing per session, even across
different timers. The gate stays held after admission until matching delivery and
terminal execution evidence arrive. Every completed check starts a cooldown of
at least the configured minimum spacing. Other sessions can progress independently.
Recurring timers use fixed nominal slots; missed intervals collapse to one check,
and the following slot is strictly in the future. No catch-up burst occurs after
long work or sleep, and timers expire even while waiting or executing.

Admission/execution errors disable the associated timer rather than retrying in
a loop. An explicit valid update can rearm a resolved recurring timer. Ambiguous
or stalled admission keeps a conservative session gate: list shows a diagnostic,
but neither stopping that timer nor creating another one bypasses potentially
accepted input. An already submitted one-shot cannot be rearmed. Event-stream
failure disables dispatch rather than guessing that every session is idle.

The plugin cannot retract an accepted Inbox item through the available plugin
session API. Stop, expiry, interruption or unload prevents future local admissions,
but input already handed to OpenCode can still run, including after another wake
or plugin reload. This boundary is deliberate; the plugin never interrupts the
whole session to cancel a monitoring prompt.

## Lifecycle, permissions, and OpenChamber

All timer state exists only in this plugin's memory. Unload, reload, service
restart or server exit discards timers; there is no recovery file, database,
daemon, or automatic reinstallation. Cleanup clears owned timeouts, subscriptions
and registrations without waiting for ongoing agent work. Already accepted
OpenCode input is managed by OpenCode, not restored timer state.

`session.execution.interrupted` removes all timers in that session. A normal
successful answer or selecting another chat does not stop them. Deleted sessions
are removed, and moving a session into another project/location stops its original
timers; create new timers at the destination. Forks do not inherit timers.
The server can run a timer in a session that is not displayed or has no UI client.

Unattended scheduling does not bypass permissions. If the scheduled prompt invokes
a tool requiring approval, OpenCode will still request approval and execution can
remain blocked until a user responds. Configure suitable permissions through
normal OpenCode policy; this plugin never grants them automatically.

OpenChamber uses the OpenCode server plugin, so no OpenChamber extension or panel
is needed. Enable the plugin in the server's effective OpenCode configuration.
Changing chats is not stopping the service. Avoid testing a service restart on
your working sessions. OpenChamber compatibility is verified by the recorded
manual smoke checks for Web 2.8.0 with OpenCode 2.4.1, not by unit tests alone.

Ownership and serialization guarantees apply within one server and plugin
location. Separate OpenCode server processes do not coordinate their in-memory
timers. V1 and unverified V2 versions are not advertised as supported.

The [interactive smoke procedure](docs/smoke-test.md) covers OpenCode and
OpenChamber; its recorded execution is complete for the versions above. Results are in
[verification status](docs/verification.md).
