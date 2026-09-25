import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { colorEnabled } from "../ui/theme.js";

const renderers = new Map<number, Marked>();

/** Markdown → ANSI for the terminal (bold, lists, code blocks, tables). Plain text when colors are off. */
export function renderMarkdown(text: string, width: number): string {
  if (!colorEnabled() || text.trim() === "") return text;
  let marked = renderers.get(width);
  if (marked === undefined) {
    marked = new Marked(markedTerminal({ reflowText: true, width, tab: 2, showSectionPrefix: false }) as never);
    renderers.set(width, marked);
  }
  try {
    return (marked.parse(text) as string).replace(/\n+$/, "");
  } catch {
    return text;
  }
}
