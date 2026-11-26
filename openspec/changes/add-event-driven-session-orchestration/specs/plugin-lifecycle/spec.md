# Spec Delta

## MODIFIED Requirements

### Requirement: In-memory lifetime
All definitions, due state, and counters created through the five legacy timer tools SHALL exist only in memory. Plugin unload or server restart SHALL discard them without automatic restoration or background service creation. Opt-in orchestration jobs, including new time jobs, SHALL persist under the separate durable orchestration contract and SHALL NOT appear as restored legacy timers.

#### Scenario: Restart
- **WHEN** the plugin or server restarts after timers were created
- **THEN** timer_list reports no restored timers
- **AND** the documentation distinguishes this from already accepted input stored by OpenCode itself

#### Scenario: Persistent time job is separate
- **WHEN** an agent explicitly creates a durable time job through the orchestration tools and the plugin restarts
- **THEN** job inspection restores that job while timer_list remains limited to current in-memory timers

### Requirement: Reliable cleanup
On unload the plugin SHALL mark itself closed, discard legacy timers, clear native timeouts, terminate subscriptions, dispose registrations, and stop scheduling new work. It SHALL fence durable workers and preserve orchestration state for recovery. Late results SHALL NOT resurrect work or clear another worker's claim. Cleanup SHALL NOT wait for unrelated agent work or promise retraction of accepted input.

#### Scenario: Cleanup with pending work
- **WHEN** plugin unload occurs during an owner check or prompt admission
- **THEN** cleanup returns without waiting for the session to finish and no late result schedules another timer
- **AND** already accepted OpenCode input is explicitly outside the cleanup guarantee

#### Scenario: Durable work survives cleanup
- **WHEN** plugin unload occurs with waiting jobs or unresolved deliveries
- **THEN** their durable state is retained and a subsequent activation reconciles it before new admissions

### Requirement: Documented compatibility and verification
The README SHALL cover installation, options, natural-language examples, supported versions, architecture, timing/cancellation/permissions limitations, development commands, and a manual OpenCode/OpenChamber smoke procedure. OpenCode 2.3.2 and 2.4.1 SHALL remain test targets; untested versions and V1 SHALL not be advertised as supported. Orchestration docs SHALL identify runtime and SDK capability requirements separately from legacy timer support.

#### Scenario: Release readiness
- **WHEN** the first functional version is considered ready
- **THEN** deterministic scheduler tests and integration tests pass, target-version verification results are recorded, and the manual smoke procedure covers both OpenCode and OpenChamber
- **AND** any unavailable environment is reported as unverified instead of claimed as a passing test

#### Scenario: Orchestration release qualification
- **WHEN** durable orchestration is advertised for a runtime and host version
- **THEN** isolated OpenCode-only E2E tests cover its supported capabilities and the docs identify unsupported history, replay, or runtime features without requiring OpenChamber

## ADDED Requirements

### Requirement: Opt-in durable orchestration lifecycle
The plugin SHALL enable durable coordination only through validated orchestration options. Existing configuration and timer tools SHALL retain their defaults and interruption/error behavior. Invalid or unavailable orchestration storage/runtime SHALL fail that capability clearly without silently weakening durability or preventing legacy timer use.

#### Scenario: Existing configuration unchanged
- **WHEN** the user loads the plugin with only existing timer options
- **THEN** the same five timer tools work with the same defaults and no durable orchestration database is required

#### Scenario: Unsupported storage runtime
- **WHEN** orchestration is enabled in a runtime without a verified supported storage binding
- **THEN** it reports unsupported-runtime and legacy timer tools remain usable

### Requirement: Complete orchestration documentation
Documentation SHALL cover architecture, lifecycle, tool schemas, trigger/event semantics, explicit completion, configuration, migration, error recovery, resource limits, permissions, and known API limitations. It SHALL include all five natural-language collaboration examples and distinguish mandatory same-server features from optional extensions.

#### Scenario: Follow example workflows
- **WHEN** a user reads the orchestration guide
- **THEN** it explains review-to-spec-update, critical-finding notification, ALL implementations to tests, periodic status until completion, and aggregation of all reviewers without requiring users to supply native event names or session IDs

#### Scenario: Unsupported guarantees are visible
- **WHEN** the user checks limitations
- **THEN** the docs explicitly exclude exactly-once agent effects, prose-based completion inference, universal background observation, and automatic multi-server federation
