# Tasks

## 1. Bilingual user-first documentation

- [ ] 1.1 Restructure README into a shared title/header, German-first and English language sections with unique explicit language/section anchors and local navigation; add focused checks that every internal anchor resolves and user topics precede developer content within each language.
- [ ] 1.2 Write equivalent German and English user guidance for public/global/project installation, version pinning, options, ordinary-language examples and all five tools; verify identical JSON identifiers/values and tool argument names, valid JSON fences, and a per-topic translation parity checklist against the current README.
- [ ] 1.3 Preserve compatibility boundaries and all behavior-oriented timing/lifecycle/permission/cancellation warnings in both user sections, moving build/local package-path/release instructions and architecture internals below them; verify one-hour creation-based lifetime, minimum session-wide spacing, busy/background handling, updates, ownership, restart/interrupt distinctions and accepted-input limits remain covered.
- [ ] 1.4 Keep links to existing English advanced docs from both languages, labelling them as English in German; verify local file links exist and developer commands still match package scripts, without altering runtime, metadata or publishing workflows.

## 2. Conventional status badges

- [ ] 2.0 Copy `C:\Users\Lars.Brandt\Downloads\57ac8eac-7651-489e-982e-616ac5dd404f.png` byte-for-byte into `docs/banner.png`, leave the original unchanged, and embed it once in the shared README header with descriptive alt text and only a relative project path; verify PNG signature/dimensions, byte equality and responsive rendering, and narrowly permit this PNG in the release archive validator with tests rejecting other binary/private files.

- [ ] 2.1 Add a compact linked badge row for public npm version, master ci.yml status, MIT license and declared Node engine range with meaningful alt text; verify encoded scoped package URLs and targets against package.json, LICENSE and the actual CI workflow, and add URL/label checks without using network responses as deterministic test expectations.
- [ ] 2.2 Check badge endpoints and npm/GitHub rendering externally where available; verify a narrow-screen/readable Markdown preview, working language navigation and useful text/link fallbacks when images fail, recording any unavailable renderer or badge endpoint rather than claiming it passed.

## 3. Integration and documentation review

- [ ] 3.1 Run documentation checks and the existing test/typecheck suite; compare the old README topic inventory with both translated versions and record parity/link/order review evidence, ensuring no runtime or supported-version changes slipped into this documentation-only diff.
- [ ] 3.2 Run npm pack --dry-run or release:check without publishing and inspect that the bilingual README and original docs/banner.png bytes are included, local links/image target remain available, and the strict archive checks still reject unrelated private assets; record package size and that existing npm versions retain their old README until a separately authorized future release.

## Workflow follow-up

- Review the documentation changes before committing, pushing or archiving when separately requested.
- Updating the public npm README requires a new authorized package version; do not publish or create a release tag as part of this change.
