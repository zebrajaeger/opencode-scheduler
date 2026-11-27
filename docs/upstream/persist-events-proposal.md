# Draft upstream fix: expose opt-in native event retention in CLI serve

## Existing upstream discussion (checked 2026-11-26)

- Open issue [#42839](https://github.com/anomalyco/opencode/issues/42839) already
  requests this CLI persistence option. Do not create a duplicate issue.
- Open PR [#61831](https://github.com/anomalyco/opencode/pull/61831) reports the
  current persistence setting on synchronization markers and explicitly lists
  managed-server configuration and historical-gap reporting as follow-ups.
- Earlier CLI option PR #42840 and live-follow PR #52090 are closed. Their existence
  does not establish a released retention/coverage contract.

A short additional evidence comment is prepared in `issue-42839-comment.md`.
It was [posted to #42839](https://github.com/anomalyco/opencode/issues/42839#issuecomment-7199521002)
after an explicitly user-authorized retry with the private credential. The first
attempt returned HTTP 403; the retry succeeded after checking for duplicates.
No new issue or implementation PR was created. Coordinate with the existing issue/PR rather than submit a
competing patch without maintainer design approval.

Status: local draft against OpenCode **v2.4.2**, commit
`fc31a485317970bcf6be7b431a9830aaef875731`. Not submitted or installed as the user's
host. A bounded source-host retention/restart probe passed; full qualification is
still incomplete. Companion patch: `opencode-v2.4.2-persist-events.patch`.

`git apply --check` passed against freshly fetched, exact v2.4.2 originals for all
three touched source files. This checks applicability only, not type safety or
runtime correctness. The isolated check lives outside the repository and does not
modify the installed OpenCode binary.

## Proposed change

Expose the existing `ServerOptions.events.persist` using an explicit
`serve --experimental-persist-events` Boolean option. Pass it through the exported
CLI `ServerProcess.Options` and the existing server launch. Default stays false in
all build channels. No plugin reads host database tables; no new service is added.

The switch affects the server's whole native bus, not one project or plugin. Event
payloads may contain sensitive session content and increase database size. Existing
events from periods when persistence was off cannot be recovered retroactively.
Disabling the switch does not imply deletion of already retained rows. Retention,
backup and deletion policy require explicit operator documentation before release.

## Why an explicit startup switch

Upstream's feature-flag convention prefers the registry and `Flag.enabled`. That
service depends on per-location configuration and the Bus, whereas this option must
be selected before the Bus is constructed. Calling it here would create a bootstrap
dependency. This draft uses a plainly named experimental opt-in switch; upstream
review must approve that exception or provide a server-bootstrap flag mechanism.
Do not silently enable persistence with `all`, a dev build, or plugin activation.

## Required upstream tests before submission

Read upstream `.opencode/skills/unit-tests/SKILL.md` and applicable AGENTS first.
Tests must use actual command definitions and actual server/database behavior, not
duplicate the pass-through logic or mock the native bus.

1. Parse the actual serve command with/without the switch; assert false/true and
   inclusion of the experimental/storage warning in help.
2. Launch isolated servers from the CLI entry point in both modes. Create a session
   and a queued deterministic local-model execution. Read its native log with
   `follow: false`: opted-in mode must retain ordered start and terminal payloads,
   not merely a `log.synced` marker. Default mode retains existing behavior.
3. Stop and reopen the same private database with persistence enabled; replay must
   return the original event IDs/sequences and one synchronized watermark.
4. Repeat for failure/interruption and inbox enqueue/delivery/cancellation.
5. Test `--service`/`--stdio` startup handling and document that an ordinary managed
   service restart does not magically preserve a one-time CLI flag. Persisted
   service configuration is deliberately outside this minimal draft.

Run the relevant CLI tests from `packages/cli`, the existing session-log tests from
`packages/core`, and upstream's canonical root `bun run check`. Actual results are
recorded below; no compiled custom binary build is claimed.

## Actual local verification

An isolated upstream checkout was created under the approved temporary directory;
the installed OpenCode binary/service was not modified. Bun 1.4.4 matches upstream.

- CLI test `persist-events.test.ts`: **5 passed**, actual command definition,
  default false, explicit true, service/stdio parsing and help warning.
- Core `session-log.test.ts`: **5 passed** using upstream's test launcher.
- CLI `bun run src/index.ts serve --help`: passed with the new flag.
- `verify-persist-events.mjs`: **passed** with the real patched CLI source host,
  local deterministic model and private data/config roots. Start and success
  payloads retained; event IDs/sequences identical after complete server restart.
  Evidence: `C:/Users/Lars.Brandt/AppData/Local/Temp/persist-events-probe-dzhtX7`
  (the tool may report the equivalent Windows short-user path).
- Extended probe: **passed**, default-off sessions retain no event payloads and
  enabling persistence after their execution does not reconstruct history.
  Evidence: `C:/Users/Lars.Brandt/AppData/Local/Temp/persist-events-probe-iXuxOZ`.
- `bun install --frozen-lockfile --ignore-scripts`: nonzero due to three Windows
  ENAMETOOLONG dependency symlink failures; 1568 packages installed. No claim of
  a completely successful dependency install. Targeted tests and source launch
  nevertheless ran successfully.
- Canonical `bun run check`: **failed in the upstream lint stage** on 172 grey
  values in unchanged `services/site` CSS. The chained typecheck did not run.
  No unrelated upstream cleanup was attempted; no full-check pass is claimed.
- Separate CLI `bun run typecheck`: **passed**, 2,132 files across 2 projects.

The initial probe does not test failed/interrupted execution, live disconnect/
reconnect, or all inbox races. A follow-up probe also checks default-off sessions
and confirms that enabling retention later cannot reconstruct historical payloads.
Those remain mandatory before the scheduler can qualify a production native host.
In particular, the confirmed historical gap means that a startup switch alone is
not a sufficient capability/coverage handshake for existing sessions.

## Scheduler requalification after a fixed host exists

The scheduler intentionally still rejects native replay on every currently accepted
CLI version. Do not remove that guard simply because this patch applies. Qualify an
identified host build with retention enabled, including pre-existing sessions/gaps,
source moves, disconnects, full restart, and unknown-admission gate recovery.
Then restore the mandatory real-host native follow-up test; the current rejection
regression is not its substitute. A positive host capability/coverage handshake is
preferable to trusting only a version or operator assertion.
