# Automated public release verification

Implementation date: 2026-11-25. This document separates local evidence from
external release gates. No npm package publication, GitHub tag push or account
modification is authorized by implementing this change.

## Local evidence

- Node 24.20.0 / npm 11.19.0 on Windows x64.
- `npm ci` succeeded in an independent clean temporary project with the current
  package/lockfile. A concurrent reinstall in the working checkout hit a Windows
  Rollup file lock held by the running host-test process; that attempt is not
  counted as success. Dependencies were restored, and a subsequent working-
  checkout `npm ci` also succeeded (308 packages). Typecheck, all 67 tests, build
  and archive installation/import passed again in the working checkout as well
  as the separate clean fixture.
- 67 deterministic scheduler, release helper and workflow tests passed; the
  opt-in real-host test is skipped in ordinary `npm test`.
- Actual `npm run release:check` succeeded: the tarball contains required ESM
  files/declarations, README and MIT LICENSE; forbidden archive files and secret
  patterns are rejected. Its dependencies install with scripts disabled in an
  isolated fixture, and its default plugin export imports successfully.
  The final dry-run manifest contains 17 files (license, README, eight compiled
  entry/declaration files, six documentation files and package.json); it contains
  no source/tests/workflows, node_modules or private configuration.
- `actionlint` 1.7.12 independently validated both workflow files with no
  diagnostics. Its downloaded Windows binary archive was SHA-256 checked against
  the upstream release digest. ShellCheck/Pyflakes integrations were disabled;
  those are not claimed tested.
- The actual release preflight entrypoint rejected manipulated handoff integrity
  before making a registry request. Its CLI identity gate also rejected a tag
  containing shell syntax without evaluating it.
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
- GitHub Actions run [45618953034](https://github.com/zebrajaeger/opencode-scheduler/actions/runs/45618953034)
  passed on 2026-11-25 for commit `e63f990`: Linux package job (clean install,
  typecheck, all 67 tests, build, actual archive install/import) and both isolated
  Windows real-host jobs, OpenCode 2.3.2 and 2.4.1, all concluded success. No
  publishing job or release tag was involved. Task 4.1 is verified.
- Public OIDC publication, registry provenance and clean OpenCode package-name
  consumption remain unverified until separately authorized release steps.
- A public registry package lookup returned HTTP 404 on 2026-11-25. The package
  is not publicly available at that check; private namespace ownership/bootstrap
  prerequisites remain unverified and no login/publication was attempted.

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

Task 4.2 audits evidence and limitations; it does not mark external publication
scenarios as passed. Task 4.1 is verified by the actual successful nonpublishing
Actions run above, not just local syntax/structure checks.

## Pending human-ready gates

1. Authorized commits `c9a64a9` and `e63f990` were pushed to master without a
   release tag; nonpublishing package and both Windows host CI jobs passed.
2. Establish/verify npm ownership and first-publication bootstrap if needed,
   with separate explicit authorization and interactive maintainer account/2FA.
3. Configure npm Trusted Publishing for owner `zebrajaeger`, repository
   `opencode-scheduler`, workflow `release.yml`, no environment; execute its
   first successful publish within the current two-day configuration window.
4. Approve a new matching stable master version tag; this publishes publicly.
5. Record public registry version/access/integrity/provenance and clean supported
   OpenCode package-name consumption. Do not infer these from local packaging.
