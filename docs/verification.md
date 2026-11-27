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

### Current automation acceptance status (2026-11-27)

Task **7.2 is complete**. The full expanded acceptance matrix passed on pinned
OpenCode **2.3.2** (342.18 seconds, private root
`scheduler-automation-acceptance-8gH1lE`) and **2.4.1** (341.70 seconds, private root
`scheduler-automation-acceptance-OCcwz2`). Each root contains `evidence.json`,
`requests.json`, and `host.log`. Both evidence files identify `phase: full` and
the asserted version, and end with an empty automation list and no store issues.

Both passes cover:

- More than two offline interval slots followed by no immediate default-skip
  replay, exactly one explicit catch-up, and future anchored deadlines.
- The reusable new chat keeping the same saved ID after restart and receiving
  two reports; two distinct fresh chats receiving one report each, with no chat
  created for skipped offline slots and no copied conversation history.
- A held automation excluding a due same-chat timer, interruption retaining the
  durable routine while deleting session timers, and subsequent timer/report
  serialization. Observed admission gaps were at least **30.09 seconds** on
  2.3.2 and **30.19 seconds** on 2.4.1 (rounded down).
- Interrupted unrelated foreground work retaining the automation, empty
  temporary timer state, and a third report afterward.
- Exactly one provider-failure fixture input, a persisted failed outcome with
  `execution-error` pause and bounded diagnostic, no retry during another full
  interval, and explicit removal of every resolved test definition.

Together with the earlier pinned restart/crash runs
(`scheduler-automation-real-lW4Wsx` for 2.3.2 and
`scheduler-automation-real-egW7h1` for 2.4.1), this supplies the task 7.2 matrix's
durable update/pause/outcome persistence, lost temporary timers, selected-target
reports, and accepted-but-unfinished recovery without duplicate submission.
Each harness stops its own private server in `finally`; no shared server was
restarted. All data/model responses are fixtures, not live provider acceptance.

The failed/partial attempts below are retained as historical diagnosis, not
additional passes or current blockers. The corrected newest-page control reader
was used in these full passes; its subsequent helper extraction is covered by
three deterministic history/correlation regressions. Latest local gate:
**243 tests passed, 3 opt-in host tests skipped**. Typecheck, build,
non-publishing package install/import, and strict OpenSpec validation passed.

Task **7.3 is complete**. The subsequent A01–A12 fixture-based UI continuation
observed the remaining described/ambiguous/foreign target, busy coalescing,
target loss/repair, new-chat restart, skip/catch-up, conservative removal barrier,
and UI/server-lifetime paths in native OpenCode **2.4.1** and OpenChamber **2.8.0**.
See [automation UI acceptance](automation-ui-verification.md) for per-check
client observations, screenshot/transcript references and explicit bounds.
Task **7.4 is complete**. Final typecheck, build/non-publishing clean-package
install/import, **244 local tests passed (3 opt-in host tests skipped)**, and
`openspec validate add-persistent-prompt-automations --strict` all passed after
the UI evidence and bilingual compatibility updates. The requirement-to-evidence
review found **101/101** delta requirement/scenario headings mapped with no
missing entry; every one of the **38/38** tracked tasks has its recorded evidence.
The review distinguishes deterministic tests, asserted pinned real hosts, and
fixture-only client observations rather than claiming live provider coverage.
Temporary diagnostic code is absent from `src`/`dist`; public installation and
release authorization boundaries remain unchanged. Nothing was committed,
pushed, published, archived, or installed into live configuration.

Final UI cleanup removed sixteen resolved visible definitions, left empty
automation/timer lists, and stopped only ownership-checked private PIDs
38164/38496/46156. Private loopback ports 51080/51081/51082 are closed. One removed,
disabled unresolved recovery tombstone is intentionally retained only in the
private test database; deleting it would defeat the conservative recovery
contract. The same private root holds the full transcripts, screenshots and
per-check summaries. No test launcher is a production service.

### Persistent automation evidence (2026-11-27)

The separate `test/automation-real-host.test.ts` passed against isolated OpenCode **2.4.1** on Windows x64 (about 72 seconds). Its loopback model produces fixture PR links, not live provider data. It verified durable create/update, a real report in the selected target, effective definition replacement, pause and terminal outcome surviving two private process restarts, empty temporary timer state after restart, and an accepted unfinished report remaining unresolved without duplicate submission after restart.

Evidence: private root `scheduler-automation-real-egW7h1`, containing `evidence.json`, `host.log`, and model request fixtures. Only the test-owned child processes were stopped; no working server/configuration or real credentials were used. Recovery context reads run after installing the durable barrier without holding setup, avoiding session APIs waiting for plugin activation; a deterministic regression test covers this ordering.

Automation SDK contracts compile for **2.3.2 and 2.4.1**. The pinned **2.3.2** isolated automation restart test also passed (69.90 seconds), with evidence in `scheduler-automation-real-lW4Wsx/evidence.json`: persisted update/pause/success outcome, lost temporary timers, and one unresolved accepted report without duplicate submission. The fixture now supports `SCHEDULER_EXPECTED_VERSION` to reject mistaken version attribution. A run using the machine's unpinned CLI passed on **2.4.2**, evidence `scheduler-automation-real-LIEw9x`; this is incidental evidence, **not** a substitute for 2.3.2 or a complete support claim.

The automation delta has a complete named evidence map in [automation scenario audit](automation-scenario-audit.md); the automated audit asserts every delta requirement/scenario is present. Client checks A01–A12 are defined in [smoke-test.md](smoke-test.md) and remain unverified until separately recorded. Current focused target/management/tool/README regressions passed (65 tests); typecheck and build passed. Combined updates now roll back on invalid patches/storage failure, retain restrictions when creating new targets, and cannot undo a pause while setup is in flight. No release, live configuration change, or shared-server restart was performed.

### Historical acceptance boundaries before the completed continuation

- The restart fixture is not the complete task 7.2 matrix: real-host skipped startup/catch-up, both new-chat policies, mixed timer/automation dispatch, interruption and execution failure still need explicit integrated runs on both pinned versions. Deterministic coverage for these behaviors is named in the audit; it does not upgrade them to real-host passes.
- A private OpenCode **2.4.1** / OpenChamber **2.8.0** loopback fixture was launched at ports 51080/51081. Its API transcript (`scheduler-automation-ui-oOW0kE/partial-ui-evidence.json`) has three `FIXTURE_REPORT` inputs in the selected target and zero messages in the unrelated chat. The routine was paused afterward. This is routing evidence, not client smoke certification.
- Playwright navigation rendered the private OpenChamber page, but subsequent calls intermittently failed with `Browser is already in use ... use --isolated`; the browser-panel tool also intermittently became unavailable. Selected report rendering, interactive Stop, and approval cards were **not verified**. Native desktop observation was available, but no user foreground app or browser profile was disrupted to work around the tooling conflict. Task 7.3 remains unchecked; older timer/UI passes are explicitly separate in both READMEs.
- Latest full local gate: **236 tests passed, 2 opt-in real-host tests skipped**, with typecheck/build successful. The non-publishing archive check requires all seven automation JS/declaration pairs and installs/imports the actual package in a clean fixture. `cron-parser` requires Node >=18 and Luxon >=12, within the package's Node >=22 runtime requirement. Development Vitest retains its pre-existing narrower `^22.12.0 || ^24.0.0 || >=26.0.0` range; no claim of testing every Node 22 minor is made.

The final non-publishing archive check passed after these documentation/source edits. Both private UI diagnostic instances were stopped using validated recorded child/launcher IDs only, after pausing the fixture routine and saving its transcript. Their externally stopped launcher exit code is not a passing smoke-test result. The ephemeral launcher was not retained as a production service. Strict OpenSpec validation passed; tasks 7.2, 7.3, and final completed-change review 7.4 remain open.

### Isolated browser retry (2026-11-27)

The named Playwright contexts `scheduler-automation-retry` and
`scheduler-automation-native` successfully accessed private OpenChamber **2.8.0**
and the native OpenCode web client on pinned server **2.4.1**. No user browser
profile was terminated. Evidence lives in
`scheduler-automation-ui-vzBbAB` under the approved OpenCode temporary directory.

- Both clients rendered four `FIXTURE_REPORT` inputs and clickable
  `https://example.invalid/pull/42` links in the bound Report target. Screenshots:
  `openchamber-report.png`, `opencode-report.png`. The unrelated chat was empty
  before deliberately submitting foreground interruption fixtures;
  `openchamber-unrelated.png` preserves that observation. Its final transcript
  contains only two explicitly submitted `HELD_UI_FOREGROUND` inputs and no
  automated report.
- OpenChamber displayed the configured shell approval card for the existing
  Approval target; native OpenCode displayed it in a newly created reusable
  restricted chat. Both requests were denied using the normal client controls,
  never automatically approved. `openchamber-approval.png` and
  `opencode-new-approval.png` record the cards. Both runs were interrupted and
  their definitions remained. This fixture uses no live PR provider or real
  credentials.
- Native `Stoppen` and OpenChamber `Generierung stoppen` each interrupted an
  automated held report. `native-stop-state.json` and
  `openchamber-stop-state.json` prove the same definition stayed enabled, with a
  later nominal occurrence admitted after the native Stop. Both clients also
  stopped separate foreground work without deleting the routine;
  `foreground-stop-state.json` records another report admission. A first
  OpenChamber foreground Stop click happened during initial admission and did
  not interrupt it; a subsequent click after observed busy state did. No claim
  of a clean console or a race-free client Stop control is made.
- The first UI launcher reached its tool timeout; the owned process group was
  gone and was restarted using the same private data root. The continuation
  added a held-response fixture only. All four UI definitions were subsequently
  paused, pending executions/approvals interrupted, then removed only after
  resolving their run records. `ui-cleanup-state.json` records an empty final
  list. The three replacement private PIDs were ownership-checked and stopped.
- The broader A01–A12 contract is not certified in full by these observations:
  ambiguity/foreign-target interaction, deletion/movement repair, full busy
  coalescing and UI-close/location-unload paths still lack this retry's complete
  client evidence. Task 7.3 remains open rather than treating successful report,
  approval and Stop paths as certification of every smoke item.

The extended pinned-version acceptance harness
`test/automation-acceptance-real-host.test.ts` initially exposed a fixture
assumption (matching mutable auto-generated titles), corrected to match delivered
prompt identities. Both versions then passed startup skip/catch-up and both new
target policies before exposing starvation of a due timer by a recurring
automation. A failing deterministic test reproduced the callback-order race.
`Scheduler.reserveExternal` now gives an older due timer its reservation, while
retaining older automation precedence and unconditional recovery barriers.
Corrected full pinned runs remain required; partial failed runs are not passes.

The first post-fix pinned runs admitted `MIXED_TIMER_AFTER_STOP` on both versions
(`scheduler-automation-acceptance-hJ0yGj`, 2.3.2, and
`scheduler-automation-acceptance-xpIGBx`, 2.4.1). They then hit a fixture timeout
waiting for the automation: serialization correctly adds another cooldown slot.
The assertion now allows that extra slot rather than assuming the former
automation-first starvation order. Those runs still count as partial failures,
not complete host acceptance. The latest full deterministic run passed **239
tests, 3 opt-in host tests skipped**; final typecheck and focused fairness/docs
tests passed. The post-fix non-publishing archive installation/import and strict
validation passed, with all 101 delta requirement/scenario headings mapped.

The next pinned runs completed the mixed-dispatch assertions:
`scheduler-automation-acceptance-NGJdmC` (**2.3.2**) and
`scheduler-automation-acceptance-jdAqCo` (**2.4.1**) each observed an interrupted
automation remaining enabled, then one timer followed by a later automation,
with admission gaps over 30 seconds. They failed at the subsequent foreground
fixture setup because its 3600-second timer used the default 3600-second lifetime:
the first due time correctly must precede expiry. The test now explicitly uses
7200 seconds for that timer's lifetime. No production validation was relaxed;
these are still incomplete acceptance runs pending the foreground/failure tail.

The lifetime-corrected runs (`scheduler-automation-acceptance-G2vd5p`, **2.3.2**,
and `scheduler-automation-acceptance-75BAKB`, **2.4.1**) also interrupted the held
foreground execution and removed its temporary timer. The durable routine stayed
enabled without a persisted outstanding run, but no later report arrived in the
asserted window. Read-only inspection of the private database confirmed a later
idle timestamp and the retained enabled definition; no recovery data was edited.
This remains a failing acceptance case, not another fixture pass. Diagnosis now
uses an opt-in mixed-only harness phase and a temporary instrumented plugin in
the approved private directory. Loading the separate diagnostic package did not
register the scheduler tools, so those two attempts were tooling failures and did
not exercise the symptom. A subsequent mixed-only run uses the normal package
with three temporary tagged dispatch/inspect/reservation diagnostics; the source
logging was removed after launching that private run and is not a release change.
A fast deterministic test covering completed-report followed by foreground
interruption passed, so it does not yet reproduce the host-only stall.

The mixed-only diagnostic (`scheduler-automation-acceptance-0iJP7C`, **2.4.1**)
resolved that apparent stall: dispatch/inspection remained active, a nominal
deadline was correctly rejected by the shared cooldown, and the retry admitted
the third report just after the original 45-second assertion timeout. Its final
saved state contains that same report's accepted/delivered run (count 3). This
was a test observation-window failure, not evidence of an indefinitely stuck
barrier. The foreground-later-occurrence assertion now allows 80 seconds, as the
other mixed-case assertion already does. Production timing/minimum spacing were
not shortened. The temporary source diagnostics were removed and `dist` rebuilt
without them before launching full pinned verification again. Latest clean
deterministic regression: **240 passed, 3 opt-in host tests skipped**.

Full clean runs next reached the provider-failure tail:
`scheduler-automation-acceptance-lzQKEK` (**2.3.2**) and
`scheduler-automation-acceptance-XDx1WF` (**2.4.1**). Their saved foreground
evidence confirms later automation delivery. Each host also persisted exactly
one failed `FAIL_REPORT`, `enabled: false`, `pauseReason: execution-error`, and a
bounded provider diagnostic. The test still timed out because repeated control
polling produced over 500 messages while its history reader kept fetching the
first 200 in ascending order and reused an old list result. Read-only private
database inspection established the actual correct failure state; this is not
counted as a passing run. The harness now reads the newest descending page,
restores chronological order, and restricts tool-result extraction to messages
after the exact current nonce-bearing user invocation. Failure-state polling is
also limited to once per second to avoid gratuitous chat growth. These are test
reader fixes only; production dispatch/recovery remains unchanged.
Three deterministic helper regressions now enforce current-invocation selection
on a newest page after more than 200 historical messages, and reject both a
missing invocation and a current invocation lacking its own tool result instead
of falling back to stale output. Latest local gate: **243 passed, 3 opt-in host
tests skipped**; typecheck and strict OpenSpec validation passed.

Latest retry regression gate before the fairness follow-up: **236 passed,
3 opt-in host tests skipped**; typecheck, build and non-publishing clean package
install/import passed. These results do not claim the subsequent source fix was
already accepted on either pinned host.

`npm test` skips the real-host tests by default. `npm run test:integration` requires `SCHEDULER_REAL_HOST=1` and now includes the timer/lifecycle, persistent restart, and full automation acceptance files. Run individual files explicitly with Vitest when narrowing diagnostics. The expanded matrix requires both `SCHEDULER_OPENCODE_BIN` (explicit pinned executable) and `SCHEDULER_EXPECTED_VERSION` (2.3.2 or 2.4.1); CI supplies both for each Windows matrix target. Set `SCHEDULER_TEST_TMP` to an approved directory if necessary. The fixtures use a private server, loopback mock model and unique state/config directories; they must not connect to the working shared service. No real credentials are required. The original timer/lifecycle suite takes approximately 2.5 minutes; the expanded automation matrix takes several minutes because real deadlines, cooldowns, offline time and processes are exercised, without shortening production safety limits.
