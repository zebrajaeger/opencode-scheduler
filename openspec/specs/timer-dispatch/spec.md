# timer-dispatch Specification

## Purpose

Deliver scheduled prompts into their existing sessions without interrupting current agent work, accumulating missed executions, or confusing dispatch acceptance with completion.

## Requirements

### Requirement: Preserve the original conversation
Due prompts SHALL be delivered to the owning existing session using the official plugin session API with queued delivery. Dispatch SHALL preserve session history, current agent/model, permissions, and working context; it SHALL NOT create a replacement session or force an interrupt.

#### Scenario: Existing session dispatch
- **WHEN** a timer becomes due in an eligible idle session
- **THEN** its configured prompt is admitted into that same session with delivery `queue` and default wake behavior
- **AND** dispatch does not override its agent, model, or permissions

#### Scenario: User activity races with dispatch
- **WHEN** user work starts after the scheduler's idle check but before prompt admission
- **THEN** queued delivery waits for the current work instead of steering or interrupting it

### Requirement: Busy deferral
Dispatch SHALL wait while the owning session has an active execution, retry, unknown execution state, or outstanding scheduler admission. Deferral SHALL retain only due state, not create repeated queued prompts. Management tools SHALL return without waiting for the invoking session to become idle.

#### Scenario: Long foreground tool
- **WHEN** a timer becomes due while a foreground tool is still executing
- **THEN** the timer stays deferred without starting another agent execution or claiming a punctual response

#### Scenario: Timer creation during agent activity
- **WHEN** the agent calls timer_start inside its active execution
- **THEN** the tool returns creation details promptly and timekeeping proceeds independently

### Requirement: Background work does not block monitoring
An otherwise idle session SHALL remain eligible when a real background process continues after its initiating tool returned. The scheduler SHALL NOT wait for all background processes to finish, run the process itself, or claim to know task completion from elapsed time alone.

#### Scenario: Test process running in the background
- **WHEN** a recurring status timer is due and the agent execution is idle while the test process remains running
- **THEN** the prompt wakes the same session to inspect that process through available tools

### Requirement: Session-level serialization
At most one scheduler prompt SHALL be admitting, queued, or executing per session. Its reservation SHALL persist beyond the prompt API's acceptance result until delivery and an associated terminal execution are observed. Different sessions SHALL make progress independently.

#### Scenario: Multiple due timers in one session
- **WHEN** two timers are due together
- **THEN** one is selected deterministically and the other remains due until the first reservation is released and spacing permits another dispatch

#### Scenario: Different sessions
- **WHEN** one session is busy or its admission is stalled and another session has an eligible timer
- **THEN** the eligible session can dispatch without waiting for the first

#### Scenario: Acceptance is not completion
- **WHEN** prompt admission succeeds but processing has not finished
- **THEN** neither another run of that timer nor another timer in the session is admitted

### Requirement: Coalesce missed recurrence slots
Recurring timers SHALL use fixed nominal slots from their effective first due time. Any number of missed slots SHALL collapse into one due execution. Following completion, the next slot SHALL be strictly in the future; the scheduler SHALL NOT replay every missed interval or schedule solely by repeatedly adding intervals to stale deadlines.

#### Scenario: Extended busy period
- **WHEN** a five-minute timer waits through several missed slots
- **THEN** at most one prompt is dispatched on becoming eligible and the next run targets a future nominal slot

#### Scenario: Machine resumes from sleep
- **WHEN** time advances over several intervals while the timer is unexpired
- **THEN** no catch-up burst occurs and expired timers do not execute

### Requirement: Enforce spacing and bounded frequency
The effective minimum spacing SHALL apply per session across all timers, not only to each timer's interval. The default SHALL be 30 seconds. After scheduler work completes, no subsequent scheduler admission SHALL occur until that spacing elapses. A bounded selection order SHALL not starve another due timer through immediate repetition.

#### Scenario: Several timers bypass individual intervals
- **WHEN** many timers in one session are due at once
- **THEN** their prompts are serialized with at least the effective spacing after each completion

#### Scenario: Prompt creates or updates a timer
- **WHEN** a scheduled prompt invokes timer management tools
- **THEN** it cannot reset the session reservation or cooldown to create an immediate self-triggering dispatch loop

### Requirement: Bounded error handling
Admission errors and failed timer executions SHALL produce bounded diagnostics and SHALL NOT trigger immediate retries. A timer with an admission failure SHALL be disabled until an explicit valid update rearms it. Ambiguous admission outcomes SHALL block further scheduler admissions in that session until resolved or plugin unload; unrelated sessions SHALL remain usable.

#### Scenario: Admission failure
- **WHEN** the prompt API rejects a dispatch
- **THEN** the timer is disabled with a bounded error and no automatic retry storm occurs

#### Scenario: Timer execution failure
- **WHEN** a delivered recurring timer's associated execution fails
- **THEN** the timer is disabled with a diagnostic and other timers remain subject to normal serialization and spacing

#### Scenario: Lost acknowledgement or ambiguous outcome
- **WHEN** it cannot be established whether a submitted prompt was accepted or delivered
- **THEN** no replacement prompt is blindly sent and the session-local admission barrier remains conservative

### Requirement: Race-safe state transitions
Dispatch SHALL revalidate timer existence, definition revision, expiry, owner context, and session cancellation generation before final submission. Late asynchronous results SHALL NOT restore removed timers, dispatch stale updates, or clear another generation's reservation. One-shot timers SHALL never receive a second accepted dispatch.

#### Scenario: Update during eligibility check
- **WHEN** timer_update changes a definition while an asynchronous owner check is pending
- **THEN** the stale dispatch is discarded and eligibility is reevaluated from the current definition

#### Scenario: Late completion after stop and restart
- **WHEN** an old timer's result arrives after it was removed and a new timer was created
- **THEN** the result cannot mutate the new timer or clear a newer reservation

#### Scenario: Fast execution before admission acknowledgement
- **WHEN** delivery and terminal execution events arrive before the prompt API resolves
- **THEN** the matching reservation completes exactly once without hanging or enabling overlapping dispatches
