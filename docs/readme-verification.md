# Bilingual README verification

Verified on 2026-11-25; documentation-only change `bilingual-user-first-readme`.
Archived plan: `openspec/changes/archive/2026-11-25-bilingual-user-first-readme/`.

## Updated layout: separate files

Following the user's correction, English is in README.md and German in
README.de.md. Each contains its own banner/badges, self-contained user-first
content and relative language links to the other file. The German file is
explicitly included in package.json and the narrow release archive allowlist.
Tests check local anchors independently, both badge sets and identical JSON/
commands. Earlier rendered-preview measurements below refer to the initial
single-file version, not a hosted preview of the separated files.

## Parity and ordering review

Both German and English user sections preserve the former README's public
configuration paths, automatic npm retrieval/version pinning, duplicate-identity
and precedence warnings, options, all five tools and timing fields, default
creation-based one-hour lifetime, session-wide 30-second spacing, interval update
expiry semantics, session/project/location ownership, JSON results/diagnostics,
verified host/UI versions and Windows-only support boundary.

Both also retain queued original-session dispatch, active foreground deferral,
real background monitoring, admission versus completion, independent sessions,
coalesced recurrence, cooldown, disabled/error recovery and conservative ambiguous
admission barriers, failed event-stream behavior, in-memory restart loss and
cleanup, interruption versus chat navigation, hidden sessions, deletion/movement/
fork handling, required approvals, irretractable accepted input and separate-
server coordination limits. These remain above developer content in each
language. Implementation architecture, local package-directory installation,
build commands and advanced release/API/audit links remain available below.

German advanced-doc links are labelled English. Tests verify unique explicit
anchors, language navigation, section ordering, valid and identical JSON
configurations, matching developer commands, tool/fact inventory and existing
local links. No source/runtime, package version or support claim was changed.

## Banner and badges

`docs/banner.png` is a byte-for-byte copy of the supplied PNG: 2172 × 724 pixels,
1,728,617 bytes, SHA-256
`5ce7b9d459c165a3b67b61c9273f41995a0ec196e135601f51e44b13bd57efae`.
README embeds only the relative project path, once. Source remains unchanged.
The archive validator allows exactly this named PNG with signature/IHDR checks;
tests still reject unrelated binary assets, private files and invalid PNG data.

Final local checks: 75 tests passed (one opt-in real-host test skipped), typecheck
and release:check passed. The inspected tarball has 19 files, approximately
1.57 MB compressed / 1.83 MB unpacked. Its banner and README bytes exactly match
the project files; install/import of the archive succeeded with scripts disabled.

All four public badge endpoints returned HTTP 200 and SVGs with these values:
npm v0.1.1, master CI passing, MIT, declared Node >=22. Targets and alt text are
checked independently of network responses in deterministic tests. Badge state
is dynamic, not a guarantee of future availability or additional compatibility.

## Rendered preview

The actual GitHub Markdown API rendered the README as GFM successfully. A private
loopback preview displayed that HTML at desktop 1280px and mobile 360px widths.
Banner and badges loaded; the banner preserved its 3:1 aspect ratio, measured
980px desktop and about 313px mobile. The mobile document width was 345px (no
page overflow). The package title was shortened to `opencode-scheduler` to avoid
scoped-name clipping; exact scoped identity remains in the public npm link and
installation examples.

GitHub's sanitizer prefixes explicit IDs with `user-content-`; the preview's
fragment handling mirrors GitHub's original-name resolution. Clicking English
reached the correct target. This local helper is not README code. Text links and
installation/safety content remained available with the banner hidden.

The repository was not pushed and no new package was published, so the hosted
GitHub README and npm's live page have not been updated/previewed as this version.
No claim is made that npm's renderer preserves explicit anchors exactly as this
GFM preview; the readable headings, normal Markdown and archive-relative image
are present. Existing npm versions retain their README until a new separately
authorized release. Private preview screenshots/output are not package content.

The separate-file follow-up passes 76 tests, typecheck and release:check. The
actual 20-file archive is 1,570,220 bytes compressed and includes README.md,
README.de.md and docs/banner.png byte-for-byte; mutual language links resolve
inside the package. An existing Git ancestry fixture exceeded its five-second
timeout once; an unchanged full rerun passed. No timeout setting was relaxed.
