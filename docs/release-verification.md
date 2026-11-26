# Automated public release verification

## Successful complete 0.1.3 release (2026-11-26)

Commit `ad6f9f5`, explicitly tagged `v0.1.3`, passed nonpublishing CI run
[45772096744](https://github.com/zebrajaeger/opencode-scheduler/actions/runs/45772096744).
The full OIDC release run
[45772621561](https://github.com/zebrajaeger/opencode-scheduler/actions/runs/45772621561)
then concluded **success**: both validate and publish jobs, including the bounded
public registry integrity/provenance check, passed. Neither job reported the
deprecated Node 20 action-runtime warning.

Independent unauthenticated registry/tarball checks returned HTTP 200 for 0.1.3,
matched the validated archive SHA-512 integrity and confirmed provenance. The
published README.md, README.de.md and docs/banner.png match the project bytes.
All 78 local tests, typecheck, package installation/import and actionlint passed
before tagging. No previous version or tag was rewritten or republished.

## 0.1.2 postpublication verification incident (2026-11-26)

The second attempt of release run 45647266387 published 0.1.2, but the subsequent
read-only registry verifier exhausted its original twelve attempts with HTTP 404.
That is a failed overall workflow, not a failed/absent npm publication. Independent
public metadata/tarball checks subsequently confirmed 0.1.2, correct SHA-512
integrity, SLSA provenance, README.md, README.de.md and docs/banner.png. No duplicate
publication was attempted. Registry propagation delay is consistent with the
observed 404-then-200 responses; the exact CDN/cache cause is not established.

Two regression tests first failed against the twelve-attempt implementation.
Verification now allows at most thirty reads with ten-second pauses, ten-second
per-request timeouts and per-attempt HTTP diagnostics. Publication is never
retried; authorization/integrity/provenance failures remain failures. The
publishing job timeout is twenty minutes to accommodate this bounded verification.
Exhaustion explicitly warns that publication may already have succeeded and
directs maintainers to retry verification only. Existing release tags retain
their original verifier. The changes were subsequently pushed and verified by
the successful 0.1.3 release recorded above.

## Actions runtime maintenance (2026-11-26)

CI and release workflows now pin native Node 24 actions: checkout v6.1.0,
setup-node v6.4.0, upload-artifact v6.0.0 and download-artifact v7.0.0.
Each immutable commit's upstream action.yml was checked for `using: node24`.
This replaces actions whose internal Node 20 runtime triggered deprecation
warnings; it is separate from the unchanged project toolchain Node 24.20.0.
Existing release tags retain their original workflow and are not rewritten.
Hosted execution of these pins is verified by the successful 0.1.3 CI/release runs above.

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

## Public bootstrap release

The user completed the authorized interactive publication of 0.1.0. Public npm
version metadata now returns HTTP 200, license MIT, and dist.integrity exactly
matches the prepublication validated archive:
`sha512-A0tXxhGxk0pEX6oQWQhcQx/DR4XmTGiEtwMhCmttqVNtVvieTGVoVvxpOHmXzcQZy8KxX03Ys5jqFNcQAaweYA==`.
This manual bootstrap has no provenance attestation and is not counted as the
planned automated OIDC release. Task 4.4 therefore remains open until Trusted
Publishing is configured and a new stable version is published through Actions.

The real-host harness accepts `SCHEDULER_PLUGIN_PACKAGE` as an opt-in override.
This permits testing the actual public version by package name with its existing
fresh private home/config/cache and loopback deterministic model, rather than a
local plugin checkout. The child environment does not inherit npm tokens or the
user's npm config. Public package consumption verification is recorded separately
after the isolated run completes.

## Automated OIDC release and isolated public consumption

Version **0.1.1** was published by the authorized `v0.1.1` tag at commit
`59d807d45176681c9be4280b0df019c11bfc33ce`. Its preceding nonpublishing CI
[45631684787](https://github.com/zebrajaeger/opencode-scheduler/actions/runs/45631684787)
succeeded. Release run
[45632419717](https://github.com/zebrajaeger/opencode-scheduler/actions/runs/45632419717)
successfully validated and published with OIDC/provenance, but its immediate
postpublication registry check failed while npm still returned HTTP 404.
The overall run is therefore recorded as **failure**, not falsely called green.
No rerun or second publication of 0.1.1 was attempted.

After propagation, public version and tarball requests returned HTTP 200.
The independent `node scripts/release.mjs registry` check succeeded against the
original validated archive. Its SHA-512 integrity is
`sha512-Pk46lNSIwmyE2q86p8WYHjcegtyQEX3PbdbNqabVzpoisr7ZOjVhulhx9JXQiV9iNNItGkgLA8rLeFNOomx48A==`.
Public npm attestations include SLSA v1 provenance identifying this repository,
`.github/workflows/release.yml`, `refs/tags/v0.1.1`, the exact release commit and
the artifact digest. Successful OIDC publication provides the first-use evidence
for the user's newly configured Trusted Publisher.

A regression test reproduced the premature-404 issue before its fix. Registry
verification now makes at most twelve read-only requests, ten seconds apart,
for 404/429/server-error propagation responses, with cache bypass. It still
fails immediately on authorization errors and never invokes publish or weakens
identity/integrity/provenance checks. **68 deterministic tests pass.**

The full real-host suite passed using the actual public package name
`@zebrajaeger/opencode-scheduler@0.1.1` on isolated OpenCode **2.3.2** (197s) and
**2.4.1** (196s), Windows x64. Fresh disposable projects/homes/config/cache,
no npm credentials, no source plugin path and a loopback deterministic model
were used. Both runs exercised all five tools, one-shot/recurring execution,
session/project isolation, foreground/background behavior, interruption,
deletion and reload. Their child servers were stopped by the harness cleanup.
No working service or provider configuration was changed. Tasks 4.4–4.5 are now
verified; historical pending gates above describe the state before this release.
