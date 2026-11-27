interface HistoryPart {
  type: string;
  name?: string;
  state?: { status: string; content?: { type: string; text?: string }[] };
}
interface HistoryMessage { type: string; text?: string; content?: HistoryPart[] }

/** Input is the newest API page, reversed back to chronological order. */
export function controlTool(messages: readonly HistoryMessage[], text: string, name: string): HistoryPart {
  const invocation = messages.findIndex(message => message.type === "user" && message.text === text);
  if (invocation < 0) throw new Error("Newest history page must contain this control invocation");
  const tool = messages.slice(invocation + 1).filter(message => message.type === "assistant")
    .flatMap(message => message.content ?? []).filter(part => part.type === "tool" && part.name === name).at(-1);
  if (!tool) throw new Error(`This control invocation has no ${name} tool result`);
  return tool;
}
