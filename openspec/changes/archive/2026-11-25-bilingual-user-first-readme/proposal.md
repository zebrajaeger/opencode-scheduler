# Proposal

## Why

The README currently opens with developer commands and is English-only, making the published plugin harder to adopt for German-speaking users. A bilingual, user-first presentation will make installation and everyday use easier to find without changing the plugin's behavior.

## What Changes

- Provide one README per language as explicitly requested: English in `README.md`, German in `README.de.md`, with mutual relative language links.
- Put installation, configuration, natural-language examples, supported versions and essential safety limitations before developer instructions in both languages.
- Add a compact shared badge row for npm version, master CI status, MIT license and Node engine requirement, using public sources and accessible text/link fallbacks.
- Copy the user-provided PNG banner into `docs/banner.png` and embed it once in the shared README header using that relative project path, never the original Downloads path.
- Preserve technical facts, all five tool names, copyable JSON/commands and existing verification boundaries; translate prose and natural-language examples rather than identifiers.
- Keep local-development/build/release links below user guidance, and link advanced architecture detail to existing documentation if necessary without losing warnings.
- Do not create translated copies of all docs, introduce new runtime features, change compatibility claims, bump versions or publish a release.

## Capabilities

### New Capabilities

None. This is a documentation presentation/translation change.

### Modified Capabilities

None. Existing plugin-lifecycle and package-release documentation obligations are preserved, not changed. `skip_specs: true` explicitly opts out of delta specs for this documentation-only change.

## Impact

The user's follow-up replaces the initial single-file layout. Include README.de.md explicitly in package.json and the exact release archive allowlist, with tests for both files and packaged language links; no runtime dependencies or version changes.

Add `docs/banner.png` to the project. The package includes docs already, but its strict archive validator currently permits only Markdown files there; extend `scripts/release.mjs` narrowly for this specific PNG and add rejection/packaging tests, without broadly accepting arbitrary binary files or changing dependencies.

Implementation primarily changes `README.md`; a focused documentation check may be added under `test/` to verify language anchors, section ordering, required facts and badge targets. Package contents already include README, so no metadata/dependency change is required. Badge images depend on public npm/GitHub/Shields endpoints; documentation remains readable when images are unavailable. Existing English `docs/` files remain linked and are labelled as English from the German section.
