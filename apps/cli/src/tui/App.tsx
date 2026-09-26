import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@banglaclaw/session";
import type { RuntimeBundle } from "../bootstrap.js";
import { ink, sym } from "../ui/theme.js";
import { VERSION } from "../version.js";
import { appendHistory, loadHistory } from "./history.js";
import { renderMarkdown } from "./markdown.js";
import { SLASH_COMMANDS, useChat, type Item, type RunSummary, type SessionChoice } from "./useChat.js";

const segmenter = new Intl.Segmenter();
const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function short(value: unknown, max = 80): string {
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toolArgs(input: unknown): string {
  if (input !== null && typeof input === "object") {
    const values = Object.values(input as Record<string, unknown>);
    if (values.length === 1 && typeof values[0] === "string") return short(values[0], 60);
  }
  return short(input, 60);
}

/** Pretty JSON (or text) cut to a few lines for an expanded tool card. */
function block(value: unknown, maxLines = 10): string[] {
  const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "");
  const lines = text.split("\n");
  return lines.length > maxLines ? [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`] : lines;
}

function duration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function toolResult(output: unknown): string {
  if (output !== null && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if ("result" in o) return short(o.result);
    if ("structured" in o) return short(o.structured);
    if ("results" in o && Array.isArray(o.results)) return `${o.results.length} results`;
  }
  return short(output);
}

function Banner({ bundle, session }: { bundle: RuntimeBundle; session: Session }) {
  const cfg = bundle.services.loaded.config;
  const extras = [
    bundle.profiles.length > 0 ? `agents: ${bundle.profiles.map((p) => p.name).join(", ")}` : undefined,
    bundle.mcp.tools().length > 0 ? `MCP: ${bundle.mcp.tools().length} tools` : undefined,
    bundle.plugins.length > 0 ? `plugins: ${bundle.plugins.map((p) => p.plugin.name).join(", ")}` : undefined,
    cfg.knowledge.enabled ? "knowledge base" : undefined,
    cfg.memory.longTerm.enabled ? "long-term memory" : undefined,
  ].filter(Boolean);
  return (
    // Horizontal rules only: terminals render Bengali conjuncts at varying widths, so vertical box edges would drift.
    <Box flexDirection="column" borderStyle="round" borderColor={ink("brand")} borderLeft={false} borderRight={false} marginBottom={1}>
      <Text>
        <Text bold color={ink("brand")}>
          {sym.paw} BanglaClaw
        </Text>
        <Text dimColor> v{VERSION}</Text>
      </Text>
      <Text>
        <Text dimColor>provider </Text>
        {bundle.providerId}
        <Text dimColor> · storage </Text>
        {bundle.services.persistent ? "postgres" : "memory"}
        <Text dimColor> · session </Text>
        {session.id.slice(0, 8)}
      </Text>
      {extras.length > 0 && <Text dimColor>{extras.join(" · ")}</Text>}
      <Text> </Text>
      <Text>
        বাংলা, Banglish বা English-এ লিখুন <Text dimColor>· type</Text> <Text color={ink("brand")} bold>/</Text> <Text dimColor>for commands</Text>
      </Text>
    </Box>
  );
}

function ToolCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const pending = item.status === undefined;
  const ok = item.status === "ok";
  const color = ink(pending ? "pending" : ok ? "brand" : "warn");
  return (
    // Left rule only (see Banner): a right edge would drift on Bengali text.
    <Box flexDirection="column" marginLeft={4} paddingLeft={1} borderStyle="single" borderColor={color} borderTop={false} borderRight={false} borderBottom={false}>
      <Text>
        <Text color={color} bold>
          {sym.tool} {item.tool}
        </Text>
        <Text dimColor> {pending ? "running…" : ok ? `${sym.ok} ${duration(item.ms)}` : `${sym.fail} ${item.status}`}</Text>
      </Text>
      <Text dimColor>input</Text>
      {block(item.input).map((l, i) => (
        <Text key={`i${i}`}>{"  " + l}</Text>
      ))}
      {!pending && <Text dimColor>{ok ? "result" : "error"}</Text>}
      {!pending &&
        block(ok ? item.output : (item.error ?? "")).map((l, i) => (
          <Text key={`o${i}`} {...(ok ? {} : { color: ink("warn") })}>
            {"  " + l}
          </Text>
        ))}
    </Box>
  );
}

function ItemView({ item, width, bundle, session, expanded }: { item: Item; width: number; bundle: RuntimeBundle; session: Session; expanded: boolean }) {
  switch (item.kind) {
    case "banner":
      return <Banner bundle={bundle} session={session} />;
    case "user":
      return (
        <Box marginTop={1}>
          <Text color={ink("brand")} bold>
            ›{" "}
          </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        // Left rule only: a right edge would drift on Bengali conjuncts (see Banner).
        <Box flexDirection="column" marginTop={1} marginLeft={1} paddingLeft={1} borderStyle="bold" borderColor={ink("brand")} borderTop={false} borderRight={false} borderBottom={false}>
          {item.agent !== "supervisor" && (
            <Text color={ink("agent")} bold>
              {item.agent}
            </Text>
          )}
          <Text>{renderMarkdown(item.text, Math.max(20, width - 4))}</Text>
        </Box>
      );
    case "worked":
      return (
        <Box paddingLeft={2} marginTop={1}>
          <Text dimColor>
            {expanded ? "▾" : "▸"} {item.seconds === undefined ? "Used" : `Worked for ${item.seconds.toFixed(1)}s ·`} {item.tools} tool{item.tools === 1 ? "" : "s"}
            {expanded ? "" : "  (Ctrl+O details)"}
          </Text>
        </Box>
      );
    case "tool": {
      if (expanded) return <ToolCard item={item} />;
      const color = ink(item.status === undefined ? "pending" : item.status === "ok" ? "ok" : "warn");
      return (
        <Box paddingLeft={4}>
          <Text color={color}>
            {sym.tool} {item.tool}
            <Text dimColor>({toolArgs(item.input)})</Text>
            {item.status === undefined ? <Text dimColor> …</Text> : item.status === "ok" ? <Text dimColor> → {toolResult(item.output)} · {item.ms}ms</Text> : <Text> → {item.status}: {short(item.error ?? "", 80)}</Text>}
          </Text>
        </Box>
      );
    }
    case "transfer":
      return (
        <Box paddingLeft={2}>
          <Text color={ink("agent")}>
            {sym.transfer} {item.to}
          </Text>
        </Box>
      );
    case "handoff":
      return (
        <Box marginTop={1} marginLeft={2} borderStyle="round" borderColor={ink("accent")} borderLeft={false} borderRight={false}>
          <Text color={ink("accent")}>{item.pending ? "⏳ A human operator owns this conversation — the bot will not reply." : `👤 Handed to a human: ${item.reason}`}</Text>
        </Box>
      );
    case "info":
      return (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {item.title !== undefined && <Text bold>{item.title}</Text>}
          {item.lines.map((l, i) => (
            <Text key={i} dimColor>
              {l}
            </Text>
          ))}
        </Box>
      );
    case "error":
      return (
        <Box paddingLeft={2}>
          <Text color={ink("error")}>
            {sym.fail} {item.text}
          </Text>
        </Box>
      );
  }
}

function StatusBar({ running, activity, startedAt, last, notice }: { running: boolean; activity: string; startedAt: number; last: RunSummary | undefined; notice: string | undefined }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setFrame((f) => f + 1), 80);
    return () => clearInterval(t);
  }, [running]);
  const left = running ? (
    <Text color={ink("brand")}>
      {SPINNER[frame % SPINNER.length]} {activity} <Text dimColor>{((Date.now() - startedAt) / 1000).toFixed(1)}s · Esc to cancel</Text>
    </Text>
  ) : last !== undefined ? (
    <Text dimColor>
      <Text color={ink(last.status === "completed" ? "brand" : last.status === "error" ? "error" : "warn")}>
        {last.status === "completed" ? sym.ok : sym.bullet} {last.status}
      </Text>
      {" · "}
      {last.agentPath.join(` ${sym.transfer} `)} · {last.seconds.toFixed(1)}s{last.tools > 0 ? ` · ${last.tools} tool${last.tools === 1 ? "" : "s"}` : ""}
      {last.tokens !== undefined ? ` · ${last.tokens.input}→${last.tokens.output} tokens` : ""}
    </Text>
  ) : (
    <Text dimColor>ready</Text>
  );
  return <Box>{notice !== undefined ? <Text color={ink("warn")}>{notice}</Text> : left}</Box>;
}

/** OpenClaw-style footer: who is answering, where, with what, and the view toggles. */
function Footer({ agent, session, provider, last, expanded }: { agent: string; session: Session; provider: string; last: RunSummary | undefined; expanded: boolean }) {
  return (
    <Box justifyContent="space-between" flexWrap="wrap" columnGap={3}>
      <Text>
        {session.status === "handoff" ? (
          <Text color={ink("accent")} bold inverse>
            {" handoff "}
          </Text>
        ) : null}
        <Text dimColor>
          {session.status === "handoff" ? " " : ""}agent <Text bold>{agent}</Text> · session {session.id.slice(0, 8)} · {provider}
          {last?.tokens !== undefined ? ` · ${last.tokens.input}→${last.tokens.output} tok` : ""}
        </Text>
      </Text>
      <Text dimColor>
        <Text bold>^O</Text> {expanded ? "collapse" : "details"} · <Text bold>^P</Text> sessions · <Text bold>/</Text> commands
      </Text>
    </Box>
  );
}

function SessionPicker({ choices, selected, current }: { choices: SessionChoice[]; selected: number; current: string }) {
  const start = Math.max(0, Math.min(selected - 4, choices.length - 10));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ink("brand")} borderLeft={false} borderRight={false}>
      <Text>
        <Text bold color={ink("brand")}>
          Sessions
        </Text>
        <Text dimColor> ↑↓ choose · Enter open · Esc close</Text>
      </Text>
      {choices.slice(start, start + 10).map((c, i) => {
        const index = start + i;
        const active = index === selected;
        return (
          <Text key={c.session.id} {...(active ? { color: ink("brand"), bold: true } : {})}>
            {active ? "▸ " : "  "}
            <Text dimColor={!active}>{c.session.updatedAt.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).padEnd(17)}</Text> {short(c.title, 60)}
            <Text dimColor>
              {" "}
              {c.session.id.slice(0, 8)}
              {c.session.id === current ? " · current" : ""}
            </Text>
          </Text>
        );
      })}
    </Box>
  );
}

function InputBox({ value, cursor, disabled }: { value: string; cursor: number; disabled: boolean }) {
  const chars = graphemes(value);
  const before = chars.slice(0, cursor).join("");
  const at = chars[cursor] ?? " ";
  const after = chars.slice(cursor + 1).join("");
  const placeholder = value === "" && !disabled;
  return (
    <Box borderStyle="round" borderColor={ink(disabled ? "muted" : "brand")} borderLeft={false} borderRight={false}>
      <Text color={ink("brand")} bold>
        ›{" "}
      </Text>
      {placeholder ? (
        <Text>
          <Text inverse> </Text>
          <Text dimColor>Ask anything… (/ for commands)</Text>
        </Text>
      ) : (
        <Text dimColor={disabled}>
          {before}
          {disabled ? at : <Text inverse>{at === "\n" ? " " : at}</Text>}
          {at === "\n" ? "\n" : ""}
          {after}
        </Text>
      )}
    </Box>
  );
}

function SlashMenu({ matches, selected }: { matches: typeof SLASH_COMMANDS; selected: number }) {
  return (
    <Box flexDirection="column" paddingX={2}>
      {matches.map((c, i) => (
        <Text key={c.name} {...(i === selected ? { color: ink("brand"), bold: true } : { dimColor: true })}>
          {i === selected ? "▸ " : "  "}
          {c.name.padEnd(10)} {c.description}
        </Text>
      ))}
    </Box>
  );
}

export interface AppProps {
  bundle: RuntimeBundle;
  initial: Session;
  onExit: (session: Session) => void;
}

/** Full-screen chat: static transcript (native scrollback) + live reply, input and status bar. */
export function App({ bundle, initial, onExit }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const width = stdout.columns ?? 100;
  const chat = useChat(bundle, initial);
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history] = useState(() => loadHistory());
  const [historyIndex, setHistoryIndex] = useState<number | undefined>();
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState<string | undefined>();
  const [armedExit, setArmedExit] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [picker, setPicker] = useState<{ choices: SessionChoice[]; selected: number } | undefined>();

  const matches = useMemo(() => (value.startsWith("/") && !value.includes(" ") && !value.includes("\n") ? SLASH_COMMANDS.filter((c) => c.name.startsWith(value.toLowerCase())) : []), [value]);
  const menuOpen = matches.length > 0 && !chat.running;

  const quit = () => {
    onExit(chat.session);
    exit();
  };
  const setText = (text: string, pos = graphemes(text).length) => {
    setValue(text);
    setCursor(pos);
    setSelected(0);
  };

  const toggleDetails = () => {
    setExpanded((e) => !e);
    chat.reprint();
  };
  const openPicker = () => {
    void chat.listSessions().then((choices) => setPicker({ choices, selected: Math.max(0, choices.findIndex((c) => c.session.id === chat.session.id)) }));
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (text === "") return;
    appendHistory(text);
    history.push(text);
    setHistoryIndex(undefined);
    setText("");
    if (text === "/sessions") return openPicker();
    if (text === "/details") return toggleDetails();
    if (text.startsWith("/")) {
      void chat.command(text).then((r) => {
        if (r === "exit") quit();
      });
    } else {
      void chat.send(text);
    }
  };

  useInput((input, key) => {
    if (notice !== undefined && !(key.ctrl && input === "c")) setNotice(undefined);

    if (key.ctrl && input === "c") {
      if (chat.running) return chat.cancel();
      if (value !== "") return setText("");
      if (Date.now() - armedExit < 1500) return quit();
      setArmedExit(Date.now());
      setNotice("Press Ctrl+C again to quit");
      return;
    }
    if (key.ctrl && input === "d") {
      if (value === "") quit();
      return;
    }
    if (picker !== undefined) {
      const n = picker.choices.length;
      if (key.escape || (key.ctrl && input === "p")) return setPicker(undefined);
      if (n > 0 && (key.upArrow || key.downArrow)) return setPicker({ ...picker, selected: (picker.selected + (key.upArrow ? n - 1 : 1)) % n });
      if (key.return) {
        const choice = picker.choices[picker.selected];
        setPicker(undefined);
        if (choice !== undefined && choice.session.id !== chat.session.id) void chat.switchSession(choice.session);
      }
      return;
    }
    if (key.ctrl && input === "o") return toggleDetails();
    if (key.ctrl && input === "p") {
      if (!chat.running) openPicker();
      return;
    }
    if (key.escape) {
      if (chat.running) chat.cancel();
      else setText("");
      return;
    }
    if (chat.running) return;

    const chars = graphemes(value);
    const insert = (text: string) => {
      const add = graphemes(text.replace(/\r\n?/g, "\n"));
      chars.splice(cursor, 0, ...add);
      setValue(chars.join(""));
      setCursor(cursor + add.length);
      setSelected(0);
    };

    if (menuOpen && (key.upArrow || key.downArrow)) return setSelected((s) => (s + (key.upArrow ? matches.length - 1 : 1)) % matches.length);
    if (menuOpen && key.tab) return setText(`${matches[selected]?.name ?? value}`);
    if (key.return) {
      if (key.meta || key.shift) return insert("\n");
      if (menuOpen) return submit(matches[selected]?.name ?? value);
      return submit(value);
    }
    if (input === "\n" || (key.ctrl && input === "j")) return insert("\n");
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      chars.splice(cursor - 1, 1);
      setValue(chars.join(""));
      setCursor(cursor - 1);
      setSelected(0);
      return;
    }
    if (key.leftArrow) return setCursor(Math.max(0, cursor - 1));
    if (key.rightArrow) return setCursor(Math.min(chars.length, cursor + 1));
    if (key.home || (key.ctrl && input === "a")) return setCursor(0);
    if (key.end || (key.ctrl && input === "e")) return setCursor(chars.length);
    if (key.ctrl && input === "u") return setText("");
    if (key.upArrow || key.downArrow) {
      if (history.length === 0) return;
      const current = historyIndex ?? history.length;
      const next = key.upArrow ? Math.max(0, current - 1) : current + 1;
      if (next >= history.length) {
        setHistoryIndex(undefined);
        return setText("");
      }
      setHistoryIndex(next);
      return setText(history[next] ?? "");
    }
    if (key.tab || key.ctrl || key.meta) return;
    // Text + Enter arriving in one chunk (fast typing over SSH, or pasting a line ending in Enter): type it, then send.
    // Multi-line pastes keep their newlines so they can be reviewed before sending.
    if (input.length > 1 && input.endsWith("\r") && !input.slice(0, -1).includes("\r") && !input.includes("\n")) {
      const typed = graphemes(input.slice(0, -1));
      chars.splice(cursor, 0, ...typed);
      return submit(chars.join(""));
    }
    if (input !== "") insert(input);
  });

  return (
    <Box flexDirection="column">
      <Static key={chat.epoch} items={chat.items}>
        {(item) => <ItemView key={item.id} item={item} width={width} bundle={bundle} session={chat.session} expanded={expanded} />}
      </Static>
      {chat.live.map((item) => (
        <ItemView key={item.id} item={item} width={width} bundle={bundle} session={chat.session} expanded={expanded} />
      ))}
      <Box marginTop={1} flexDirection="column">
        <Box paddingX={1}>
          <StatusBar running={chat.running} activity={chat.activity} startedAt={chat.startedAt} last={chat.last} notice={notice} />
        </Box>
        {picker !== undefined ? <SessionPicker choices={picker.choices} selected={picker.selected} current={chat.session.id} /> : <InputBox value={value} cursor={cursor} disabled={chat.running} />}
        {menuOpen && picker === undefined && <SlashMenu matches={matches} selected={selected} />}
        <Box paddingX={1}>
          <Footer agent={chat.agent} session={chat.session} provider={bundle.providerId} last={chat.last} expanded={expanded} />
        </Box>
      </Box>
    </Box>
  );
}
