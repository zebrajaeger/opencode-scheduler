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
on 2026-11-27. Version 0.2.0 was published successfully after the gates below;
local package checks alone were not treated as publication evidence.

Release-preparation checks passed with 245 local tests (3 opt-in host tests
skipped), typecheck, strict validation of all seven synchronized main specs, and
the real 0.2.0 tarball installation/import check. The archived deltas are checked
against the main specs by a deterministic regression. Windows branch CI now
reruns all three isolated timer/automation host suites on both asserted versions
before the release tag is pushed.

## Successful public publication (2026-11-27)

- Release commit `225cd11e4dcf7318f8e4fcf40bda19c36b9d33e4` was pushed to `main`.
- [Branch CI 46036116647](https://github.com/zebrajaeger/opencode-scheduler/actions/runs/46036116647)
  passed its package job and both Windows host jobs, including all three isolated
  timer/lifecycle, automation restart and full automation acceptance suites on
  OpenCode 2.3.2 and 2.4.1.
- Annotated tag `v0.2.0` points to that exact commit.
- [Release run 46037156483](https://github.com/zebrajaeger/opencode-scheduler/actions/runs/46037156483)
  passed both validate and publish jobs, including OIDC publication and the
  public registry integrity/provenance check.
- Unauthenticated npm metadata and tarball reads independently returned HTTP
  200. The registry reports publication at `2026-11-27T16:54:05.439Z` and
  `latest: 0.2.0` for `@zebrajaeger/opencode-scheduler`.
- The public 37-file tarball exactly matches a clean rebuild of the release
  commit with Git `core.autocrlf=false`, including its SHA-512 integrity:
  `sha512-Wd5GhH1eF/oivxq3OA+zZKe6o/vQf02j8g/1Y+zU/GfDKp8GmlC1VuqQu+9ICblNVgmtC0CC4QneKIuGgG05+Q==`.
- The downloaded SLSA v1 provenance statement binds the tarball digest to this
  repository, `.github/workflows/release.yml`, `refs/tags/v0.2.0`, the exact
  release commit and run 46037156483. This checks public statement identity and
  digest; it is not a separate cryptographic Sigstore verification.
- The public tarball passed the package allowlist, isolated dependency
  installation with scripts disabled, and default plugin ESM import.

An initial independent comparison against the existing Windows checkout failed:
its ignored `dist` directory retained 24 unrelated compiled files and some
packaged text used CRLF. A fresh default Windows archive removed those extra
files but still used CRLF. A second fresh archive with `core.autocrlf=false`
reproduced the CI/public tarball byte-for-byte. No files in the existing ignored
output were deleted, and no publication retry or tag rewrite was attempted.
The later documentation-only evidence commit does not change the released tag
or the already published package.

## Runtime limits

Automation definitions survive restarts but run only while the owning server
and plugin location are active. An accepted old run with insufficient terminal
evidence remains unresolved, potentially indefinitely; edits/removal do not
bypass its barrier. Closing a UI does not necessarily stop scheduling.

No live provider lookup, production configuration change or shared-server
restart is part of this release verification.
