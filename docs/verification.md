# Verification status

## Completed local checks

On 2026-11-25, Node.js 24.20.0 / npm 11.19.0:

- 55 deterministic unit/typed-host tests passed before adding the opt-in real-host harness.
- Type checking and build passed.
- Package dry-run included the ESM plugin, declaration files, README and development documentation.
- Published plugin API contracts compile against 2.3.2 and 2.4.1. This is not a real-host compatibility certificate.

## Real-host results

The initial fixture failed model initialization before timer tools could be exercised:

```text
Provider package @ai-sdk/openai-compatible@2.0.0 does not export model(modelID, settings)
```

This blocker is resolved. The fixture uses the bundled native `@opencode/ai/providers/openai-compatible`, which exports V2's `model(modelID, settings)`. A local dummy apiKey is necessary because `apiKey: false` fails model snapshot validation on the tested release. No production credentials are used. The child environment allowlists OS execution variables and overrides home/data/config/state paths; successful logs contain no inherited OpenChamber plugin entries. The user's shared server was not restarted or reconfigured.

On 2026-11-25 the full real-host suite passed on Windows x64 with OpenCode **2.3.2** (about 145 seconds) and **2.4.1** (about 144 seconds). The 2.4.1 CLI was installed separately into the approved temporary directory, not as an upgrade of the working installation.

Verified: model-generated timer tools return during agent work; one-shot exactly once; recurring at least twice; original history/location/model retained; two projects/sessions isolated; foreign stop does not mutate ownership; interval update preserves expiry; a 45-second foreground tool defers its timer; a 65-second real background process allows a 30-second timer check; interruption removes session timers; deletion does not create replacement work; location reload clears timers. Logs/history/model requests remain in unique temporary directories for diagnostics.

56 local tests, type checks (including both published plugin API versions), build and package dry-run pass after the final scenario audit added an explicit configured session-wide spacing test. Tasks 5.1–5.5 are verified after the final continuation below; real-server verification alone is not certification of UI behavior.

## Partial interactive OpenChamber smoke

On 2026-11-25, a separate OpenChamber Web 2.8.0 instance connected to a private OpenCode 2.4.1 server. The existing OmniRoute connection and selected `work/gpt-6.1-sol` model were reused with the user's permission. Credential file references were resolved only into a user-ACL-restricted temporary configuration, never into the repository or test source. The working service/configuration was unchanged.

Through the browser UI, German natural-language requests successfully exercised all five tools: once/repeat start, list, interval update, stop and stop-all. The one-shot prompt checked `ready.txt` using `glob` and correctly reported its absence without creating the file. The interval update preserved ID and expiry. Stop-all removed two newly created timers and a subsequent list was empty. The first authentication error was due to unresolved home-relative credential references in the copied config and was corrected before the successful requests.

The continuation verified actual background checks while another chat was selected, foreground deferral, both clients' stop buttons followed by empty lists, OpenChamber busy expiry and deletion, and approval-required scheduled shell commands in both clients. Neither command was auto-approved; both were denied through the normal client controls. An explicit private plugin-location reload returned HTTP 204; OpenChamber listed its sentinel before reload and returned an empty list afterward.

Native background and one-shot checks serialized after a 45-second foreground tool. The one-shot used `glob` in the original project. An additional native expiry experiment was invalidated by a private configuration edit: both the short-lived and long-lived sentinel disappeared. It is not counted as an independent expiry pass. The private setup is watched; do not build/edit it during timing experiments.

This initial run was partial evidence; its remaining gaps were closed in the final continuation below. The exact per-client matrix and transcript IDs are in `docs/smoke-test.md`. OpenChamber console responses from source-control binding and recently deleted sessions are documented, not hidden or claimed clean.

## Scenario and artifact audit

`docs/scenario-audit.md` maps all 47 scenarios to named automated tests, real-host checks or manual evidence and explicitly identifies weaker installation/permission evidence. The missing configured session-wide 60-second cooldown assertion was added to `test/scheduler-dispatch.test.ts`; it passes without production changes.

An actual `npm pack --json --pack-destination <private-temp>` artifact was installed into a fresh private npm fixture with scripts disabled. Importing `@zebrajaeger/opencode-scheduler` succeeded and exposed its default ESM export. The archive contained 14 files. This validates packaging and runtime dependency resolution without publishing. Project-only host activation from this installed artifact was verified in the final continuation. Package-name configuration after publication is not claimed tested before publication.

## Final continuation: tasks 5.4 and 5.5 completed

On 2026-11-25 a fresh ACL-restricted private root (`scheduler-ui-PTI4GN`) ran
OpenCode 2.4.1 and OpenChamber Web 2.8.0 with the same authorized model. Each of
two disposable projects enabled the packed/npm-installed plugin in its own
`opencode.jsonc`; the private global config had no plugin entry. Both locations
exposed timer tools, while a third unconfigured project's agent reported
timer_list absent. OpenChamber's project-config trust dialog was accepted through
its normal UI. This exercises a real package, not just source compilation.

Native recurring checks executed 9 times, OpenChamber checks 7 times, with
minimum observed admission gaps exceeding 32 seconds and no overlap/catch-up
burst. Both clients displayed full timer records. In each second-project session,
stop-all removed two new timers, a repeated call removed zero, and the final list
was empty while the original hidden session continued checking. The native
70-second foreground expiry experiment removed only its 60-second timer and
preserved the longer-lived control, without admitting the short-lived prompt.
A native session containing an active 120-second recurring timer was deleted
through the tab context menu/confirmation and remained HTTP 404 after due.

Live delayed restart sentinels were listed in both clients before an actual
private server process restart, keeping data/config paths unchanged. Each
client then invoked timer_list through the UI and received an empty result. No
sentinel had been accepted before restart. Prior accepted input remains outside
the scheduler cancellation guarantee. No build/configuration edit occurred
during these timing experiments. Combined with the preceding recorded passes,
all 12 manual procedure items have passing evidence for both clients. This
verifies only the recorded versions/platform, not arbitrary versions or a clean
browser console. The 47-scenario audit and installation checks close task 5.5.

## Private test cleanup

The two recorded private service processes were stopped after this run. The exact
credential-bearing temporary `config/opencode/opencode.json` was deleted. An
exact-value scan using both credential candidates found zero matches in 151
repository/private-artifact files (dependency directories and Git internals
excluded). Both private SQLite databases were inspected; credential/auth tables
contained zero rows. No credential values were printed. Logs and transcripts
remain only in the private test directory for diagnostics; no commit or push was
performed.

After the final continuation, the replacement private server and private web
process were also stopped and the new credential-bearing config deleted. The
final exact-value scan covered 219 repository/private-artifact files, found zero
matches for both credential candidates, and inspected two private SQLite
databases with zero credential/auth rows. Source credentials and working
services were unchanged.

## Opt-in harness

`npm test` skips the real-host test by default. `npm run test:integration` also requires `SCHEDULER_REAL_HOST=1`. Set `SCHEDULER_OPENCODE_BIN` to an explicit executable if necessary and `SCHEDULER_TEST_TMP` to an approved directory. The fixture uses a private server, loopback mock model and unique state/config directories; it must not connect to the working shared service. No real credentials are required. The suite takes approximately 2.5 minutes because real deadlines and processes are exercised, without shortening production safety limits.
