import type { BaseMessage } from "@langchain/core/messages";

export const MAX_TITLE_LENGTH = 80;

/** A session title from its first user message: whitespace collapsed, at most 80 characters. */
export function titleFromMessages(messages: readonly BaseMessage[]): string | undefined {
  for (const m of messages) {
    if (m.getType() !== "human") continue;
    const text = m.text.replace(/\s+/g, " ").trim();
    if (text === "") continue;
    return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…` : text;
  }
  return undefined;
}
