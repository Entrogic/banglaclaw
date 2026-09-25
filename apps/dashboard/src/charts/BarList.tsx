import type { ReactNode } from "react";
import { fmtNum } from "../format";

export interface BarItem {
  /** React key when labels can repeat (defaults to the label). */
  id?: string;
  label: string;
  value: number;
  /** Secondary text under the label (e.g. tokens and cost). */
  detail?: ReactNode;
}

/** Horizontal single-series bars with the value at the tip. */
export function BarList({ title, items, empty = "No data" }: { title: string; items: BarItem[]; empty?: string }) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <section className="card">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="barlist">
          {items.map((item) => (
            <li key={item.id ?? item.label}>
              <div className="barlist-label">
                <span title={item.id ?? item.label}>{item.label}</span>
                {item.detail !== undefined && <small>{item.detail}</small>}
              </div>
              <div className="barlist-track">
                <div className="barlist-fill" style={{ width: `${max === 0 ? 0 : Math.max(1, (item.value / max) * 100)}%` }} />
                <span className="barlist-value">{fmtNum(item.value)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
