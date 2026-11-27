# Development and API evidence

## Verified contracts

`test/api-contract.test.ts` compiles the actual published `@opencode/plugin` types for 2.3.2 and an npm alias of 2.4.1. It checks session get/prompt, explicit queued delivery, tool registration/invocation identity, event subscriptions and `event.data.sessionID` / `event.data.inboxID`, and asserts the plugin session domain has no inbox member. Official message IDs come from `SessionMessage.ID.create()` in the explicitly declared `@opencode/schema` dependency, not from a guessed format.

Relevant upstream release sources:

- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/plugin.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/tool.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/adapter.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/client/src/promise/generated/types.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/session-message.ts
- https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/promise/plugin.ts

The Promise adapter in 2.3.2 does not forward optional request signals for session methods. Do not depend on aborting `session.wait`, and do not invent `ctx.session.inbox.cancel`. Runtime integration remains a separate release gate; compiling these contracts does not certify a running OpenCode/OpenChamber environment.

## Commands

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm pack --dry-run` from the repository root. Unit fixtures provide fake clocks, deterministic IDs and deferred host promises. No unit test needs credentials or a running OpenCode service.

The official plugin dependencies currently contain moderate npm audit findings; the test runner was updated to remove the critical findings of its older version. Do not use forced dependency upgrades that break the verified API matrix.

## Automation recurrence contract

The schedule module is being implemented for persistent automations; this section does not claim that the complete automation tool/runtime integration has already shipped. Temporary `timer_*` inputs and lifetime remain unchanged.

Calendar inputs require five fields: **minute hour day-of-month month day-of-week**, plus an explicit IANA `timeZone`. Numeric values, `*`, comma-separated lists, ranges, and `/` steps are supported. Sunday is 0 or 7. If both day fields are restricted, either matching selects a date (OR). Seconds, macros such as `@daily`, names, and `L`, `W`, or `#` extensions are rejected. Impossible dates are rejected with bounded evaluation; leap-day schedules remain valid even across a non-leap century.

For natural-language requests, resolve a zone explicitly stated by the user or clearly established local context; ask when unknown. Do not guess UTC. Store the resolved zone so later machine-default-zone changes do not alter the schedule.

Examples verified in `test/automation-schedule.test.ts`:

- `0 9 * * 1-5`, `Europe/Berlin`: weekday 09:00; Friday 2026-03-27 at 08:00 UTC advances to Monday 2026-03-30 at 07:00 UTC.
- `*/15 9-17 * * 1-5`, `UTC`: every 15 minutes during the listed weekday hours; 2026-11-27 at 12:00 UTC advances to 12:15 UTC.
- `0,30 13 * * *`, `UTC`: at 13:00 and 13:30; 2026-11-27 at 12:00 UTC advances to 13:00 UTC.
- `0 9 1 * 1`, `UTC`: first of each month **or** Monday; 2026-03-28 advances to Monday 2026-03-30 at 09:00 UTC.
- `30 2 * * *`, `Europe/Berlin`: missing spring 02:30 is skipped, not shifted to 03:30. On the 2026-10-25 rollback it runs at the first 02:30 (00:30 UTC), never again at 01:30 UTC.

Recurring intervals use integer seconds at or above the effective minimum spacing (at least 30 seconds). Their persisted anchor defines nominal slots; restart and slow completion do not re-anchor them. A schedule update establishes a new anchor. Consumed-occurrence high water prevents repeats after backward clock changes.

The next occurrence is a **due time**, not a guaranteed execution or answer time. Busy chat execution, shared scheduler spacing, tools, approvals, and model latency can delay the answer. Native permissions still apply.

`cron-parser` is pinned behind validation and calendar correction rather than exposed directly: its default nonexistent-time shifting is not this contract. DST fixtures also cover a half-hour rollback in `Australia/Lord_Howe`. The new parser and its time-zone dependency have no reported findings in the current npm audit; existing official SDK findings remain.

## Automation storage and management

Each automation is one versioned JSON envelope in official plugin storage. Keys use `automations/v1/<encoded-scope>/<automationId>`, with scope encoding project ID, comparable directory, and optional workspace ID. Windows drive/UNC identity follows `@opencode/util/path`; POSIX paths remain case-sensitive. An explicit scope check protects reads and writes even if host storage is plugin-global.

The envelope contains definition/revision, recurrence anchor, target binding, enabled/paused reason, next and pending occurrences, accepted-run count, last outcome, and optional setup/run recovery state. Mutations are serialized per automation and published in memory only after the single-envelope write succeeds. There is no multi-key transaction or cross-server locking claim. Unknown schema versions and malformed records are diagnosed and preserved, never overwritten or activated.

Any chat in the owning project/location can manage the automation; this differs from session-local temporary timers. A pause survives restart. Prompt/label/schedule edits do not implicitly resume it. Resume validates its target and refuses unresolved setup or run state. The default missed policy skips old slots; explicit `catch-up-once` produces one pending occurrence, never a replay series.

List states distinguish `scheduled`, `due`, `checking`, `queued`, `running`, `unresolved`, and `paused`; acceptance is not completion. Bound target, future/pending times, pause reason, counters, and last outcome remain inspectable. A removed definition is hidden, but a recovery tombstone retains any outstanding accepted run until identity-matching terminal evidence allows cleanup. Removal does not interrupt a session or retract admitted input.

Rolling back to a plugin version without automation support leaves these records dormant rather than deleting them. Returning to a supporting version reapplies activation/recovery rules. In SDKs 2.3.2 and 2.4.1, plugin `session.context` and live events are available but inbox/log reads and event replay are not: an offline outcome that cannot be proved remains visibly unresolved, potentially indefinitely. Tests in `automation-store.test.ts` and `automation-management.test.ts` cover scope, pagination, persistence failure, management transitions, state snapshots, and tombstones.

## Automation target selection / Zielauswahl

The agent resolves natural-language targets at setup, not on every occurrence. A described chat must have a uniquely supported match; when two chats plausibly match, ask the user which one. Candidate listing is bounded and scoped to the owning project/location. A title or an active state alone does not prove which deployment is meant. Never silently choose the first result or a foreign worktree.

- **Here / hier / dieser Chat:** `{ "kind": "current" }` binds the invoking session ID, not whichever chat the UI later displays.
- **In the deployment chat / in dem Chat, wo das Deployment läuft:** inspect scoped candidates, clarify ambiguity, then use `{ "kind": "existing", "sessionID": "<resolved-id>" }`.
- **In a new chat / im neuen Chat:** `{ "kind": "new-reuse", "title": "My PRs / Meine Pull Requests" }` creates one target and reuses it after later runs and restarts.
- **A new chat every time / jedes Mal ein neuer Chat:** `{ "kind": "new-each-run" }` explicitly selects distinct targets for reserved runs. Skipped occurrences create no chat; unresolved runs block further creation.

Ein beschriebenes Ziel wird einmal eindeutig aufgelöst und gespeichert. Bei mehreren passenden Chats fragt der Agent nach. Umbenennen, Chatwechsel und Forks ändern die gespeicherte Zuordnung nicht. Wird das Ziel gelöscht oder in einen anderen Standort verschoben, pausiert die Automation sichtbar; sie erstellt keinen stillen Ersatz. Neu zuordnen und anschließend ausdrücklich fortsetzen repariert den Zeitplan.

New targets retain the configuring selection and restrictions without copying the full history; existing targets retain their own context. Target creation stores the intended official session ID first. An uncertain result is inspected using that same ID instead of allocating another chat, and no potentially user-touched target is deleted as compensation.

## Automation runtime eligibility

Only a running OpenCode server **and the owning active plugin location** can execute a stored automation. A globally configured plugin does not eagerly activate every project. Closing a UI window or displaying another chat does not necessarily stop its server or location. No OS job or separate service is created; scheduler timeouts are unreferenced so they do not keep the host alive solely for scheduling.

On activation/reload/resume, default `skip` selects the next strictly future slot: a weekday Berlin 09:00 report started at 10:00 on Friday 2026-11-27 waits until Monday 09:00. Explicit `catch-up-once` makes at most one current-state report due after any number of inactive missed slots. If the runtime stays loaded during standby or busy agent work, elapsed slots instead coalesce into one due check. The next slot after completion remains nominal and strictly future.

Timers and automations aimed at one session share admission exclusion and the effective minimum spacing (at least 30 seconds after completion). Fresh-chat routines also have their own outstanding-run gate. Queued host acceptance is not completion. Busy/unknown state defers admission; queue delivery protects foreground work that starts after the idle inspection.

**Stop a running chat** interrupts that execution, not its saved automation: a proven interrupted automation occurrence is consumed and later nominal slots remain enabled. Temporary timers in the interrupted session still stop. **Pause an automation** persistently prevents future admissions; **remove** deletes the live definition but cannot retract already admitted input. Execution errors pause without an immediate retry. Uncertain old admissions remain visibly unresolved instead of rerunning, including with catch-up enabled.

The eligibility, offline morning, explicit catch-up, busy/standby coalescing, update/removal races, mixed scheduler spacing, and interruption rules have deterministic coverage in `automations.test.ts` and `scheduler-external.test.ts`; runtime-host verification remains a separate gate.

## Automation recovery diagnostics

Use `automation_list` from another chat in the owning location to inspect an unresolved target. The stored `run` includes occurrence, revision, target session, message ID, phase, and acceptance/delivery flags. `unresolved` means the plugin cannot prove the old outcome; it does not mean the task was never executed. Do not reset the record or resubmit the same occurrence just because the session is idle. A matching new cancellation or live delivery followed by terminal execution can resolve the barrier. Offline completion without this evidence can remain gated indefinitely.

`target-unavailable` means the selected chat was confirmed deleted or moved out of scope; retarget it and explicitly resume. `user-paused` persists over restart. `execution-error`, `target-creation-error`, or `setup-unresolved` retains a bounded diagnostic and does not trigger an immediate retry. Storage errors prevent unrecorded admission. A removed definition with outstanding input remains an internal recovery tombstone until proven terminal; already admitted input can still execute.

Closing a UI is not equivalent to stopping the OpenCode server or unloading its owning location. No separate service wakes OpenCode. The isolated 2.4.1 fixture in `automation-real-host.test.ts` demonstrates retained pause/outcome state, empty temporary timers, and no duplicate accepted report after restart. This is loopback fixture evidence, not live PR-provider access or UI certification.
