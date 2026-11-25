# Design

## Context

See `proposal.md` for motivation and the three capability specs for the behavior contract. The repository currently has no implementation or existing specs. Package identity is `@zebrajaeger/opencode-scheduler`; upstream repository is `git@github.com:zebrajaeger/opencode-scheduler.git`.

Exploration verified the official V2 Promise plugin API against release tags `v2.3.2` and `v2.4.1`. These are implementation/test targets, not an already proven runtime compatibility range. V1 examples using `@opencode-ai/plugin`, `promptAsync`, or legacy hook objects are not applicable.

### Source-verified integration surface

- [Plugin Context and cleanup](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/plugin.ts): `Plugin.define`, `setup`, returned cleanup, `ctx.app`, `ctx.location`, `ctx.tool`, and `ctx.session`.
- [Tool registration](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/tool.ts) and [tool invocation identity](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/tool.ts): `ctx.tool.transform(editor => editor.add(...))`; execution context supplies `sessionID`, not directory. Capture project/location from initialization and validate against the session.
- [Session API types](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/client/src/promise/generated/types.ts): `get({ sessionID })`, `prompt({ sessionID, id?, text, metadata?, delivery?, resume? })`, returning an admitted inbox item.
- [Plugin SessionDomain](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/session.ts): includes `get`, `prompt`, `context`, and `wait`; does NOT expose the network client's inbox list/cancel API or active-execution endpoint.
- [Session admission](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/session/session.ts): validates the existing session, resolves its location services, admits input, and wakes unless `resume === false`. Preparation occurs before admission and can fail; acceptance is not completion.
- [Public events](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/session-event.ts): `session.deleted`, `session.inbox.enqueued`, `session.inbox.delivered`, `session.inbox.cancelled`, `session.execution.started`, `session.execution.succeeded`, `session.execution.failed`, `session.execution.interrupted`. Confirm exact envelope fields through exported types, never a legacy payload assumption.
- [Session info](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/session.ts): `location`, `projectID`, `time.busy`, `time.idle`, and terminal `outcome` support initial state reconciliation. Timestamps are hints, not an atomic lock; equal/ambiguous transitions must be treated conservatively.
- [Plugin event subscription](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/event.ts) and [adapter](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/adapter.ts): typed async subscription accepts a signal and unload closes its iterators. Session-method adaptation in this release accepts only input at runtime, despite inherited optional RequestOptions types; it does not forward AbortSignal.
- [Per-location activation and cleanup](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/plugin.ts): plugin instances are location-scoped, not per session, and are disposed on unload/replacement.
- [Execution coordinator](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/session/run-coordinator.ts) and [runner](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/session/runner/llm.ts): one agent execution per session, coalesced wake-ups, and queue delivery at safe work boundaries. This does not itself bound the number of admitted prompts.

## Goals / Non-Goals

**Goals:** Keep one location-local in-memory scheduler with a small testable core; preserve session context and permissions; make timing, expiry, cancellation, and failure states observable through the five tools.

**Non-Goals:** Durable scheduling, cron/calendar expressions, standalone agent sessions, execution of shell commands by the scheduler, task-completion inference, automatic approvals, GUI panels, cross-session management, V1 adapters, or full cancellation of already accepted inbox input.

## Decisions

### 1. Small core and official plugin adapter

Use TypeScript ESM with a pure scheduling/state module, a thin OpenCode host adapter, and tool schema/description definitions. Suggested files are `src/scheduler.ts`, `src/opencode-adapter.ts`, `src/tools.ts`, and `src/index.ts`; avoid a framework of pluggable backends, durable stores, worker pools, or generic event sourcing.

The core receives time/timer functions, ID generation, and the narrow host operations it needs. Unit tests can inject deterministic time and host promises. Use a mainstream fake-timer test runner (Vitest as a development dependency), TypeScript, and compiled ESM output. Runtime dependencies are the official `@opencode/plugin` and only an official schema package if required for valid message-ID generation; no scheduler library or language parser is necessary.

Keep tool registration in the server plugin. `options.codemode: false` is an available choice for making these small management tools directly discoverable. Tool descriptions contain use cases, argument units, default first run, finite lifetime, ownership, and stop/admission limits. No AGENTS.md edits are part of implementation.

### 2. Explicit tool contract and defaults

- `timer_start`: `{ mode: "once" | "repeat", prompt, label?, delaySeconds?, intervalSeconds?, maxLifetimeSeconds? }`. Reject interval for once; repeat requires interval. The first repeat delay defaults to interval.
- `timer_list`: empty input, current-session scope only.
- `timer_stop`: `{ timerId }`, returning whether a live record was removed and an accepted-input warning when applicable.
- `timer_stop_all`: empty input, returning removed count and the same cancellation limitation.
- `timer_update`: `{ timerId, prompt?, label?, delaySeconds?, intervalSeconds?, maxLifetimeSeconds? }`, with at least one actual change. Mode cannot change. For repeat, an explicit delay determines next due time; otherwise an interval change resets it from now. A delay update for once reschedules it from now. Updating prompt/label/lifetime alone preserves the due time.

Use JSON-compatible structured results encoded using the official tool result contract. Return stable error categories and readable explanations without throwing unhandled tool errors. List statuses are `scheduled`, `deferred`, `in-flight`, and `disabled`; disabled records expire normally and a valid explicit update rearms them. A completed one-shot is removed; a failed/ambiguous one-shot is not automatically reissued. Reject rearming a one-shot whose acceptance is established or unresolved.

Options: `defaultMaxLifetimeSeconds` defaults to 3600 and `minimumSpacingSeconds` defaults to 30. They are installation defaults, not additional timer tools. Spacing cannot be configured below 30. Tool-specified lifetime overrides the default and is always relative to original creation, never sliding with a new interval. Validate safe integers, timestamp arithmetic, prompt non-emptiness, and first due before expiry. Changes are validated before atomic application.

The 30-second value is a conservative initial design default, not a prior user-selected numeric value. A deliberately longer delay/lifetime remains possible. Finite lifetime plus session-wide spacing bounds unattended prompt frequency; do not add quotas or automatic extension machinery for this version.

### 3. Ownership and minimal state

Each timer has an opaque generated timer ID, immutable owner `{ sessionID, projectID, location }`, creation/expiry times, mode, label/prompt, interval, nominal first/next due times, definition revision, status, accepted run count, and bounded last error. No user-supplied session/project field is accepted.

Each participating session has execution state, cancellation generation, at most one admission/execution reservation, and next allowed dispatch time. The reservation is separate from live timer records: removing a timer must not release a prompt already accepted by OpenCode and let another timer overlap it.

No module-global timer map is shared between plugin instances. Global installation creates a scheduler for each active location. Compare owner context against fresh session info before admission; stop on incompatible move instead of silently following to a new location. Forked sessions do not inherit timers. Do not persist via `ctx.storage`, files, or a database.

### 4. Event-driven busy observation, no indefinite wait calls

Subscribe to relevant events during setup before any tools become usable. Maintain per-session execution state from start/terminal/status observations. Initialize or reconcile an unknown owner's state with `get` and its execution timestamps; events observed during a fetch take precedence over a stale snapshot. Unknown or contradictory state defers dispatch. Do not clear a reservation merely because an idle status arrived without its matching delivery/terminal evidence.

Avoid a long-lived `ctx.session.wait` promise: the verified adapter ignores the optional request signal, so unload cannot reliably cancel that wait. Avoid polling full message histories, guessing idle from assistant text, or relying on `experimental.idle`, which skips interruption/failure paths. A minimal session-info recheck at due eligibility points is sufficient; test timestamp edge cases and event races.

Native event notification plus a bounded recheck (no faster than the effective spacing) handles deferred state without spinning. Event subscription failure disables further dispatch for that plugin instance and reports a diagnostic rather than assuming every session is idle.

### 5. One next-deadline timeout, session-local dispatch gates

Maintain one plugin-owned next-deadline `setTimeout`, recomputed on tool changes, expiry, terminal events, and checks. Consider both next due and expiry deadlines, including disabled/in-flight records. Clamp long sleeps to the JavaScript timeout range. A due-but-busy timer must not repeatedly rearm a zero-delay timeout; wake on events or the bounded recheck. Independent session admissions must not be awaited behind one slow session.

Select due timers by effective due time then creation/ID tie-breaker. Reserve the session synchronously before any asynchronous host operation. Re-read timer revision, existence, expiry, cancellation generation, current owner, and busy state immediately before sending. Never let `setInterval(async ...)` enqueue overlapping callbacks.

Use `ctx.session.prompt({ sessionID, id, text: prompt, delivery: "queue", metadata: { ...scheduler provenance... } })`. Let default resume wake the session; never call interrupt or override agent/model. Generate a valid message ID through the actual official ID type/helper rather than guessing its format, and install reservation correlation before invoking prompt so fast events cannot outrun it.

Queued delivery is the final race safety net if user work begins between the idle observation and admission. The scheduler does not promise atomic idle-only admission. It promises no steering, no independent parallel agent run, and at most one scheduler handoff per session.

### 6. Admission and execution are separate phases

Track the generated message/inbox ID through enqueue/delivery/cancel events and subsequent terminal execution. Buffer matching early events in the reservation so completion before the prompt promise resolves is handled exactly once. Metadata is diagnostic provenance, not a guarantee of exclusive execution ownership: a session execution may include user input or background notices.

After confirmed delivery plus terminal execution, release the matching reservation and begin session cooldown. Count accepted runs once, not on each timer tick. A recurring timer advances to the next strictly future nominal slot after completion, also respecting cooldown; expired/removed timers never return. Multiple missed slots remain one due flag. A one-shot is never admitted twice.

If interruption occurs, remove every timer in that session and invalidate local callbacks. For a normal failed execution after confirmed delivery, disable the associated recurring timer and keep a bounded diagnostic. Do not remove unrelated timers for a mere failure; they remain gated until safe terminal/cooldown state. If failure occurs before confirmed delivery, accepted input may remain pending, so preserve a conservative barrier until its fate is established.

### 7. Cancellation and error honesty

`timer_stop`, `timer_stop_all`, expiry, deletion, and interruption cancel locally owned future work. They do not call the public network inbox API through an invented `ctx.session.inbox` member, nor construct a separate authenticated client using undisclosed connection details.

Once prompt submission has entered OpenCode there is an unavoidable race: its preparation/admission may finish despite local cancellation. An accepted queued item can outlive the plugin's in-memory timer and might later execute, including after reload or another wake. State this in tool results and README. Strong retraction of accepted inputs is outside the first-version contract; do not claim that clearTimeout retracts them.

Use bounded error text and no blind automatic retries. Known pre-admission validation errors disable the timer and release its reservation if non-acceptance is established. Matching enqueue/delivery events can establish acceptance despite a rejected acknowledgement. A stalled or otherwise ambiguous call keeps a session-local barrier; local watchdog diagnostics must not release it or retry the same prompt. Other sessions continue. Explicit rearming is allowed only after the prior handoff is conclusively resolved.

Cleanup marks closed first, increments cancellation generations, clears timer/deadline/diagnostic state, aborts and closes the event consumer, and disposes registrations through the official registration contract. Do not await foreground agent completion or assume that passing signal cancels plugin session APIs. Catch all late promise rejections and guard every late mutation; report rather than hide unresolved host work. Host-controlled operations already in progress may settle after cleanup, but cannot restart the scheduler.

### 8. Compatibility, installation, and documentation

Use standard V2 global/project `plugins` configuration and an ESM server entry. Document the scoped package and repository, exact installation examples verified against target releases, option syntax, duplicate activation considerations, and a restart requirement where relevant. Do not alter repository remotes or publish without separate authorization.

OpenCode 2.3.2 and 2.4.1 are the initial verification matrix; do not imply every intermediate/newer minor or V1 is supported. Check both compilation/API adaptation and runtime behavior. OpenChamber's [shared service](https://github.com/openchamber/openchamber/blob/200587b00662bcea7d65ce216373c79a94cbcb07/packages/web/server/lib/opencode/shared-service.ts) and [managed plugin configuration](https://github.com/openchamber/openchamber/blob/200587b00662bcea7d65ce216373c79a94cbcb07/packages/web/server/lib/opencode/managed-plugin-config.ts) support ordinary V2 plugins; no OpenChamber extension is required. Record the actual UI/service versions used in smoke tests.

Native automations in 2.4.1 were considered but rejected for this version: they are unavailable through the 2.3.2 plugin context, explicitly send `steer`, and expose only create/list/delete in the plugin domain. An external OS scheduler solves a different persistence problem and violates the chosen in-memory/no-infrastructure boundary.

## Risks / Trade-offs

- [30-second minimum and idle deferral reduce punctuality] -> Document due time versus execution/answer time and use true background processes for status checks.
- [Background job completion can race with monitoring] -> Queue prompts, preserve native execution coordination, and never infer process outcome in the scheduler.
- [Idle observation is not atomic; same-millisecond events can be ambiguous] -> Favor events, defer unknown state, and use queued delivery as the last safety boundary.
- [Accepted input cannot be retracted through this plugin surface] -> Keep one handoff per session, disclose residual accepted input, and avoid speculative queueing.
- [Plugin adapter does not forward session-method AbortSignal] -> No unbounded session wait tasks; guard late callbacks and do not promise host-operation cancellation.
- [Conservative barrier can stall one session after an ambiguous failure] -> Expose disabled/error state; favor no duplication over liveness, while keeping other sessions independent.
- [Unattended tools may need approval] -> Respect native permissions and document prerequisites instead of auto-approving.
- [Location disposal or server restart loses timers] -> Make the lifetime explicit; no silent recovery or extra daemon.
- [In-memory isolation does not coordinate separate OpenCode server processes] -> Scope guarantees to one server/plugin location and document that multiple servers must not independently schedule the same intent.
- [Source compatibility is not runtime certification] -> Gate release claims on version-specific integration and recorded manual smoke results.

## Migration Plan

No existing data or functionality needs migration. During implementation create and build the package, verify tests and package contents locally, then test installation in isolated global/project configurations. Remove the plugin configuration to roll back; unloading discards timers but does not erase already accepted OpenCode messages. Publication is a separately authorized release action, not an implementation task.
