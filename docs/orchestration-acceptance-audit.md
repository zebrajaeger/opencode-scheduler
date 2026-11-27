# Orchestration acceptance audit — 2026-11-26

This index maps all 98 scenarios in the change's seven delta specs to the current
test surface. A file reference identifies relevant evidence, not proof that every
assertion in the scenario passes on every host. **Native replay and corresponding
restart guarantees remain blocked**; component tests are not host qualification.
Task checklist: `openspec/changes/add-event-driven-session-orchestration/tasks.md`.

Abbreviations below refer to files under `test/`:

- **host**: `orchestration-real-host.test.ts` (isolated OpenCode 2.4.2, local model).
- **legacy-host**: `real-host.test.ts` (orchestration absent).
- **jobs**: `orchestration-jobs.test.ts`; **dispatch**: `orchestration-dispatch.test.ts`.
- **store**: `orchestration-store.test.ts`; **restart**: `orchestration-restart.test.ts`.
- **replay**: `session-replay.test.ts` (controlled SDK streams, not a real native host).
- **communication**: `session-communication.test.ts`; **tools**: `coordination-tools.test.ts`.
- **commands**: `coordination-commands.test.ts`; **safety**: `coordination-safety.test.ts`.
- **gate**: `admission-gate.test.ts`; **adapter**: `opencode-adapter.test.ts`.
- **options**: `orchestration-options.test.ts`; **sdk**: `opencode-sdk.test.ts`.
- **timer**: `scheduler-dispatch.test.ts` and `scheduler-management.test.ts`.

## orchestration-jobs

- Three trigger categories — jobs component coverage; **native host category blocked**.
- Unsupported durable session history — jobs/tools; host explicitly rejects native registration.
- Test after both implementations — jobs/host, no activation after first result.
- Aggregate all reviewers — jobs/host, frozen producer/task set and result IDs.
- ANY races — jobs, earliest committed event wins once.
- Completion during registration — commands/jobs/store transaction boundaries.
- Review completed earlier — jobs existing-or-future selection.
- Successful but incomplete review — communication/host, idle does not publish a result.
- Recurring ALL uses fresh rounds — jobs.
- Level-only recurrence — jobs rejects registrations without an edge/time driver.
- Completed task is not repeated — jobs consumed terminal evidence.
- Status every five minutes until review completion — host uses interval 300 seconds
  with an early first slot and stops after completion; jobs uses deterministic clock
  coverage for later/coalesced slots (host does not wait a full five-minute interval).
- Stop already satisfied — jobs.
- Stop after admission — jobs/dispatch; accepted input cannot be retracted.
- Failed implementation in ALL — jobs fail-fast/ignore policy.
- ANY waits for another success — jobs explicit ignore policy.
- Restart suspension — restart/replay components; **native host recovery blocked**.
- Timeout action runs once — jobs timeout and bounded terminal handling.
- Cancel races with readiness — dispatch cancellation during inspection.
- Accepted is not completed — dispatch/domain; host result remains producer-owned.
- Lost execution association — dispatch keeps uncertain gate; no retry inference.
- Session B waits without token consumption — host stable model-call count during wait.

## orchestration-reliability

- Crash after result publication — store/restart; host full server restart for signal job.
- Storage write fails — store/replay rollback fixtures.
- Completion occurred during downtime — replay component; **native host blocked**.
- Live event overtakes replay — replay ordering/atomic buffering components.
- Ephemeral transition was missed — jobs refuses unsynchronized native evidence;
  **durable host coverage blocked**.
- Prompt accepted but response lost — dispatch uncertain admission and fixed ID.
- Duplicate event delivery — commands/jobs/replay unique event/logical run handling.
- Two locations see one result — store/gate multiple SQLite connections and claims.
- Lease expires during request — dispatch/store fencing.
- Fast delivery precedes response — dispatch terminal/delivery-before-ack regressions.
- Ambiguous execution association — dispatch/gate epoch checks preserve barrier.
- Temporary server outage — dispatch bounded proven-non-admission retries; replay
  reconnect component; **native host reconnection qualification blocked**.
- Target deleted or moved — dispatch/communication; host deleted-target send rejected.
- Authentication failure — sdk/dispatch fail closed, no secret echo or automatic retry.
- Upgrade with pending work — store schema-v1 migration preserving IDs/checkpoints.
- Downgrade opens newer data — store rejects newer schema without rewrite.
- Cleanup with waiting dependencies — store retention pins.
- Requested evidence was pruned — jobs explicit history-unavailable.

## orchestration-safety

- Accidental cross-project target — communication/tools/host denial.
- Same-project worktrees — communication/host passive mailbox without wake.
- Foreign cancellation — domain/jobs/host owner-isolated not-found result.
- Scheduled work needs approval — host outstanding form survives inspection;
  communication snapshots; **a scheduled permission-requiring tool execution is not
  yet covered end-to-end**. No auto-approval code exists.
- Review result contains malicious instructions — safety/commands/jobs literal JSON
  and immutable provenance; no claim that LLM prompt injection is eliminated.
- Oversized payload — commands/jobs reject before partial writes/outbox creation.
- Quota exhaustion — jobs/safety persisted owner/project/root limits.
- Explicit task cycle — jobs direct/indirect declared graph cycles.
- Mutual signal activation — jobs/safety hop/root bounds with fresh correlations.
- New correlation attempts to bypass spacing — gate/host shared target cooldown.
- Wrong endpoint — sdk session/project/location binding and loopback validation.
- Credential configuration — sdk environment references and official Basic auth.

## orchestration-signals

- Publish an early critical finding — commands/host while producer task remains working.
- Same name in another project — commands/domain/tools project-scoped matching.
- Wait for user input without false completion — commands/communication waiting_input.
- Another session attempts completion — commands/domain producer ownership.
- Review releases specification work — host exact result ID and literal summary.
- Execution succeeds without explicit result — host no activation before task publication.
- Concurrent completion and failure — commands competing SQLite connections.
- Producer continues after publication — commands/host immutable stored result.
- Forged task completion signal — commands/tools reject scheduler namespace/top-level scope.
- Retry after lost acknowledgement — commands idempotency response/event deduplication.
- Existing review has no task publication — tools/host missing task contract rejected.

## plugin-lifecycle

- Restart — adapter/legacy-host/host discard legacy timer definitions.
- Persistent time job is separate — adapter/jobs/host durable registrations across reload.
- Unresolved legacy admission survives reload — dispatch/gate persisted minimal evidence.
- Cleanup with pending work — timer/adapter late callback fencing.
- Durable work survives cleanup — adapter/restart/host; **native gate recovery blocked**.
- Release readiness — standard/release checks; unavailable OS/version/manual UI
  environments remain unverified, not advertised as passed.
- Orchestration release qualification — host covers plugin-owned workflows;
  **full mandatory native qualification remains open**.
- Existing configuration unchanged — options/legacy-host five timer tools.
- Unsupported storage runtime — options/sqlite-runtime/adapter fail capability only.
- Follow example workflows — host tool sequences and matching EN/DE five-example
  guide; both SDK-enabled and no-SDK real-host configurations passed.
- Unsupported guarantees are visible — EN/DE READMEs and native blocker document.

## session-communication

- Find a review by natural reference — communication/tools/host title search.
- Invalid exact identity — communication/host missing/deleted and foreign IDs.
- Two reviewers share a title — communication/host ambiguity without implicit selection.
- All current reviewers — communication pagination/frozen identities; host later
  reviewer does not join already registered explicit ALL task set.
- Idle with unfinished background work — communication controlled interaction/background
  snapshots; explicit task state never inferred from idle.
- Waiting for interaction — communication/host forms; task publication tests waiting_input.
- Unstructured question — communication does not infer a wait from prose.
- Read a completed review — communication/tasks/results and host stored result envelope.
- Unsupported full history — tools/communication and isolated no-SDK host reject
  history while explicitly permitting separately labelled current compacted context.
- Send information without execution — communication/host mailbox only.
- Busy target receives an activation — dispatch queue-race tests and both host modes:
  held model execution receives no early input; one queued activation follows release.
- Forged origin and duplicate send — commands/communication/safety immutable provenance.
- Wait and update specifications — host registered result dependency without model polling;
  deterministic tool routing proves integration, not natural-language model quality.

## timer-dispatch

- Admission failure — timer/legacy-host bounded disable diagnostics.
- Timer execution failure — timer/legacy-host no unrequested retry.
- Lost acknowledgement or ambiguous outcome — timer/dispatch barrier retained.
- Durable shared gate during unload — dispatch/gate, minimal evidence not timer restore.
- Multiple due timers in one session — timer/legacy-host serialized progress.
- Different sessions — timer/host unrelated target progresses during contention.
- Acceptance is not completion — timer/dispatch explicit settlement.
- Timer and signal job share target — gate components plus host timer/signal-job
  contention. The earlier timer/time-job variant also passed independently.
- Several timers bypass individual intervals — timer configured target-wide spacing.
- Prompt creates or updates a timer — timer/legacy-host reentrant registration/update.
- Event jobs cannot bypass cooldown — gate/dispatch and host mixed target cooldown.

## Required follow-up, not optional scope

Native start/outcome/inbox replay must be qualified on an identified fixed host,
including missing-retention intervals and restart recovery. A syntactically applicable
upstream patch or passing rejection test does not fulfill that contract. The explicit
host gaps above remain acceptance work; task 9.7 cannot be checked merely because
every scenario now has an entry in this document.
