# 0.2.0: persistent prompt automations

## Changes

- Seven automation tools alongside the five unchanged temporary timer tools.
- Durable interval/five-field-cron schedules, explicit IANA time zones and
  deterministic DST/anchor behavior.
- Current/existing-chat targets, one reusable new chat, or a fresh chat per run.
- Default offline skipping and explicit coalesced catch-up; shared chat
  reservations/spacing prevent overlap and due-timer starvation.
- Explicit pause/resume/removal and conservative unresolved-run recovery through
  official plugin storage, without a separate scheduler service.
- Existing permissions remain enforced; new chats retain saved execution
  selections/restrictions. No automatic approvals or provider integration.

## Verification before publication

The complete automation change has 38/38 tasks verified, 244 local tests,
OpenCode 2.3.2/2.4.1 isolated host acceptance, and the native OpenCode 2.4.1 /
OpenChamber 2.8.0 fixture UI matrix. See [verification](verification.md) and
[UI evidence](automation-ui-verification.md) for exact limits.

Specs were synchronized to three new automation capabilities and the existing
plugin lifecycle specification; the change was archived at
`openspec/changes/archive/2026-11-27-add-persistent-prompt-automations`.

The user authorized commit, push, tag-triggered release and public publication
on 2026-11-27. The intended stable version is 0.2.0. Publication is pending until
the tag-triggered OIDC workflow and public registry verification succeed; local
package checks and this document are not publication evidence.

Release-preparation checks passed with 245 local tests (3 opt-in host tests
skipped), typecheck, strict validation of all seven synchronized main specs, and
the real 0.2.0 tarball installation/import check. The archived deltas are checked
against the main specs by a deterministic regression. Windows branch CI now
reruns all three isolated timer/automation host suites on both asserted versions
before the release tag is pushed.

## Runtime limits

Automation definitions survive restarts but run only while the owning server
and plugin location are active. An accepted old run with insufficient terminal
evidence remains unresolved, potentially indefinitely; edits/removal do not
bypass its barrier. Closing a UI does not necessarily stop scheduling.

No live provider lookup, production configuration change or shared-server
restart is part of this release verification.
