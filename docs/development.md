# Development and API evidence

## Verified contracts

`test/api-contract.test.ts` compiles the actual published `@opencode/plugin` types for 2.3.2 and an npm alias of 2.4.1. It checks session get/prompt, explicit queued delivery, tool registration/invocation identity, event subscriptions and `event.data.sessionID` / `event.data.inboxID`, and asserts the plugin session domain has no inbox member. Official message IDs come from `SessionMessage.ID.create()` in the explicitly declared `@opencode/schema` dependency, not from a guessed format.

Relevant upstream release sources:

- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/plugin.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/tool.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/adapter.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/client/src/promise/generated/types.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/session-message.ts
- https://github.com/anomalyco/opencode/blob/v2.4.1/packages/plugin/src/promise/plugin.ts

The Promise adapter in 2.3.2 does not forward optional request signals for session methods. Do not depend on aborting `session.wait`, and do not invent `ctx.session.inbox.cancel`. Runtime integration remains a separate release gate; compiling these contracts does not certify a running OpenCode/OpenChamber environment.

## Commands

Run `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, and `npm pack --dry-run` from the repository root. Unit fixtures provide fake clocks, deterministic IDs and deferred host promises. No unit test needs credentials or a running OpenCode service.

The official plugin dependencies currently contain moderate npm audit findings; the test runner was updated to remove the critical findings of its older version. Do not use forced dependency upgrades that break the verified API matrix.
