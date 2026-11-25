# Tasks

Implementation is not started. Every checkbox includes its verification. Use the capability scenarios as the acceptance contract and do not replace unavailable plugin APIs with guessed methods. Do not publish, configure git remotes, or modify OpenCode/OpenChamber.

## 1. Package and verified host contract

- [x] 1.1 Create the TypeScript ESM package scaffold for `@zebrajaeger/opencode-scheduler`, official plugin entry, build output, scripts, and minimal dependency declarations; verify dependency installation, `npm run build`, `npm run typecheck`, and `npm pack --dry-run` succeed without publishing.
- [x] 1.2 Add Vitest with controllable time, deterministic IDs, deferred-promise helpers, and typed host fixtures; verify a minimal unit test passes using `npm test` without real sleeps or external services.
- [x] 1.3 Pin and compile the used official Plugin/Tool/Session/event contracts against 2.3.2 and 2.4.1, including valid prompt ID generation and actual event envelopes; verify a compatibility contract test rejects nonexistent plugin inbox methods and document API source/version evidence in development documentation.
- [x] 1.4 Add README identity, prerequisites, local development commands, global/project installation, and configuration skeleton; verify installation paths, ESM package exports, and option syntax match the target releases and the packed package contains the required entry and README.

## 2. Timer management and validation

- [x] 2.1 Implement owned in-memory records, unique IDs, one-shot/recurring creation, and session-local listing; verify timer-management creation/identity scenarios with multiple timers, sessions, and locations.
- [x] 2.2 Implement input and option validation, 3600-second default lifetime, 30-second minimum spacing, safe timestamp arithmetic, and automatic expiry; verify fake-time tests for invalid values, whitespace prompts, config overrides, first due at expiry, and expiry during busy/disabled/in-flight states.
- [x] 2.3 Implement atomic updates with stable mode/identity/creation, reset-on-timing-change, preserved expiry on interval-only change, explicit lifetime change, and safe rearming; verify update-during-dispatch, no-op/invalid patch, elapsed lifetime, and accepted/ambiguous one-shot rearm tests.
- [x] 2.4 Implement stop/stop-all with idempotent results and ownership isolation while preserving separate accepted-handoff reservations; verify repeated stop, foreign IDs, stop-all counts, and stop followed by a new timer cannot bypass an existing reservation.
- [x] 2.5 Define the five official tool schemas, descriptions, and structured results; verify typed registration, schema boundary tests, and a tool-description acceptance checklist covering all natural-language examples without AGENTS.md additions; add the corresponding examples, timing units, lifetime semantics, and error/status fields to README.

## 3. Scheduling and safe dispatch

- [x] 3.1 Implement one next-deadline timeout, expiry wakeups, bounded busy rechecks, and fake-time scheduling; verify no zero-delay busy loop, timeout overflow handling, late wake/sleep behavior, and timer changes recompute the deadline correctly.
- [x] 3.2 Implement fixed nominal recurrence slots, missed-tick coalescing, deterministic due selection, and completion-based session cooldown; verify long executions, many missed intervals, several simultaneously due timers, fair progress, and at least effective spacing after completion.
- [x] 3.3 Implement per-session reservations and revision/cancellation guards around asynchronous owner eligibility checks and prompt submission; verify same-timer/same-session no-overlap, cross-session progress, stale-update rejection, expiry-before-admission, and stop/update/delete races.
- [x] 3.4 Implement official queued prompt delivery with valid preallocated IDs and provenance, preserving agent/model/permissions/location; verify the host contract receives exactly the permitted fields, no session creation/interrupt occurs, and a user-start race remains queued rather than steer.
- [x] 3.5 Implement enqueue/delivery/terminal correlation and buffered early results without treating admission as completion; verify fast completion before API resolution, cancelled inbox events, unrelated terminal events, mixed user/timer execution, and old completion events cannot release newer reservations.
- [x] 3.6 Implement bounded diagnostics, disable-on-admission/execution-failure, explicit safe rearm, and conservative ambiguous-outcome barriers; verify rejected/hanging acknowledgements, lost event/acknowledgement ordering, no retry storm, failed one-shots, and independent-session liveness.
- [x] 3.7 Add README architecture and precise busy/background, due-versus-answer timing, coalescing, spacing, failed/disabled status, and accepted-input cancellation limits; verify each documented claim is exercised by the scheduling tests and no strong inbox-retraction guarantee is stated.

## 4. Plugin and session lifecycle integration

- [x] 4.1 Wire `Plugin.define`, configuration validation, per-location scheduler instances, tool registration, and a typed event consumer subscribed before tool availability; verify a typed plugin-host integration fixture initializes independently for two locations and does not duplicate tools on the tested configuration paths.
- [x] 4.2 Implement busy state reconciliation using fresh session info plus execution/status events, with event precedence and conservative unknown state; verify mid-execution installation, stale fetches, same-millisecond transitions, retry state, and event-stream failure without using indefinite session.wait promises or message-text heuristics.
- [x] 4.3 Implement session interruption, confirmed deletion, and project/location mismatch cleanup; verify all owned timers disappear, success/navigation preserve timers, transient errors do not simulate deletion, moved owners are not followed, and forks do not inherit timers.
- [x] 4.4 Implement unload cleanup, deadline/event cancellation, registration disposal, idempotent close, and late promise guards; verify no native timer or owned event consumer remains, no unhandled rejection occurs, and cleanup does not wait for a foreground execution or resurrect removed state.
- [x] 4.5 Add README lifecycle, In-Memory/reload guarantees, unsupported V1/multi-server boundaries, and native permission/approval prerequisites; verify documentation explicitly distinguishes stopping timers from already accepted OpenCode input and service restarts from UI navigation.

## 5. Real-host integration and release-readiness verification

- [x] 5.1 Add opt-in isolated real OpenCode integration tests using actual plugin loading and a deterministic test model/host fixture where supported; verify one-shot and recurring delivery in an existing session, tool calls returning during an active run, queue behavior, and original history/context without production credentials or infrastructure changes.
- [x] 5.2 Exercise real-host concurrency and lifecycle scenarios for two sessions/locations, active foreground work, real background process monitoring, interruption, deletion, update/stop races, and plugin reload; verify no duplicate accepted scheduler prompt, no burst, no cross-owner mutation, and no timer restoration.
- [x] 5.3 Run the unit, type, build, package, and real-host contract suite against OpenCode 2.3.2 and 2.4.1; record exact versions/results and advertise only verified support, reporting unavailable targets or unresolved API behavior as blockers rather than silently passing them.
- [x] 5.4 Deliver and run a documented manual smoke procedure in OpenCode and OpenChamber covering natural-language start/list/update/stop/stop-all, a true background test/container, a busy foreground tool, navigation, interruption, expiry, deletion, and service restart; record exact UI/service versions and observations, with unavailable environments explicitly marked unverified.
- [x] 5.5 Audit every scenario in the three capability specs against automated tests or recorded manual checks; verify all five tools, default lifetime/minimum spacing, cleanup, installation modes, and accepted-input limitations are covered and the packed README commands work as written.
