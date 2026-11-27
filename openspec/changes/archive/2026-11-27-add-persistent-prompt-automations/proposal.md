# Proposal

## Why

The existing bounded, in-memory timers are suitable for monitoring current work, but cannot express a routine that survives OpenCode restarts, such as a weekday report of assigned pull requests. Users need durable prompt schedules that run only inside an active OpenCode server and deliver their results to a deliberately chosen conversation.

## What Changes

- Add persistent automations alongside, not instead of, the existing `timer_*` tools. Existing timer lifetime, ownership, interruption, and restart behavior remain unchanged.
- Support recurring intervals and five-field cron schedules with an explicit, persisted IANA time zone for calendar schedules. Natural-language requests are translated by the agent into validated structured tool inputs.
- Store automation definitions through the official plugin storage API. Run only while the OpenCode server and the owning plugin location are active; create no operating-system job, daemon, worker service, or independent LLM client.
- Allow a specified existing target chat, the invoking chat ("here" / "this chat"), one newly created and subsequently reused chat, or an explicitly requested fresh chat for every run. Resolve described chats at setup and bind their stable identities rather than rediscovering a target on every tick.
- Skip occurrences missed while the scheduler was inactive by default. Offer explicit, coalesced catch-up without replaying every missed occurrence.
- Preserve queued, permission-respecting execution, busy deferral, spacing, and non-overlap. Interrupting a run does not delete its persistent automation; pause, resume, update, and removal are explicit management actions.
- Expose definitions, targets, next occurrences, pause/error reasons, and run outcomes through discoverable automation tools. Pause an automation when its bound target disappears or moves out of scope; do not silently replace it.
- Add deterministic scheduling/recovery tests, isolated real-host verification, and bilingual documentation with PR-report examples and unattended-execution limitations.

## Capabilities

### New Capabilities

- `automation-management`: Durable automation identity, location-scoped management, structured schedules, updates, pause/resume/removal, and observable status.
- `automation-scheduling`: Calendar and interval occurrence calculation, active-runtime execution, persistence/recovery, misfire rules, non-overlap, and failure handling.
- `automation-targeting`: Explicit chat selection, stable target binding, new-chat policies, execution context, and target lifecycle handling.

### Modified Capabilities

- `plugin-lifecycle`: Limit the current all-in-memory rule to temporary timers; permit durable automation storage and distinguish timer cancellation from interruption of an automation run. Extend cleanup and documentation requirements for the additional capability.

## Impact

- Implementation will extend `src/opencode-adapter.ts` and `src/tools.ts` and introduce focused automation schedule/storage/targeting modules. Reuse or extract the execution reservation logic in `src/scheduler.ts` so timers and automations sharing a target cannot bypass serialization.
- Uses the official OpenCode V2 plugin/session/storage APIs already present in the installed 2.3.2 SDK. Preserve the repository's 2.3.2 and 2.4.1 verification targets; newly used APIs require additional real-host verification, not assumed compatibility.
- A maintained cron parser with time-zone support may be added; no natural-language parser or external scheduling infrastructure is required.
- Initial scope is one server and the automation's owning project/plugin location. Existing targets must belong to that location. Cross-project/worktree targeting, cross-server coordination, external notifications, provider-specific PR integrations, and publication are out of scope.
- Only this change's planning artifacts are created now. Main specs, production code, configuration, credentials, and published packages are not modified by proposing the change.
