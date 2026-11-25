# Proposal

## Why

Users currently need a local checkout because the plugin has not been published. Public npm releases will let OpenCode obtain `@zebrajaeger/opencode-scheduler` directly from its normal plugin configuration, while a tag-triggered GitHub Actions pipeline makes subsequent releases repeatable and credential-safe.

## What Changes

- Publish the scoped package publicly on npm under the existing name, with compiled ESM files, declarations, documentation and the user-selected MIT license.
- Introduce GitHub Actions validation and a release workflow triggered by stable `vX.Y.Z` tags matching package and lockfile versions, restricted to commits reachable from `master`.
- Authenticate recurring releases through npm Trusted Publishing/GitHub OIDC rather than a stored npm token; document any first-publication/account setup that requires a human.
- Gate publishing on clean installation, type checking, tests, build and inspection/import of the actual packed artifact. Never publish from a pull request or ordinary branch push.
- Document release preparation, immutable-version recovery, npm setup, provenance and package-name configuration without manual installation.
- Keep runtime behavior and existing compatibility claims unchanged. No automatic version bumps, prereleases, GitHub Release creation or scheduler feature changes are included.

## Capabilities

### New Capabilities

- `package-release`: Public package availability, safe tag-triggered publishing, validated release artifacts, credential isolation and release/operator documentation.

### Modified Capabilities

None. Existing `plugin-lifecycle` installation requirements remain unchanged; this change provides the distribution channel they already describe.

## Impact

Implementation will affect `.github/workflows/`, release validation scripts/tests, `package.json`, package metadata/contents, a new MIT `LICENSE`, README and release documentation. GitHub Actions and npm are development/distribution infrastructure only, not runtime dependencies. Initial npm ownership/trusted-publisher configuration is an external prerequisite; the planning workflow neither configures accounts nor publishes packages.
