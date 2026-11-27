# Spec Delta

## Purpose

Make registered coordination durable and recoverable while bounding duplicate admission, concurrent workers, ambiguous outcomes, and storage evolution.

## ADDED Requirements

### Requirement: Durable atomic coordination
New orchestration jobs, tasks, results, signals, mailbox entries, firing evidence, delivery intents, and replay checkpoints SHALL persist across reloads and restarts. Recording an event, satisfying dependencies, and creating its resulting delivery intents SHALL be atomic. Failure SHALL leave no partially visible success.

#### Scenario: Crash after result publication
- **WHEN** a process dies after committing a completed result but before sending its dependent prompt
- **THEN** recovery retains both the result and exactly one logical pending delivery

#### Scenario: Storage write fails
- **WHEN** a transaction fails while creating an ALL firing
- **THEN** no partial result consumption, run, or success acknowledgement is exposed

### Requirement: Durable source synchronization
Native durable event sources SHALL replay from per-source checkpoints and synchronize before historical conditions are evaluated or delivery gates reopened. Reconnect SHALL use bounded backoff and replay. Deduplication SHALL include instance/session identity and event identity or aggregate sequence; out-of-order live input SHALL NOT cause replay evidence to be skipped.

#### Scenario: Completion occurred during downtime
- **WHEN** a watched execution ended while the plugin was offline
- **THEN** supported log replay recovers its terminal event and evaluates dependent jobs once

#### Scenario: Live event overtakes replay
- **WHEN** a newer live event arrives before older unprocessed replay events for that session
- **THEN** all relevant committed evidence is processed in source order without dropping the older match

#### Scenario: Ephemeral transition was missed
- **WHEN** a permission or idle transition occurred during downtime
- **THEN** the system uses supported current-state reconciliation and does not fabricate a replayed transition

### Requirement: Stable idempotent admission intent
Every activating delivery SHALL persist one official OpenCode message ID and immutable payload before submission. Allowed retries SHALL reuse both. Unknown admission outcomes SHALL NOT be automatically resent: same-ID deduplication is not guaranteed after Inbox cancellation. Duplicate evidence SHALL NOT create another logical delivery. No exactly-once agent effects SHALL be promised.

#### Scenario: Prompt accepted but response lost
- **WHEN** OpenCode accepted a prompt and its API acknowledgement was lost
- **THEN** recovery reconciles using the original ID without resending; unknown remains uncertain and no replacement ID is created

#### Scenario: Duplicate event delivery
- **WHEN** one signal or native event is ingested repeatedly
- **THEN** the same job firing produces at most one logical run and delivery

### Requirement: Concurrency-safe worker ownership
Concurrent plugin activations SHALL claim work transactionally with fencing and target-level arbitration. A stale worker SHALL NOT overwrite a newer claim or clear another delivery's gate. Losing a worker lease SHALL NOT imply that an admitted prompt or active target execution has completed.

#### Scenario: Two locations see one result
- **WHEN** two plugin activations observe the same result and attempt to dispatch its follow-up
- **THEN** one logical firing and target admission intent exist

#### Scenario: Lease expires during request
- **WHEN** a worker stalls after submission and another worker recovers its lease
- **THEN** recovery retains the original message ID and unresolved execution gate instead of opening a parallel scheduler execution

### Requirement: Conservative delivery reconciliation
The system SHALL distinguish admission, delivery, and host execution settlement using verified inbox and durable execution evidence. Derived execution epochs SHALL NOT be advertised as native run IDs. Unresolved association SHALL remain uncertain and block unsafe target admissions until reconciled; unrelated targets SHALL remain usable.

#### Scenario: Fast delivery precedes response
- **WHEN** inbox delivery and execution terminal events arrive before the prompt request resolves
- **THEN** the same run settles at most once without hanging or clearing a newer target gate

#### Scenario: Ambiguous execution association
- **WHEN** an accepted message cannot be safely associated with an execution after restart
- **THEN** its run remains uncertain and no later scheduler prompt bypasses the unresolved target gate

### Requirement: Classified bounded failures
New jobs SHALL distinguish proven non-admission failures from ambiguous outcomes and permanent validation, scope, missing-session, and policy failures. Only proven non-admission failures SHALL automatically retry with capped backoff, attempts, deadline, and the same intent. Unknown outcomes SHALL stay uncertain. Execution failure SHALL NOT replay business effects; recurring jobs SHALL pause by default.

#### Scenario: Temporary server outage
- **WHEN** submission receives a retryable transport or server error
- **THEN** a proven non-admission permits bounded same-ID retry; otherwise the intent becomes uncertain without an automatic resend

#### Scenario: Target deleted or moved
- **WHEN** pre-dispatch validation confirms deletion or a project/location mismatch
- **THEN** the run fails or pauses with a permanent diagnostic and no replacement session is created

#### Scenario: Authentication failure
- **WHEN** SDK access is rejected by authentication or policy
- **THEN** affected work pauses with an actionable diagnostic and does not retry indefinitely or weaken authentication

### Requirement: Versioned storage and controlled recovery
Persistent records SHALL have a schema version with tested atomic migrations preserving identities and pending work. Unknown-newer schemas, corruption, and migration failures SHALL fail closed without overwriting data. Historical ephemeral timer state SHALL NOT be invented or restored. Rollback SHALL leave durable data intact.

#### Scenario: Upgrade with pending work
- **WHEN** a supported old schema contains an accepted run and waiting dependencies
- **THEN** migration preserves their IDs, evidence, and conservative delivery state

#### Scenario: Downgrade opens newer data
- **WHEN** an older plugin encounters an unsupported newer schema
- **THEN** it refuses durable orchestration with a diagnostic and does not reset or reinterpret the database

### Requirement: Bounded retention without evidence loss
Retention SHALL preserve evidence referenced by waiting jobs, results referenced by active runs, unread retained mailbox entries within quota, and unresolved deliveries/checkpoints. Reads SHALL identify truncation or unavailable history. Resource exhaustion SHALL reject new work explicitly rather than silently deleting required coordination state.

#### Scenario: Cleanup with waiting dependencies
- **WHEN** retention cleanup runs while jobs reference older result evidence
- **THEN** that evidence remains usable until no longer needed or the job expires

#### Scenario: Requested evidence was pruned
- **WHEN** registration or retrieval requires history beyond retained coverage
- **THEN** it returns history-unavailable rather than assuming an unmet or fulfilled dependency
