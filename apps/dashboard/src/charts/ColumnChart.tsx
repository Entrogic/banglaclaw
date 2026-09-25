import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { fmtInt, niceTicks } from "../format";

export interface Series {
  name: string;
  /** CSS color (a token such as var(--series-1)). */
  color: string;
}

export interface Column {
  label: string;
  /** One value per series, stacked bottom-up in series order. */
  values: number[];
  /** Extra tooltip rows (not plotted). */
  extra?: { name: string; value: string }[];
}

const HEIGHT = 200;
const PAD = { top: 12, right: 8, bottom: 24, left: 44 };
const GAP = 2;
const MAX_BAR = 24;

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A path for a column segment: 4px rounded top when it is the data end, square otherwise. */
function segmentPath(x: number, y: number, w: number, h: number, roundTop: boolean): string {
  const r = roundTop ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const TOOLTIP_W = 180;

function tooltipLeft(center: number, barW: number, width: number): number {
  const right = center + barW / 2 + 8;
  return right + TOOLTIP_W <= width ? right : Math.max(0, center - barW / 2 - 8 - TOOLTIP_W);
}

/** Stacked daily columns with a per-column tooltip, a legend and a table view. */
export function ColumnChart({ title, series, columns, format = fmtInt }: { title: string; series: Series[]; columns: Column[]; format?: (n: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | undefined>(undefined);
  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const totals = columns.map((c) => c.values.reduce((a, v) => a + v, 0));
  const ticks = niceTicks(Math.max(0, ...totals));
  const top = ticks.at(-1) ?? 1;
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const slot = columns.length > 0 ? innerW / columns.length : innerW;
  const barW = Math.max(2, Math.min(MAX_BAR, slot * 0.7));
  const labelEvery = Math.max(1, Math.ceil(52 / slot));
  const hovered = active === undefined ? undefined : columns[active];

  const onKey = (e: KeyboardEvent) => {
    if (columns.length === 0) return;
    if (e.key === "ArrowRight") setActive((i) => Math.min(columns.length - 1, (i ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? columns.length) - 1));
    else if (e.key === "Escape") setActive(undefined);
    else return;
    e.preventDefault();
  };

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <h3>{title}</h3>
        {series.length > 1 && (
          <ul className="legend">
            {series.map((s) => (
              <li key={s.name}>
                <span className="swatch" style={{ background: s.color }} />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
      <div className="chart-plot" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${title}. Use arrow keys to read values; the table below lists every value.`}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setActive(undefined)}
          onPointerLeave={() => setActive(undefined)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "axis" : "grid"} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="tick" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const x = PAD.left + i * slot + (slot - barW) / 2;
            let base = 0;
            const lastNonZero = c.values.reduce((last, v, k) => (v > 0 ? k : last), -1);
            return (
              <g key={c.label} className={active !== undefined && active !== i ? "dim" : undefined}>
                {c.values.map((v, k) => {
                  if (v <= 0) return null;
                  const y0 = y(base);
                  base += v;
                  const y1 = y(base);
                  // 2px surface gap between stacked segments.
                  const h = Math.max(1, y0 - y1 - (k === lastNonZero ? 0 : GAP));
                  return <path key={k} d={segmentPath(x, y0 - h, barW, h, k === lastNonZero)} fill={series[k]?.color} />;
                })}
                {i % labelEvery === 0 && (
                  <text className="tick" x={x + barW / 2} y={HEIGHT - 6} textAnchor="middle">
                    {c.label}
                  </text>
                )}
                <rect
                  className="hit"
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                />
              </g>
            );
          })}
        </svg>
        {hovered !== undefined && active !== undefined && (
          <div
            className="tooltip"
            role="status"
            // Beside the column (right, or left near the edge) so it never covers the mark it describes.
            style={{ left: tooltipLeft(PAD.left + active * slot + slot / 2, barW, width), top: 4 }}
          >
            <div className="tooltip-title">{hovered.label}</div>
            {[...series].reverse().map((s) => {
              const k = series.indexOf(s);
              return (
                <div className="tooltip-row" key={s.name}>
                  <span className="line-key" style={{ background: s.color }} />
                  <strong>{format(hovered.values[k] ?? 0)}</strong>
                  <span>{s.name}</span>
                </div>
              );
            })}
            {hovered.extra?.map((e) => (
              <div className="tooltip-row" key={e.name}>
                <span className="line-key blank" />
                <strong>{e.value}</strong>
                <span>{e.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="table-view">
        <summary>Show table</summary>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              {series.map((s) => (
                <th key={s.name} className="num">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.label}>
                <td>{c.label}</td>
                {series.map((s, k) => (
                  <td key={s.name} className="num">
                    {format(c.values[k] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
