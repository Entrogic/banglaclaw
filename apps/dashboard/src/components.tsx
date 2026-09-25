import { useEffect, useRef } from "react";
import type { Message } from "@banglaclaw/client";

/** Session, run or audit status with an icon, so color never carries the meaning alone. */
export function StatusBadge({ status, kind = "session" }: { status: string; kind?: "session" | "run" }) {
  const label = status === "handoff" ? (kind === "session" ? "Waiting for a human" : "Handed off") : status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
  const tone =
    status === "handoff" || status === "limited" || status === "aborted" || status === "denied"
      ? "warning"
      : status === "error" || status === "failure"
        ? "critical"
        : status === "completed" || status === "active" || status === "success"
          ? "good"
          : "neutral";
  const icon = tone === "good" ? "✓" : tone === "critical" ? "✕" : tone === "warning" ? "!" : "•";
  return (
    <span className={`badge ${tone}`}>
      <span aria-hidden="true">{icon}</span> {label}
    </span>
  );
}

const ROLE_LABEL: Record<Message["role"], string> = { user: "User", assistant: "Assistant", operator: "Operator", tool: "Tool", system: "System" };

export function Transcript({ messages }: { messages: Message[] }) {
  return (
    <ol className="transcript">
      {messages.map((m, i) => (
        <li key={i} className={`msg ${m.role}`}>
          <div className="msg-role">{ROLE_LABEL[m.role]}</div>
          {m.content !== "" && <div className="msg-body">{m.content}</div>}
          {m.toolCalls?.map((call, k) => (
            <details key={call.id ?? k} className="tool-call">
              <summary>
                Calls <span className="mono">{call.name}</span>
              </summary>
              <pre className="code">{JSON.stringify(call.args, null, 2)}</pre>
            </details>
          ))}
        </li>
      ))}
    </ol>
  );
}

/** Calls `fn` every `ms` while the tab is visible. */
export function useInterval(fn: () => void, ms: number): void {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") saved.current();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
}
