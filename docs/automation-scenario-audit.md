# Persistent automation scenario audit

Scope: `openspec/changes/archive/2026-11-27-add-persistent-prompt-automations/specs`. The deltas are synchronized to `openspec/specs/automation-*` and `openspec/specs/plugin-lifecycle`. Existing timer evidence remains in `scenario-audit.md`. Every delta scenario below has a named test file or explicit smoke check. A mapped smoke check is **not a passing result**: see `verification.md` for execution status. Deterministic natural-language cases test the agent/tool boundary, not the accuracy of an arbitrary LLM.

The full `test/automation-acceptance-real-host.test.ts` matrix passed on pinned
2.3.2 and 2.4.1: `scheduler-automation-acceptance-8gH1lE` and
`scheduler-automation-acceptance-OCcwz2`. It adds real-host evidence for default
startup skip, explicit coalesced catch-up, reusable/fresh targets after restart,
same-chat timer/automation exclusion and spacing, automated and foreground
interruption, failed-report pausing/no immediate retry, and resolved removal.
Crash/admission recovery remains evidenced by `test/automation-real-host.test.ts`.
The separate client A01–A12 fixture matrix also passed on native OpenCode
web/server 2.4.1 and OpenChamber 2.8.0; [per-client evidence](automation-ui-verification.md)
names the observed controls/screenshots/transcripts and limits. Host results alone
are not a substitute for that separately recorded client evidence.

## automation-management

| Requirement | Scenarios | Evidence |
| --- | --- | --- |
| Discoverable automation tools | Natural-language routine; Explicit pause versus run interruption | `test/automation-tools.test.ts`: weekday PR-link request, unique described deployment chat, inventory; `test/automations.test.ts`: interrupted delivered run; smoke A01, A07 |
| Durable automation creation | Successful creation; Storage failure | `test/automation-store.test.ts`: create and update become effective only after a single durable envelope write; failed creation does not publish state; `test/automation-real-host.test.ts` |
| Validated structured recurrences | Interval automation; Calendar automation; Rejected schedules | `test/automation-schedule.test.ts`: schedule validation, cron supports five numeric fields; `test/automation-tools.test.ts`: invalid calendar targets |
| Location-scoped management | Manage a routine from a different chat; Foreign automation ID | `test/automation-tools.test.ts`: inventory and control operations, invalid calendar targets foreign IDs and ownership overrides; `test/automation-real-host.test.ts`: separate control/report sessions |
| Atomic automation updates | Change an interval; Update during an admitted run; Failed update persistence | `test/automation-management.test.ts`: invalid updates and failed persistence; `test/automation-target.test.ts`: combined retarget patches; `test/automations.test.ts`: pause update remove and unload during asynchronous checks |
| Explicit pause resume and removal | Pause survives restart; Resume after skipped occurrences; Removal races with admission | `test/automation-management.test.ts`: pause persists and edits do not reactivate, resume rejects bad target, removal is idempotent; `test/automation-real-host.test.ts`; smoke A06, A08 |
| Inspectable definition and run state | Report waits for a busy chat; Accepted is not successful; Lost target is diagnosable | `test/automation-management.test.ts`: inspection distinguishes due queued running unresolved, list retains schedule target pause reason counters; `test/automations.test.ts`: queued acceptance waits for matching delivery; smoke A04, A09 |

## automation-scheduling

| Requirement | Scenarios | Evidence |
| --- | --- | --- |
| Active-runtime-only execution | OpenCode is stopped; Another chat is displayed; Owning location is inactive | `test/automation-real-host.test.ts`: private stop/start; `test/automations.test.ts`: activation skips inactive occurrences, no missed first occurrence; smoke A02, A06, A10 |
| Stable interval recurrence | Restart does not shift the interval; A slow report finishes late | `test/automation-schedule.test.ts`: interval recurrence preserves anchor; `test/automations.test.ts`: busy target and standby time jump |
| Explicit calendar and time-zone semantics | Weekday morning report; Day-field convention; Explicit syntax boundary | `test/automation-schedule.test.ts`: calendar weekday 09:00, restricted day fields use OR, cron supports five numeric fields |
| Daylight-saving and clock discontinuities | Spring clock change; Autumn clock change; System zone changes | `test/automation-schedule.test.ts`: nonexistent spring 02:30, autumn repeated local minute, first-instance rule, consumed high water, calendar weekday 09:00 follows saved zone |
| Default skipping of inactive occurrences | Missed morning report; Several days offline | `test/automations.test.ts`: weekday morning missed at 09:00 is skipped at 10:00 after several offline days; smoke A06 |
| Explicit coalesced catch-up | User requests catch-up; Nothing was missed | `test/automations.test.ts`: explicit catch-up collapses missed slots, no missed first occurrence; `test/automation-management.test.ts`: resume rejects bad target and explicit catch-up; smoke A06 |
| Busy deferral and missed-slot coalescing | Busy target with several elapsed slots; Sleep while runtime stays active | `test/automations.test.ts`: busy target and standby time jump coalesce slots without overlap or drift; smoke A04 |
| Shared serialization and spacing | Timer and automation target one chat; Fresh chat is not an overlap bypass | `test/scheduler-external.test.ts`: external automation reservation and timer share session exclusion and cooldown, older due timer cannot be starved by recurring external reservations, older automation precedes a newer timer without bypassing recovery; `test/automation-target.test.ts`: fresh-run policy never overlaps; smoke A04 |
| Durable admission recovery | Crash after host acceptance; Unknown handoff after reload; Offline completion is not provable; Storage fails before admission | `test/automation-real-host.test.ts`: accepted unfinished report; `test/automations.test.ts`: offline message context, restored missing context, failed durable intent write, unresolved handoff never retries; smoke A08 |
| Bounded errors and interruption outcomes | User stops a report; Report execution fails; Foreground work is interrupted | `test/automations.test.ts`: interrupted delivered run preserves routine and failed run pauses, session interruption stops temporary timers; smoke A07 |

## automation-targeting

| Requirement | Scenarios | Evidence |
| --- | --- | --- |
| Explicit target policies | Here means the invoking session; No destination was established | `test/automation-target.test.ts`: here binds invocation identity, invalid or foreign destination; `test/automation-tools.test.ts`: invalid calendar targets |
| Discoverable target candidates | A described active chat is unique; Several plausible chats; Candidate privacy boundary | `test/automation-tools.test.ts`: unique described deployment chat, described-chat requests expose clarification; `test/automation-host.test.ts`: target candidates are bounded scoped filtered and paginated; smoke A03 |
| Stable existing-chat binding | Target is renamed; Foreign target | `test/automation-target.test.ts`: existing targets survive rename title reuse and forks, invalid or foreign destination; smoke A02, A09 |
| One newly created reusable chat | Default new-chat meaning; Restart preserves new-chat binding | `test/automation-target.test.ts`: new reusable target persists intent before creation and restart uses the same session, uncertain create acknowledgement; `test/automation-tools.test.ts`: new-chat request reuses one chat; smoke A05 |
| Explicit fresh chat per run | Every time a new chat; Offline occurrence is skipped | `test/automation-target.test.ts`: fresh-run policy creates separate chats only for reserved runs; `test/automations.test.ts`: activation skips inactive occurrences; smoke A05, A06 |
| Existing context and safe new-chat defaults | Existing chat has its own model; New chat respects configuring restrictions; A PR lookup needs approval | `test/automation-host.test.ts`: new session receives saved selections and permissions; `test/automation-target.test.ts`: new targets capture configuring selections, retargeting existing drops saved selections; `test/automation-tools.test.ts`: no automatic tool approval; smoke A11 |
| Missing or moved target pauses automation | Reusable report chat is deleted; Target moves to another worktree; User repairs the target | `test/automation-target.test.ts`: confirmed missing/moved target pauses without replacement and retarget needs explicit resume; transient failures are not deleted; smoke A09 |
| Forks and run cancellation do not transfer schedules | Chat is forked; Stop current report but keep routine | `test/automation-target.test.ts`: here binds invocation identity and forks; `test/automations.test.ts`: interrupted delivered run preserves routine; smoke A07, A09 |

## plugin-lifecycle

| Requirement | Scenarios | Evidence |
| --- | --- | --- |
| In-memory lifetime | Restart; Automation survives restart | `test/real-host.test.ts`; `test/automation-real-host.test.ts`; smoke A06 |
| Session interruption stops timers | User aborts the session; Chat navigation or successful answer; Persistent routine in interrupted session | Existing `test/opencode-adapter.test.ts` lifecycle tests; `test/automations.test.ts`: session interruption stops temporary timers but retains automation; smoke A02, A07 |
| Reliable cleanup | Cleanup with pending work; Cleanup preserves automation recovery | `test/opencode-adapter.test.ts`: cleanup; `test/automations.test.ts`: unload during asynchronous checks, restored context waiting for plugin activation, terminal storage failure; smoke A08, A10 |
| Documented compatibility and verification | Release readiness; Automation readiness | `test/api-contract.test.ts`: 2.3.2/2.4.1 plugin contracts; `test/readme.test.js`; `npm run release:check`; `test/automation-real-host.test.ts`; smoke A01–A12. Unexecuted client/version combinations stay unverified. |

## Diagnostics and limitations

Recovery diagnostics are backed by `test/automations.test.ts` restored context/cancellation/storage-failure fixtures, `test/automation-management.test.ts` removal tombstones, and the isolated-host restart evidence. Neither offline idle nor context history proves terminal success. Recovery reads must not hold plugin activation. A removed outstanding definition can retain a hidden barrier indefinitely. Fixture PR links from `example.invalid` certify routing/output only, not GitHub authentication or live provider access.
