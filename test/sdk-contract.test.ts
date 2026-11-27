import { OpenCode } from "@opencode/client";
import { expect, test } from "vitest";

type Client = ReturnType<typeof OpenCode.make>;

// These are published SDK methods, deliberately not Plugin.Context members.
async function compileHistoricalContract(client: Client, sessionID: string) {
  const messages = await client.message.list({ sessionID, limit: 10, order: "asc" });
  const cursor: string | null | undefined = messages.cursor.next;
  const message = await client.session.message.get({ sessionID, messageID: "test-message" });
  const id: string = message.id;
  const inbox = await client.session.inbox.list({ sessionID });
  const forms = await client.session.form.list({ sessionID });
  const permissions = await client.permission.list({ sessionID });
  for await (const event of client.experimental.session.log({ sessionID, after: 12, follow: false })) {
    if (event.type === "log.synced") {
      const sequence: number | undefined = event.seq;
      const aggregate: string = event.aggregateID;
      void sequence; void aggregate;
    } else {
      const sequence: number = event.durable.seq;
      const producer: string = event.data.sessionID;
      void sequence; void producer;
    }
  }
  return { cursor, id, inbox, forms, permissions };
}

test("SDK history, inbox, interaction snapshots, and log watermark use isolated HTTP contracts", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push(url);
    if (url.pathname.endsWith("/log")) {
      return new Response('data: {"type":"log.synced","aggregateID":"test-session","seq":12}\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (url.pathname.endsWith("/message/test-message")) {
      return Response.json({ data: { id: "test-message", type: "user", text: "Review", time: { created: 1 } } });
    }
    if (url.pathname.endsWith("/message")) return Response.json({ data: [], cursor: {} });
    return Response.json({ data: [] });
  };
  const client = OpenCode.make({ baseUrl: "http://sdk-contract.invalid", fetch: fetcher });
  const result = await compileHistoricalContract(client, "test-session");
  expect(result).toEqual({ cursor: undefined, id: "test-message", inbox: [], forms: [], permissions: [] });
  expect(requests.map(url => url.pathname)).toEqual([
    "/api/session/test-session/message", "/api/session/test-session/message/test-message",
    "/api/session/test-session/inbox", "/api/session/test-session/form",
    "/api/session/test-session/permission", "/api/experimental/session/test-session/log",
  ]);
  const log = requests.at(-1)!;
  expect(log.searchParams.get("after")).toBe("12");
  expect(log.searchParams.get("follow")).toBe("false");
});
