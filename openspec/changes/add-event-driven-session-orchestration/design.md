# Design

## Context

See `proposal.md` for motivation and scope. The current implementation has a host-independent `Scheduler`, a V2 adapter, and five session-owned tools. Its Maps and deadlines are location-local and ephemeral. It already distinguishes admission, delivery, and terminal execution, deduplicates durable sequences per session, rechecks revisions after awaits, and conservatively blocks unresolved admission. Preserve these properties rather than replacing them with event callbacks that submit prompts directly.

### Verified API boundary

Evidence was inspected in the installed 2.3.2 declarations, the 2.4.1 contract-test alias, and upstream tagged sources; the local CLI reported 2.4.2. This is source/type evidence, not new runtime certification. Implementation must retain a tested version matrix.

- Plugin `ctx.session` exposes `list`, `get`, `context`, `prompt`, `synthetic`, `wait`, creation/update/interrupt operations, and hooks. It does NOT expose the SDK's inbox administration, historical message list/get, or durable log API.
- `ctx.session.list` supports title search, project/directory/parent filters, archive filters, and pagination. Identity is `id`, with `projectID`, `location`, optional `parentID`, title, metadata, times, and last outcome. Titles are neither unique nor stable.
- `ctx.session.context` loads the latest compacted context window, not a complete immutable transcript. SDK `client.message.list`, `client.session.message.get`, and `client.experimental.session.log({ sessionID, after, follow })` provide additional access.
- `ctx.session.prompt({ sessionID, id, text, delivery: "queue", metadata })` returns inbox admission, not execution completion. Default delivery is `steer`; always override for scheduler activation. The inbox reconciles the same ID/session/type against pending and promoted messages: first admission wins. Retrying must preserve payload and ID.
- `synthetic` supports `resume: false` but still adds future model input; it is not a guaranteed private, non-executing chat notification. Do not equate it with a mailbox.
- `ctx.event.subscribe` is a public server-wide live bus, not a location-local historical feed. SDK subscriptions have no replay or automatic reconnection. Durable per-session log replay is a separate SDK operation with `after`, `follow`, and `log.synced`.
- Execution started/succeeded/failed/interrupted are durable per-session events. Terminal payloads identify the session, not a native execution ID or the prompt whose business task finished. One terminal event covers a busy period with potentially coalesced drains.
- `session.status` is idle/busy/retry. `session.wait` awaits process-local idle only. Neither implies business success.
- Permissions use ephemeral `permission.asked/replied`; structured questions use ephemeral `form.created/replied/cancelled`, not a guessed `question.asked` event. SDK forms/permissions can be listed for reconciliation. Ordinary text questions cannot be classified reliably.
- `experimental.idle` exposes tracked background work including descendants. The hook runs after model work before idle, not after failure/interruption/control-only work. Returning does not block idle. Descendant-owned completion may wake only the descendant. Untracked detached processes cannot be certified complete.
- Built-in subagent continuation restricts targets to children; independent-session communication must use the session API, not misuse the subagent tool.
- Plugin storage provides durable plugin-ID-scoped JSON get/set/remove/scan, backed by KV; no public transaction or CAS. Its namespace does not include location. The execution coordinator and live bus are process-local even when processes share storage.

Primary sources (pin these tags in implementation evidence):

- https://opencode.ai/docs/build/plugins/server/
- https://opencode.ai/docs/build/client/
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/plugin/src/promise/session.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/plugin/src/promise/plugin.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/plugin/src/promise/storage.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/plugin/host.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/execution.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/inbox.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/runner/llm.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/background.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/store.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/session.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/session/execution/restart.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/schema/src/session-event.ts
- https://github.com/anomalyco/opencode/blob/v2.4.2/packages/schema/src/form.ts

## Goals / Non-Goals

**Goals:** bounded, inspectable, durable coordination; agent-operated tools rather than a new natural-language parser; immutable results; transactional dependency evaluation; explicit delivery guarantees; compatibility with legacy timers and real V2 contracts.

**Non-Goals:** exactly-once agent/file/network effects; interpreting arbitrary prose as task completion; keeping sessions busy to wait; distributed consensus; arbitrary Boolean programs or scripts; automatic cross-project trust; creating remote agents or worktrees implicitly; filesystem locks; new UI/MCP/LLM service.

Mandatory scope is one explicitly identified OpenCode server/storage namespace, including independent sessions and same-project worktrees. Multi-server transport, cross-project grants, user interfaces, wildcard topics, arbitrary predicates, and general workflow DAG execution are optional follow-up changes, not unfinished mandatory checkboxes.

## Decisions

### 1. Separate business tasks, jobs, runs, and host executions

Use a small domain vocabulary:

- **Task:** a named piece of business work owned by a producer session; `open`, `working`, `waiting_input`, or terminal `completed`, `failed`, `cancelled`.
- **Result:** immutable, schema-versioned terminal task publication, including summary, bounded JSON data, references, producer, and correlation ID.
- **Job:** a registered condition/action owned by its creating session; `waiting`, `ready`, `active`, `paused`, or terminal `completed`, `cancelled`, `timed_out`, `failed`.
- **Run:** one immutable firing snapshot, including matched source IDs; `pending`, `submitting`, `accepted`, `delivered`, `settled`, `cancelled`, `failed`, or `uncertain`. Settlement includes host outcome separately; it never creates business completion.
- **Delivery:** durable action envelope, target, fixed official message ID, payload hash, admission attempts, next retry, and acknowledgement evidence.

Task completion is authoritative when its producer successfully publishes the completed result. B may start while A is composing its final chat reply. A must finish relevant children/background work before publication; idle does not infer that. Later failure/interruption does not retract a committed result. Corrections use a new task/result linked by `supersedes`, with no implicit rerun of already consumed results.

Technical inspection returns execution `idle|busy|retry|unknown`, last outcome, and interaction/background observations with freshness/coverage. `waiting_input` is an explicit task state; forms and permissions add evidence but do not cover prose questions. Treat shutdown interruption as suspend/recover information, not automatic business cancellation. Legacy timer interruption behavior is unchanged.

Alternative rejected: using the latest assistant message or `execution.succeeded` as the review-completed signal. Both confuse unrelated work and can omit background results or survive only as compacted context.

### 2. Thin adapters around a shared coordination pipeline

Proposed module seams (new internal names, not OpenCode APIs):

```text
timer deadlines ----+
native session -----+--> normalized events --> transactional evaluator
explicit signals ---+                              |
                                                   v
agent tools --> commands --> repository <------- runs + outbox
                                                   |
                                                   v
                                   shared target admission arbiter
                                                   |
                                     plugin host / optional SDK
```

Keep the existing timer facade and fixtures. Extract only admission arbitration, bounded clock wakeups, ownership checks, diagnostics, and normalization that both paths actually need. Legacy Maps remain ephemeral. Orchestration time jobs use the same evaluator/persistent repository as session and signal jobs. Do not force persistence or retry semantics onto old timer tools.

A target gate serializes legacy timers and new jobs across location activations. It does not lock a session against users or unrelated plugins. Native `delivery: "queue"` is the final protection when a user starts work after the idle check. Do not hold a database transaction across a host request or wait for idle inside a tool.

### 3. Persistent SQLite with transactional single-writer semantics

Use a plugin-owned local SQLite file, never internal OpenCode tables. Prefer `node:sqlite` where supported; keep a narrow binding adapter for the actual host runtime. Runtime qualification of Node 22.x and the OpenCode plugin host is a bounded first gate. No native addon, dependency installation, engine increase, or KV fallback is implicit. If the tested runtime cannot provide the binding, durable features report `unsupported-runtime`; existing timers remain usable. A dependency/runtime policy change requires an explicit design revision before implementation proceeds past that gate.

Suggested tables: schema metadata, projects/scopes, tasks, results, events, jobs, dependency cursors, runs, deliveries, mailbox entries, source checkpoints, target gates, worker leases. Use foreign keys, busy timeout, local-filesystem WAL where supported, unique indexes, short write transactions, and a monotonic commit position for plugin events. Do not use network shares or embed credentials in the DB.

Store multiple locations in one explicitly configured instance namespace; never key only by plugin ID. Project identity comes from the host, not caller JSON. Full local session identity includes configured instance namespace and session ID; recorded project/location snapshots detect deletion or movement. Same-project worktrees are allowed but revalidated. A moved session is paused/rejected, not followed across scope boundaries.

Every evaluation transaction records input deduplication, cursor changes, job/run changes, and outbox intent atomically. Fixed IDs and uniqueness prevent duplicate firings. Transactional leases with fencing protect workers and target gates across multiple activations. Cleanup releases only its own leases. An expired lease permits retry of the SAME delivery; it never grants permission to invent a replacement prompt. Persistent unresolved target gates survive worker loss.

For native host execution, support only one explicitly bound execution server per instance namespace. SQLite concurrency does not make two independent OpenCode executors sharing a database safe.

### 4. Replay and capability-aware host access

Plugin-only mode supports discovery, current context, direct prompts, durable plugin signals/results/mailboxes, time jobs, and dependencies on plugin-owned tasks. Recoverable native execution-history triggers and complete historical messages require the SDK adapter.

Configure a loopback same-server endpoint and credentials by environment-variable reference; optionally discover the registered service using the official client service API. Discovery must never start another server via `ensure`. The operator binds the endpoint to the instance namespace; validate version, accessible current-session identity/project/location, and authentication before using it. Do not pretend the plugin context exposes server URL or credentials. A mismatch fails closed. A direct, aligned client dependency must be declared when used.

For each observed native session, use durable log replay with checkpoint and `follow`. Buffer live observations during synchronization, deduplicate by source event identity and per-session sequence, and publish readiness only at `log.synced`. Never apply a global highest sequence across sessions or discard unprocessed replay events because a newer live event arrived first. Reconnect with bounded backoff and repeat replay after disconnect. Persist the checkpoint only with the resulting state changes.

Ephemeral idle/retry/permission/form observations are reconciled from supported snapshots where available. Never advertise replay of ephemeral transitions. A session trigger can test a current idle level after synchronized inspection; historical execution edges require the durable log. If that capability is unavailable, reject registration with `unsupported-capability`, rather than accepting a trigger that silently loses events.

### 5. Bounded declarative trigger model

No expression language. A job has a flat `all` or `any` group of at most 16 conditions plus an optional `until` group, a finite lifetime, and one action. Each condition is:

- **time:** due-at or recurring interval (safe integer seconds, at least configured minimum spacing);
- **session:** a pinned session with a current-state predicate (`idle`, `busy`, `retry`) or durable execution outcome edge;
- **signal:** exact project-local name, optional producer and correlation filter; task outcomes compile to reserved result signals.

Require correlation/task identity for business completion. Native execution edges are explicitly technical. Signal names such as `review.completed` are user-defined data; they imply business completion only through their declared producer/task contract. Reserved scheduler result names cannot be forged.

Registration atomically selects `future` or `existing_or_future` per condition. Plugin signals use the registration commit boundary; already committed retained matching evidence can satisfy the latter. SDK conditions synchronize replay first and establish a source watermark. If required history was pruned or unavailable, return `history-unavailable`, not a guessed false or success.

One-shot jobs consume one match set. Recurring event jobs consume fresh event IDs since the previous firing: ALL needs fresh evidence for every edge condition; ANY picks the earliest committed match with stable-ID tie breaking. Level predicates gate firings but do not repeatedly fire just because a level stays true. Require an edge/time driver for every recurring job. Repeated ALL task rounds need distinct correlated result events; a completed task does not complete twice. Membership is frozen at registration; "all reviewers" means the resolved explicit set, never future discovered sessions.

At most one active run and one coalesced pending firing exist per job. Periodic nominal slots are fixed and missed slots coalesce, matching timer principles. Stop/timeout/cancel take precedence when committed before admission. For `every 300 seconds until review.completed`, create a recurring time driver and a latched stop condition; already completed review means no first report. No retroactive cancellation of an admitted prompt is promised.

Source failure policy is explicit: default `fail` makes the job fail on failed/cancelled required tasks or deleted sources; `ignore` excludes that event but continues waiting to deadline; `match` treats the configured terminal outcome as evidence. For ALL, ignored sources do not shrink membership. ANY defaults fail-fast too; choose `ignore` explicitly to await another successful source. Shutdown alone does not publish task cancellation. Timeouts default to `timed_out` without activation; an optional predeclared timeout action uses the same bounded delivery path once.

### 6. Outbox, run observation, and errors

Persist a message ID from `SessionMessage.ID.create()` and the exact envelope before submitting. Retrying an ambiguous timeout reuses both. Unique `(job, firing)` and `(delivery, target)` keys prevent duplicate admission intents. Manual messaging accepts a caller idempotency key scoped to authenticated caller/task; reuse with different content returns conflict.

Before final submission recheck revision, cancellation, deadline, source stop condition, scope, target existence, limits, and target gate. Busy targets remain deferred; no repeated queue submissions. After acceptance, track matching inbox events and the enclosing execution epoch derived from durable started sequence. Host terminal events have no native run ID, so expose epoch correlation/coverage, not a fabricated exact prompt outcome. Reconcile restart from durable inbox/log evidence. If execution association is ambiguous, mark the run `uncertain` and keep the target gate conservative; do not silently release it or mark success.

New orchestrated runs can retry proven transient transport/429/5xx failures with jittered capped backoff, fixed ID, attempt/deadline bounds. Permanent not-found/scope/validation/auth-policy failures fail or pause with actionable reason. Auth repair requires explicit resume; ambiguous acknowledgement remains `uncertain` until replay/same-ID reconciliation proves admission state. Host execution failure settles that run unsuccessfully; default pauses recurring jobs, and never automatically repeats business side effects. Legacy timers retain their existing disable-on-error behavior.

Cancelling a job prevents future admissions but cannot retract accepted input. Do not interrupt a shared target session to cancel one job. Paused/uncertain jobs expose cause and a safe resume/cancel path; resume never clears an unresolved target gate blindly.

### 7. Agent-facing tools

These are proposed plugin tools, not claimed native API names. All schemas reject unknown fields, use bounded lengths/enums, derive caller identity from invocation, and return `{ ok, result }` or `{ ok: false, error: { code, message, retryable } }`.

- `session_find`: `query?`, `sessionID?`, project-local `directory?`, `parentID?`, pagination. Returns candidates with IDs, title, project/location, parent, state freshness. Ambiguity returns candidates without selecting by recency.
- `session_read`: resolved `sessionID`, `view: state|context|history|mailbox|tasks|result`, optional task/result ID or task-title filter, bounded `limit`, cursor. Reports capabilities, truncation, provenance, coverage, and current-context versus full-history distinction. The tasks view exposes authorized same-project task identities and states, not private job definitions, so completion contracts are discoverable without user-supplied task IDs.
- `session_send`: resolved `sessionID`, `mode: message|prompt`, text, task/correlation references, idempotency key. `message` writes only to the durable mailbox; `prompt` creates an activating queued delivery. Return this distinction explicitly.
- `task_update`: create a named task or transition own task to working/waiting_input/failed/cancelled/completed. Terminal publication requires summary and optional bounded JSON/reference data; creates immutable result and reserved outcome signal transactionally. Expected version and idempotency key prevent racing terminal publications.
- `signal_emit`: exact name, optional JSON payload, task/correlation ID, idempotency key. Producer/project/time are host-assigned. Signals do not activate sessions without matching authorized jobs.
- `job_create`: label, condition group, until group, action (`prompt` or `message`), target defaulting to caller, optional declared `outputTaskID`, once/repeat, already-satisfied policy, source-failure policy, lifetime/timeout, optional timeout action. An output task must belong to the target producer and be authorized as that job's intended output; declaration never completes it automatically. For a foreign target, its producer must opt the task into coordination first. Known-cycle detection follows only these explicit task-output edges; undeclared dynamic signal chains remain bounded by runtime budgets.
- `job_list`: own jobs and task/run/result detail by ID with bounded pagination; no unrestricted project dump of other sessions' private registrations.
- `job_control`: own job ID, `pause|resume|cancel`, expected revision. Cancellation is idempotent and reports accepted work separately.

Use `session_read` with result/task reference selectors for immutable result retrieval, rather than adding a broad generic database query tool. Discovery never changes state. An agent resolves references before registering; if candidates are ambiguous it asks the user. If it cannot identify the intended task within a session it asks rather than watches an unrelated successful execution. No new natural-language inference engine is required.

Examples in tool descriptions and both READMEs map all five user prompts to these steps, including asking A to publish a correlated task result when A has not adopted that contract. A passive session cannot be magically instructed without an authorized prompt.

### 8. Isolation, limits, and feedback suppression

Default: same server and project, including validated worktrees. Cross-project targets/sources are denied with no hidden data or prompt side effect. Cross-project grants and remote endpoints are optional future work, not an unsafe configuration switch in this change. Preserve legacy session-only timer mutation. Job mutation requires creator ownership; task publication requires producer ownership. Receiving sessions may read authorized same-project results and messages, not modify producers' tasks.

Transport metadata includes source session/project, target, job/run/task/signal IDs, causation/root correlation, timestamp, and content hash. User text cannot overwrite provenance. Prompt instructions are authored by the job creator; source messages/results are clearly delimited untrusted data and never promoted to system instructions or executed as templates/code. This reduces accidental instruction laundering but cannot guarantee an LLM ignores prompt injection; normal permissions remain mandatory.

Initial bounded defaults: 16 conditions/group, 32 KiB UTF-8 signal/result JSON, 16 KiB message/prompt text, 64 KiB assembled activation, 100 live jobs per owner, 1000 per project, 100 retained unread mailbox entries per target, 8 automatic causal hops, 20 activations per root chain, 1 active run/job and 1 admitted scheduler execution/target. New-job default lifetime 3600 seconds, hard maximum 7 days; existing timer defaults retain their established behavior. Project history defaults to 7 days and 10,000 unreferenced events/results; pinned unsatisfied evidence/outbox records are not deleted. Exhaustion rejects new writes with `resource-limit`; it never silently drops required evidence. Lower configurable caps are supported; increasing hard caps is a separately reviewed change.

Reject explicit self-dependencies and cycles among known task-output dependencies. Because arbitrary future signals can form dynamic cycles, also propagate trusted causation through delivered prompt metadata, task/signal calls, and all downstream jobs. Enforce hop/activation budgets persistently and pause offending jobs with diagnostics. Rate limits and target spacing apply even if an agent starts a new correlation. Unknown or malicious causal laundering cannot be statically prevented; retain project/owner caps and permissions as a second boundary.

### 9. Verification and documentation

Unit tests use fake clocks and deterministic IDs for evaluation, ALL/ANY rounds, stop precedence, errors, state machines, provenance, and limits. Repository integration tests use real SQLite transactions, competing connections, injected crash boundaries, migration fixtures, and retention. Adapter tests compile against published APIs and test capability degradation. Isolated real-server tests use a deterministic mock provider and two independent sessions; do not spend user model tokens or mutate live user sessions.

Mandatory E2E cases cover review-result to spec-update, early critical finding, ALL implementation completion to tests, periodic status until completion, and aggregate all reviewers. Include restart between commit/send/ack, already satisfied registration, source deletion, busy target, subagent/background/prose-question distinctions, same-project worktrees, denied cross-project access, and duplicate/out-of-order events. Keep all existing tests passing. Record actual targets/OS/runtime and unverified environments.

### 10. Configuration and error contract

Keep existing top-level timer defaults unchanged. Add one optional `orchestration` object with `enabled` (default false), `instanceID` (stable operator-selected local namespace), `dataDirectory` (absolute local directory), optional `sdk` (`baseUrl`, optional `tokenEnv`, optional registered-service discovery flag), and bounded `limits`/`retention` overrides. Enabled durable operation requires explicit stable identity and data directory; do not infer them from a transient worktree or process PID. Secrets are environment references, never literal tool parameters. Discovery and an explicit base URL are mutually exclusive. Unknown fields and invalid limits yield actionable validation errors for orchestration, not silently ignored safety settings. Per-location options that address one instance DB must agree; conflicting namespace/path/policy bindings fail closed rather than let the last activation overwrite policy.

The capability report distinguishes `plugin-context`, `passive-mailbox`, `durable-task-signals`, `durable-jobs`, `native-log-replay`, `historical-messages`, and `interaction-reconciliation`. No current source exposes a trustworthy portable server-installation ID to this plugin; the configured namespace plus verified endpoint binding is an explicit trust assumption, not a discovered native identifier.

Stable tool error codes include `invalid-input`, `not-found`, `ambiguous-session`, `scope-denied`, `conflict`, `unsupported-capability`, `unsupported-runtime`, `history-unavailable`, `resource-limit`, `cycle-detected`, `storage-unavailable`, `authentication-required`, `transient-host-error`, and `uncertain-delivery`. Error messages are bounded and redact secrets/content. Inspection explains paused/uncertain causes and whether retry is safe; an operator repairs SDK/storage configuration outside model prompts.

## Risks / Trade-offs

- [Plugin API lacks replay/history] -> Explicit SDK capability boundary and unsupported errors; no silent live-only durability claim.
- [Endpoint discovery binds the wrong server] -> Explicit namespace/operator binding, version/session checks, no `ensure` or arbitrary port scan.
- [SQLite binding differs in plugin host] -> Early runtime gate; no silent engine/dependency changes; timers remain available.
- [Successful host exit does not mean business success] -> Only explicit producer result completes a task.
- [Result published before relevant child work completes] -> Producer contract and examples; host idle/background evidence is diagnostic, not an omniscient verifier.
- [Terminal events lack prompt run IDs] -> Derived epoch evidence, replay, explicit uncertainty; business result is independent.
- [Worker dies after sending] -> Durable fixed message ID, same-ID reconciliation, fencing, conservative target gate.
- [Accepted prompt may outlive cancellation] -> Return boundary clearly; never interrupt unrelated work or promise retraction.
- [Dynamic signal cycles evade graph analysis] -> Persistent causal budgets, quotas, recurrence limits, no unbounded automatic activation.
- [LLM prompt injection through peer results] -> Provenance/data delimiters, no authority escalation, preserved permissions; no absolute injection-prevention claim.
- [Common checkout still changes concurrently] -> Explain worktree/revision references; coordination is not a filesystem transaction.
- [Large or stale histories] -> Bounded reads, snapshots, retention pinning, explicit history-unavailable and expired evidence.

## Migration Plan

1. Keep orchestration disabled by default until explicitly enabled in plugin options. Existing options and timer tool contracts remain valid. No existing scheduler persistence exists in this repository; do not claim a fictional previous job format needs conversion.
2. With orchestration enabled, validate runtime/storage/limits and initialize a versioned plugin DB in an explicitly configured local data directory. Register new tools only after readiness, or report actionable capability errors without breaking legacy tools.
3. Optional SDK configuration uses environment references for secrets, is validated before history features are enabled, and never changes the target server automatically.
4. Future DB versions use transactional, versioned migrations with fixture tests and preservation of IDs/cursors. Unknown-newer schemas or failed migrations fail closed for orchestration; do not overwrite or reset data.
5. On reload/unload stop new claims, stop subscriptions/timers, fence workers, release owned leases, close connections, and leave persistent jobs/outbox recoverable. Legacy timer Maps are discarded exactly as before. No waiting for unrelated session completion.
6. Rollback disables orchestration and leaves its DB intact; accepted OpenCode prompts remain outside rollback. A previous binary must refuse a newer schema rather than reinterpret it. No downgrade migration or publication is automatic.

## Open Questions

These are deliberately non-semantic release-qualification details; they cannot relax the specs without a follow-up decision:

- Which exact supported Node 22 patch levels and OpenCode host builds expose the chosen built-in SQLite binding? The first runtime-contract task records the matrix or marks durable features unavailable for that environment.
- Which registered local service layouts can be safely discovered on each tested OS? Explicit configured loopback endpoint/authentication remains the supported baseline if discovery is unavailable.
- Which human-readable presentation best exposes uncertainty and provenance in text tool output? The stable machine fields and error behavior are fixed by the specs.

Not technically promised: recognizing arbitrary business completion from prose; passive UI chat delivery without future model input; recovery of ephemeral event transitions; observing untracked background processes; exactly-once downstream effects; automatic federation across servers. Optional cross-server transport requires a separate identity/authentication/retention threat model and acceptance contract.
