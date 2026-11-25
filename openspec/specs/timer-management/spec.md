# timer-management Specification

## Purpose

Allow agents to manage bounded, identifiable timers in their own conversation without requiring user-facing commands or additional agent instructions.

## Requirements

### Requirement: Discoverable timer tools
The plugin SHALL expose `timer_start`, `timer_stop`, `timer_list`, `timer_update`, and `timer_stop_all`. Their descriptions and schemas SHALL explain scheduling, units, lifetime, ownership, busy deferral, and cancellation limits sufficiently for natural-language use without an AGENTS.md addition.

#### Scenario: Natural-language management
- **WHEN** an agent receives requests to check a container in two minutes, report test status every five minutes, change the interval, list timers, or stop monitoring
- **THEN** the available tool descriptions provide enough information to select the corresponding operation and valid arguments
- **AND** no slash command, separate UI, or plugin-owned language-model request is required

### Requirement: One-shot and recurring timer creation
`timer_start` SHALL accept a non-empty prompt, `mode` (`once` or `repeat`), optional label, timing in integer seconds, and optional `maxLifetimeSeconds`. One-shot timers SHALL require `delaySeconds`; recurring timers SHALL require `intervalSeconds` and default their first delay to that interval. Successful creation SHALL return a unique timer ID and its effective schedule.

#### Scenario: One-shot timer
- **WHEN** a timer is started with mode `once` and delaySeconds 120
- **THEN** its first due time is 120 seconds after creation and it permits at most one accepted dispatch

#### Scenario: Recurring timer with delayed first run
- **WHEN** a timer is started with mode `repeat`, intervalSeconds 300, and delaySeconds 120
- **THEN** its first due time is 120 seconds after creation and subsequent nominal slots are spaced 300 seconds apart

### Requirement: Session-local identity and authorization
Every timer SHALL receive a plugin-generated unique ID and SHALL belong to the tool invocation's session, project, and location. Management tools SHALL operate only on that ownership scope and SHALL NOT accept a target session or project override.

#### Scenario: Multiple independent timers
- **WHEN** two timers are started in one session and another timer in a different session
- **THEN** all receive distinct IDs and each session can list or modify only its own timers

#### Scenario: Foreign timer ID
- **WHEN** a session attempts to update or stop another session's timer ID
- **THEN** the operation returns a session-local not-found result without revealing or changing the foreign timer

### Requirement: Bounded real-time lifetime
Timer lifetime SHALL default to 3600 seconds unless a valid plugin default or explicit tool value replaces it. Expiry SHALL be measured from original creation, including busy deferrals and execution time. No dispatch SHALL begin at or after expiry, and expired records SHALL be removed.

#### Scenario: Default lifetime
- **WHEN** a timer is created without an explicit lifetime or configured alternative
- **THEN** it expires exactly one hour after creation even if the session remained busy

#### Scenario: Explicit lifetime expires while deferred
- **WHEN** a due timer with maxLifetimeSeconds 600 remains deferred until its expiry
- **THEN** it is removed without a late dispatch

### Requirement: Atomic timer updates
`timer_update` SHALL accept timer ID and a non-empty patch of prompt, label, timing, or lifetime. It SHALL keep mode, identity, ownership, and original creation time unchanged. Timing changes SHALL reset the next due time from update time; other changes SHALL preserve it. In-progress dispatch snapshots SHALL not be rewritten.

#### Scenario: Interval change
- **WHEN** a recurring timer's interval is changed to 600 seconds without a lifetime change
- **THEN** its next due time becomes 600 seconds after the update and its original expiry remains unchanged

#### Scenario: Lifetime change
- **WHEN** maxLifetimeSeconds is updated
- **THEN** expiry is recalculated from original creation time
- **AND** an invalid or already elapsed expiry is rejected without partial mutation

#### Scenario: Update during execution
- **WHEN** a timer prompt has already been accepted and the agent updates that timer
- **THEN** only future dispatches use the updated definition and no second dispatch overlaps the existing one

### Requirement: Validated timing and input
All timing values SHALL be finite positive safe integers. Delays and intervals SHALL meet the effective minimum spacing, defaulting to 30 seconds and never configurable below 30 seconds. A first due time SHALL precede expiry. Invalid input SHALL return a controlled error without changing any timer.

#### Scenario: Invalid or excessive frequency
- **WHEN** creation or update supplies an empty prompt, fractional duration, non-positive value, unsafe integer, or interval below the minimum
- **THEN** it is rejected and existing state is unchanged

#### Scenario: Schedule cannot run within lifetime
- **WHEN** creation or a timing update places its next due time at or after expiry
- **THEN** the operation is rejected with an actionable explanation

### Requirement: Inspectable timer status
`timer_list` SHALL return session-local unexpired timer records including ID, label, mode, prompt, creation time, expiry, interval if applicable, next due time if applicable, status, accepted run count, and last error if present. Status SHALL distinguish scheduled, due/deferred, in-flight, and disabled-by-error records.

#### Scenario: Busy deferral is visible
- **WHEN** the agent lists timers while a timer is due but cannot run
- **THEN** its record indicates deferral rather than claiming that the prompt executed

### Requirement: Explicit cancellation
`timer_stop` SHALL remove one owned timer; `timer_stop_all` SHALL remove all owned timers and return the removed count. Repeated cancellation SHALL be safe. Cancellation SHALL prevent future admissions and discard local due state, but SHALL NOT interrupt the session or promise retraction of already accepted input.

#### Scenario: Stop all timers
- **WHEN** timer_stop_all is called in a session with multiple timers
- **THEN** all its timers are removed and timers in other sessions remain unchanged

#### Scenario: Stop races with admission
- **WHEN** cancellation occurs before final local admission checks
- **THEN** no prompt is submitted for that timer
- **AND** if admission already crossed into OpenCode the result explains that the accepted check can still run
