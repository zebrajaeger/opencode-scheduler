# Spec Delta

## Purpose

Execute durable prompt recurrences only inside active OpenCode plugin runtime, with predictable calendar semantics, conservative recovery, and bounded handling of missed or overlapping occurrences.

## ADDED Requirements

### Requirement: Active-runtime-only execution
Automations SHALL admit prompts only while their owning OpenCode server and plugin location are active. Stored definitions SHALL NOT start OpenCode, keep it alive solely for scheduling, or create an external scheduler. Eligibility SHALL NOT depend on the currently displayed chat or on a connected UI client.

#### Scenario: OpenCode is stopped
- **WHEN** a stored automation reaches its scheduled time while the server is stopped
- **THEN** no agent execution occurs and no separate process is started

#### Scenario: Another chat is displayed
- **WHEN** the owning runtime is active and a different chat is displayed at a due time
- **THEN** the automation can execute in its configured target subject to execution state and permissions

#### Scenario: Owning location is inactive
- **WHEN** the server is running but the automation's plugin location is unloaded
- **THEN** the automation does not execute until that location is active again

### Requirement: Stable interval recurrence
Interval occurrences SHALL follow a persisted anchor plus whole multiples of the interval. A restart or completed execution SHALL NOT reset that anchor. A schedule change SHALL establish a new anchor at the update time. Occurrences already consumed SHALL NOT be repeated after a backward clock change.

#### Scenario: Restart does not shift the interval
- **WHEN** a 30-minute schedule anchored at 08:00 is reactivated at 09:10 with the default missed policy
- **THEN** its next occurrence is 09:30 rather than 09:40

#### Scenario: A slow report finishes late
- **WHEN** an 08:30 report completes at 08:47
- **THEN** its next nominal interval occurrence remains 09:00 rather than 09:17

### Requirement: Explicit calendar and time-zone semantics
Calendar schedules SHALL use five cron fields in minute, hour, day-of-month, month, day-of-week order and a persisted IANA time zone. They SHALL support wildcards, lists, ranges, and steps. If both day fields are restricted, either matching SHALL select the date. Unsupported extensions SHALL be rejected rather than silently reinterpreted.

#### Scenario: Weekday morning report
- **WHEN** `0 9 * * 1-5` is configured in `Europe/Berlin`
- **THEN** occurrences are Monday through Friday at 09:00 in that zone, including after daylight-saving changes

#### Scenario: Day-field convention
- **WHEN** `0 9 1 * 1` is configured
- **THEN** the schedule selects the first day of each month and Mondays, not only Mondays that are also the first

#### Scenario: Explicit syntax boundary
- **WHEN** a schedule includes seconds, macros, or `L`, `W`, or `#` extensions
- **THEN** it is rejected with an explanation of the supported five-field format

### Requirement: Daylight-saving and clock discontinuities
A nonexistent local calendar time SHALL have no occurrence. A local calendar minute repeated by a daylight-saving rollback SHALL yield one occurrence at its first instance. Forward time jumps within an active runtime SHALL coalesce due occurrences; backward jumps SHALL NOT repeat consumed occurrences. A stored time zone SHALL NOT change when the machine's default zone changes.

#### Scenario: Spring clock change
- **WHEN** `30 2 * * *` reaches a date without 02:30 in the stored zone
- **THEN** no occurrence is invented at 03:30 or another replacement time

#### Scenario: Autumn clock change
- **WHEN** 02:30 occurs twice on a local date for `30 2 * * *`
- **THEN** only its first instance is eligible for that automation

#### Scenario: System zone changes
- **WHEN** the server's default time zone changes after an automation is saved
- **THEN** its calendar recurrence continues using the saved zone

### Requirement: Default skipping of inactive occurrences
On startup, reload, or explicit resume, the default `skip` policy SHALL discard unadmitted occurrences at or before activation time and schedule the next strictly future occurrence. It SHALL NOT run automatically merely because OpenCode starts after a scheduled time. Previously admitted input SHALL be reconciled rather than treated as a new missed occurrence.

#### Scenario: Missed morning report
- **WHEN** a daily 09:00 automation is activated at 10:00 after OpenCode was stopped overnight
- **THEN** no catch-up prompt is admitted and the next occurrence is the following scheduled 09:00

#### Scenario: Several days offline
- **WHEN** a weekday automation is activated after several missed weekdays
- **THEN** all those unadmitted occurrences are skipped without generating a replay queue

### Requirement: Explicit coalesced catch-up
Only an explicit `catch-up-once` policy SHALL make inactive missed occurrences eligible at activation or resume. One or more missed occurrences SHALL produce at most one catch-up prompt using the current definition. Successful consumption SHALL advance to future recurrence slots without replaying older occurrences.

#### Scenario: User requests catch-up
- **WHEN** a daily PR report with `catch-up-once` is reactivated after three missed reports
- **THEN** exactly one current-state report becomes due, not three reports
- **AND** the next recurrence after that run is strictly in the future

#### Scenario: Nothing was missed
- **WHEN** a catch-up-enabled automation is reactivated before its first due occurrence
- **THEN** it waits for that occurrence rather than running merely on startup

### Requirement: Busy deferral and missed-slot coalescing
An occurrence that becomes due during active runtime SHALL wait while its target is busy or execution state is unknown, without repeatedly submitting queued prompts. Multiple elapsed slots during deferral or a run SHALL collapse into the outstanding check. After completion, the next nominal occurrence SHALL be strictly future, including after standby while the runtime remains loaded.

#### Scenario: Busy target with several elapsed slots
- **WHEN** a 30-minute automation waits in a busy chat through three occurrence slots
- **THEN** at most one due report is admitted when the chat becomes eligible
- **AND** its completion advances to a future slot rather than immediately generating another report

#### Scenario: Sleep while runtime stays active
- **WHEN** the machine resumes from standby with several elapsed occurrences and no runtime reload
- **THEN** those occurrences coalesce into one due check, regardless of the inactive-runtime missed policy

### Requirement: Shared serialization and spacing
At most one run per automation SHALL be checking, admitted, queued, executing, or unresolved, even with a fresh-chat-per-run target or a target update. Timers and automations targeting one session SHALL share one admission reservation and the effective per-session minimum spacing. Distinct eligible sessions SHALL remain independent and due work SHALL not starve indefinitely.

#### Scenario: Timer and automation target one chat
- **WHEN** a temporary timer and an automation are due in the same session
- **THEN** only one is admitted until its correlated execution terminates and the session cooldown elapses

#### Scenario: Fresh chat is not an overlap bypass
- **WHEN** a fresh-chat-per-run automation reaches another slot while its previous run is executing
- **THEN** no additional run or target chat is created until that run resolves

### Requirement: Durable admission recovery
Before submission the automation SHALL durably record occurrence, revision, target, and host message identities. Reactivation SHALL use available official plugin context reads and subsequent live events to reconcile outstanding admissions. Insufficient evidence SHALL retain an inspectably unresolved barrier, potentially indefinitely, without automatic resubmission even with catch-up enabled. Delivery or idle state alone SHALL NOT prove completion.

#### Scenario: Crash after host acceptance
- **WHEN** the host accepted a prompt but the plugin stopped before recording acceptance
- **THEN** reactivation reconciles that recorded message rather than submitting the occurrence again
- **AND** without identity-correlated terminal evidence it remains unresolved rather than assuming completion

#### Scenario: Unknown handoff after reload
- **WHEN** available official plugin context and live events cannot prove the terminal outcome of an outstanding admission
- **THEN** the automation retains an unresolved run and does not automatically retry or overlap it

#### Scenario: Offline completion is not provable
- **WHEN** the saved message appears in context after restart but no correlated terminal outcome was persisted or newly observed
- **THEN** the outstanding run remains visibly unresolved even if the current session is idle

#### Scenario: Storage fails before admission
- **WHEN** the required durable admission record cannot be written
- **THEN** no prompt is submitted and a bounded persistence error is visible

### Requirement: Bounded errors and interruption outcomes
Admission failures or correlated execution failures SHALL pause the automation with a bounded diagnostic and no immediate retry. Interrupting its run SHALL retain the enabled definition, record an interrupted outcome, and consume that occurrence without replay. Unknown admissions or loss of the event stream SHALL block further affected dispatch until reconciled.

#### Scenario: User stops a report
- **WHEN** an automation's correlated run is interrupted
- **THEN** its definition remains enabled for later nominal occurrences
- **AND** that interrupted occurrence is not retried as catch-up

#### Scenario: Report execution fails
- **WHEN** the correlated host execution fails
- **THEN** the automation remains stored but paused with its last error until explicitly resumed after the problem is resolved

#### Scenario: Foreground work is interrupted
- **WHEN** unrelated foreground execution is interrupted in an automation's target chat
- **THEN** the stored automation is not deleted or implicitly paused
- **AND** already admitted scheduler input is tracked conservatively until its own outcome is established
