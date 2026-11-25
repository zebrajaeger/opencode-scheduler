# Design

## Context

See proposal.md for motivation. README currently starts with Development before installation and contains English-only descriptions, tool reference, timing/permission warnings and architectural detail. package.json declares MIT, Node >=22 and version 0.1.1. The public package is `@zebrajaeger/opencode-scheduler`; `.github/workflows/ci.yml` is the nonpublishing master validation workflow and `release.yml` publishes tags. Existing docs are English and already hold advanced verification/release evidence. README is automatically included by npm packaging; new translation files would require additional packaging checks.

This change deliberately has no delta specs. It preserves the existing documentation obligations in plugin-lifecycle/package-release and uses a review checklist and focused documentation tests for presentation acceptance.

## Goals / Non-Goals

**Goals:** Make both languages self-contained for users, keep critical safety facts equally visible, provide stable language/section anchors and truthful lightweight badges, and keep implementation detail below normal usage.

**Non-Goals:** No full docs translation, custom logo/image generation, multilingual website, runtime/localization changes, altered support claims, additional dependency, version bump, commit/push or release implied by planning.

## Decisions

### Single README with explicit language navigation

Use one package title, one shared badge row, and `Deutsch | English` links to explicit `deutsch` and `english` anchors. German comes first as a reversible presentation assumption based on the user's request. Each language has its own short overview and local section links with distinct IDs (for example `de-installation` / `en-installation`) to avoid duplicate-heading anchor collisions. Prefer small explicit anchors and normal Markdown; no tables for full prose, collapsible whole translations, scripts or multi-column layout. This works on GitHub/npm and narrow screens. Separate README.de.md was considered but would make npm language access depend on an extra packaged file and is unnecessary for two languages.

### Users before developers in both languages

Each language follows: overview → installation/quick start → configuration → natural-language examples and five-tool reference → compatibility → timing/lifecycle/permissions/cancellation limitations → developer documentation. Local clone/build/package-path instructions, architecture internals and maintainer release links belong in the developer section, not the public npm installation path. Keep concise behavior-oriented timing explanations above that boundary even when implementation internals move down. English developer content at the end of its section does not change the same user-first ordering inside the German section.

### Preserve behavior and factual parity

Both versions cover the same facts: normal global/project npm configuration, optional version pinning, automatic host download rather than manual installation, duplicate activation/configuration precedence, original creation-based default one-hour lifetime, minimum 30-second session-wide spacing, queued busy deferral, background monitoring, coalesced ticks, session ownership, all five tool identifiers and timing fields, interval updates not extending expiry, in-memory restart loss, UI navigation versus interruption, deletion/movement/fork behavior, approval requirements, and irretractable accepted input. Preserve verified versions/platforms without extrapolation. Translate prose/examples idiomatically, never JSON keys, package names, API/tool IDs or executable commands. Existing English evidence links are labelled `(Englisch)` in German. A per-topic parity checklist is stronger than matching exact translated sentences.

### Supplied project-local banner

The user supplied `C:\Users\Lars.Brandt\Downloads\57ac8eac-7651-489e-982e-616ac5dd404f.png`. Read-only inspection confirmed a PNG, 2172 × 724 pixels, 1,728,617 bytes. During implementation copy it byte-for-byte into `docs/banner.png`, leaving the source unchanged. Embed it once below the shared title and above badges/language links, with descriptive alt text and responsive Markdown rendering. README must use only the relative project path: no absolute Windows path, file URL, symlink, base64 embed or external hosting.

The package already includes docs, but its strict release validator currently accepts only `docs/*.md`. Add an exact `docs/banner.png` exception with PNG-signature checks and rejection tests for other binary/private files; verify the actual tarball contains the original banner bytes and the README's relative image target. Preserve content and aspect ratio; do not generate or edit the supplied image. If the source is unavailable at implementation time, report the prerequisite rather than inventing a substitute.

### Conventional public badges alongside the supplied banner

Plan four linked badges under the title:
- npm: `https://img.shields.io/npm/v/%40zebrajaeger%2Fopencode-scheduler`, linked to the npm package.
- CI: `https://github.com/zebrajaeger/opencode-scheduler/actions/workflows/ci.yml/badge.svg?branch=master`, linked to that workflow (not the historically failed first release run).
- License: `https://img.shields.io/npm/l/%40zebrajaeger%2Fopencode-scheduler`, linked to LICENSE.
- Node: `https://img.shields.io/node/v/%40zebrajaeger%2Fopencode-scheduler`, linked to package.json engines; describe this as the declared engine range, not tested support on every Node release.

Use readable alt labels and accompanying language prose/links so failed remote images do not hide installation, license or compatibility facts. Verify endpoints/targets during implementation, using URL encoding for the scoped name. No coverage/download-count/security/performance badges without a maintained source. If an endpoint fails, report it and retain the useful text link rather than showing a misleading badge. No generated image is needed.

## Risks / Trade-offs

- README roughly doubles in length → concise language-specific tables of contents and advanced-doc links; avoid duplicating historical test transcripts.
- Translations drift → review matching topic inventories and identical code snippets; add targeted anchor/order/identifier checks, not brittle full-text snapshots.
- German rendered anchors differ between clients → explicit unique anchors, checked local links, and actual GitHub/npm-compatible Markdown preview.
- Remote badge service fails or changes → meaningful alt text, verified links and no reliance on badges as sole evidence.
- Moving limitations into developer-only sections hides user risks → explicitly review that in-memory loss, approvals and accepted-input cancellation limits remain in both user sections.
- npm page remains on previously published README → document that repository changes do not update an existing immutable npm version; no release is part of this change.

## Migration Plan

Copy the supplied banner into docs/banner.png during implementation and verify the narrow archive-validator exception before the existing documentation/packaging checks. The banner adds approximately 1.73 MB to the package; record package size and preserve its bytes rather than silently modifying the image.

Reorganize/translate README, add badges and focused documentation tests, then verify Markdown anchors, links, code snippets and package inclusion locally. Compare the complete old README against the parity checklist before approval. No service restart or credentials are needed. Reverting the documentation-only change restores the earlier presentation. Publishing a new package README requires a separately authorized versioned release.
