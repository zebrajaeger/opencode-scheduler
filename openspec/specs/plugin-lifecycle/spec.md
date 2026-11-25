# plugin-lifecycle Specification

## Purpose

Integrate timer scheduling into the official OpenCode server-plugin lifecycle while keeping session boundaries, installation behavior, and shutdown limitations explicit.

## Requirements

### Requirement: Standalone official server plugin
The package SHALL be named `@zebrajaeger/opencode-scheduler` and integrate through the official TypeScript V2 server-plugin API. It SHALL require no OpenCode/OpenChamber modifications, separate UI, MCP server, own LLM client, external scheduler, or infrastructure.

#### Scenario: Plugin installation
- **WHEN** the package is loaded as an OpenCode server plugin
- **THEN** the five timer tools are available through standard tool registration without another service

### Requirement: Global and project installation
The plugin SHALL support normal global and project-specific OpenCode plugin configuration. Effective plugin activation SHALL expose one timer tool set per location rather than duplicate registrations. Documentation SHALL explain configuration precedence and prevent configuring duplicate package identities.

#### Scenario: Project installation
- **WHEN** only a project's OpenCode configuration enables the plugin
- **THEN** timers are available in that enabled location without requiring a global install

#### Scenario: Global installation across projects
- **WHEN** the global configuration enables the plugin and multiple locations are active
- **THEN** each location has isolated timer ownership and cannot list or mutate another location's timers

### Requirement: In-memory lifetime
All timer definitions, due state, and counters SHALL exist only in memory. Plugin unload or server restart SHALL discard them without automatic restoration, background service creation, or persisted scheduler state.

#### Scenario: Restart
- **WHEN** the plugin or server restarts after timers were created
- **THEN** timer_list reports no restored timers
- **AND** the documentation distinguishes this from already accepted input stored by OpenCode itself

### Requirement: Session interruption stops timers
On an owning session's `session.execution.interrupted` event, the plugin SHALL remove all its timers, invalidate local pending dispatches, and prevent future timer admissions. A normal successful execution or UI navigation SHALL NOT cancel timers.

#### Scenario: User aborts the session
- **WHEN** the session's execution is interrupted
- **THEN** all its timers stop and no later local callback can restart them
- **AND** other sessions' timers remain intact

#### Scenario: Chat navigation or successful answer
- **WHEN** the user views another chat or a normal agent response completes
- **THEN** the timers remain active while the server and plugin location stay active

### Requirement: Deleted or moved owners
Deleted sessions SHALL have their timers removed through lifecycle events and a pre-dispatch existence check. A timer SHALL stop rather than follow an owner to another project/location or recreate a missing session. Transient API failures SHALL NOT be mistaken for deletion.

#### Scenario: Session deletion
- **WHEN** session.deleted is observed or an owner check confirms that the session no longer exists
- **THEN** all its timer records are removed and no replacement session is created

#### Scenario: Session moves to another worktree
- **WHEN** the current owner location/project no longer matches the recorded ownership
- **THEN** its original timers are removed and the agent must create new timers in the destination

### Requirement: Inactive clients do not prevent execution
Timer eligibility SHALL depend on server/plugin and session execution state, not on which session a client displays or whether a UI client is connected. Accepted prompts SHALL execute subject to the session's existing permission and approval rules.

#### Scenario: Session is not displayed
- **WHEN** its timer is due while another session is selected or no UI client is connected
- **THEN** the server can process the prompt in the owning session

#### Scenario: Tool requires approval
- **WHEN** a timer prompt reaches an operation that existing OpenCode policy requires a user to approve
- **THEN** the plugin does not auto-approve or bypass the policy
- **AND** documentation explains that unattended scheduling does not guarantee unattended execution of every downstream tool

### Requirement: Validated plugin defaults
The plugin SHALL accept optional `defaultMaxLifetimeSeconds` and `minimumSpacingSeconds` defaults, with built-in values 3600 and 30. Invalid defaults SHALL cause a clear initialization failure rather than silently weaken safety. Explicit timer lifetime SHALL override the lifetime default, but timer timing SHALL not bypass spacing.

#### Scenario: Stricter spacing
- **WHEN** minimumSpacingSeconds is configured as 60
- **THEN** timing below 60 seconds is rejected and session-wide spacing is at least 60 seconds

#### Scenario: Unsafe configuration
- **WHEN** minimumSpacingSeconds is below 30 or either default is not a valid positive safe integer
- **THEN** plugin initialization reports an actionable configuration error

### Requirement: Reliable cleanup
On unload the plugin SHALL mark itself closed, discard timers, clear native timeouts, terminate its event subscription, dispose registrations as supported by the host, and stop scheduling new work. It SHALL handle late asynchronous results without unhandled rejections or state resurrection and SHALL NOT await the completion of unrelated agent work.

#### Scenario: Cleanup with pending work
- **WHEN** plugin unload occurs during an owner check or prompt admission
- **THEN** cleanup returns without waiting for the session to finish and no late result schedules another timer
- **AND** already accepted OpenCode input is explicitly outside the cleanup guarantee

### Requirement: Documented compatibility and verification
The README SHALL cover installation, options, natural-language examples, supported versions, architecture, timing/cancellation/permissions limitations, development commands, and a manual OpenCode/OpenChamber smoke procedure. OpenCode 2.3.2 and 2.4.1 SHALL be tested as targets; untested versions and V1 SHALL not be advertised as supported.

#### Scenario: Release readiness
- **WHEN** the first functional version is considered ready
- **THEN** deterministic scheduler tests and integration tests pass, target-version verification results are recorded, and the manual smoke procedure covers both OpenCode and OpenChamber
- **AND** any unavailable environment is reported as unverified instead of claimed as a passing test
