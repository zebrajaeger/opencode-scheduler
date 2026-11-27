# Spec Delta

## MODIFIED Requirements

### Requirement: Bounded error handling
Admission errors and failed timer executions SHALL produce bounded diagnostics and SHALL NOT trigger immediate retries. A timer with an admission failure SHALL be disabled until an explicit valid update rearms it. Ambiguous admission outcomes SHALL block further scheduler admissions in that session until resolved, or plugin unload when durable orchestration is disabled. With orchestration enabled, minimal admission evidence and the gate SHALL survive unload; unrelated sessions SHALL remain usable.

#### Scenario: Admission failure
- **WHEN** the prompt API rejects a dispatch
- **THEN** the timer is disabled with a bounded error and no automatic retry storm occurs

#### Scenario: Timer execution failure
- **WHEN** a delivered recurring timer's associated execution fails
- **THEN** the timer is disabled with a diagnostic and other timers remain subject to normal serialization and spacing

#### Scenario: Lost acknowledgement or ambiguous outcome
- **WHEN** it cannot be established whether a submitted prompt was accepted or delivered
- **THEN** no replacement prompt is blindly sent and the session-local admission barrier remains conservative

#### Scenario: Durable shared gate during unload
- **WHEN** orchestration is enabled and plugin unload occurs with an unresolved timer admission
- **THEN** the gate is preserved without restoring the timer or retrying its business work

### Requirement: Session-level serialization
At most one scheduler prompt SHALL be admitting, queued, or executing per target session across legacy timers and orchestration jobs. Its reservation SHALL persist beyond acceptance until delivery and associated terminal execution are observed or uncertainty is safely reconciled. Different sessions SHALL progress independently. Sharing arbitration SHALL NOT change legacy timer ownership, lifetime, or error behavior.

#### Scenario: Multiple due timers in one session
- **WHEN** two timers are due together
- **THEN** one is selected deterministically and the other remains due until the first reservation is released and spacing permits another dispatch

#### Scenario: Different sessions
- **WHEN** one session is busy or its admission is stalled and another session has an eligible timer
- **THEN** the eligible session can dispatch without waiting for the first

#### Scenario: Acceptance is not completion
- **WHEN** prompt admission succeeds but processing has not finished
- **THEN** neither another run of that timer nor another timer in the session is admitted

#### Scenario: Timer and signal job share target
- **WHEN** a legacy timer and a signal-triggered orchestration job target the same eligible session simultaneously
- **THEN** only one admission proceeds and the other remains deferred behind the same target gate

### Requirement: Enforce spacing and bounded frequency
The effective minimum spacing SHALL apply per target session across legacy timers and orchestrated activating deliveries, not only to individual intervals. The default SHALL be 30 seconds. After scheduler work completes, no subsequent scheduler admission SHALL occur until that spacing elapses. A bounded deterministic selection order SHALL prevent immediate repetition from starving other due work.

#### Scenario: Several timers bypass individual intervals
- **WHEN** many timers in one session are due at once
- **THEN** their prompts are serialized with at least the effective spacing after each completion

#### Scenario: Prompt creates or updates a timer
- **WHEN** a scheduled prompt invokes timer management tools
- **THEN** it cannot reset the session reservation or cooldown to create an immediate self-triggering dispatch loop

#### Scenario: Event jobs cannot bypass cooldown
- **WHEN** a signal job becomes ready immediately after a legacy timer execution settles
- **THEN** it waits for the same target cooldown and cannot obtain an independent admission slot
