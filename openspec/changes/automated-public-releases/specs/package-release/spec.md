# Spec Delta

## Purpose

Distribute verified scheduler plugin versions through public npm releases so users can configure the package directly and maintainers can release safely from explicit version tags.

## ADDED Requirements

### Requirement: Public configuration-based consumption
Released versions SHALL be publicly available as `@zebrajaeger/opencode-scheduler` on npm. A user SHALL be able to configure that package in a supported OpenCode host without cloning this repository or manually installing its dependencies. Documentation SHALL distinguish automatic package retrieval from an installation-free runtime.

#### Scenario: Consume a published version
- **WHEN** a clean supported OpenCode instance is configured with a published package version
- **THEN** the host retrieves the package and exposes the five timer tools without a local source checkout
- **AND** no npm credentials are required to consume the public package

### Requirement: Deliberate stable release selection
Automated publishing SHALL require an explicit stable `vX.Y.Z` tag whose version matches package metadata and the lockfile root version. The selected commit SHALL be reachable from the repository's `master` branch. Ordinary branch pushes, pull requests, malformed tags and prerelease tags SHALL NOT publish.

#### Scenario: Valid stable tag
- **WHEN** a matching stable version tag identifies a commit reachable from master
- **THEN** the release is eligible for validation before publishing

#### Scenario: Invalid release identity
- **WHEN** the tag version mismatches metadata, is not stable, or points to a commit not reachable from master
- **THEN** no npm publication occurs and the release run reports why it was rejected

#### Scenario: Non-release event
- **WHEN** a pull request or ordinary branch push runs checks
- **THEN** it has no npm publication path or publishing identity

### Requirement: Verified publishable artifact
Publishing SHALL require a clean lockfile installation, successful type checking, deterministic tests, build and validation of the actual npm archive. That archive SHALL include compiled ESM entry points, declarations, README and MIT license, install its runtime dependencies and import successfully. Private configurations, credentials and development-only directories SHALL NOT be packaged.

#### Scenario: Valid archive
- **WHEN** all required checks succeed and the archive has valid metadata, contents and import behavior
- **THEN** that same verified archive is eligible for public publication

#### Scenario: Verification failure
- **WHEN** any required check fails or the archive contains a forbidden artifact
- **THEN** publication is blocked with a diagnostic and no npm version is created by that run

### Requirement: Short-lived publishing identity
Recurring automated npm releases SHALL authenticate with npm Trusted Publishing through GitHub OIDC on supported hosted runners. No long-lived npm publishing token or reused model credential SHALL be committed, packaged or required by the normal release workflow. Missing trusted-publisher prerequisites SHALL fail closed without falling back to a stored token.

#### Scenario: Trusted publisher configured
- **WHEN** an eligible release runs with the correctly configured publishing identity
- **THEN** it obtains short-lived authentication and publishes with public access
- **AND** provenance is available for the public package built from the public repository

#### Scenario: Publishing identity unavailable
- **WHEN** npm ownership or trusted-publisher configuration is missing or does not match the workflow
- **THEN** publishing fails without exposing secrets or attempting a long-lived-token fallback

### Requirement: Immutable version handling
A published version SHALL never be overwritten or silently reused as a successful release. Release execution SHALL serialize competing attempts for the same tag. If publication succeeded but a subsequent check failed, maintainers SHALL be able to verify the existing version and recover without deleting, replacing or blindly republishing it.

#### Scenario: Duplicate release attempt
- **WHEN** an automated release targets a version already present on npm
- **THEN** it reports that the version exists and does not attempt to overwrite it or claim a fresh publication

#### Scenario: Post-publication failure
- **WHEN** publication succeeds but registry verification fails afterward
- **THEN** documentation explains how to inspect the registry state and choose a new corrective version if needed

### Requirement: Explicit human preparation and release evidence
Release documentation SHALL cover npm ownership, first-publication bootstrap, trusted-publisher setup, version/tag preparation, MIT licensing, consumption examples and failure recovery. External setup and publication SHALL be performed only with explicit authorization. Unperformed live registry or supported-host checks SHALL be recorded as unverified, not represented as successful by local dry runs.

#### Scenario: First publication prerequisites
- **WHEN** maintainers prepare a package that does not yet have usable npm ownership and trusted publishing
- **THEN** the required one-time account/setup steps are identified without committing credentials or starting an unauthorized publication

#### Scenario: Verify a release
- **WHEN** an authorized public release finishes
- **THEN** its version, workflow result, registry metadata, archive integrity and clean supported-host consumption outcome are recorded
- **AND** any unavailable live check is explicitly marked unverified
