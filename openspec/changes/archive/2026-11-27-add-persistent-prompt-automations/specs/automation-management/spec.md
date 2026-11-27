# Spec Delta

## Purpose

Allow users to configure and manage durable prompt automations separately from temporary session timers, with explicit schedules, targets, and inspectable lifecycle state.

## ADDED Requirements

### Requirement: Discoverable automation tools
The plugin SHALL expose `automation_create`, `automation_list`, `automation_update`, `automation_pause`, `automation_resume`, and `automation_remove`. Descriptions SHALL explain schedule units, target policies, persistence, ownership, missed-occurrence defaults, and cancellation limits without requiring additional agent instructions.

#### Scenario: Natural-language routine
- **WHEN** a user asks for a weekday assigned-PR report with direct links in a new chat
- **THEN** the agent can represent the routine using the registered automation tools
- **AND** the report remains a normal prompt task rather than a provider-specific scheduler operation

#### Scenario: Explicit pause versus run interruption
- **WHEN** the agent inspects the automation tools
- **THEN** their descriptions distinguish pausing future occurrences from interrupting a currently executing chat

### Requirement: Durable automation creation
Creation SHALL accept a non-empty prompt, an optional label, a structured recurrence, an explicit target policy, and an optional missed-occurrence policy defaulting to `skip`. It SHALL return a unique automation ID and effective settings only after durable storage succeeds. Automations SHALL have no timer-style default expiration and SHALL remain until explicitly removed.

#### Scenario: Successful creation
- **WHEN** a valid recurring automation is created
- **THEN** the response identifies its persisted schedule, target, missed-occurrence policy, and next occurrence
- **AND** restarting OpenCode does not discard its definition

#### Scenario: Storage failure
- **WHEN** persistence fails during creation
- **THEN** the tool returns a controlled error and does not report or activate a successfully created automation

### Requirement: Validated structured recurrences
An automation SHALL accept either an integer-second interval of at least the effective minimum spacing or a five-field cron expression with a valid IANA time zone. Invalid, ambiguous, unsupported, or unsatisfiable inputs SHALL produce a controlled error without changing durable or active state.

#### Scenario: Interval automation
- **WHEN** an automation uses an interval of 1800 seconds
- **THEN** its effective schedule identifies the interval and its stable recurrence anchor

#### Scenario: Calendar automation
- **WHEN** an automation uses `0 9 * * 1-5` in `Europe/Berlin`
- **THEN** its effective schedule reports that expression and time zone and a future weekday 09:00 occurrence

#### Scenario: Rejected schedules
- **WHEN** an input has a fractional or too-short interval, an invalid time zone, six cron fields, or no possible future date
- **THEN** creation or update fails without partially applying the input

### Requirement: Location-scoped management
Every automation SHALL belong to the invoking session's validated project and plugin location. Management SHALL be available from sessions in that same ownership scope, independent of the target chat. Tools SHALL NOT allow callers to override ownership or inspect or mutate automations from another scope.

#### Scenario: Manage a routine from a different chat
- **WHEN** a user opens another session in the owning location and lists automations
- **THEN** the same automation is visible and can be explicitly paused or updated

#### Scenario: Foreign automation ID
- **WHEN** a caller attempts to update or remove an automation owned by another project or location
- **THEN** it receives a scope-local not-found result without disclosure or mutation

### Requirement: Atomic automation updates
Updates SHALL require an owned automation ID and a non-empty validated patch. Identity and ownership SHALL remain unchanged. Prompt, label, target, recurrence, and missed-occurrence policy changes SHALL be persisted atomically before becoming effective. Schedule changes SHALL recompute future occurrences; admitted runs SHALL retain their submitted snapshot.

#### Scenario: Change an interval
- **WHEN** an interval is changed at 10:00 to 1800 seconds
- **THEN** future interval occurrences are anchored to that update and the next is 10:30
- **AND** the automation's identity and original creation time remain unchanged

#### Scenario: Update during an admitted run
- **WHEN** an already admitted report is executing and its prompt or target is updated
- **THEN** that report uses its original snapshot and future runs use the persisted revision
- **AND** the update does not permit an overlapping automation run

#### Scenario: Failed update persistence
- **WHEN** the durable write for a valid update fails
- **THEN** both the visible definition and future execution keep the previous effective revision

### Requirement: Explicit pause resume and removal
Pause SHALL persistently prevent future admissions without deleting the definition. Resume SHALL preserve recurrence anchors and apply the configured missed-occurrence policy, but SHALL fail while a target or prior handoff is unresolved. Removal SHALL persistently delete the automation. These actions SHALL NOT interrupt unrelated chat execution or promise retraction of admitted prompts.

#### Scenario: Pause survives restart
- **WHEN** an automation is paused and OpenCode restarts
- **THEN** it remains paused and is not admitted until explicitly resumed

#### Scenario: Resume after skipped occurrences
- **WHEN** a paused automation with the default policy is resumed after several occurrences
- **THEN** it schedules only the next future occurrence and does not run immediately as catch-up

#### Scenario: Removal races with admission
- **WHEN** removal completes before the final admission check
- **THEN** no new prompt is submitted for that automation
- **AND** if input was already admitted the response warns that it can still execute

### Requirement: Inspectable definition and run state
Listing SHALL return owned definitions including ID, label, prompt, recurrence, time zone when applicable, target policy and bound chat, missed-occurrence policy, next future occurrence, pending due occurrence if any, enabled/paused state and reason, run state, accepted-run count, and last outcome/error. It SHALL distinguish due, checking, queued, running, and unresolved states from successful completion.

#### Scenario: Report waits for a busy chat
- **WHEN** an occurrence is due but the target is busy
- **THEN** listing shows the pending due occurrence and deferral rather than claiming the report ran

#### Scenario: Accepted is not successful
- **WHEN** the host accepts input but the corresponding execution has not terminated
- **THEN** listing shows an outstanding run, not a successful outcome

#### Scenario: Lost target is diagnosable
- **WHEN** a bound target is deleted
- **THEN** listing retains the automation with a paused target-unavailable reason
