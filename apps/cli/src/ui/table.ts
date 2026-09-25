import stringWidth from "string-width";
import { c } from "./theme.js";

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  /** Applied after padding so ANSI codes never affect alignment. */
  color?: (text: string, row: T) => string;
  align?: "left" | "right";
  /** Columns that may be truncated to fit the terminal (default: the widest one). */
  shrink?: boolean;
}

const segmenter = new Intl.Segmenter();

/** Truncates to a display width, cutting on grapheme boundaries (safe for Bangla). */
export function truncate(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  if (width <= 1) return "…".slice(0, width);
  let out = "";
  for (const { segment } of segmenter.segment(text)) {
    if (stringWidth(out + segment) > width - 1) break;
    out += segment;
  }
  return `${out}…`;
}

function pad(text: string, width: number, align: "left" | "right"): string {
  const gap = Math.max(0, width - stringWidth(text));
  return align === "right" ? " ".repeat(gap) + text : text + " ".repeat(gap);
}

/**
 * Renders rows as an aligned table with a dim header. Widths use display width (string-width),
 * so Bengali combining marks and emoji line up; the table is shrunk to `maxWidth`.
 */
export function table<T>(rows: readonly T[], columns: readonly Column<T>[], options: { maxWidth?: number; gap?: number } = {}): string {
  const gap = options.gap ?? 2;
  const maxWidth = options.maxWidth ?? (process.stdout.columns !== undefined && process.stdout.columns > 0 ? process.stdout.columns : 120);
  const cells = rows.map((row) => columns.map((col) => col.value(row).replace(/\s*\n\s*/g, " ")));
  const widths = columns.map((col, i) => Math.max(stringWidth(col.header), ...cells.map((r) => stringWidth(r[i] ?? ""))));

  const total = () => widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  const shrinkable = columns.map((col, i) => (col.shrink === true ? i : -1)).filter((i) => i >= 0);
  const candidates = shrinkable.length > 0 ? shrinkable : columns.map((_, i) => i);
  while (total() > maxWidth) {
    const widest = candidates.reduce((best, i) => ((widths[i] ?? 0) > (widths[best] ?? 0) ? i : best), candidates[0] ?? 0);
    const excess = total() - maxWidth;
    const current = widths[widest] ?? 0;
    const floor = Math.max(8, stringWidth(columns[widest]?.header ?? ""));
    if (current <= floor) break;
    widths[widest] = Math.max(floor, current - excess);
  }

  const sep = " ".repeat(gap);
  const header = columns.map((col, i) => pad(truncate(col.header, widths[i] ?? 0), widths[i] ?? 0, col.align ?? "left")).join(sep);
  const lines = cells.map((r, ri) =>
    columns
      .map((col, i) => {
        const text = pad(truncate(r[i] ?? "", widths[i] ?? 0), widths[i] ?? 0, col.align ?? "left");
        const row = rows[ri] as T;
        return col.color !== undefined ? col.color(text, row) : text;
      })
      .join(sep)
      .trimEnd(),
  );
  return [c.dim(header.trimEnd()), ...lines].join("\n");
}
