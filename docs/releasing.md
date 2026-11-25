# Public npm releases

The release automation is implemented and its nonpublishing GitHub Actions checks
have passed. Version 0.1.0 was published manually as the authorized bootstrap;
an automated OIDC release has not yet been performed. Validation does not establish npm ownership,
trusted publishing, provenance or public OpenCode consumption. See
[release verification](release-verification.md) for current evidence.

## Consumer setup

In a supported OpenCode configuration, use the package name:

```json
{
  "plugins": ["@zebrajaeger/opencode-scheduler"]
}
```

To select a particular published version:

```json
{
  "plugins": ["@zebrajaeger/opencode-scheduler@0.1.0"]
}
```

Version 0.1.0 is publicly published on npm.
OpenCode downloads/installs the public npm package internally. You do not need a
source checkout, a manual npm install, or npm credentials to consume it. Network
access to the registry and runtime dependencies is still necessary. Normal
project-config trust/permissions apply. Keep the existing supported-version
boundaries and never restart important shared work just to test installation.

## One-time human preparation

These steps require separate authorization; implementing the workflow does not
authorize account setup, package publication or pushing release tags.

1. Confirm control of the npm `zebrajaeger` namespace and the package name.
   Use your own npm account with 2FA. Do not paste credentials into the chat,
   repository, package files, CI logs or GitHub Actions secrets.
2. Check the current npm bootstrap options. Trusted Publishing is configured
   through an existing package's Settings page. If the unpublished name cannot
   yet be configured, perform one authorized interactive first publication with
   maintainer login/2FA, outside Actions, using the locally verified archive.
   Use `npm run release:check` first; the archive is
   `.release-artifacts/package.tgz`. Interactive login is a human action, not an
   unattended command for an agent. This consumes that package version.
3. Under the package's npm Settings → Trusted publishing, add GitHub Actions:
   - GitHub owner: `zebrajaeger`
   - Repository: `opencode-scheduler`
   - Workflow filename: `release.yml` (no directory prefix)
   - Environment: leave empty; this workflow does not select an environment
   - Allow direct publishing with `npm publish`
4. Ensure the repository is public and Actions uses GitHub-hosted runners.
   Node 24.20.0 includes npm 11.19.0; npm OIDC requires npm >=11.5.1 and
   Node >=22.14.0. Self-hosted runners are not supported by this release design.
5. Current npm guidance requires the first successful trusted-publisher publish
   within two days of configuration. If it expires, delete/recreate the
   configuration when ready. A workflow filename/owner mismatch fails closed;
   never "fix" it by adding NPM_TOKEN or NODE_AUTH_TOKEN.
6. Restrict release tag creation through repository rules and protect master.
   OIDC is not a replacement for controlling who can modify tagged workflows.

The first automated version must be new: if bootstrap published 0.1.0, use a
later version such as 0.1.1 for its first Actions release. No version bump or
tagging is performed automatically.

## Prepare a release

1. Change the version in `package.json` and the lockfile together, for example
   through `npm version patch --no-git-tag-version`, and review the resulting
   diff. This command changes files only; choose the intended version deliberately.
2. Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` and
   `npm run release:check`. The last command inspects the actual npm tarball,
   installs it with scripts disabled in an isolated fixture, checks its ESM
   import and records SHA-512 integrity in `.release-artifacts/metadata.json`.
   This directory is ignored and is not a publishing credential store.
3. Commit the intended changes to master and obtain a successful nonpublishing
   CI run, including the two Windows host targets, before releasing.
4. With explicit publication approval, create and push a canonical stable tag
   `vX.Y.Z` matching all package/lockfile versions at the selected master commit.
   Both lightweight and annotated tags are supported. Do not retarget release
   tags. Tag pushes start public publication; ordinary branch pushes/PRs do not.

## Workflow boundaries

`ci.yml` validates pull requests and master changes without publishing identity.
Its Windows matrix explicitly installs OpenCode 2.3.2/2.4.1 into RUNNER_TEMP and
runs the existing loopback-model isolated host suite. No actual model credential
is used. Its Linux package check is a build/import check, not an additional
operating-system support claim.

`release.yml` validates the stable tag, metadata and ancestry from fetched master
before installing dependencies. The validation job runs local gates and creates
the archive. Only the archive and nonsecret metadata cross the artifact handoff.
The publishing job installs no project dependencies and runs no package scripts;
it verifies the received bytes, rejects existing npm versions, and publishes the
same archive with OIDC, public access and provenance. It then fetches registry
metadata and the public tarball and checks identity, integrity and provenance.
Release executions for the same tag are serialized and not cancelled midway.

All actions are pinned to full verified upstream commit SHAs. Release builds do
not use dependency caches. A dry run cannot prove OIDC/provenance; those remain
unverified until an authorized live run succeeds.

## Failure and recovery

- Invalid/prerelease/mismatched tag or unmerged commit: validation fails before
  authentication. Fix metadata/commit selection and create a suitable new tag.
- Checks or archive inspection fail: no publication; fix and repeat local checks.
- Existing npm version: preflight reports it and never republishes/overwrites it.
- Authentication error: verify npm ownership and the exact trusted-publisher
  workflow identity/expiry. No long-lived-token fallback exists.
- Network/preflight errors other than exact HTTP 404: publication is blocked.
- Publication succeeds but later registry checks fail: inspect the exact npm
  version and compare its dist.integrity to the workflow metadata. The version
  may already be public. Do not blindly rerun publication, auto-unpublish or
  overwrite; recover by recording existing state, or release a new corrective
  version if the package itself is defective.
- To stop future releases, disable the release workflow or revoke its trusted
  publisher. This does not remove already published immutable versions.

## Final human-ready checklist

- [x] Implementation committed/pushed with successful nonpublishing Actions run.
- [ ] npm ownership/bootstrap complete with explicit approval.
- [ ] Correct trusted publisher configured and still valid.
- [ ] Intended previously unpublished version and matching master tag approved.
- [ ] Actions publication, registry metadata/public access and provenance verified.
- [ ] A clean isolated supported OpenCode host configured by package name/version
      exposes all five timer tools without source checkout or npm credentials.

These are external release gates, not claims of completed local tests. Never
mark them done because `npm pack` or an installation fixture succeeded.

References checked 2026-11-25:
- https://docs.npmjs.com/trusted-publishers/
- https://docs.github.com/en/actions/tutorials/publish-packages/publish-nodejs-packages
