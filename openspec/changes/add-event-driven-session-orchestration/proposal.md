# Proposal

## Why

The scheduler can currently wake only its owning session at a deadline. Agents need to coordinate independent sessions, transfer review results, and combine time and completion conditions without making users manage session IDs or keep an agent running while it waits.

## What Changes

- Add persistent orchestration jobs with time, session, and explicit signal triggers; bounded ALL/ANY dependencies, recurrence, deadlines, stop conditions, inspection, and cancellation share one evaluation and delivery pipeline.
- Add project-scoped session discovery, bounded message/context access, provenance-bearing messages, and explicitly activating queued prompts through supported OpenCode V2 APIs.
- Add named signals and immutable task results. Publishing an explicit completed result is the authoritative business-completion boundary; idle and successful execution remain separate technical observations.
- Expose agent-oriented tools with schemas and guidance for resolving natural-language session references, clarifying ambiguity, registering waits, publishing findings, and retrieving results.
- Persist new jobs, signals, results, delivery intents, and replay checkpoints in plugin-owned SQLite, with transactional evaluation and stable OpenCode message IDs. Do not promise exactly-once agent side effects.
- Preserve the five existing timer tools, configuration defaults, ownership, ephemeral lifetime, cancellation, spacing, and error semantics. New persistent time jobs are opt-in through the orchestration tools, not an implicit change to legacy timers.
- Require a verified same-server SDK connection for recoverable native execution-history triggers and complete historical-message access; fail unsupported operations explicitly rather than inventing plugin APIs or silently falling back to unreliable observation.
- Bound automatic activation, payloads, retention, recursion, and concurrency; deny cross-project activation by default and treat external-session content as untrusted data.
- Separate mandatory same-server coordination from optional multi-server transport, cross-project grants, and richer workflow/UI features.

## Capabilities

### New Capabilities

- `session-communication`: Scoped session resolution, state inspection, context/history access, provenance, passive messages, and active prompts.
- `orchestration-signals`: Persistent named signals, immutable task results, producer identity, correlation, and authoritative business completion.
- `orchestration-jobs`: Trigger expressions, dependency evaluation, recurrence, timeouts, stop conditions, job/run lifecycle, and nonblocking management tools.
- `orchestration-reliability`: Transactional persistence, replay, idempotent admission, recovery, delivery ordering, error classification, and migrations.
- `orchestration-safety`: Project isolation, ownership, untrusted-content boundaries, activation limits, and bounded resource use.

### Modified Capabilities

- `plugin-lifecycle`: Introduce opt-in durable orchestration and its lifecycle/configuration/documentation alongside the unchanged legacy in-memory timer lifecycle.
- `timer-dispatch`: Share target admission arbitration with new jobs so the extension cannot bypass existing timer serialization and spacing.

## Impact

Likely implementation areas are `src/scheduler.ts`, `src/opencode-adapter.ts`, `src/tools.ts`, new orchestration/domain/storage/transport modules, deterministic tests, `test/real-host.test.ts`, package/runtime compatibility checks, both READMEs, and `docs/`. Existing main specs are not edited by this proposal. No implementation or publication is authorized by these artifacts.

The existing Node >=22 declaration and actual OpenCode plugin runtime must be checked against the selected SQLite binding. Prefer a supported built-in binding and no service or native addon; do not silently raise runtime requirements. A direct, version-aligned `@opencode/client` dependency is needed if the SDK adapter is implemented instead of relying on a transitive package. Backend runtime qualification and local endpoint/authentication integration are explicit pre-implementation gates in the design and tasks.
