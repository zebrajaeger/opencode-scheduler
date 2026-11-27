# Spec Delta

## MODIFIED Requirements

### Requirement: In-memory lifetime
All temporary `timer_*` definitions, due state, and counters SHALL exist only in memory. Plugin unload or server restart SHALL discard them without automatic restoration. Persistent automations SHALL retain their definitions and recovery state through official plugin storage, but SHALL execute only in active plugin runtime without creating a background service.

#### Scenario: Restart
- **WHEN** the plugin or server restarts after timers were created
- **THEN** timer_list reports no restored timers
- **AND** the documentation distinguishes this from already accepted input stored by OpenCode itself

#### Scenario: Automation survives restart
- **WHEN** the plugin or server restarts after an automation was persisted
- **THEN** automation_list retains its definition and paused/enabled state
- **AND** its activation follows the automation missed-occurrence and admission-recovery rules

### Requirement: Session interruption stops timers
On an owning session's `session.execution.interrupted` event, the plugin SHALL remove all its temporary timers, invalidate local pending timer dispatches, and prevent future timer admissions. A normal successful execution or UI navigation SHALL NOT cancel timers. Persistent automations SHALL NOT be deleted by interruption; their run outcomes and future admissions SHALL follow the automation lifecycle rules.

#### Scenario: User aborts the session
- **WHEN** the session's execution is interrupted
- **THEN** all its timers stop and no later local callback can restart them
- **AND** other sessions' timers remain intact

#### Scenario: Chat navigation or successful answer
- **WHEN** the user views another chat or a normal agent response completes
- **THEN** the timers remain active while the server and plugin location stay active

#### Scenario: Persistent routine in interrupted session
- **WHEN** a target session with a stored automation is interrupted
- **THEN** the automation definition remains stored
- **AND** only explicit automation pause/removal or a diagnosed automation error prevents later occurrences

### Requirement: Reliable cleanup
On unload the plugin SHALL mark itself closed, discard temporary timers and volatile automation scheduling state, clear native timeouts, terminate its event subscription, dispose registrations as supported by the host, and stop scheduling new work. It SHALL preserve durable automation records, handle late results without unhandled rejections or state resurrection, and SHALL NOT await unrelated agent work.

#### Scenario: Cleanup with pending work
- **WHEN** plugin unload occurs during an owner check or prompt admission
- **THEN** cleanup returns without waiting for the session to finish and no late result schedules another timer
- **AND** already accepted OpenCode input is explicitly outside the cleanup guarantee

#### Scenario: Cleanup preserves automation recovery
- **WHEN** plugin unload occurs with a persisted automation admission outstanding
- **THEN** no new local admission occurs and its durable recovery record is retained
- **AND** reactivation reconciles it instead of blindly creating another run

### Requirement: Documented compatibility and verification
The README SHALL cover installation, options, examples, supported versions, architecture, timing/cancellation/permission limits, development, and OpenCode/OpenChamber smoke procedures. It SHALL distinguish timers from durable automations, target policies, time zones, and missed-occurrence defaults. OpenCode 2.3.2 and 2.4.1 SHALL be tested as targets; untested versions and V1 SHALL NOT be advertised as supported.

#### Scenario: Release readiness
- **WHEN** the first functional version is considered ready
- **THEN** deterministic scheduler tests and integration tests pass, target-version verification results are recorded, and the manual smoke procedure covers both OpenCode and OpenChamber
- **AND** any unavailable environment is reported as unverified instead of claimed as a passing test

#### Scenario: Automation readiness
- **WHEN** persistent automations are considered ready
- **THEN** documentation and recorded tests cover restart persistence, target selection, skipped and explicit catch-up occurrences, interrupted runs, permissions, and recovery of outstanding admissions
- **AND** closing a UI window is not documented as necessarily stopping the OpenCode server or its active plugin locations
