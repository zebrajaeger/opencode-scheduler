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

### Orchestration API contracts

The plugin contract test also checks discovery, current context, producer/location identity,
last execution outcome, prompt and experimental idle hooks, durable JSON storage, and
execution/form/permission events against both published plugin targets. Negative type
assertions ensure inbox, history, message, and log methods are not invented on `ctx.session`.
These are compile-only functions: they do not subscribe or submit work to a real server.

`test/sdk-contract.test.ts` uses the version-aligned 2.3.2 client already installed by the
plugin dependency, with an injected fetch and no network traffic. It verifies historical
message list/get, inbox, forms, permissions, and durable log replay with `log.synced`.
This test-only import is not a production SDK adapter or a promise of runtime compatibility.
A production adapter must declare its direct client dependency and qualify the host version.

Additional tagged sources:

- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/session.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/storage.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/client/src/promise/client.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/server/src/handlers/session.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/event-log.ts
- https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/promise/session.ts

Current context can be compacted; it is not complete history. Live subscriptions do not
replay. Execution success/idle does not publish business task completion. Forms and
permission events are ephemeral and require snapshots after a missed observation.

### SQLite runtime qualification (Windows x64, 2026-11-26)

| Runtime | Built-in binding | Commit / rollback / reopen |
| --- | --- | --- |
| Node 22.0.0 (official standalone binary, no flags) | `node:sqlite` absent | Unsupported |
| Node 22.13.1 (official standalone binary, no flags) | `node:sqlite` | Passed |
| Node 24.20.0 (local test runner) | `node:sqlite` | Passed |
| OpenCode 2.4.2 isolated plugin host (reports Bun 1.4.4 / Node compatibility v26.3.0) | `node:sqlite` and `bun:sqlite` | Both passed |

`test/sqlite-runtime.test.ts` checks real file transactions and reopen. Set
`SCHEDULER_SQLITE_HOST=1` to run the private-server probe; it uses separate config/data
directories, activates plugins through agent discovery, and makes no model calls.
The host probe's JSON and server log remain in its isolated temporary directory.
Node 22 binaries used for qualification were downloaded from nodejs.org into the
approved temporary directory, not installed into the project or selected globally.

This does not change the package's Node >=22 engine contract: legacy timers do not
require SQLite. Durable orchestration must dynamically detect the binding and report
`unsupported-runtime` without disabling legacy timers on environments such as 22.0.0.
Other 22.x patches, host versions 2.3.2/2.4.1 SQLite runtime behavior, and non-Windows
hosts remain unverified. Type compatibility alone does not extend this runtime matrix.

### Coordination lifecycle vocabulary

`src/orchestration-domain.ts` keeps business task state separate from job eligibility
and delivery/run state. A task waiting for user input remains nonterminal. A run that
is accepted is neither delivered nor settled; a technical host outcome is stored
separately and cannot complete a business task. Terminal task identities cannot reopen.
Run uncertainty requires evidence-based reconciliation; cancellation cannot pretend
that already accepted input was retracted. Same-project worktrees can communicate,
but only producer/creator sessions can mutate their owned records.

### Plugin-owned repository

`CoordinationStore` opens only `orchestration.sqlite` in the configured local data
directory. It uses schema version 2, WAL, foreign keys, busy timeout, unique event
identities, scoped record reads, and optimistic revisions. Event ingestion and outbox
writes can share a synchronous `BEGIN IMMEDIATE` transaction; host calls must stay
outside it. Policy identity is persisted so a second location/process cannot silently
reuse the file with a different namespace or limits.

Worker leases have monotonically increasing fencing tokens, including after release.
Leases and persistent target gates are separate: an expired worker is not proof that
a prompt finished. A replacement must reconcile the original intent/message ID.
Repository tests open competing connections and inject transaction failures; they
do not open or modify OpenCode's internal database.

Version zero initializes only an empty plugin-owned database; there was no previous
persistent scheduler format to migrate. Version one migrates atomically to version two
by adding retention metadata without changing pending deliveries or checkpoints.
Unknown-newer schemas, unversioned nonempty data, corruption,
and filesystem failures fail closed; no reset/downgrade is attempted. Disable the
preview to roll back while preserving its data. Future schema changes must supply
transactional migrations and old-version fixtures before raising the schema version.

Retention defaults to seven days and 10,000 unreferenced entries. Waiting jobs and
active runs pin required event/result records in the same transaction that consumes
them. Unread mailbox messages and unresolved delivery/gate/checkpoint records are
never automatically collected. Only unpinned historical events/results and read
mailbox entries are eligible for pruning. The repository exposes explicit capacity
checks for command transactions; it rejects exhaustion rather than sacrificing
referenced evidence. A missing required pin reports `history-unavailable`.

Session discovery uses the published plugin `list/get` methods with project filters
and verifies returned project identity again. A title search with multiple results
or further pages stays ambiguous; it never chooses the most recent session. Exact
resolution freezes the identity snapshot, including the actual directory. The
published `LocationPublicRef` does not expose workspaceID, so discovery does not
invent one. Context reads are revalidated after access and labeled as the current
possibly compacted context rather than a complete transcript.
Fresh live idle/busy/retry observations expire after 30 seconds; later session
snapshot timestamps take precedence. This is diagnostic evidence, not business
completion. Explicit task/result selectors read authorized producer-owned records;
current-context responses are bounded to 64 KiB and report truncation.
Passive sends are transactional mailbox writes, not synthetic model input. The
caller/session-scoped idempotency key binds target and exact text; conflicting reuse
fails. Capacity is checked without eviction, and mailbox reads keep provenance as
untrusted data. The communication adapter intentionally has no prompt method; active
sends will use the separate outbox/admission path.

Task commands are producer-owned and version checked. Terminal commands persist an
immutable result and reserved outcome event in the same transaction, with a retained
idempotency response. Signal commands use exact names and reject the `scheduler.`
namespace; custom findings never implicitly complete a task. JSON data must be finite,
bounded, and no more than 32 levels deep. Dependent evaluation and causal budgets are
enforced in the same repository transaction as activation intent creation.

The one-shot dependency evaluator now runs inside publication/registration
transactions when supplied to command handlers. It records a single ALL/ANY firing
with pinned event/result snapshots. ANY selects the earliest committed matching
event; a future condition starts after the registration watermark. The evaluator
writes intents; only the separate fenced delivery worker submits prompts.
Matching also writes a stable-message-ID outbox intent in that transaction. Partial
ALL rounds pin evidence while waiting; recurring rounds retain fresh evidence during
the active run and coalesce another ready firing. Time slots use nominal deadlines;
stop evidence precedes timeout/match evaluation. Pruned history is tracked
conservatively and existing-or-future registration returns `history-unavailable`.
The evaluator is connected to production job registration/publication tools. Automatic
delivery is enabled on a supported configured repository, with persistent unresolved gates.

Recurring ALL rounds require fresh source evidence; levels only gate an edge/time
driver and cannot create an endless idle loop. One active round retains at most one
coalesced pending firing. Optional deadlines create at most one declared timeout
action; stop conditions win before a new admission, and cancellation is idempotent.
The delivery worker is constructed and supervised in plugin setup:
busy targets defer, passive actions never prompt, and uncertain admission keeps a
persistent target gate. Host settlement requires delivery plus observed execution
epoch evidence. Runtime qualification is bounded to the recorded matrix, not a general
certification for all host versions or operating systems.

The SDK adapter now declares a direct aligned `@opencode/client` dependency. Its
connection qualification accepts only explicitly supported versions and a loopback
endpoint matching the invoking session/project/location. Discovery uses only
`Service.discover`, never ensure/start or a port scan. Environment credential values
are confined to request headers. Replay ingestion commits each durable event with
its checkpoint and evaluator effects; registration requires an observed synced
watermark. Live observations are not mixed into this ordered replay lane. Source
followers reconnect under supervision and clear readiness when their coverage is lost.

### Recovery hardening evidence

Focused regression tests additionally cover:

- Expired workers returning from a host inspection cannot submit or modify a newer worker's intent.
- Delivered/settled/cancelled evidence takes precedence over a late rejected admission response.
- A later execution epoch cannot settle an earlier delivered prompt whose terminal event was missed.
- Recovery checks same-session identity, strictly ordered source sequences, and a covering `log.synced` watermark before releasing any gate.
- Failed/disconnected replay clears readiness and watermark capabilities before reconnect backoff.
- Concurrent replay never moves the persisted source checkpoint backwards.
- Server-shutdown interruptions remain durable technical evidence without publishing a business interruption trigger.
- Cached live retry observations cannot extend their own freshness simply by being read repeatedly.
- Historical message and interaction reads reject location changes during access.
- Unload aborts and awaits replay followers before closing their repository; late inspection responses cannot submit.

Legacy scheduler settlement is not sufficient to release a durable target gate: the
validated event/recovery lane owns that release. A second execution start after
delivery marks association uncertain rather than substituting a new epoch. Missing
or invalid recovery coverage leaves the original gate intact. Published task results
remain pinned while their retained task identities refer to them.

Component/repository regressions are complemented by the isolated real-host suite
`test/orchestration-real-host.test.ts`: explicit results, early critical findings,
ALL aggregation, periodic stop, cross-project denial, worktrees, reload and restart.

Apply-time safety clarifications (approved): with durable orchestration enabled,
minimal submitted-timer evidence/shared gates survive unload but timer definitions
remain ephemeral. Also, a cancelled OpenCode inbox row is removed; same-ID retries
are not a universal deduplication guarantee. Unknown admission outcomes must remain
uncertain and must never be automatically resent. Replay distinguishes queued,
delivered, and cancelled evidence; only proven non-admission can permit retry.

Before a prompt call has begun, transient inspection failures allow at most five
retries of the same stored envelope/message ID, with exponential delay, up to 25%
positive jitter, a 30-second delay cap, and the original job deadline. Exhaustion,
invalid requests, and authentication failures pause the job with a bounded diagnostic.
Once submission begins, transport rejection is ambiguous unless stronger host evidence
has arrived; it is never automatically resent. Failed recurring executions pause by
default. Explicit resume permits only future rounds, not replay of business effects.
Legacy timer admission failures continue to disable the timer without automatic retry.

Job registration persists host-resolved owner, target and producer/stop-source
identities. Final delivery rechecks those identities after asynchronous host reads,
the worker fencing token, the unchanged job revision, current stop/deadline state,
and the shared target gate. Busy targets retain the original intent without repeated
submission. A user prompt arriving after the idle snapshot is protected by explicit
`delivery: "queue"`; the dispatcher never steers or interrupts the session.

`session_read` state derives `waitingInput` only from supported SDK form/permission
snapshots; without SDK it remains unknown. These snapshots are explicitly not
replayable, do not classify prose questions, and never approve anything. The
experimental idle hook's background evidence retains each reported owning session,
so own-session work and descendant-owned work are not conflated. The observation is
host-reported only and becomes unknown after 30 seconds; it does not certify complete
background work or infer business completion.

Declared `outputTaskID` edges require the owning producer to target itself; they grant
no right to publish another session's task. Cycle detection unions dependencies from
all live jobs declaring the same output, rejecting self-loops and indirect cycles while
allowing acyclic graphs. Undeclared model behavior is not statically cycle-detectable
and still requires the separate causal activation budgets.

Native execution-edge registrations require a verified SDK and a synchronized source
watermark; unsupported registrations fail rather than falling back to live-only events.
The source-follow stream reports readiness at `log.synced` before returning registration,
and disconnected sources defer existing native-edge evaluation until synchronization.
Current-state predicates use freshness-bounded snapshots instead, and cannot alone
drive recurrence. Historical message reads use SDK pagination and explicit coverage,
never substitute compacted current context for full history.

Source followers reconnect with capped exponential backoff and validate the recorded
source location before reading again. Downtime events resume from the committed
checkpoint, are deduplicated, and evaluate only under covering synchronized evidence.
Reconnect failures surface bounded source diagnostics; readiness/watermarks clear on
failure, and absent/pruned/out-of-order/foreign coverage never releases a target gate.
The supervising plugin aborts and awaits these followers during unload.

Shared target arbitration uses transactionally persisted FIFO contender hints for
both timer and job admissions. Equal timestamps use stable contender IDs. Waiting
hints expire if an activation disappears, but an admitted/uncertain message gate
never expires merely because its worker does. Cooldown is target-wide and remains
independent of fresh job IDs, signal correlations, or plugin activations. These hints
do not persist legacy timer definitions or authorize a worker to submit by themselves.

### Latest verification checkpoint (Windows x64, 2026-11-26)
Latest standard suite: **213 passed, 3 opt-in skipped**. SDK and no-SDK isolated
orchestration host matrices passed, including timer/signal-job spacing, reviewer
aggregation, deleted targets and busy queued recipients. Typecheck/build/strict
OpenSpec/whitespace and non-publishing release package/import checks passed. The
package explicitly includes only the upstream proposal/patch, not its executable
private-host probe. All 98 delta scenarios are indexed in
`docs/orchestration-acceptance-audit.md`; native acceptance is still blocked.

**Not full acceptance:** the CLI host does not enable durable native payload
retention. Native triggers now fail closed; mandatory native replay/restart
qualification is blocked. See [the evidence and decision needed](native-replay-blocker.md).


Verification includes typecheck, standard tests, build, strict OpenSpec validation,
whitespace checks and non-publishing package/import checks. Opt-in host suites use
private config/data roots and a deterministic loopback model, never the user's shared
server or paid credentials. OpenCode 2.4.2/Windows x64 is the actual host evidence;
other operating systems and host versions remain unqualified. The SQLite probe makes
no model/provider calls. The orchestration host suite intentionally makes only local
fixture model calls and preserves its history/evidence/logs for inspection.

## Residual model-input risk

Peer summaries/results are serialized literal JSON under an explicit untrusted-data
label. They cannot override the stored producer, instance, correlation or causal
fields; publication commands reject reserved top-level fields. UTF-8 byte/depth limits
are checked before the publishing transaction can commit. This containment is not a
proof against LLM prompt injection: model-generated actions still require ordinary
OpenCode permissions and user approvals. The scheduler never auto-approves tools,
forms or permission requests, and does not execute text from a peer as tool code.

Every coordination tool validates the invoking session's current project/location
before use; publication attribution additionally resolves the invoking message's
preceding user input, not a later queued request. Registration validates stop sources
as well as trigger sources. Final admission revalidates the recorded owner/target/
sources. Native replay rechecks its source at connection and before buffered commit.
Caller-supplied producer/project/causal fields are rejected, including command-layer
calls that bypass JSON schema validation.

## Commands

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm pack --dry-run` from the repository root. Unit fixtures provide fake clocks, deterministic IDs and deferred host promises. No unit test needs credentials or a running OpenCode service.

The official plugin dependencies currently contain moderate npm audit findings; the test runner was updated to remove the critical findings of its older version. Do not use forced dependency upgrades that break the verified API matrix.
