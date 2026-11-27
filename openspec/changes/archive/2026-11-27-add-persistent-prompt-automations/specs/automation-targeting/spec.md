# Spec Delta

## Purpose

Route scheduled prompts to deliberately selected OpenCode conversations, preserving stable identity and normal execution context instead of guessing a new destination whenever a schedule becomes due.

## ADDED Requirements

### Requirement: Explicit target policies
Automation creation SHALL require one target policy: invoking chat, specified existing chat, newly created reusable chat, or fresh chat per run. The effective response SHALL report the resolved policy and bound session when available. An omitted or ambiguous target SHALL NOT silently select a destination.

#### Scenario: Here means the invoking session
- **WHEN** a user specifies "here" or "this chat" and the agent submits the invoking-chat policy
- **THEN** the invoking session ID is persisted as the target
- **AND** switching the displayed chat does not change it

#### Scenario: No destination was established
- **WHEN** creation omits the target or submits conflicting target modes
- **THEN** it fails without creating an automation and identifies the required target choice

### Requirement: Discoverable target candidates
The plugin SHALL provide `automation_targets` to list bounded candidate IDs, titles, locations, and execution states within the caller's validated ownership scope. Agents SHALL resolve described destinations to a unique session before submitting creation or update; ambiguous descriptions SHALL require user clarification rather than first-match selection.

#### Scenario: A described active chat is unique
- **WHEN** a user requests the chat where a deployment is running and the available candidate/context evidence uniquely identifies it
- **THEN** the agent supplies that concrete session ID and the automation binds it

#### Scenario: Several plausible chats
- **WHEN** two candidate chats plausibly match a requested deployment conversation
- **THEN** the agent asks which chat is intended before creating or retargeting the automation

#### Scenario: Candidate privacy boundary
- **WHEN** a caller lists automation target candidates
- **THEN** sessions outside its project and plugin location are not disclosed

### Requirement: Stable existing-chat binding
Existing targets SHALL be validated for existence and matching project/location when configured and before admission. Their stored ID SHALL remain stable across title changes and user navigation. Target resolution SHALL NOT be repeated against titles or current activity on each occurrence. Out-of-scope targets SHALL be rejected without changing the automation.

#### Scenario: Target is renamed
- **WHEN** a bound deployment chat is renamed and another chat adopts its old title
- **THEN** future runs still target the originally bound session ID

#### Scenario: Foreign target
- **WHEN** creation or update specifies a session from another project or plugin location
- **THEN** it returns a controlled invalid-target result and does not admit work there

### Requirement: One newly created reusable chat
The reusable-new-chat policy SHALL create and persist one target binding during setup. Subsequent runs and restarts SHALL reuse that session. The agent SHALL interpret "in a new chat" as this policy unless the user explicitly requests a new chat for each run. A failed or uncertain setup SHALL NOT silently create multiple replacement chats.

#### Scenario: Default new-chat meaning
- **WHEN** an automation is configured to report "in a new chat"
- **THEN** one target chat is created and its ID is returned and persisted
- **AND** the next two runs both append to that same chat

#### Scenario: Restart preserves new-chat binding
- **WHEN** OpenCode restarts after successful reusable-chat creation
- **THEN** the stored target session is reused rather than another chat being created

### Requirement: Explicit fresh chat per run
Only the fresh-chat-per-run policy SHALL create a distinct session for each admitted run, including a coalesced catch-up. Chat creation SHALL wait until the automation is eligible to attempt one run. Each session SHALL remain available as its report destination; skipped occurrences SHALL NOT create chats.

#### Scenario: Every time a new chat
- **WHEN** the user explicitly requests "a new chat every time" and two occurrences execute
- **THEN** two distinct report chats are created and their IDs are associated with the respective runs

#### Scenario: Offline occurrence is skipped
- **WHEN** a fresh-chat-per-run occurrence is skipped under the default inactive-runtime policy
- **THEN** no empty target chat is created for that occurrence

### Requirement: Existing context and safe new-chat defaults
Dispatch to existing targets SHALL preserve their history, selected agent/model, permissions, and working location. New targets SHALL use an explicit saved agent/model selection and permission rules no more permissive than the configuring session. Prompts SHALL use normal queued session delivery; the scheduler SHALL NOT bypass approval or execute task-specific tools itself.

#### Scenario: Existing chat has its own model
- **WHEN** an automation is admitted to an existing chat whose model differs from the configuring chat
- **THEN** the existing chat retains its model, agent, permissions, and history

#### Scenario: New chat respects configuring restrictions
- **WHEN** a configuring session has restricted shell or editing permissions and requests a new report chat
- **THEN** the created target retains those restrictions and does not gain approval bypasses

#### Scenario: A PR lookup needs approval
- **WHEN** a report's normal tool policy requires a user approval
- **THEN** it follows that approval process rather than being automatically allowed by the automation

### Requirement: Missing or moved target pauses automation
Confirmed deletion or movement of a bound target outside ownership SHALL persistently pause, not delete, its automation with an actionable target-unavailable reason. No replacement SHALL be silently created, including for reusable-new-chat targets. Retargeting and explicit resume SHALL be available from another owning-location chat. Transient inspection failures SHALL NOT be misreported as deletion.

#### Scenario: Reusable report chat is deleted
- **WHEN** its bound session is confirmed deleted
- **THEN** the automation remains stored and paused and no replacement chat is created

#### Scenario: Target moves to another worktree
- **WHEN** a target's current location no longer matches ownership
- **THEN** future local admissions stop and the automation reports a paused incompatible-target reason

#### Scenario: User repairs the target
- **WHEN** the user retargets a paused automation to a valid session and explicitly resumes it
- **THEN** future occurrences use the new binding under its configured missed-occurrence policy

### Requirement: Forks and run cancellation do not transfer schedules
Forking a target SHALL NOT copy or retarget its automations. Interrupting ordinary or automation execution in a target SHALL NOT remove its saved schedules. Pause/removal SHALL affect future admissions only; outstanding accepted work SHALL remain correlated until proven terminal or cancelled.

#### Scenario: Chat is forked
- **WHEN** a user forks the target chat
- **THEN** the original automation remains bound to the original session and the fork inherits no automation ownership

#### Scenario: Stop current report but keep routine
- **WHEN** a user stops a running automated report without requesting automation pause or removal
- **THEN** the current occurrence is recorded as interrupted and the routine remains configured for later runs
