# Native replay acceptance blocker — 2026-11-26

The change is not fully accepted. Final verification/acceptance tasks remain open; the passing
unsupported-capability regression must not be counted as native-trigger acceptance.
No mandatory requirement has been removed or replaced by live-only observation.

## Observed failure

On isolated Windows x64/OpenCode 2.4.2, registering a future native execution-success
dependency initially succeeded with watermark 0. Its source then completed a technical
execution, but the follower received no durable execution payload and no follow-up ran.
The plugin repository contained no native event/checkpoint for that source.

Original failing fixture (local, retained):
`C:/Users/Lars.Brandt/AppData/Local/Temp/opencode/scheduler-orchestration-host-Cq9sJY`.
Source: `ses_de75b4e57ffeC2Uct7QYOBfsXJ`.
Waiting job: `job_2faf8dae-2573-435c-bb53-0131bfabdfaf`.

## Primary-source diagnosis

All links are pinned to v2.4.2:

- [Bus](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/src/bus.ts):
  `persist = options?.persist ?? false`; retained payload writes depend on this flag.
- [Server options](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/server/src/options.ts):
  programmatic `events.persist` exists.
- [Server composition](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/server/src/routes.ts):
  passes `options.events?.persist` into `Bus.configured`.
- [CLI server process](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/cli/src/server-process.ts):
  its server launch does not pass `events`; neither the inspected serve handler nor
  service configuration exposes an event-persistence option.
- [Session-log tests](https://github.com/anomalyco/opencode/blob/v2.4.2/packages/core/test/session-log.test.ts):
  durable replay fixtures explicitly replace the Bus with `persist: true`.

No supported CLI/config/environment switch was found in the inspected launch path.
A custom programmatic server can select persistence, but changing the user's host
architecture or installing a patched runtime requires an explicit decision.

## Safe interim behavior

SDK authentication/history/forms remain supported and independently verified.
Native replay is not advertised merely because SDK binding succeeds. No accepted
CLI host version is currently qualified for durable replay. Native registration
fails before creating a job; automatic and status-triggered native gate recovery
are disabled on unqualified connections. Uncertain admissions remain blocked, never
blindly resent. Component replay tests remain useful but do not qualify a real host.

## Decision needed

Choose an upstream/host fix or explicitly authorize a separately scoped supported
server launcher enabling `events.persist`, then qualify event retention and restart
replay in the real host. Alternatively, explicitly revise the mandatory recovery
contract through OpenSpec; do not silently substitute live-only events.

The user selected the upstream-fix route. A minimal, unapplied CLI startup patch and
test/requalification plan are prepared in
[`upstream/persist-events-proposal.md`](upstream/persist-events-proposal.md).
Patch applicability to v2.4.2 is checked. Five new CLI tests, five existing log tests
and an isolated patched source-host retention/restart probe now pass. Submission and
installation have not been performed. This does not resolve acceptance: the stock
CLI remains unchanged and native capability/coverage negotiation is still absent.

Mixed timer/job real-host contention now passes, as do an independent all-reviewer
aggregation with a later excluded reviewer and rejection of a deleted target. Task
9.4 and 9.5 are complete, including SDK/no-SDK and busy-target delivery. Remaining acceptance gaps and the full scenario-to-test index are
recorded in [the acceptance audit](orchestration-acceptance-audit.md).

## Latest checks after fail-closed correction

- Typecheck, build, strict OpenSpec validation and `git diff --check`: passed.
- Standard suite: 211 passed, 3 opt-in tests skipped (214 total).
- `npm run release:check`: passed; package/import/dependency checks only, no publish.
- Real orchestration host: passed in 41.6 seconds, fixture
  `C:/Users/Lars.Brandt/AppData/Local/Temp/opencode/scheduler-orchestration-host-NlRMjk`.
  Includes explicit task results, early findings, ALL aggregation, periodic stop,
  worktree mailbox, foreign-project denial, reload, server restart, authenticated
  SDK history/forms, and explicit rejection of unqualified native triggers.
- Legacy isolated host: previously passed in 149.1 seconds with immutable plugin
  snapshot (no orchestration configured). The last correction affects only enabled
  orchestration/native capability handling, not the legacy timer facade.

Linux/macOS and other real host versions were not qualified. The above passing checks
do not qualify native execution replay in the scheduler or complete the final acceptance audit.

## Continuation checkpoint

- Latest SDK host suite: passed in 108.1 seconds, fixture
  `C:/Users/Lars.Brandt/AppData/Local/Temp/opencode/scheduler-orchestration-host-fExPpv`.
- No-SDK host suite: passed in 111.2 seconds, fixture
  `C:/Users/Lars.Brandt/AppData/Local/Temp/opencode/scheduler-orchestration-host-K28UHl`.
- Timer/signal-job contention, unrelated progress, frozen reviewer aggregation,
  deleted/missing targets and a held-busy active recipient are verified.
- All 98 delta scenarios have an explicit test/limitation entry in the audit,
  enforced by `test/acceptance-audit.test.js`; coverage indexing is not acceptance.
- Patched upstream CLI passes its own typecheck and retention/restart/default-off/
  historical-gap probes. Its canonical full check stops at unrelated website lint.

There is still no qualified stock host contract exposing retention enablement and
per-session coverage/gaps. Scheduler production replay remains deliberately disabled.
Finishing mandatory native acceptance requires an upstream contract/fix or an explicitly
approved change to the host/deployment contract, not another retry of the stock host.
