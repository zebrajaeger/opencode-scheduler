# Design

## Context

See `proposal.md` for motivation and `specs/package-release/spec.md` for acceptance criteria. The package is currently version 0.1.0, ESM, Node >=22, with a lockfile and `publishConfig.access: public`. Its allowlist is `dist`, README and docs; `prepack` builds declarations and JavaScript. There is no LICENSE, license metadata or GitHub workflow. Existing unit tests are deterministic; `test/real-host.test.ts` is explicitly opt-in and uses isolated OpenCode processes and a loopback model, not real credentials. Published plugin API contracts cover 2.3.2/2.4.1. Existing specs already define project/global plugin configuration and remain untouched.

## Goals / Non-Goals

**Goals:** Separate release eligibility, artifact verification and privileged publication; publish a tested immutable artifact; make human account preparation explicit; preserve existing runtime dependencies and compatibility boundaries.

**Non-Goals:** No runtime changes, Changesets/release bots, version bump automation, prerelease channels, automatic GitHub Releases, publishing from every push, or assumption that an npm package needs no download. No publication or account modification in this planning phase.

## Decisions

### 1. Stable tags identify releases

The user chose `vX.Y.Z` tags and MIT. Implement `.github/workflows/ci.yml` for nonpublishing checks and `.github/workflows/release.yml` for `push.tags: v*`. A narrow validation script must reject anything other than canonical stable SemVer, compare package.json and package-lock.json (top-level and packages[""]) versions and verify package name/public access. Fetch master explicitly and resolve the tagged commit, including annotated tags; require ancestry from master. Shell interpolation of tag names is forbidden: pass ref values as quoted environment/data inputs. Invalid runs fail before authentication. Use concurrency keyed to the tag, with no cancellation of an in-progress publish. Version increments remain a maintainer action. A GitHub Release trigger and automatic bumps were considered but add lifecycle/versioning behavior the user did not select.

### 2. Build and inspect once, publish the archive

Use a pinned supported Node 24 toolchain and npm >=11.5.1; upstream npm documentation currently requires Node >=22.14.0 for OIDC. Run `npm ci`, typecheck, deterministic tests, build and `npm pack --json`. Validate the archive's name/version/public metadata, expected dist entry/declarations, README and MIT LICENSE; reject `.npmrc`, `.env`, private configs, source/test/node_modules directories, workflow files and secret-pattern findings. Install the tarball into a fresh temporary fixture with scripts disabled and import the package's default export. Record its SHA-512 integrity; hand only that archive and nonsecret validation metadata to the publish job. Do not repack different bytes at publication time. Disable dependency caches for release builds. Pin third-party action revisions to verified full commit SHAs during implementation, keeping readable version comments. No new runtime dependency is needed; release helpers can use Node built-ins.

### 3. Least-privilege OIDC publication

Validation runs need contents:read only. The publish job uses a GitHub-hosted Linux runner, contents:read and id-token:write, the public npm registry and a workflow identity exactly matching the npm trusted publisher for `zebrajaeger/opencode-scheduler`, workflow filename `release.yml`. No NPM_TOKEN/NODE_AUTH_TOKEN fallback. OIDC provenance should be generated automatically for a public repository/public package; verify that the tarball publication path retains provenance rather than assuming it. Publication must use the verified archive with public access, then inspect registry metadata/integrity. Failure to authenticate remains a failure, not a reason to introduce credentials into the workflow. Job isolation keeps installation/test code away from the publishing identity as far as practical.

### 4. First-publication bootstrap is a separate human gate

Current npm docs configure trusted publishing through an existing package's settings; an unpublished name may need a one-time authorized interactive publication to establish ownership. Document checking actual namespace/package ownership and available npm bootstrap flow before publishing. If bootstrap is necessary, it must use the same validated artifact and an interactive maintainer login/2FA outside GitHub Actions, never a repository token. That first publication consumes its version: the first automated release must use a new version, not republish 0.1.0. Configure the exact workflow identity only when ready for its first automated run; current npm docs say an unvalidated new trusted publisher expires after two days. No live package ownership or bootstrap success is assumed in these artifacts.

### 5. Verification distinguishes automation from external evidence

Add release-helper tests for accepted/rejected versions, mismatched lockfile metadata, unauthorized ancestry, forbidden package contents and existing registry versions. Test workflow structure for event restrictions, least privilege, action pinning, no long-lived credentials and same-archive handoff. Preserve the existing deterministic suite; a publishing-disabled CI job should run the isolated real-host harness for both claimed OpenCode versions on Windows using explicitly installed CLIs, with bounded timeouts and no model secrets. If supported CI cannot run that matrix, report the limitation instead of silently passing it. Public consumption is a separate authorized post-release smoke on a clean supported host configured by package name/version, not merely an npm install fixture. Record registry provenance/integrity and all external outcomes.

## Risks / Trade-offs

- First package ownership may require human bootstrap → document it as a precondition and consume a separate version; no token fallback.
- npm/Actions requirements change → check the cited primary docs at implementation time and pin verified supported versions; keep minimum versions explicit.
- Publishing a tarball may affect provenance generation → verify before claiming it; reject a release path that loses required provenance rather than silently repacking.
- Tag-controlled workflows can be modified by maintainers → require master ancestry, restrict tag creation with recommended repository rules, and keep privileges in the publishing job only.
- Pack allowlists do not prove secret absence → inspect extracted files and patterns, never read local user credentials in CI, and use explicit artifact exclusions.
- Network failure after publication is ambiguous → query exact version and compare integrity; never auto-unpublish or retry by overwriting an immutable version.
- Linux CI success does not prove new runtime compatibility → retain Windows-only verified support until additional evidence exists.

## Migration Plan

1. Implement license/metadata, release checks, CI/release workflows and documentation without publishing.
2. Run local negative tests and a publishing-disabled Actions run; verify actual package contents/import and existing host contracts.
3. With separate user authorization, establish npm package ownership/bootstrap if necessary and configure Trusted Publishing for release.yml. Do not store credentials in Git or Actions secrets.
4. Prepare a previously unpublished matching version on master, then create/push its stable tag with explicit publication authorization.
5. Verify registry access, integrity/provenance and clean OpenCode package-name consumption; record outcomes. On defects disable future publishing and release a new corrected version; do not overwrite existing versions.

## Primary references

Retrieved 2026-11-25:
- https://docs.npmjs.com/trusted-publishers/ — OIDC prerequisites, hosted runners, workflow identity, automatic provenance, two-day initial configuration expiry.
- https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages — Node package release workflow context.

Package ownership and live publication remain external prerequisites, not unresolved architecture choices or authorization implied by this proposal.
