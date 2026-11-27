# Interactive smoke test: OpenCode and OpenChamber

## Persistent automation smoke contract (A01–A12)

**Recorded fixture pass (2026-11-27):** native OpenCode web/server **2.4.1** and
OpenChamber **2.8.0**, Windows x64. All twelve procedure items have recorded
client observations; [per-client automation evidence](automation-ui-verification.md)
lists screenshots, transcripts, startup/recovery assertions and cleanup. This
certifies the stated deterministic fixtures, not arbitrary LLM interpretation,
every internal scenario/cross-product, a clean client console or live providers.

Run these separately in both clients against a **private supported OpenCode server** with the locally built package, unique project/config/state directories, and safe fixture model data. Never install into or restart a shared server. Earlier timer results below do not certify these checks. Record each check as passed, failed, or unverified per client and version; a written procedure is not an executed check.

- **A01 — Discoverability and weekday request.** Ask for a weekday 09:00 Europe/Berlin PR-link report. Inspect `automation_create`: five-field `0 9 * * 1-5`, explicit zone/target, default `skip`. List seven automation and five unchanged timer tools. For observable output use a separate >=30-second interval fixture; this does not certify wall-clock cron timing (unit fixtures do).
- **A02 — Selected chat and navigation.** Create control, report, and unrelated chats. Bind the report by ID, navigate elsewhere, and observe the fixture link only in the report chat. Rename it and verify the bound ID does not change; other chats are neither interrupted nor given report input.
- **A03 — Described destination.** Ask for monitoring in “the deployment chat.” With one candidate bind its ID; with two plausible candidates verify clarification before any new definition/write. Reject foreign project/location targets without revealing their contents.
- **A04 — Busy and shared gate.** Hold report execution over two slots, create a temporary timer for that same chat, then release. Verify no overlap, one coalesced due check, minimum cooldown, and independent progress in another chat. Fresh-chat retargeting must not bypass an outstanding automation run.
- **A05 — New-chat policies.** “In a new chat” creates one reusable chat. Two occurrences reuse it, including after restart. “Every time a new chat” creates distinct chats only for admitted runs; skipped offline slots create none. Check saved agent/model/restrictions and no copied full history.
- **A06 — Private restart/misfire.** Pause and restart the private server, not merely the UI. Verify definition/update/pause/outcome survives and temporary timers disappear. In a separate resolved routine stop the server over several interval slots: default `skip` yields no immediate historical replay; explicit `catch-up-once` yields one current-state check. Verify anchored future slots. Remove test routines after observing the result.
- **A07 — Interruption and failure.** Use the client Stop control during an automated report, then during unrelated foreground work. Both preserve the durable routine; session timers stop. Verify a later nominal report still occurs. A fixture execution failure pauses with a bounded diagnostic and no immediate retry; resume requires explicit action.
- **A08 — Ambiguous acceptance recovery/removal.** Stop the private process after report acceptance before proven completion; restart and inspect one unchanged report plus `unresolved`. Resume/retarget/remove cannot bypass the old session barrier. Removal stops future admissions but warns that already admitted input can still run. Never clear stored recovery data to force a pass.
- **A09 — Stable identity and target loss.** Fork/rename the target and reuse its title: schedules stay bound to the original ID. Delete or move the private target; verify persistent `target-unavailable`, no replacement chat, and explicit retarget plus resume repair. Distinguish transient inspection failure from deletion.
- **A10 — Location/UI lifetime.** Close only the private client's UI while its server/location stays active: verify no claim that UI closure stopped scheduling. Unload the private location/server and verify no new local admission; reload uses stored definitions and conservative barriers. Do not unload a production location.
- **A11 — Approval policy.** With an isolated read-only fixture tool configured to require approval, verify an automated prompt waits for the same approval instead of automatically granting it. Deny the fixture request safely; verify no real PR lookup or credential use. Repeat for a newly created restricted chat. A hard-coded model response containing a link is not evidence that tool approval was exercised.
- **A12 — Visible evidence and cleanup.** Save client/version, private server address/root, automation/target/message IDs, transcript/link screenshots, outcomes, and pending approvals. Mark unavailable UI paths unverified. Pause/remove all resolved test routines; stop only owned child processes. No publication or live provider claims.

See [automation scenario mapping](automation-scenario-audit.md) and [verification status](verification.md) for the evidence boundary.

Temporary-timer status: completed across the recorded runs on 2026-11-25 with OpenCode Web/server 2.4.1 and OpenChamber Web 2.8.0 on Windows x64. The earlier partial record is retained below; the final continuation closes its timer gaps. Automation checks A01–A12 above have separate execution status in `verification.md`. The deterministic real-server suite does not replace UI/agent-language checks.

## Safety and prerequisites

- Use disposable test projects and sessions, not existing work.
- Build with `npm ci` and `npm run build`.
- Enable the absolute plugin **package directory** in the selected test server's configuration. Do not configure a single compiled file.
- Prefer an isolated server/client configuration. Connecting OpenChamber to it must not reconfigure or restart the working shared service without permission.
- An actual agent/model is required for natural-language tool selection. Any needed credentials must be supplied privately, not committed or printed.
- Record the OpenCode executable/server version, OpenChamber version, OS, installation scope, test project and date. Do not treat an unrun item as passed.

## Procedure (repeat in OpenCode and OpenChamber)

1. Ask: “Check in 30 seconds whether the file `ready.txt` exists. Run this once, with a maximum lifetime of two minutes.” Verify the agent calls `timer_start`, returns immediately, reports an ID, and later checks in the same session. It must not invent the file's status from elapsed time.
2. Ask: “Give me a status every 30 seconds for three minutes.” Ask “List my timers.” Verify `timer_list` contains the recurring timer with creation, next due, expiry and status. Wait for two checks: no overlapping turns and no burst of missed runs.
3. Ask: “Change that interval to one minute.” Verify `timer_update` keeps the same ID and original expiry. Ask “Stop that timer.” Verify `timer_stop` and no new local submissions.
4. Create two differently labelled timers. Ask “Stop all timers in this session.” Verify `timer_stop_all` removes both and subsequent listing is empty. Repeat stopping to verify idempotence.
5. Start a disposable real background process (e.g. a Node process that writes a status file then exits after 65 seconds). Schedule a 30-second check. Verify it runs while the process remains in the background and checks actual output.
6. Create a 30-second timer and run a 45-second foreground command. Verify the check is deferred until foreground work ends; no interrupt or catch-up burst occurs.
7. In another project/session create a timer. Navigate between chats and projects. Verify original timers stay associated with their sessions, hidden sessions can run, and listing/stop-all does not affect the other session.
8. Create a timer, start disposable foreground work and use the UI's stop/interrupt action. Resume the conversation and list timers: all timers of that interrupted session are gone.
9. Create a recurring timer with a 60-second maximum lifetime. Verify expiry is based on original creation, includes busy waits and occurs without another list call. There is no dispatch at/after expiry.
10. Create a delayed timer and delete its disposable session. Verify no replacement session or later prompt appears.
11. With only disposable sessions on the selected test server, reload the plugin or restart that private service. List timers: none are restored. Explain that previously accepted OpenCode input is a separate limitation and can survive scheduler state loss.
12. Check tool permission behavior using an approval-required harmless command: the scheduler must not auto-approve. Restore only test configuration changes made for this procedure.

## Results to record

Record pass/fail/unverified for each numbered item separately for each client, plus timer IDs and relevant transcript/event evidence. If the environment is unavailable or using it requires changing a working service, leave task 5.4 open and ask for the test-environment decision. Only claim interactive OpenChamber support after these checks actually run.

## Recorded run: 2026-11-25

Windows x64; private OpenCode 2.4.1 Web/server on loopback port 50980;
OpenChamber Web 2.8.0 on port 50981. Disposable project under the approved
temporary directory (`scheduler-ui-sffTya/project`), model
`omniroute/work/gpt-6.1-sol`. No working service was changed. Credentials were
copied only into a user-ACL-restricted private configuration.

| Item | OpenCode Web | OpenChamber Web |
| --- | --- | --- |
| 1: One-shot actual file check | Pass: NativeOnce used `glob`, once, in its original session | Pass: initial ready.txt check and OCDeferred used `glob` |
| 2: Recurrence twice and inspectable list | Partial: NativeBackground dispatched and multiple timers serialized; independent twice/list workflow remains | Pass for two background checks; full timestamp/status UI inspection remains partial |
| 3: Update and individual stop | Pass: German management request, same ID and original expiry | Pass: German management request, same ID and original expiry |
| 4: Two timers and stop-all | Pass: management request and empty final list; repeated UI stop-all remains unverified | Pass: two timers removed and empty final list; repeated UI stop-all remains unverified |
| 5: Real background process | Pass: actual background Node process and shell process inspection | Pass: two shell checks while a different session was selected |
| 6: Busy foreground deferral | Pass: 45-second foreground completed before NativeBackground/NativeOnce admission, serialized checks | Pass: OCDeferred checked the file only after the 45-second foreground returned |
| 7: Cross-project navigation/isolation | Partial: chat navigation/hidden session execution; separate-project UI flow unverified | Partial: chat navigation/hidden session execution; separate-project UI flow unverified |
| 8: UI interruption | Pass: Stoppen, then timer_list empty | Pass: Generierung stoppen, then timer_list empty |
| 9: Busy lifetime expiry | Unverified independent run: configuration edit invalidated the NativeExpiry/NativeReload experiment | Pass: 60-second lifetime expired during 70-second foreground work, no late prompt |
| 10: UI deletion with active timer | Unverified | Pass: DeleteProbe session deleted before first due time, still HTTP 404 afterward, no replacement |
| 11: Private reload/restart | Partial: configuration change cleared NativeReload; native UI verification of explicit controlled reload remains | Pass for plugin reload: ControlledReload visible before explicit private location reload (HTTP 204), subsequent UI timer_list empty; process restart not repeated |
| 12: Approval-required harmless shell | Pass: scheduled Write-Output showed Berechtigung erforderlich; denied, not auto-approved | Pass: scheduled Write-Output showed Berechtigung erforderlich; Ablehnen used, no auto-approval |

### Transcript references

- Background/navigation and native management: session
  `ses_ded8e1d6bffeS0cdg6fNPFrwWA`, recurring timer
  `a56b81e2-477d-4abe-966e-bbf53b420865`. Shell returned a wrapper PID;
  the agent inspected the actual Node child rather than assuming it was running.
- OpenChamber expiry: `ses_ded8d7fb8ffeAtWumZJ2k1wzfw`.
- Both UI stop actions and subsequent empty lists:
  `ses_ded8a92a3ffeO7e5hU9hO0JiSF`.
- OpenChamber deletion: `ses_ded86457fffeuSqxerrYqMVvdr`, timer
  `cc6f73df-c644-47b3-91bc-f365885723bb`.
- Native foreground/background/file checks:
  `ses_ded85421cffeJU7j6lbj2WbWFZ`.
- OpenChamber foreground/file check: `ses_ded84b187ffeMPYLpn9hOyS311`.
- Native approval and contaminated expiry/reload experiment:
  `ses_ded83235dffec8QZtdEw3IKkDx`; approval timer
  `204259f5-7ed5-47a0-9476-5571714b5a0a`.
- OpenChamber reload/approval: `ses_ded83fc81ffe5BcJhA8RmA5U2T`.
  Approval timer `15bf483c-9f3a-4b29-a74e-10b73e52213d` reached the
  visible approval card and was denied.
  Controlled reload timer `599fec06-c766-47ec-b90e-8e298ccde166` was
  listed before reload and absent from the subsequent UI tool result.

### Client observations, not scheduler failures

OpenChamber logged 422 responses from source-control binding queries in the
disposable project and 404 session/inbox/message requests immediately after
deletion. The deleted session remained absent. A Playwright right-click was
blocked by an aria-disabled draggable ancestor; dispatching the actual
contextmenu event exposed the normal menu and confirmation dialog. These
observations are not a clean-console certification or fixes to OpenChamber.

Do not build the watched plugin or edit its configuration during a timing
experiment: reload discards all in-memory timers and invalidates expiry evidence.

## Final continuation: all remaining checks completed

Same client/server/model versions as above; fresh private root
`scheduler-ui-PTI4GN`, with `project` and `second-project`. Each project's
`opencode.jsonc` enabled the already packed and npm-installed package directory.
The private global config contained no `plugins` entry. A `disabled-project`
without project configuration exposed no timer tool. OpenChamber's normal
project-plugin trust dialog was explicitly accepted for these disposable
projects. No package build or configuration edit occurred during timing checks.

| Previously incomplete item | OpenCode Web | OpenChamber Web |
| --- | --- | --- |
| 2: Recurrence and full list | Pass: 9 checks; ID/createdAt/nextDueAt/expiresAt/status recorded | Pass: 7 checks; all fields shown in UI; deferred status also observed before restart |
| 4: Repeated stop-all | Pass: two new timers removed, second call removed 0, list empty | Pass: two new timers removed, second call removed 0, list empty |
| 7: Different projects/navigation | Pass: second-project tools cannot see first-project timer; stop-all there did not stop recurring checks in hidden original session | Pass: second project added through UI; its empty list/stop-all isolated; original hidden session continued |
| 9: Independent busy expiry | Pass: after 70-second foreground only the 360-second control timer remained; 60-second timer never admitted | Already passed in earlier run |
| 10: Deletion while active | Pass: NativeDeleteActive created, session deleted through tab menu and confirmation before its due time; HTTP 404 persisted after due | Already passed in earlier run |
| 11: Actual service restart | Pass: live sentinel listed before private server process restart; timer_list empty afterward | Pass: live sentinel listed before the same process restart; timer_list empty afterward |

Combined with the preceding run, all 12 numbered items have passing evidence in
both clients. Console observations are still not a clean-console guarantee.

### Final evidence

- Native recurrence: `ses_ded7a614cffeVFKTHySdtaHyw7`, timer
  `8c05da67-1c5d-4dbc-a041-bf3e3a2307b8`; 9 accepted checks, consecutive
  admission gaps at least 32.4 seconds. Second project:
  `ses_ded7a5fcfffePWBqOWpsrSZvX7`.
- OpenChamber recurrence: `ses_ded7a5ea1ffeRGr5S2wpPFmoMq`, timer
  `3f1976ab-d95e-4d8d-aea5-c6a68d1ee829`; 7 accepted checks, gaps at least
  32.4 seconds. Second project: `ses_ded7a5e80ffeikkG0kNeIQDLJh`.
- Native independent expiry: `ses_ded7a5e71ffejzoDpHk5NvHFK1`;
  expired timer `ead0818b-eaf6-409b-ac75-a16669135a22`, surviving control
  `d44e9129-5c26-4bcf-a997-e156b3ff84bf`.
- Native active deletion: `ses_ded7a5e62ffeI6tNU5GNVilr6P`, timer
  `41ab245c-e1e1-4ec2-a16a-b1fbcb76b1d3`. The earlier 60-second one-shot
  fired before menu confirmation and is not used as active-deletion evidence;
  the 120-second recurring replacement was still scheduled when deleted.
- Actual restart sentinels: native
  `6c7e70cf-6c4d-4eea-8417-472ab65d148c`, OpenChamber
  `4987f8cf-2100-4377-a831-b0a4b741a8ef`. Restart changed only the recorded
  private server PID; home, data and configuration paths were unchanged.
- Disabled project negative control: `ses_ded7a5e4effeusNQV0wIotN9Vf`.
  Agent reported timer_list absent without running discovery or shell commands.

Full before/after histories were saved only under the ACL-restricted private
root as `final-before-restart.json` and `final-after-restart.json`. Previously
accepted OpenCode input is still outside the plugin cancellation/state-loss
guarantee; the restart sentinels had not been accepted before restart.
