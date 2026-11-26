# Spec Delta

## Purpose

Provide durable, attributable agent signals and immutable task outcomes that give independent sessions an explicit business-completion contract.

## ADDED Requirements

### Requirement: Named structured signals
Authorized agents SHALL publish and subscribe to exact named signals with optional bounded JSON payloads, producer filters, and task/correlation references. Signals SHALL be scoped to the configured instance and host-derived project. Publication SHALL persist before success is returned and SHALL NOT activate a session without an authorized matching job.

#### Scenario: Publish an early critical finding
- **WHEN** a reviewer publishes review.critical-finding with structured finding data while its review remains working
- **THEN** matching subscriptions can notify the implementer without marking the review completed

#### Scenario: Same name in another project
- **WHEN** another project publishes review.completed
- **THEN** it cannot satisfy a subscription in the caller's project

### Requirement: Explicit producer-owned tasks
Agents SHALL create named tasks owned by the invoking session and update them through open, working, waiting_input, completed, failed, or cancelled states. Only the producer SHALL publish its terminal outcome. Terminal transitions SHALL require a summary and SHALL be irreversible for that task identity.

#### Scenario: Wait for user input without false completion
- **WHEN** A marks its review task waiting_input
- **THEN** completed-result dependencies remain waiting and inspection exposes the explicit waiting state

#### Scenario: Another session attempts completion
- **WHEN** B attempts to complete A's task
- **THEN** the operation is rejected without changing the task or emitting a result

### Requirement: Atomic authoritative result publication
A terminal task publication SHALL atomically store an immutable result, transition the task, emit its reserved outcome signal, and evaluate dependent jobs. Publishing completed SHALL be the business-completion boundary, independent of later idle or execution events. Producers SHALL finish relevant subagent/background work before declaring completed.

#### Scenario: Review releases specification work
- **WHEN** A commits a completed review result after gathering its relevant child results
- **THEN** B's matching dependency becomes eligible with that result even while A is composing its final chat reply

#### Scenario: Execution succeeds without explicit result
- **WHEN** A's execution succeeds but A has not published the review task completed
- **THEN** a dependency on that task's completed result remains waiting

### Requirement: Immutable and idempotent outcomes
Results SHALL contain schema version, producer/project, task identity, outcome, timestamp, summary, optional JSON data, and bounded references. Repeating an identical terminal publication with its idempotency key SHALL return the original result. Conflicting terminal publications SHALL fail. Corrections SHALL create a new linked result identity without retracting consumed results.

#### Scenario: Concurrent completion and failure
- **WHEN** two terminal updates race for one task revision
- **THEN** one commits and the other returns conflict without creating a second terminal result

#### Scenario: Producer continues after publication
- **WHEN** A later fails, is interrupted, or publishes a correction as a new task/result
- **THEN** the original result remains unchanged and previously released work is not automatically cancelled or rerun

### Requirement: Signal identity and reserved outcomes
Signals SHALL have durable unique identity, host-derived origin, commit ordering, and optional causation. Repeated publication keys SHALL deduplicate within producer scope and reject different payloads. Reserved task-outcome names SHALL be emitted only by task transitions, not arbitrary signal publication.

#### Scenario: Forged task completion signal
- **WHEN** an agent tries to publish a reserved completed-result signal without the corresponding task transition
- **THEN** the request fails and no dependent job is released

#### Scenario: Retry after lost acknowledgement
- **WHEN** signal publication committed but the caller retries the same publication key after losing the response
- **THEN** it receives the original signal identity and subscribers observe one logical event

### Requirement: Explicit completion contracts for unprepared sessions
The system SHALL distinguish custom signal names from authoritative task outcomes. Discovering a session SHALL NOT invent a task or completion contract for it. Agent guidance SHALL require an authorized request to the producer or user clarification when no suitable business-completion contract exists.

#### Scenario: Existing review has no task publication
- **WHEN** B discovers an already running reviewer that has not adopted an explicit completion contract
- **THEN** B does not equate its next idle or successful execution with completed review and instead establishes the contract or asks for clarification
