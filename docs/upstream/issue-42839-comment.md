Reproduced on v2.4.2 (`fc31a485317970bcf6be7b431a9830aaef875731`), Windows x64, Bun 1.4.4. A stock CLI session log reaches `log.synced` without retained execution payloads.

In an isolated source checkout I passed the existing `events.persist` option through an explicit opt-in serve flag. With a deterministic loopback model:

- Start/success events were retained and replayed with identical IDs/sequences after a full server restart.
- Without the flag, payloads were not retained. Enabling it later did not recover that session's earlier events.
- Five CLI parsing/help tests, five existing session-log tests and the CLI typecheck passed. Root `bun run check` stopped at unchanged website colour lint, so I am not claiming a full workspace pass.

I found #61831 covers reporting the current persistence setting, with managed-server configuration and history-gap reporting listed as follow-ups. For durable orchestration, `persist: true` alone cannot establish that an existing session's requested range is complete.

Is #61831's follow-up the preferred place to coordinate the CLI setting and per-session/range coverage (including discarded intervals), rather than opening another implementation PR? Until that contract exists, our client rejects native durable triggers instead of treating a synchronized cursor as proof of retained history.
