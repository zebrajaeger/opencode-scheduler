# Tasks

## 1. Bilingual user-first documentation

- [x] 1.1 Provide English README.md and German README.de.md with matching banner/badge headers, mutual relative language links and unique local section anchors; verify each file contains one language and user topics precede developer content.
- [x] 1.2 Write equivalent German and English user guidance for public/global/project installation, version pinning, options, ordinary-language examples and all five tools; verify identical JSON identifiers/values and tool argument names, valid JSON fences, and a per-topic translation parity checklist against the current README.
- [x] 1.3 Preserve compatibility boundaries and all behavior-oriented timing/lifecycle/permission/cancellation warnings in both user sections, moving build/local package-path/release instructions and architecture internals below them; verify one-hour creation-based lifetime, minimum session-wide spacing, busy/background handling, updates, ownership, restart/interrupt distinctions and accepted-input limits remain covered.
- [x] 1.4 Keep links to existing English advanced docs from both languages, labelling them as English in German; verify local file links exist and developer commands still match package scripts, without altering runtime, metadata or publishing workflows.

## 2. Conventional status badges

- [x] 2.0 Copy `C:\Users\Lars.Brandt\Downloads\57ac8eac-7651-489e-982e-616ac5dd404f.png` byte-for-byte into `docs/banner.png`, leave the original unchanged, and embed it once in the shared README header with descriptive alt text and only a relative project path; verify PNG signature/dimensions, byte equality and responsive rendering, and narrowly permit this PNG in the release archive validator with tests rejecting other binary/private files.

- [x] 2.1 Add a compact linked badge row for public npm version, master ci.yml status, MIT license and declared Node engine range with meaningful alt text; verify encoded scoped package URLs and targets against package.json, LICENSE and the actual CI workflow, and add URL/label checks without using network responses as deterministic test expectations.
- [x] 2.2 Check badge endpoints and npm/GitHub rendering externally where available; verify a narrow-screen/readable Markdown preview, working language navigation and useful text/link fallbacks when images fail, recording any unavailable renderer or badge endpoint rather than claiming it passed.

## 3. Integration and documentation review

- [x] 3.1 Run documentation checks and the existing test/typecheck suite; compare the old README topic inventory with both translated versions and record parity/link/order review evidence, ensuring no runtime or supported-version changes slipped into this documentation-only diff.
- [x] 3.2 Include README.de.md explicitly in package metadata and the narrow archive allowlist; run release:check without publishing and verify both README files, mutual language links and original banner bytes in the archive, while unrelated private files stay forbidden; record size and unchanged published versions.

## Workflow follow-up

- Review the documentation changes before committing, pushing or archiving when separately requested.
- Updating the public npm README requires a new authorized package version; do not publish or create a release tag as part of this change.
