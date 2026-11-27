# Tasks

All boxes track future implementation or verification; none are completed by writing this proposal. Follow `design.md` and the four capability deltas. Preserve the existing temporary timer contract throughout.

## 1. Schedule representation and deterministic occurrence calculation

- [x] 1.1 Add typed interval/cron schedules and missed-occurrence policies with runtime input validation; verify non-empty prompts, safe integer intervals, minimum spacing, explicit IANA zones, and rejected conflicting fields with unit tests and `npm run typecheck`.
- [x] 1.2 Evaluate and lock the compatible `cron-parser` candidate behind `src/automation-schedule.ts`; verify five-field validation, list/range/step syntax, Sunday 0/7, OR day-field semantics, rejected extensions, and bounded rejection of impossible dates in deterministic tests.
- [x] 1.3 Implement anchored interval and calendar next-occurrence calculation; verify the 08:00/30-minute anchor survives a 09:10 restart, completion does not drift the anchor, and a schedule update establishes a new anchor.
- [x] 1.4 Implement explicit daylight-saving and clock-discontinuity handling; verify `Europe/Berlin` weekday 09:00, absent spring 02:30, first-only autumn 02:30, backward-clock deduplication, and saved-zone independence with timestamped fixtures.
- [x] 1.5 Document supported cron fields, time-zone resolution, day-field convention, DST rules, and occurrence-versus-answer-time limits in development documentation; verify every documented schedule against the schedule fixtures.

## 2. Versioned durable records and management transitions

- [x] 2.1 Add a narrow official-storage adapter and one versioned envelope per automation using an explicit ownership prefix; verify cross-location filtering, platform-aware location identity, storage pagination, and malformed/unknown-version preservation with fake-store tests.
- [x] 2.2 Implement serialized single-envelope create/update writes and effective-state publication after persistence; verify storage-failure rollback and concurrent management/event mutations without claiming multi-key transactions.
- [x] 2.3 Implement persistent enabled/paused state, explicit resume, removal, and recovery tombstones for removed definitions with outstanding runs; verify idempotent pause/removal, invalid resume rejection, no accidental reactivation from edits, and tombstone cleanup only after proven run resolution.
- [x] 2.4 Add bounded list-state representation for definitions, future and pending occurrences, target bindings, pause reasons, accepted-run counts, and last outcomes; verify checking/queued/running/unresolved state is never reported as completed success.
- [x] 2.5 Document storage schema, location ownership, management-from-another-owning-chat, and dormant-data rollback behavior; verify the documented states and namespace examples against adapter and management tests.

## 3. Target resolution and recoverable chat creation

- [x] 3.1 Extend the narrow host adapter with scoped candidate listing and target inspection using installed V2 signatures; verify bounded pagination, ownership validation, transient failures versus confirmed deletion, and no foreign-session disclosure in adapter/contract tests.
- [x] 3.2 Implement invoking-chat and concrete existing-chat target validation/binding; verify navigation, renaming, title reuse, and forks never redirect the bound ID and incompatible project/location targets are rejected.
- [x] 3.3 Implement reusable-new-chat setup with an officially generated, pre-persisted session ID and a recoverable setup phase; verify one chat is created, restart reuses it, uncertain creation inspects that same ID, and later storage failure causes no silent duplicate or destructive compensation.
- [x] 3.4 Implement explicit fresh-chat-per-run setup after the automation's run reservation; verify two completed occurrences use distinct sessions, skipped occurrences create none, and a long outstanding run creates no additional target.
- [x] 3.5 Capture and apply new-chat agent/model selections and configuring permission restrictions without copying full history; verify existing targets retain their own execution selections, new sessions do not widen permissions, and unavailable saved selections pause rather than silently fall back.
- [x] 3.6 Implement persistent pausing for confirmed target deletion or incompatible movement and explicit retarget/resume repair; verify reusable targets are not silently replaced and transient inspection errors are not called deletion.
- [x] 3.7 Add bilingual target-policy examples and candidate-selection guidance, including "here", described chats, default reusable new chat, explicit new chat every run, and ambiguity requiring clarification; verify the examples correspond to the target schemas and candidate tests.

## 4. Shared dispatch coordinator and active-runtime scheduling

- [x] 4.1 Extract or narrowly extend the existing session reservation/cooldown coordinator for both timers and automations; verify all existing scheduler tests still pass plus mixed timer/automation same-session serialization and fair selection tests.
- [x] 4.2 Implement automation activation with default inactive-occurrence skipping and explicit `catch-up-once`; verify 09:00 missed/10:00 startup, several days offline, no missed first occurrence, pause/resume anchor preservation, and no historical replay queue.
- [x] 4.3 Integrate next-deadline scheduling, active busy deferral, standby coalescing, and the automation-wide run gate; verify no asynchronous interval loop, no overlap after retargeting or fresh-chat selection, and future nominal advancement after a slow run.
- [x] 4.4 Persist run intent before submission and revalidate revision, ownership, enabled state, cancellation generation, and closed state after awaited steps; verify pause/update/remove/unload races prevent stale admissions and failed intent writes submit no prompt.
- [x] 4.5 Correlate queued acceptance, delivery, cancellation, and terminal events using official session/message identities; verify acknowledgement is not completion, early delivery/termination races settle once, and unrelated foreground terminal events cannot release an automation run.
- [x] 4.6 Implement interrupted-run consumption without deleting the enabled definition and explicit error pausing without immediate retry; verify both interruption of an automated report and interruption of unrelated foreground work preserve later automation occurrences while temporary timers still stop.
- [x] 4.7 Document active-server/active-location eligibility, default skip versus explicit catch-up, active standby behavior, shared spacing, and Stop-versus-pause semantics; verify the documentation examples correspond to deterministic scheduling and lifecycle tests.

## 5. Recovery and plugin lifecycle integration

- [x] 5.1 Extend contract tests for official storage, preassigned session IDs, session context reads, and live event correlation against both 2.3.2 and 2.4.1 SDKs; verify inbox/message/log reads are not assumed available in the plugin and no additional HTTP client or event replay is introduced.
- [x] 5.2 Reconcile persisted setup/run records using supported context reads and subsequent live events, rebuilding shared target-session barriers before new dispatch; verify delivered-only, newly correlated terminal/cancelled, absent/truncated evidence, and offline-completion cases remain conservatively gated as specified.
- [x] 5.3 Implement fail-closed behavior for unknown admission outcome, event-stream failure, and terminal-record persistence failure; verify no duplicate submission under either missed policy and unrelated target sessions remain eligible where safe.
- [x] 5.4 Preserve subscribe-before-registration setup and reliable closed-first cleanup while retaining durable definitions/recovery; verify one tool registration per location, cleared/unreferenced timeouts, aborted subscriptions, and no late scheduling or revision overwrite.
- [x] 5.5 Extend isolated real-host tests to stop/start hosts around stored creation, queued acceptance, and terminal persistence; verify definitions and pause state survive, timers do not, replacement of one storage value is atomic, and a host-accepted occurrence is not duplicated after recovery.
- [x] 5.6 Document recovery diagnostics, unresolved barriers, cancellation warnings, and why UI closure differs from server shutdown; verify troubleshooting statements against recovery fixtures and isolated-host evidence.

## 6. Agent-facing tool registration and user documentation

- [x] 6.1 Register the six automation management tools and `automation_targets` alongside unchanged `timer_*` tools with precise schemas/descriptions and controlled JSON errors; verify tool inventory, default `skip`, explicit targets/zones, foreign IDs, and validated invocation ownership in tool tests.
- [x] 6.2 Add natural-language acceptance cases for a weekday PR-link report, interval monitoring in a described existing chat, explicit catch-up, pause/resume, and new-chat policies; verify unique candidate resolution or clarification occurs before mutation and the scheduler adds no provider-specific integration or automatic approvals.
- [x] 6.3 Update `README.md` and `README.de.md` with installation-compatible automation examples, recurrence/target/misfire inputs, durable-versus-temporary comparison, location scope, permissions, and stop/removal limits; verify README coverage tests and consistency with tool responses.
- [x] 6.4 Extend `docs/smoke-test.md`, `docs/verification.md`, and scenario-audit documentation for automation scenarios and compatibility evidence; verify every new or modified requirement/scenario has a named unit, contract, integration, or explicit smoke check.

## 7. End-to-end acceptance and regression gates

- [x] 7.1 Run `npm run typecheck`, `npm test`, `npm run build`, and the existing non-publishing package verification; verify no timer regression, required compiled files are packaged, and dependency engine ranges remain compatible with Node >=22.
- [x] 7.2 Run isolated OpenCode 2.3.2 and 2.4.1 acceptance covering durable routines, skipped startup occurrences, explicit catch-up, selected targets, safe chat creation, mixed scheduler serialization, interruption, failure, and crash/reload recovery; verify observable prompts/chats and record unavailable targets as unverified, not passed.
- [x] 7.3 Perform the documented OpenCode/OpenChamber UI smoke checks against an isolated supported server, using safe fixture data for PR-link output where real credentials are unavailable; verify reports appear in the selected chats, approval policy is respected, other chats are not interrupted, and neither tests nor docs claim live provider access from fixture results.
- [x] 7.4 Validate the completed change with `openspec validate add-persistent-prompt-automations --strict` and review requirement-to-evidence coverage; verify every tracked task is actually completed before checking it off and publication/shared-server configuration remain untouched.

## Workflow follow-up

- Start implementation only after a separate explicit apply request.
- Archive the change only after implementation and required verification/review are complete and archival is requested.
- Publishing a package, installing it into the user's live configuration, or restarting a shared OpenCode service requires separate authorization.
