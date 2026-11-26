# Spec Delta

## Purpose

Enable agents to discover independent OpenCode sessions and exchange bounded, attributable information without confusing passive messages with execution requests.

## ADDED Requirements

### Requirement: Scoped session discovery
The system SHALL discover sessions by exact ID, title search, and project/location context with bounded pagination. Results SHALL include stable identity, title, project, location, parent when available, and state freshness. The default scope SHALL be the caller's project on the configured server.

#### Scenario: Find a review by natural reference
- **WHEN** an agent searches for a code-review session in its current project
- **THEN** it receives matching candidates with enough context to resolve the user's reference without asking the user for a session ID

#### Scenario: Invalid exact identity
- **WHEN** an exact session ID is missing or outside the authorized scope
- **THEN** discovery returns a bounded not-found or scope-denied result without activating another session

### Requirement: Ambiguity is not silently resolved
The system SHALL return an explicit ambiguity result for unresolved multiple candidates and SHALL NOT select by recency or title alone. Agent tool guidance SHALL require clarification before sending or registering a dependency. A resolved set of multiple sessions SHALL be frozen at registration.

#### Scenario: Two reviewers share a title
- **WHEN** two sessions match the intended reviewer and no supplied context distinguishes them
- **THEN** the tool returns candidates and no communication or dependent job is created until the agent obtains clarification

#### Scenario: All current reviewers
- **WHEN** an agent registers a job against three resolved reviewer sessions and a fourth is created later
- **THEN** the dependency remains on the original three unless explicitly replaced

### Requirement: Honest session state inspection
Inspection SHALL distinguish idle, busy, retry, unknown, and last execution outcome from explicit task state. Interaction and background observations SHALL report freshness and coverage. Missing evidence SHALL NOT imply success, cancellation, or absence of pending work.

#### Scenario: Idle with unfinished background work
- **WHEN** a session is idle while a tracked child or shell remains active
- **THEN** inspection does not report the business task completed

#### Scenario: Waiting for interaction
- **WHEN** an outstanding form or permission is observed or the producer marks its task waiting_input
- **THEN** inspection exposes that evidence separately from execution status and does not infer a terminal task result

#### Scenario: Unstructured question
- **WHEN** the assistant ends with an ordinary text question without explicit task-state publication
- **THEN** the system makes no reliable waiting-for-user or business-completion claim based on that prose

### Requirement: Bounded context and result access
Authorized agents SHALL retrieve another session's current context, retained mailbox entries, and immutable task results with provenance and truncation metadata. Current compacted context SHALL be labeled as such. Full historical-message access SHALL require a verified supporting SDK capability and SHALL NOT be substituted silently by current context.

#### Scenario: Read a completed review
- **WHEN** B retrieves the result reference supplied by a completed review task in A
- **THEN** B receives the stored result snapshot even if A has since continued or compacted its context

#### Scenario: Unsupported full history
- **WHEN** history is requested without a verified historical-message capability
- **THEN** the tool returns unsupported-capability and identifies current-context access as a distinct available operation

### Requirement: Passive messages and activating prompts
The system SHALL distinguish durable passive mailbox messages from queued activating prompts. A passive message SHALL NOT wake the target or submit model input. A prompt SHALL use explicit queued delivery through supported OpenCode APIs. Results SHALL state whether information was stored, admitted, or delivered, without claiming business completion.

#### Scenario: Send information without execution
- **WHEN** A sends B a message in passive mode
- **THEN** B can retrieve it from the mailbox and no OpenCode prompt is submitted or agent execution started

#### Scenario: Busy target receives an activation
- **WHEN** a prompt action targets busy B
- **THEN** one delivery intent is retained and activation is deferred and eventually submitted with queue delivery without steering or interrupting B

### Requirement: Host-derived communication provenance
Messages, prompt envelopes, and retrieved results SHALL include host-derived producer session/project, target where applicable, creation time, and available task/job/run/correlation references. Caller text SHALL NOT override these fields. Manual repeated sends with the same caller-scoped idempotency key SHALL preserve a single logical delivery.

#### Scenario: Forged origin and duplicate send
- **WHEN** an agent retries a send with the same idempotency key and text claiming another producer
- **THEN** the original host-assigned provenance is retained and at most one logical message or activating delivery exists

### Requirement: Natural-language agent integration
Tool descriptions and strict parameter schemas SHALL teach discovery before action, ambiguity clarification, task-result lookup, passive versus active delivery, and nonblocking waits. IDs SHALL be discoverable by agents; users SHALL NOT need native event names, IDs, or scheduler configuration to express supported collaborations.

#### Scenario: Wait and update specifications
- **WHEN** the user asks to wait for the review and then update specifications
- **THEN** the agent can discover the intended producer/task and register a result-dependent job using tools, asking only about genuine ambiguity or missing completion contracts
