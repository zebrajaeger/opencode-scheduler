# Automated public release verification

Implementation date: 2026-11-25. This document separates local evidence from
external release gates. No npm package publication, GitHub tag push or account
modification is authorized by implementing this change.

## Local evidence

- Node 24.20.0 / npm 11.19.0 on Windows x64.
- `npm ci` succeeded in an independent clean temporary project with the current
  package/lockfile. A concurrent reinstall in the working checkout hit a Windows
  Rollup file lock held by the running host-test process; that attempt is not
  counted as success and the checkout dependencies must be restored afterward.
- 67 deterministic scheduler, release helper and workflow tests passed; the
  opt-in real-host test is skipped in ordinary `npm test`.
- Actual `npm run release:check` succeeded: the tarball contains required ESM
  files/declarations, README and MIT LICENSE; forbidden archive files and secret
  patterns are rejected. Its dependencies install with scripts disabled in an
  isolated fixture, and its default plugin export imports successfully.
- `actionlint` 1.7.12 independently validated both workflow files with no
  diagnostics. Its downloaded Windows binary archive was SHA-256 checked against
  the upstream release digest. ShellCheck/Pyflakes integrations were disabled;
  those are not claimed tested.
- Full action commit pins were resolved from upstream GitHub refs: checkout
  v4.3.1, setup-node v4.4.0, upload-artifact v4.6.2, download-artifact v4.3.0.
- Node's release index confirms 24.20.0 includes npm 11.19.0, above npm's OIDC
  minimums. The installed npm 11.19.0 publish implementation reads tarball
  manifests and passes the tarball bytes to libnpmpublish; the explicit
  provenance path signs their integrity. Actual OIDC/provenance remains unverified.
- No `src/` files were changed. A secret-pattern review of release source,
  workflows, tests and documentation found only the intentionally invalid private
  key header used by the archive rejection test; it is not a credential and is
  outside the package allowlist. No user/provider credentials were needed.
- An exact-value leak scan privately compared three existing provider credential
  candidates against all 65 tracked/new source/documentation files and the
  decompressed generated npm archive: zero matches. Values were not printed or
  copied into project files; this scan is local only, not a CI dependency.
- GitHub Actions execution, public registry/provenance and clean OpenCode
  package-name consumption are unverified until explicitly authorized external
  steps are performed.

## Scenario audit

| package-release scenario | Evidence / gate |
| --- | --- |
| Consume a published version | README and releasing.md configuration; live package-name host smoke is pending task 4.5, not replaced by fixture import |
| Valid stable tag | release identity helper tests; identity gate before npm ci in release.yml |
| Invalid release identity | malformed/prerelease/mismatch and annotated-tag/ancestry tests; no shell interpolation of tag |
| Non-release event | workflow tests verify PR/master CI has no publishing commands/identity and release has tags only |
| Valid archive | actual npm pack/install/import plus required metadata/files/license tests; same bytes handed to publish |
| Verification failure | missing/forbidden/private file, unsafe/link/duplicate path, invalid license and failed import tests; publish needs validate |
| Trusted publisher configured | OIDC-only publishing job and explicit public/provenance command; live identity and attestations pending task 4.4 |
| Publishing identity unavailable | no token fallback and exact setup instructions; live npm rejection not simulated as authentication success |
| Duplicate release attempt | registry helper rejects existing HTTP 200; npm itself also refuses immutable version replacement |
| Post-publication failure | registry identity/integrity/license/provenance tests; documented inspect-before-retry recovery |
| First publication prerequisites | explicit ownership/bootstrap/2FA and trusted-publisher checklist; no stored npm credentials |
| Verify a release | registry metadata/public tarball verification implemented; live workflow/registry/consumer evidence remains tasks 4.4–4.5 |

Task 4.2 audits evidence and limitations; it does not mark external release
scenarios as passed. Task 4.1 remains open until actual publishing-disabled
GitHub Actions execution is recorded (or a user-approved planning update changes
that criterion). A local syntax/structure check is not an Actions run.

## Pending human-ready gates

1. Obtain authorization to commit/push this implementation so nonpublishing
   `ci.yml` can run on GitHub; inspect the package job and both Windows targets.
2. Establish/verify npm ownership and first-publication bootstrap if needed,
   with separate explicit authorization and interactive maintainer account/2FA.
3. Configure npm Trusted Publishing for owner `zebrajaeger`, repository
   `opencode-scheduler`, workflow `release.yml`, no environment; execute its
   first successful publish within the current two-day configuration window.
4. Approve a new matching stable master version tag; this publishes publicly.
5. Record public registry version/access/integrity/provenance and clean supported
   OpenCode package-name consumption. Do not infer these from local packaging.
