# Spec Delta

## Purpose

Coordinate bounded follow-up work using shared time, session, and signal conditions without consuming agent execution resources while dependencies remain unsatisfied.

## ADDED Requirements

### Requirement: Common trigger registration
The system SHALL register jobs with time, session, or signal conditions through one management contract. Each job SHALL have an owner, pinned sources and target, one action, a flat ALL or ANY group, once or repeat mode, and a finite lifetime. Unsupported predicates or source capabilities SHALL fail registration atomically.

#### Scenario: Three trigger categories
- **WHEN** agents register a time deadline, a technical session-outcome edge, and an explicit result-dependent job
- **THEN** all expose the same identity, inspection, cancellation, lifecycle, and delivery guarantees

#### Scenario: Unsupported durable session history
- **WHEN** an execution-outcome edge requires replay but the configured host adapter cannot provide it
- **THEN** registration returns unsupported-capability instead of creating a live-only dependency

### Requirement: Single and multiple source dependencies
Single-source jobs SHALL fire on their matching condition. ALL SHALL require evidence for every pinned member; ANY SHALL require one matching member. Matching SHALL retain source identities and immutable result references in the run snapshot. Simultaneous matches SHALL produce at most one firing for a one-shot job.

#### Scenario: Test after both implementations
- **WHEN** two implementation tasks are ALL dependencies and only one has completed
- **THEN** tests do not start until the other publishes its completed result

#### Scenario: Aggregate all reviewers
- **WHEN** every task in the pinned reviewer set has published its required result
- **THEN** one summarization run receives references to all matched reviewer results

#### Scenario: ANY races
- **WHEN** two ANY members match concurrently
- **THEN** one firing is selected deterministically and no duplicate action is created

### Requirement: Existing and future evidence
Registration SHALL specify future or existing_or_future evidence per condition. The registration boundary and evidence evaluation SHALL be race-safe. Existing retained evidence SHALL satisfy the latter mode, while unavailable required history SHALL return history-unavailable. State-level and execution-edge conditions SHALL have distinct semantics.

#### Scenario: Completion during registration
- **WHEN** a result is published concurrently with registration of an existing_or_future dependency
- **THEN** the job fires once whether publication commits immediately before or after registration

#### Scenario: Review completed earlier
- **WHEN** retained matching completed evidence already exists at registration
- **THEN** existing_or_future makes the job eligible and future waits for new matching evidence

### Requirement: Business completion is not inferred
Jobs SHALL distinguish explicit task outcomes, session idle levels, and native execution outcomes. Successful execution, idle, absence of forms, or completion of one child SHALL NOT satisfy a completed-task condition. Session-level predicates SHALL expose snapshot freshness and SHALL NOT claim historical ephemeral-transition replay.

#### Scenario: Successful but incomplete review
- **WHEN** an execution ends successfully after reporting partial progress with background review still outstanding
- **THEN** only explicitly configured technical conditions can match and the completed-task condition remains unsatisfied

### Requirement: Defined recurring rounds
Recurring edge jobs SHALL consume fresh evidence after each firing; ALL SHALL require fresh evidence for every edge member and ANY SHALL select one deterministic matching event. Level conditions SHALL gate an edge or time driver rather than repeatedly fire by remaining true. A job SHALL have at most one active run and one coalesced pending firing.

#### Scenario: Recurring ALL uses fresh rounds
- **WHEN** a recurring ALL group consumed events from A and B and only A publishes a new matching event
- **THEN** no next run starts until B also provides fresh matching evidence

#### Scenario: Level-only recurrence
- **WHEN** a recurring job contains only an idle level and no edge or time driver
- **THEN** registration is rejected rather than creating an activation loop

#### Scenario: Completed task is not repeated
- **WHEN** an already consumed terminal task remains completed
- **THEN** it cannot repeatedly satisfy new rounds without distinct matching correlated result events

### Requirement: Combined time and stop conditions
Jobs SHALL combine a time driver with event/state gates and an optional latched ALL/ANY stop group. Repeated intervals SHALL use fixed nominal slots, coalesce missed slots, and honor shared target spacing. Stop evidence committed before final admission SHALL prevent that admission and all future firings.

#### Scenario: Status every five minutes until review completion
- **WHEN** a 300-second status job has a review-completed stop condition
- **THEN** status runs recur without catch-up bursts until that result is committed and no further unadmitted report starts

#### Scenario: Stop already satisfied
- **WHEN** registration includes existing_or_future stop evidence that already matches
- **THEN** the job completes without sending an initial status report

#### Scenario: Stop after admission
- **WHEN** review completion arrives after a status prompt was admitted
- **THEN** future runs stop and inspection explains that accepted input can still execute

### Requirement: Source failure policies
Jobs SHALL define fail, ignore, or match handling for failed/cancelled required tasks and deleted sources, defaulting to fail. Ignore SHALL preserve ALL membership and wait until the deadline; match SHALL require the configured terminal condition. Shutdown interruption alone SHALL NOT cancel a business task.

#### Scenario: Failed implementation in ALL
- **WHEN** a required implementation fails under default policy
- **THEN** the test job fails with source provenance and does not activate the test session

#### Scenario: ANY waits for another success
- **WHEN** one ANY source fails under explicit ignore policy
- **THEN** the job remains eligible to await another matching source until its deadline

#### Scenario: Restart suspension
- **WHEN** a source execution is interrupted for shutdown without explicit task cancellation
- **THEN** the task dependency remains pending for recovery rather than being marked cancelled

### Requirement: Deadlines and cancellation
Jobs SHALL support optional shorter timeouts within their finite lifetime and idempotent cancellation. Expiry SHALL transition to timed_out without activation unless one bounded timeout action was declared. Cancellation SHALL stop future admissions without interrupting the target or promising retraction of accepted input.

#### Scenario: Timeout action runs once
- **WHEN** an unsatisfied job reaches its deadline with a declared timeout notification
- **THEN** it records timed_out and creates at most one notification through the normal delivery path

#### Scenario: Cancel races with readiness
- **WHEN** cancellation commits before final admission of a ready run
- **THEN** the run is not submitted and a late asynchronous check cannot revive it

### Requirement: Inspectable job and run lifecycle
Jobs SHALL expose waiting, ready, active, paused, completed, cancelled, timed_out, or failed state. Runs SHALL separately expose pending, submitting, accepted, delivered, settled, cancelled, failed, or uncertain state, matched evidence, timestamps, bounded errors, and host outcome when established. Admission and technical settlement SHALL NOT imply business success.

#### Scenario: Accepted is not completed
- **WHEN** the prompt API confirms admission but no delivery or terminal evidence is known
- **THEN** inspection shows accepted, not delivered, settled, or task-completed

#### Scenario: Lost execution association
- **WHEN** evidence cannot safely associate an accepted delivery with a host execution epoch
- **THEN** the run is uncertain with a diagnostic rather than falsely successful

### Requirement: Nonblocking agent management
Registration, listing, pause/resume, and cancellation SHALL return without waiting for source completion or target idle. Waiting jobs SHALL consume no ongoing model execution or polling prompts. Tools SHALL use strict schemas, bounded errors, ownership checks, and discoverable task/result references.

#### Scenario: Session B waits without token consumption
- **WHEN** B registers a dependency on A and ends its response
- **THEN** server-side scheduling retains the dependency without a sleeping tool, active agent loop, or repeated model call until an action is eligible
