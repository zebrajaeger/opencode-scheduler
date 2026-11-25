# Proposal

## Why

OpenCode agents need to revisit work later without blocking a tool call, losing the original conversation, or relying on an external scheduler. A small server plugin can provide bounded, session-local prompt scheduling through natural-language requests and discoverable agent tools.

## What Changes

- Introduce the TypeScript npm package `@zebrajaeger/opencode-scheduler`, maintained in `git@github.com:zebrajaeger/opencode-scheduler.git`.
- Provide `timer_start`, `timer_stop`, `timer_list`, `timer_update`, and `timer_stop_all` with self-contained descriptions and structured input/output.
- Support one-shot and recurring prompts, multiple uniquely identified timers per session, and automatic session/project/location ownership.
- Keep all timer definitions and scheduling state in memory. No persistence, restart recovery, separate UI, MCP server, LLM connection, or external infrastructure.
- Defer due work while the agent is busy; serialize scheduler work per session, coalesce missed ticks, enforce execution spacing, and allow monitoring while real background processes continue.
- Default maximum timer lifetime to one hour, allow explicit lifetime changes through tools, and stop session timers on interruption, deletion, or incompatible location changes.
- Implement bounded error handling and plugin cleanup without interrupting unrelated agent activity or weakening OpenCode permissions.
- Document global/project installation, configuration, supported OpenCode versions, development, limitations, and manual OpenCode/OpenChamber smoke checks.
- Add deterministic unit tests and OpenCode integration coverage for lifecycle, concurrency, failures, and races.

## Capabilities

### New Capabilities

- `timer-management`: Agent-facing timer tools, identity, ownership, validation, updates, expiry, and cancellation.
- `timer-dispatch`: Non-interrupting session delivery, busy deferral, spacing, coalescing, concurrency, and error handling.
- `plugin-lifecycle`: Official V2 plugin integration, installation, in-memory lifetime, session lifecycle handling, compatibility, and cleanup.

### Modified Capabilities

None. This repository has no existing capability specifications.

## Impact

- New package/build/test/documentation files will be introduced during implementation; this change currently adds planning artifacts only.
- Integrates with the verified OpenCode V2 `@opencode/plugin` Promise API, targeting OpenCode 2.3.2 and 2.4.1 pending runtime verification.
- Does not change OpenCode or OpenChamber. Existing sessions retain their history, agent, model, permissions, and working context.
- Uses server-owned timers and existing session APIs; no native automation dependency and no invented plugin inbox API.
- The unscoped npm name is already occupied; publication uses the specified `@zebrajaeger` scope. Publishing and configuring remotes are outside this change's execution authority.
