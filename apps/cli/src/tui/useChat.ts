import { useCallback, useRef, useState } from "react";
import { AgentRunError } from "@banglaclaw/agent";
import type { RunRecord, Session } from "@banglaclaw/session";
import type { RunEvent } from "@banglaclaw/shared";
import { AllowlistPolicy } from "@banglaclaw/tools";
import type { RuntimeBundle } from "../bootstrap.js";
import { resolveSession } from "../commands/shared.js";
import { describe } from "../ui/errors.js";

export type Item =
  | { id: number; kind: "banner" }
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string; agent: string }
  | { id: number; kind: "tool"; tool: string; input: unknown; status?: string; output?: unknown; error?: string; ms?: number }
  | { id: number; kind: "transfer"; to: string }
  | { id: number; kind: "handoff"; reason: string; pending: boolean }
  | { id: number; kind: "info"; title?: string; lines: string[] }
  | { id: number; kind: "error"; text: string };

export interface RunSummary {
  status: RunRecord["status"];
  agentPath: string[];
  tokens?: { input: number; output: number };
  seconds: number;
  tools: number;
}

const isControl = (tool: string) => tool.startsWith("transfer_to_") || tool === "request_human";

export const SLASH_COMMANDS: readonly { name: string; description: string }[] = [
  { name: "/help", description: "Commands and keyboard shortcuts" },
  { name: "/new", description: "Start a new session" },
  { name: "/history", description: "Show recent messages of this session" },
  { name: "/session", description: "Show the session id (resume with --session)" },
  { name: "/agents", description: "Supervisor and specialist agents" },
  { name: "/tools", description: "Tools available to the agent" },
  { name: "/skills", description: "Loaded skills" },
  { name: "/clear", description: "Clear the screen" },
  { name: "/exit", description: "Quit" },
];

/** Bridges AgentRuntime runs and RunEvents to React state. No agent logic lives here (ADR-0005). */
export function useChat(bundle: RuntimeBundle, initial: Session) {
  const nextId = useRef(1);
  const id = () => nextId.current++;
  const [items, setItems] = useState<Item[]>([{ id: 0, kind: "banner" }]);
  const [live, setLive] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  const [activity, setActivity] = useState("thinking…");
  const [startedAt, setStartedAt] = useState(0);
  const [last, setLast] = useState<RunSummary | undefined>();
  const [session, setSession] = useState(initial);
  const [agent, setAgent] = useState(initial.activeAgent ?? "supervisor");
  const [epoch, setEpoch] = useState(0);
  const sessionRef = useRef(initial);
  const controller = useRef<AbortController | undefined>(undefined);

  const push = useCallback((...add: Item[]) => setItems((prev) => [...prev, ...add]), []);
  const info = useCallback((lines: string[], title?: string) => push({ id: id(), kind: "info", lines, ...(title !== undefined && { title }) }), [push]);

  const send = useCallback(
    async (text: string) => {
      const segments: Item[] = [];
      let currentAgent = sessionRef.current.activeAgent ?? "supervisor";
      let flushTimer: NodeJS.Timeout | undefined;
      const flush = () => {
        flushTimer = undefined;
        setLive(segments.map((s) => ({ ...s })));
      };
      const schedule = () => {
        flushTimer ??= setTimeout(flush, 33);
      };
      const lastText = (): Extract<Item, { kind: "assistant" }> => {
        const tail = segments.at(-1);
        if (tail?.kind === "assistant") return tail;
        const seg: Extract<Item, { kind: "assistant" }> = { id: id(), kind: "assistant", text: "", agent: currentAgent };
        segments.push(seg);
        return seg;
      };
      const onEvent = (e: RunEvent) => {
        switch (e.type) {
          case "run_start":
            currentAgent = e.agent;
            setAgent(e.agent);
            break;
          case "token":
            lastText().text += e.text;
            setActivity("writing…");
            schedule();
            break;
          case "tool_start":
            if (isControl(e.tool)) break;
            segments.push({ id: id(), kind: "tool", tool: e.tool, input: e.input });
            setActivity(`running ${e.tool}…`);
            schedule();
            break;
          case "tool_end": {
            if (isControl(e.audit.tool)) break;
            const t = [...segments].reverse().find((s) => s.kind === "tool" && s.tool === e.audit.tool && s.status === undefined);
            if (t?.kind === "tool") Object.assign(t, { status: e.audit.status, output: e.audit.output, error: e.audit.error, ms: e.audit.durationMs });
            setActivity("thinking…");
            schedule();
            break;
          }
          case "agent_transfer":
            currentAgent = e.to;
            setAgent(e.to);
            segments.push({ id: id(), kind: "transfer", to: e.to });
            schedule();
            break;
          case "handoff":
            segments.push({ id: id(), kind: "handoff", reason: e.reason, pending: e.pending });
            schedule();
            break;
          case "error":
            segments.push({ id: id(), kind: "error", text: e.message });
            schedule();
            break;
          case "final":
            break;
        }
      };

      push({ id: id(), kind: "user", text });
      setRunning(true);
      setActivity("thinking…");
      setStartedAt(Date.now());
      setLive([]);
      const abort = new AbortController();
      controller.current = abort;
      let record: RunRecord | undefined;
      try {
        record = await bundle.runtime.run(text, { sessionId: sessionRef.current.id, onEvent, signal: abort.signal });
      } catch (error) {
        if (error instanceof AgentRunError) record = error.record;
        else segments.push({ id: id(), kind: "error", text: describe(error) });
      } finally {
        if (flushTimer !== undefined) clearTimeout(flushTimer);
        controller.current = undefined;
        if (record?.status === "aborted") segments.push({ id: id(), kind: "info", lines: ["Cancelled."] });
        setItems((prev) => [...prev, ...segments.filter((s) => s.kind !== "assistant" || s.text.trim() !== "")]);
        setLive([]);
        setRunning(false);
        if (record !== undefined) {
          setLast({
            status: record.status,
            agentPath: record.agentPath,
            ...(record.usage !== undefined && { tokens: { input: record.usage.inputTokens, output: record.usage.outputTokens } }),
            seconds: record.durationMs / 1000,
            tools: record.toolCalls.filter((t) => !isControl(t.tool)).length,
          });
          const updated = await bundle.runtime.sessions.get(sessionRef.current.id);
          if (updated !== undefined) {
            sessionRef.current = updated;
            setSession(updated);
            setAgent(updated.activeAgent ?? "supervisor");
          }
        }
      }
    },
    [bundle, push],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  const command = useCallback(
    async (input: string): Promise<"exit" | undefined> => {
      const [name] = input.trim().split(/\s+/);
      switch (name) {
        case "/exit":
        case "/quit":
          return "exit";
        case "/help":
          info(
            [
              ...SLASH_COMMANDS.map((c) => `${c.name.padEnd(10)} ${c.description}`),
              "",
              "Enter send · Alt+Enter or Ctrl+J newline · ↑/↓ history · Tab complete",
              "Esc cancel a reply / clear input · Ctrl+C twice or Ctrl+D quit",
            ],
            "Help",
          );
          return undefined;
        case "/new":
        case "/reset": {
          const { session: fresh } = await resolveSession(bundle.runtime, bundle.services);
          sessionRef.current = fresh;
          setSession(fresh);
          setAgent("supervisor");
          setLast(undefined);
          info([`New session ${fresh.id}`]);
          return undefined;
        }
        case "/session":
          info([sessionRef.current.id, bundle.services.persistent ? `Resume later: banglaclaw chat --session ${sessionRef.current.id}` : "Memory storage: this session ends when you quit."], "Session");
          return undefined;
        case "/history": {
          const recent = await bundle.runtime.sessions.recentMessages(sessionRef.current.id, 20);
          const lines = recent.filter((m) => (m.getType() === "human" || m.getType() === "ai") && m.text.trim() !== "").map((m) => `${m.getType() === "human" ? "you  " : "agent"} ${m.text.replace(/\s+/g, " ").slice(0, 160)}`);
          info(lines.length > 0 ? lines : ["No messages yet."], "History");
          return undefined;
        }
        case "/agents":
          info(
            bundle.profiles.length === 0
              ? ["supervisor  (single agent — add agents/<name>/AGENT.md for specialists)"]
              : ["supervisor  front desk", ...bundle.profiles.map((p) => `${p.name.padEnd(11)} ${p.description}`)],
            `Agents · active: ${sessionRef.current.activeAgent ?? "supervisor"}`,
          );
          return undefined;
        case "/tools": {
          const policy = new AllowlistPolicy(bundle.services.loaded.config.tools.allow);
          const tools = bundle.registry.list().filter((t) => policy.check(t).allowed);
          info(tools.length > 0 ? tools.map((t) => `${t.name.padEnd(24)} ${t.risk}`) : ["No tools allowed (tools.allow)."], "Tools");
          return undefined;
        }
        case "/skills": {
          const skills = bundle.skills.list();
          info(skills.length > 0 ? skills.map((s) => `${s.name.padEnd(16)} ${s.description}`) : ["No skills loaded."], "Skills");
          return undefined;
        }
        case "/clear":
          process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
          setItems([{ id: id(), kind: "banner" }]);
          setEpoch((e) => e + 1);
          return undefined;
        default:
          info([`Unknown command ${name ?? ""} — type /help`]);
          return undefined;
      }
    },
    [bundle, info],
  );

  return { items, live, running, activity, startedAt, last, session, agent, epoch, send, cancel, command, info };
}
