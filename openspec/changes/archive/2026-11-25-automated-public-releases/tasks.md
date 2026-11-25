# Tasks

## 1. Public package metadata and validated artifact

- [x] 1.1 Add the user-selected MIT LICENSE and matching package license metadata; verify the existing scoped package identity, ESM exports, public access and lockfile version remain consistent without changing scheduler behavior or runtime compatibility claims.
- [x] 1.2 Add release-validation helpers using Node built-ins for canonical stable tags, package/lockfile version agreement and master ancestry, including annotated tags and untrusted ref inputs handled as data rather than shell expressions.
- [x] 1.3 Add actual npm archive validation: required compiled entry/declarations, README/LICENSE, metadata, forbidden development/private artifacts and secret patterns; install the archive with scripts disabled into a clean fixture and verify default ESM import and record integrity.
- [x] 1.4 Add deterministic helper tests covering valid tags, prerelease/malformed/mismatched tags, incorrect package or lockfile identity, unauthorized ancestry, missing files, forbidden archive contents and import/dependency failures.

## 2. Nonpublishing CI and safe release automation

- [x] 2.1 Add publishing-disabled pull-request/master CI for npm ci, typecheck, deterministic tests, build and package verification; configure explicitly installed OpenCode 2.3.2/2.4.1 Windows integration jobs using the existing isolated deterministic harness, with bounded timeouts and no production credentials.
- [x] 2.2 Add .github/workflows/release.yml triggered only by version-tag pushes, with early stable-tag/version/master validation, tag-keyed concurrency and no cancellation of an active publish; use verified SHA-pinned actions, supported pinned Node/npm versions and no release dependency cache.
- [x] 2.3 Separate unprivileged validation/archive creation from the hosted-runner publishing job; give only that job id-token:write, configure the public registry and npm Trusted Publishing, and publish the same verified archive without NPM_TOKEN/NODE_AUTH_TOKEN fallback or repacking.
- [x] 2.4 Add existing-version detection and fail-closed registry error handling, postpublication metadata/integrity/provenance verification and recovery diagnostics; never overwrite, auto-unpublish or blindly retry an ambiguous publication.
- [x] 2.5 Add workflow validation tests/checks for trigger restrictions, least privilege, action pinning, same-archive handoff, concurrency, no stored credential fallback and blocked publication after negative validation cases. Recheck current npm OIDC/tarball provenance requirements against the cited primary sources.

## 3. Maintainer and consumer documentation

- [x] 3.1 Document npm namespace ownership, unpublished-package bootstrap via separately authorized interactive maintainer login/2FA if required, exact release.yml trusted-publisher identity and current initial-configuration expiry; do not add real credentials to Git, package contents or Actions secrets.
- [x] 3.2 Document manual version/lockfile updates, stable tag preparation on master, first automated version after bootstrap, tag protection recommendations, duplicate-version behavior, postpublication ambiguity and corrective-version recovery.
- [x] 3.3 Update README with public package-name and version-pinned OpenCode configuration examples, MIT licensing and release documentation links; explain automatic host package download without manual clone/npm install, retain local-development instructions, and avoid claiming an unpublished package or unrun consumption test is available/verified.

## 4. Verification and explicit publication gates

- [x] 4.1 Run npm ci, typecheck, all deterministic/release tests, build and real package installation/import; run the existing target-version host suite and publishing-disabled Actions checks, recording exact versions and unavailable environments instead of substituting dry-run success for live evidence.
- [x] 4.2 Audit every package-release spec scenario against helper tests, workflow checks or explicitly recorded external evidence; inspect the final package and Git diff for forbidden artifacts/credentials and verify no scheduler runtime behavior changed.
- [x] 4.3 Record a human-ready first-release checklist distinguishing completed implementation/dry runs from pending npm account/trusted-publisher preparation and public release. If live publication is not separately authorized, stop here and leave subsequent tasks open.
- [x] 4.4 Only after explicit authorization, complete npm ownership/bootstrap as necessary and trusted-publisher setup, publish a previously unpublished matching stable version through the tag workflow, and record workflow/registry metadata, public access and provenance/integrity. A bootstrap publication must not be reused as a fresh automated version.
- [x] 4.5 After the authorized release, verify package-name/version configuration on a clean isolated supported OpenCode host with no source checkout or npm credentials; check all five timer tools, record results, and report any unavailable live check as unverified rather than marking it passed.
