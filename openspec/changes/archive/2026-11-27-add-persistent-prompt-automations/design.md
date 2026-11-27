# Design

## Context

See `proposal.md` for motivation and the capability deltas for the behavior contract. The current package is TypeScript ESM, requires Node >=22, and uses `@opencode/plugin` / `@opencode/schema` 2.3.2 with contract and isolated-host coverage for OpenCode 2.3.2 and 2.4.1.

`src/scheduler.ts` keeps timers and session reservations in maps, uses one next-deadline timeout, and enforces fixed-slot intervals, session cooldown, final owner/revision checks, and conservative admission barriers. `src/opencode-adapter.ts` subscribes before registering tools, inspects session ownership/activity, and submits `ctx.session.prompt({ sessionID, id, text, delivery: "queue", metadata })`. All temporary state currently disappears on unload. Five `timer_*` tools in `src/tools.ts` are session-local.

### Verified integration surface

- Official [server plugin documentation](https://opencode.ai/docs/build/plugins/server): location-scoped setup/cleanup, durable `ctx.storage.get/set/remove/scan`, session APIs, normal queued prompt delivery, and permissions.
- Installed declarations in `node_modules/@opencode/plugin/dist/promise/{plugin,storage}.d.ts`: storage is available on the existing Promise plugin context, not a separate infrastructure dependency.
- Installed plugin declarations for 2.3.2 and 2.4.1: session creation accepts a caller-provided ID, location, title, agent, model, metadata, and permissions; session listing and context reads are available. The full client has additional inbox/message/log APIs, but these are NOT exposed by the supported plugin context. Event subscription provides live events, not durable replay. Recovery must stay within the smaller plugin surface.
- New host operations have not yet been runtime-tested by this exploration. Existing runtime compatibility evidence must not be extrapolated to persistent storage or recovery.
- Read-only registry inspection identifies `cron-parser` 5.10.7 (Node >=18) as a compatible candidate. Its default semantics are not the public contract; the schedule adapter must enforce the specified five-field, day-field, and daylight-saving behavior.

## Goals / Non-Goals

**Goals:** Keep the agent-facing contract small; separate durable recurrence from transient execution; share the proven admission barrier across timers and automations; make uncertain recovery visible instead of duplicating work; retain location isolation and existing timer compatibility.

**Non-Goals:** General workflow/DAG execution, task-specific GitHub logic, durable shell workers, OS scheduler registration, external push notifications, automatic approvals, global scheduling independent of location activation, cross-server distributed locks, or exactly-once downstream side effects.

## Decisions

### 1. Add automations without broadening timer semantics

Keep `StartInput`, timer expiry, five `timer_*` tools, same-session ownership, and timer interruption behavior unchanged. Introduce an automation controller and narrow schedule/storage/target interfaces rather than an `infinite` timer mode. Temporary monitoring and durable routines have different cancellation, ownership, and recovery semantics; mixing them would silently break today's specs and tools.

Suggested module seams:

- `src/automation-schedule.ts`: validation and pure next-occurrence/coalescing calculations.
- `src/automation-store.ts`: versioned JSON records, scope filtering, serialized mutations, and recovery records.
- `src/automations.ts`: definition management, activation/misfire logic, targeting orchestration, and durable lifecycle.
- An extracted shared dispatch coordinator, or an equally narrow extension of the existing reservation implementation in `src/scheduler.ts`: session eligibility, reservations, cooldown, fair selection, and correlated terminal events.
- `src/opencode-adapter.ts`: real storage/session operations, event normalization, recovery inspection, setup, and cleanup.
- `src/tools.ts`: existing timers plus separately described automation tools.

These are planned boundaries, not a requirement to manufacture a framework or rewrite the whole scheduler. Existing timer regression tests gate any extraction.

### 2. Use explicit structured tools; let the agent interpret language

Planned inputs:

```text
automation_create:
  prompt, label?, schedule, target, missedPolicy? = "skip"

schedule:
  { kind: "interval", intervalSeconds }
  { kind: "cron", expression, timeZone }

target:
  { kind: "current" }
  { kind: "existing", sessionID }
  { kind: "new-reuse", title? }
  { kind: "new-each-run", title? }

automation_update:
  automationId, non-empty patch of prompt/label/schedule/target/missedPolicy

automation_pause / automation_resume / automation_remove:
  automationId

automation_list:
  no ownership override

automation_targets:
  search?, cursor?, limit? (bounded, default 20, maximum 100)
```

Use `missedPolicy: "skip" | "catch-up-once"`. Tool output follows the existing `{ ok, result }` / controlled `{ ok: false, error }` convention. Runtime validation is authoritative even when JSON Schema prevents most invalid calls.

Creation requires an explicit target. "Here" uses the invocation's session, not client UI focus. The agent uses scoped `automation_targets` and, where needed, normal context-reading tools to resolve a described chat. A candidate list's title/activity is evidence, not proof of a semantic match. Ambiguity must be clarified before mutation. The scheduler only receives a concrete ID; no background LLM chat selector is added.

For natural-language calendar requests, the agent supplies an explicit IANA zone based on a zone stated by the user or clearly established local context; it asks when unknown. Do not make an unexplained implicit UTC choice. The effective response exposes the resolved zone and next occurrence.

### 3. Scope durable definitions by project and plugin location

Ownership is `{ projectID, directory, workspaceID? }`, validated using the invoking session rather than trusting tool inputs. Unlike temporary timers, any session in this location can manage its automations. Targets must have the same validated ownership. This first version does not promise cross-project/worktree routing or a process-wide registry that runs all projects when any location is active.

Use an explicit escaped scope prefix in plugin storage keys even if the host implementation also isolates storage. Example conceptual namespace: `automations/v1/<encoded-scope>/<automationId>`. Never rely on plugin-global storage alone to authorize reads. Host paths must use established platform-aware location identity, not ad-hoc lowercasing.

Store one versioned envelope per automation, containing definition and current recovery state together. Serialize mutations per automation (including management and event-driven writes) inside the one supported server/owner runtime. Use one awaited `set` for each atomic envelope revision; do not claim multi-key transactions or compare-and-swap that `ctx.storage` does not provide. Verify single-value replacement behavior in the real-host tests.

Conceptual persisted fields:

```text
schemaVersion, automationId, owner, createdAt, updatedAt, revision
prompt, label?, schedule (+ interval anchor), missedPolicy
target policy, boundSessionID?, saved new-chat execution selection
enabled, pauseReason?, lastConsumedOccurrence, nextOccurrence
acceptedRunCount, lastOutcome?, lastError?
pendingSetup? / outstandingRun?
```

`outstandingRun` holds occurrence identity, snapshot revision, target session ID, host message ID, phase, and known acceptance/delivery/outcome. Retain bounded diagnostics and the last outcome, not an unbounded duplicate transcript. OpenCode itself retains report chats and their messages.

Unknown schema versions and malformed records are reported and left untouched, never guessed into an enabled job. A storage read failure disables automation admission rather than implying an empty registry. A failed write leaves the last effective definition in place and prevents unrecorded submission.

### 4. Calendar parser behind a deterministic schedule adapter

Use `cron-parser` as the candidate dependency, pinning an evaluated compatible release in the lockfile during implementation. A wrapper accepts exactly five numeric fields with `*`, lists, ranges, and steps; rejects seconds, aliases/macros, and `L/W/#`; canonicalizes Sunday 0/7; and enforces standard OR semantics when both day-of-month and day-of-week are restricted. Do not enable a parser mode that forbids this contract.

Validate ranges and Gregorian date feasibility before accepting the definition. Finding a next occurrence must be bounded: use calendar feasibility checks and a finite search window sufficient for supported yearless Gregorian patterns (including leap years), never an unbounded scan on user input. A valid schedule must yield a future occurrence; evaluation failures return a controlled error.

Persist IANA time zones and interval anchors. Represent occurrences with UTC timestamps plus a local calendar-minute identity for cron. Nonexistent local times are absent; for repeated local times choose the first instance and suppress the second by local occurrence identity. This is enforced by the wrapper and fixtures, not assumed from dependency defaults. Persist consumed occurrence identity/high-water state so backward clock changes and restarts cannot repeat an already consumed slot.

Do not use a repeating async `setInterval` loop. Integrate the next automation deadline with the existing single-deadline style scheduler. Native scheduling handles use `unref` where available so this plugin alone does not keep an otherwise exiting host alive.

### 5. Separate inactive misfires from active busy deferral

At initial creation there are no historical occurrences to catch up. On activation/reload/resume, preserve the recurrence anchor and first reconcile any persisted outstanding run.

- `skip`: advance unadmitted occurrences at or before activation time to the next strictly future slot.
- `catch-up-once`: if there were eligible unconsumed occurrences, make one current-definition run due; after it settles advance beyond all elapsed slots.
- Explicit pause behaves like an inactive period for misfire calculation; it does not reset the anchor. Schedule replacement starts a new schedule rather than catching up the superseded one.
- If runtime stays loaded and a target is busy or the machine sleeps, retain at most one due check. Any additional slots that pass during its deferral or execution are absorbed by that check; on terminal completion calculate the next slot strictly after now.
- Label/prompt/target edits do not silently resume a paused automation. Resume remains explicit and validates target plus outstanding-admission state.

Persist advancement before considering a skipped/consumed occurrence settled. Expose the pending due occurrence separately from the next future nominal occurrence so `automation_list` does not hide deferral.

The alternative "run on every startup" is rejected: the user explicitly chose skipping unless catch-up was requested. Replay of every missed occurrence is also excluded.

### 6. Bind chats once, and make new-chat setup recoverable

`current` and `existing` bind a stable session ID; revalidate owner/existence at configuration and immediately before submission. Renames, UI navigation, and other chats adopting the title do not retarget the automation.

For `new-reuse`, generate a valid official session ID in advance, persist a setup record containing that ID, then call `ctx.session.create` using it. Record the returned binding before enabling the automation and reporting success. On setup uncertainty, inspect that same ID. Do not create another ID as a fallback. A pending/failed setup is visible as paused and is not an apparently successful routine. Do not recursively delete a possibly user-touched chat to compensate for a later storage failure.

For `new-each-run`, reserve the automation before target creation. Allocate and durably record the intended session ID for the occurrence, then create that session. A later slot cannot create another chat while the current run is outstanding. Skipped slots create nothing. Display a bounded title derived from label/base title and occurrence time; record the latest run target ID in list results.

New chats do not copy a full conversational history. Persist resolved agent/model selections and the configuring session's effective session-level permission rules; verify that creation does not widen permissions and preserves agent policy. Existing chats keep their own selection and restrictions. If a saved model/agent is unavailable, pause with a diagnostic rather than silently switching to a more capable or more expensive alternative.

Deleting or moving a bound chat pauses the definition. Retargeting through `automation_update`, followed by `automation_resume`, repairs it. Fresh-chat runs whose active target disappears follow the same conservative run-resolution rules, without replacing that run's session. Forks do not change any target IDs or create new automations.

### 7. Share admission reservations; retain durable uncertainty

Timers and automations aimed at one session use the same reservation and cooldown. Each automation also has its own outstanding-run gate, independent of session, preventing target changes or fresh-chat policy from bypassing non-overlap. Due jobs are selected fairly with minimum spacing; no broad task worker pool is needed.

Before `ctx.session.prompt`:

1. Reserve the automation and intended target; inspect host state and validate scope.
2. Snapshot prompt/target/revision and allocate a valid host message ID.
3. Persist the preparing run with occurrence and message identity.
4. Revalidate close/cancellation generation, enabled state, revision, target, and reservation after every awaited preparation step.
5. Submit normal queued input carrying automation ID/occurrence/revision metadata. Acknowledgement is acceptance, not completion.

Retain the reservation through matching inbox delivery/cancellation and correlated terminal execution. User activity after an idle check remains protected by queued delivery. Distinguish interruption of unrelated foreground execution from interruption of the delivered automation run; do not use any arbitrary session terminal event as proof of a queued run's completion.

On reactivation, rebuild the session barrier from persisted outstanding runs before scheduling either restored automations or new timers there. Read available `session.context` and observe subsequent live events through the supported plugin API. A matching delivered user message proves delivery, not terminal execution; current `session.outcome` or idle status alone is not proof that this particular input completed. Only a durable terminal result already saved before unload, or newly observed identity-correlated delivery/cancellation and terminal execution, can release the barrier. Without sufficient evidence retain an inspectably unresolved barrier, potentially indefinitely, even if the task actually completed while the plugin was offline. Do not invent inbox/log APIs, add an HTTP client, or resubmit speculatively. Host idempotent prompt identity is useful defense but is not a substitute for this rule.

An execution failure pauses the definition; a proven interruption consumes that run while retaining enabled recurrence. A loss of event subscription stops affected admissions. If the terminal-state storage write fails, retain conservative outstanding state and reconcile on recovery rather than trusting only volatile completion.

Removal with an admitted run retains only an internal bounded recovery tombstone until its target barrier can be released. It does not reappear as a live definition. A single-key envelope marked removed avoids losing recovery state in a non-transactional definition-delete/run-record-write race. Once the handoff is proven terminal, remove the tombstone. Explicit pause/removal never calls session-wide interrupt or cancels unrelated host inbox items.

### 8. Preserve setup and cleanup ordering

Subscribe before exposing tools. Load/validate only this location's persisted records, establish recovery barriers, and then enable deadline evaluation. Temporary timers start empty. Register timers and automation tools once per effective plugin location.

On cleanup mark closed and cancel local timeouts before disposing registrations and aborting event consumption. Prevent late callbacks from scheduling work or overwriting newer revisions. Do not wait for an agent report to finish and do not erase saved definitions or run records. Reload follows the same activation/misfire/recovery path as restart.

## Risks / Trade-offs

- [Stopping a UI is not necessarily stopping its server] -> Document the server-and-active-location boundary prominently; no promise that closing a window disables schedules.
- [Only active locations run their routines] -> State this limitation explicitly; a global plugin entry is not a daemon that eagerly activates every project.
- [Storage has no documented transaction/CAS surface] -> One envelope per automation, serialized in-process writers, fail-closed admission, real-host atomic replacement tests; multiple servers are outside the guarantee.
- [Crash between host action and persisted acknowledgement] -> Preallocate session/message IDs, persist intent before host mutation, reconcile conservatively, and expose unresolved status instead of duplicate side effects.
- [Cron libraries differ in daylight-saving and day-field behavior] -> Public semantics live in a wrapper with explicit DST/day-field fixtures rather than in library defaults.
- [Unattended execution may wait for approval or credentials] -> Preserve permissions and give setup examples; scheduling never grants access.
- [Repeated reports consume tokens and grow history] -> Existing native compaction remains available; report cadence is explicit and per-session admission remains bounded.
- [Same-chat reports use changing conversational context] -> Preserve that deliberate choice; reusable dedicated and fresh-per-run policies give alternatives without silently resetting a target.
- [Removing a routine cannot retract input already accepted by OpenCode] -> Return the existing style of cancellation warning and keep a recovery barrier until proven resolved.

## Migration Plan

No conversion of current timer state is needed or permitted. Add versioned automation storage while keeping existing timer inputs, outputs, and lifecycle tests intact. Update bilingual docs to distinguish the two capabilities and retain compatibility caveats.

During explicit implementation, run typecheck, deterministic tests, build, package checks, and isolated 2.3.2/2.4.1 host tests. Test persistence by stopping and starting isolated hosts, never the user's shared server. Record OpenCode/OpenChamber smoke evidence without claiming unavailable environments passed.

Rollback to the old plugin stops automation execution because that version does not consume automation storage. Saved JSON records remain dormant and are not automatically deleted; re-enabling the new version reapplies misfire/recovery rules. Already admitted OpenCode input can still execute. Package publication, changing the user's plugin configuration, and restarting shared services require separate authorization.
