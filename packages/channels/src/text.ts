/**
 * Splits text into chunks of at most `max` characters, preferring paragraph, line and
 * word boundaries. Works on code points so a surrogate pair is never split.
 */
export function splitMessage(text: string, max: number): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while ([...rest].length > max) {
    const window = [...rest].slice(0, max).join("");
    let cut = Math.max(window.lastIndexOf("\n\n"), -1);
    if (cut < max * 0.5) cut = window.lastIndexOf("\n");
    if (cut < max * 0.5) cut = window.lastIndexOf(" ");
    if (cut < max * 0.5) cut = window.length;
    chunks.push(window.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}
