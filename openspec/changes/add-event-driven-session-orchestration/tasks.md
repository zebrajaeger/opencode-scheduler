# Tasks

All numbered checkboxes are mandatory implementation/verification work, not authorization to implement during proposal creation. Complete groups in dependency order. Each item must land its focused tests with the behavior it introduces. Optional extensions below are deliberately not implementation checkboxes.

## 1. Qualify runtime and supported API contracts

- [ ] 1.1 Extend `test/api-contract.test.ts` with actual published plugin discovery/context/prompt/hooks/storage/event types and negative assertions for absent inbox/history/log members; verify typecheck against the existing 2.3.2 and 2.4.1 targets without casts inventing APIs.
- [ ] 1.2 Add isolated contract fixtures for the version-aligned SDK message list/get, durable log/watermark, inbox, forms, and permissions methods; verify the exact signatures and record tagged source links in `docs/development.md`.
- [ ] 1.3 Qualify the built-in SQLite adapter in supported Node 22 patch levels and the actual OpenCode plugin host; verify transactional read/write/reopen in isolated temp directories and record the runtime matrix. Stop for a design decision before adding native dependencies or raising engines if unavailable; verify unsupported-runtime preserves legacy tools.
- [ ] 1.4 Implement and test opt-in orchestration option validation, stable namespace/data-directory binding, SDK secret references, limits, and capability reporting; verify old options remain valid and conflicting location policies fail closed; document the configuration and unsupported-capability behavior in both READMEs.

## 2. Persistent repository and domain lifecycle

- [ ] 2.1 Add narrow task/job/run/event/delivery domain types and validated transitions; verify table-driven legal/illegal transition tests distinguish business completion, admission, delivery, settlement, waiting_input, and uncertainty.
- [ ] 2.2 Implement schema-versioned plugin-owned SQLite initialization and repositories with atomic transactions, unique identities, and local-file validation; verify reopen persistence, rollback on injected write failure, and no use of internal OpenCode tables.
- [ ] 2.3 Add transactional worker leases/fencing and persistent target-gate records; verify two connections cannot claim one intent concurrently and stale workers cannot overwrite a newer claim or release an unresolved gate.
- [ ] 2.4 Implement migration/version guards and controlled storage errors; verify old-schema fixtures preserve pending IDs/cursors and unknown-newer/corrupt schemas do not reset data; document upgrade/rollback and storage failure behavior.
- [ ] 2.5 Add bounded retention and reference pinning; verify cleanup preserves waiting evidence, active results, unresolved deliveries, and retained unread mailbox entries and reports quota/history-unavailable instead of dropping required state; document retention limits.

## 3. Scoped discovery and non-activating information access

- [ ] 3.1 Implement plugin-adapter session search/get with pagination, project/worktree scope, immutable resolved identities, and ambiguity results; verify same-title, exact-ID, same-project worktree, missing-session, and denied foreign-project fixtures.
- [ ] 3.2 Implement honest state/current-context inspection and explicit task/result selectors; verify idle/busy/retry/unknown, freshness, compacted-context labeling, explicit waiting_input, and that prose questions never infer business success.
- [ ] 3.3 Implement the persistent mailbox and passive `session_send` action with host-derived provenance and caller-scoped idempotency; verify duplicate/conflicting sends, capacity errors, bounded reads, and zero host prompt calls for passive messages.
- [ ] 3.4 Register strict `session_find` and `session_read` schemas/descriptions; verify unknown fields and forged scope are rejected, private job definitions are not exposed, and examples guide discovery and clarification without user-supplied IDs; document passive mailbox versus visible chat limitations.

## 4. Explicit tasks, immutable results, and signals

- [ ] 4.1 Implement producer-owned task creation and nonterminal updates with expected revisions; verify cross-session mutation is denied and discovery can retrieve authorized task identities/states without exposing private registrations.
- [ ] 4.2 Implement atomic terminal task/result/outcome-event publication with fixed publication keys; verify concurrent completion/failure yields one immutable result, retries return its identity, and later execution failure cannot retract it.
- [ ] 4.3 Implement exact-name structured signals, reserved-name protection, producer/correlation filters, and host-derived provenance; verify custom critical-finding publication does not complete the task and unrelated projects or forged producers cannot satisfy subscriptions.
- [ ] 4.4 Register `task_update` and `signal_emit` with byte-bounded schemas and explicit relevant-background-work guidance; verify oversized/non-JSON/conflicting payloads fail atomically; document the producer completion contract, corrections, and early-finding example.

## 5. Bounded dependency evaluator and job management

- [ ] 5.1 Implement one-shot single/ALL/ANY signal/task conditions with immutable matched-evidence snapshots and unique firing keys; verify two-implementation gating, all-reviewer aggregation, deterministic simultaneous ANY, and duplicate-event tests.
- [ ] 5.2 Implement race-safe future/existing_or_future registration using plugin commit boundaries and verified source watermarks; verify result-before/during/after-registration cases each yield correct zero-or-one firings and pruned evidence returns history-unavailable.
- [ ] 5.3 Implement recurring fresh-edge rounds and gated level predicates with one active/one coalesced pending run; verify ALL needs fresh evidence per member, ANY deterministic consumption, and level-only recurrence is rejected.
- [ ] 5.4 Implement persistent time deadlines/nominal intervals through the common evaluator; verify fake-clock sleep, busy periods, no catch-up bursts, finite lifetime, integer validation, and configured minimum spacing.
- [ ] 5.5 Implement until groups, cancel/pause/resume, timeout transitions and optional once-only timeout action; verify stop-already-satisfied, stop-versus-deadline precedence, cancel during asynchronous checks, and accepted-input boundary diagnostics.
- [ ] 5.6 Implement fail/ignore/match source policies and deletion/movement handling; verify default fail-fast including ANY, ignored ALL membership retention, configured failure matches, and shutdown not being business cancellation.
- [ ] 5.7 Register strict `job_create`, `job_list`, and `job_control` schemas with ownership/revision checks; verify calls return without source completion/target idle and expose all documented job/run states; document time/session/signal semantics and periodic-status-until-completion.

## 6. Safe activating delivery and legacy arbitration

- [ ] 6.1 Persist immutable prompt envelopes and official message IDs before network/host submission, including manual active `session_send`; verify duplicate keys return one intent and changed payloads conflict without generating another message ID.
- [ ] 6.2 Extract shared per-target admission/cooldown arbitration without changing the existing timer facade; verify timer-versus-job races across activations, deterministic fairness, unrelated-target progress, and the complete existing scheduler unit suite.
- [ ] 6.3 Implement final scope/revision/deadline/cancel/stop/gate revalidation and explicit `delivery: queue`; verify busy-target deferral creates no repeated submissions and user work racing the idle check is not steered or interrupted.
- [ ] 6.4 Implement accepted/delivered/settled/uncertain run reconciliation and derived epoch evidence; verify delivery-before-ack, terminal-before-ack, lost association, stale callbacks, and persistent conservative target gates.
- [ ] 6.5 Implement bounded same-ID transient retries, permanent failure/auth pause, and default recurring pause on execution failure; verify fixed payload/ID across retries, caps/jitter/deadlines with fake clocks, no business-effect replay, and unchanged legacy disable-on-error behavior; document errors and recovery.
- [ ] 6.6 Implement cancellation/unload fencing and cleanup for mixed ephemeral/durable work; verify legacy timers disappear after unload, persistent intents remain recoverable, no unrelated session interruption occurs, and late responses cannot resurrect work.

## 7. Same-server SDK replay and historical access

- [ ] 7.1 Add a direct version-aligned SDK dependency only when introducing its adapter; implement explicit loopback endpoint or official non-starting discovery with environment-secret references and current-session/project/version validation; verify wrong endpoint/auth fails closed, no service ensure/port scan occurs, and secrets are redacted.
- [ ] 7.2 Implement per-session durable log replay/follow with checkpoints, buffering, deduplication, and log.synced readiness; verify duplicate/out-of-order/live-overtakes-replay fixtures and transactionally coupled checkpoint updates.
- [ ] 7.3 Add reconnect/backoff and historical-gap handling; verify downtime completion is recovered once, missing/pruned coverage is explicit, and target gates remain conservative until synchronized.
- [ ] 7.4 Implement capability-gated native execution edge/current-state conditions and full historical message reads; verify absent SDK rejects unsupported registrations instead of silently using live-only events or compacted context.
- [ ] 7.5 Reconcile forms/permissions through supported SDK snapshots and expose tracked background/descendant evidence via supported hooks; verify ephemeral transitions are not claimed replayable, foreground/subagent/background distinctions, and unsupported observation remains unknown; document technical versus business completion.

## 8. Isolation, feedback limits, and untrusted envelopes

- [ ] 8.1 Enforce host-derived scope and owner/producer authorization at every command, source read, publication, and final delivery; verify moved sessions, forged IDs/metadata, cross-project data reads, and foreign cancellation do not leak or activate work.
- [ ] 8.2 Implement declared output-task dependency edges and known-cycle detection without granting foreign task publication authority; verify self-loop, multi-task cycle, valid acyclic dependencies, and producer opt-in tests.
- [ ] 8.3 Propagate trusted causation from delivered prompts into subsequent tool publications and enforce persistent hop/activation/owner/project budgets; verify mutual A/B signals pause at bounds and fresh correlation IDs cannot bypass target cooldown or quotas.
- [ ] 8.4 Implement UTF-8 envelope/payload bounds, literal untrusted-data assembly, immutable provenance, and secret-safe diagnostics; verify injection-like payloads remain data, reserved fields cannot be overridden, and size rejection is atomic; document residual LLM-injection risk and normal approval requirements.

## 9. Isolated end-to-end workflows and release integration

- [ ] 9.1 Extend the deterministic mock-provider real-host harness for two independent same-project sessions; verify review-result to spec-update and early critical-finding activation with stored origins, no child-only subagent routing, and no model polling while waiting.
- [ ] 9.2 Add E2E cases for ALL implementations to tests, all-reviewer result aggregation, and five-minute status until review completion; verify exact matched result sets, coalesced intervals, stop races, and no false completion from successful partial executions.
- [ ] 9.3 Add repository/host restart fault injection at event commit, outbox commit, send, acceptance, delivery, and checkpoint boundaries; verify recovery uses original IDs, no duplicate logical runs occur, and agent-side effects are not advertised exactly-once.
- [ ] 9.4 Add mixed timer/job compatibility E2E and same-project-worktree/denied-cross-project cases; verify legacy ownership, interruption, ephemeral restart, cooldown, update, and error scenarios still pass without orchestration configured.
- [ ] 9.5 Exercise documented tool sequences for all five natural-language prompts plus ambiguity, missing producer contract, unsupported SDK, deleted/unreachable targets, and approval waits; verify documentation matches observable tool output in isolated OpenCode without OpenChamber.
- [ ] 9.6 Run typecheck, unit/repository/integration tests, build, and the existing non-publishing release checks; record actual host/runtime/OS evidence and unavailable environments in verification docs, and verify packed contents/dependencies and English/German READMEs remain consistent.
- [ ] 9.7 Revalidate the OpenSpec change and audit every new/modified scenario against a test or explicit documented limitation; verify mandatory acceptance has no unchecked capability claim and no optional work was accidentally required.

## Optional extensions outside mandatory implementation

- Multi-server SDK transport, endpoint registry, remote result replication, and cross-instance authentication require a separate change and threat model; no automatic federation is included here.
- Explicit cross-project grants, wildcard signals, arbitrary predicates/nested workflows, UI notifications, visual dashboards, and a separate daemon are deferred, not prerequisites for this change.
- A visible non-executing OpenCode chat message can be added only if a verified public API provides that exact contract; the mandatory passive mailbox remains available independently.
- Automatic assessment of task/background completeness, general filesystem locking, and exactly-once agent effects are not acceptance promises.

## Workflow follow-up

- Review these artifacts and runtime-contract results before applying scope-changing dependency/runtime decisions.
- Archive only after mandatory implementation and verification are complete and reviewed; neither implementation nor archive is part of proposal creation.
