# Persistent automation UI acceptance

Client scope: native OpenCode web client **2.4.1** and OpenChamber **2.8.0** on
Windows, attached only to the private pinned OpenCode **2.4.1** server at loopback
ports 51080/51081. The named Playwright contexts use separate browser storage and
do not terminate the user's browser profile. Evidence root:
`C:/Users/Lars.Brandt/AppData/Local/Temp/opencode/scheduler-automation-ui-vzBbAB`.

All model/tool-selection outputs are deterministic fixtures. They exercise
representable tool calls and client controls, not arbitrary natural-language
interpretation, a live PR provider, or real credentials. Clock/DST and transient
storage/inspection failures remain deterministic-test contracts. A client
screenshot alone is not a scheduler timing pass; saved transcripts, accepted
message IDs, and definition state provide the corresponding assertions.

## Recorded checks

| Check | Native OpenCode | OpenChamber | Evidence and bounds |
| --- | --- | --- | --- |
| A01 discoverability/weekday | Passed | Passed | `ui-tool-inventory.json`: seven automation/five timer tools. `native-weekday-tools.png`, `chamber-weekday-tools.png`, `ui-a01-a03-native.json`: five-field weekday cron, Berlin zone, explicit current target and default skip. Not a real weekday clock wait. |
| A02 selected chat/navigation | Passed | Passed | Earlier `openchamber-report.png`, `opencode-report.png`, `openchamber-unrelated.png`; selected report transcript and zero unrelated automated inputs. Actual client rename keeps the bound ID; `native-target-renamed.png`, `chamber-target-renamed.png`. |
| A03 described/ambiguous/foreign | Passed | Passed | `native-described-unique.png`, `chamber-described-unique.png`; both select the sole Deployment primary ID. `native-described-ambiguous.png`, `chamber-described-ambiguous.png`: question rendered for two candidates, no mutation before answer, question safely discarded. `ui-target-selection-after.json` and `native-ambiguity-before-answer.json`. Both foreign requests returned scope errors without foreign content; `native-foreign-rejected.png`, `chamber-foreign-rejected.png`, recorded model tool results. |
| A04 busy/shared gate | Passed | Passed | `ui-busy-while-retargeted.json`: each chat holds one report across multiple slots, one same-chat timer, then one coalesced report; independent target progressed seven times. Retargeting held reports to fresh-chat policy created no escape chats. `busy-retarget-while-running.json`, `native-busy-coalesced-timer.png`, `chamber-busy-coalesced-timer.png` and timestamped model requests. |
| A05 new-chat policies | Passed | Passed | `ui-new-chat-evidence.json`: two reusable inputs share one ID; two fresh IDs each have one input. `ui-misfire-after.json` proves reusable ID unchanged and no offline fresh chats; `ui-after-misfire-observation.json`: later runs use the same reusable ID and two further fresh IDs. Screenshots `native/chamber-reusable-two-runs.png`, `native/chamber-fresh-<sessionID>.png`, `native/chamber-reuse-after-restart.png`, `native/chamber-fresh-after-restart.png`. Saved agent/model/restriction handling is covered by host/target tests and the earlier restricted-new-chat approval screenshot. |
| A06 restart/misfire | Passed | Passed | `ui-postrestart-state.json`: paused/enabled states and outcomes retained, timer sentinel gone. `ui-private-offline-evidence.json`: server unavailable over two slots. `ui-misfire-before.json`/`ui-misfire-after.json`: skip counts unchanged immediately after startup, one explicit catch-up, no offline fresh chats, anchored future deadlines. `native/chamber-catchup-after-restart.png` and reusable/fresh screenshots confirm rendering. |
| A07 Stop/failure | Passed | Passed | Earlier automated and foreground Stop screenshots/states. `native-execution-failure.png`, `chamber-execution-failure.png`: visible provider error; `ui-failure-final.json`: failed paused routine, count one, no immediate retry. |
| A08 uncertain recovery/removal | Passed | Passed | `ui-postrestart-state.json`, `chamber-recovery-unresolved.png`, `native-recovery-one-report.png`: one unchanged accepted report and unresolved restored run. Both explicit resume calls rejected; `native/chamber-recovery-resume-rejected.png`. Retarget preserved old run snapshot, created no escape chat; `chamber-recovery-retarget-gated.png`. Removal warning shown in OpenChamber and observed in native history; `native/chamber-remove-recovery-warning.png`. Replacement routine remained blocked even after independent foreground work made the old target idle: `ui-recovery-after-removal-idle.json`, `native/chamber-recovery-target-idle-still-gated.png`. Safety tombstone remains, not cleared. |
| A09 identity/target loss/repair | Passed | Passed | Native rename, title reuse and fork did not redirect; `native-identity-bound.json`. Each client deleted its private target through normal UI. `native-target-loss.json`, `chamber-target-lost-expanded.png`: target-unavailable, no replacement. `ui-both-retarget-still-paused.json`: edits alone do not resume. Explicit UI resume followed by reports in repaired ID; `ui-repaired-and-new-policy-state.json`, `native/chamber-repaired-reports.png`. Transient inspection failure distinction remains unit-test evidence. |
| A10 UI/server lifetime | Passed | Passed | `ui-closed-clients-evidence.json`: admission with both private clients closed, screenshots `native/chamber-report-after-ui-close.png`. Private server stopped over multiple slots, restart retains records/barrier; `ui-private-offline-evidence.json`, `ui-postrestart-state.json`, `ui-misfire-after.json`. The permitted server-unload path is used, not a shared location unload. |
| A11 approvals | Passed | Passed | Earlier `openchamber-approval.png` for existing target and `opencode-new-approval.png` for reusable restricted target; normal deny controls, interrupted outcomes, no shell execution/automatic approval. Both clients observed their own policy path, not every cross-product of policy and client. |
| A12 artifacts/cleanup | Passed | Passed | `ui-final-transcripts.json`: 26 scoped chat histories. `ui-final-cleanup.json`: sixteen resolved definitions removed, automation/timer lists empty; `native/chamber-final-empty-list.png`. `ui-retained-recovery-tombstone.json`: one disabled removed unresolved record retained intentionally. Owned final PIDs 38164/38496/46156 stopped after checking their command lines; private ports closed. Nothing published or installed into live configuration. |

## Client/fixture observations

- OpenChamber's sortable sidebar wraps interactive rows in an `aria-disabled`
  drag container; Playwright force-clicks on visible rows were used where normal
  actionability checks refused them. No production DOM was changed.
- Native OpenCode compacts the long control history automatically. This fixed
  loopback model does not generate compaction summaries, so a new private
  control chat was created. Persisted automations were managed from that same
  owning location, without copying/replacing them. `ui-continuation-control.json`
  records the reason. This is not arbitrary-model compaction certification.
- After the prior private shutdown, the old approval target retained a busy
  timestamp. The failure fixture did not bypass it; it was explicitly retargeted
  to a fresh idle chat. `ui-failure-target.json` records that change.
- The first temporary restart-helper attempt confused a signalled child exit
  with an active process because `exitCode` stays null after signal termination.
  The helper now checks `signalCode` too; only owned helper/client processes were
  replaced. The unavailable-server evidence is preserved and is not a passing
  restart-helper result. No production source was changed by this continuation.
- Existing console/integration errors and the early OpenChamber Stop race are
  documented in `verification.md`; passing scheduler acceptance is not a clean
  console or universal client reliability claim.

## Final result

All twelve recorded procedure items now have passing fixture-based observations
for the two stated clients. This does not imply every internal deterministic
scenario has a separate browser test, every client/target-policy cross-product
was exercised, or arbitrary language/live-provider access was validated.

The final additional A04 check held **foreground** execution for 65 seconds
(over two interval slots), admitted no report while busy, then exactly one
coalesced report on release. `ui-deferred-coalescing.json` and
`native/chamber-busy-foreground-no-overlap.png` /
`native/chamber-busy-coalesced-after-release.png` record both states. The routine
was explicitly paused after that report. This separates foreground deferral
from the earlier automation-wide held-run/retarget gate.

Tasks 7.3 and 7.4 are complete after strict validation, the 101-heading evidence
review, typecheck, build/non-publishing package installation/import and 244
passing local tests (3 opt-in host tests skipped). The complete pinned real-host
matrix passed separately on 2.3.2 and 2.4.1. No archival, commit, push,
publication, or live plugin installation was performed; each requires the
appropriate separate user authorization.
