import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@banglaclaw/session";
import type { RuntimeBundle } from "../bootstrap.js";
import { VERSION } from "../version.js";
import { appendHistory, loadHistory } from "./history.js";
import { renderMarkdown } from "./markdown.js";
import { SLASH_COMMANDS, useChat, type Item, type RunSummary } from "./useChat.js";

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
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" borderLeft={false} borderRight={false} marginBottom={1}>
      <Text>
        <Text bold>🐾 BanglaClaw</Text>
        <Text dimColor> {VERSION}</Text>
      </Text>
      <Text dimColor>
        {bundle.providerId} · {bundle.services.persistent ? "postgres" : "memory"} storage · session {session.id.slice(0, 8)}
      </Text>
      {extras.length > 0 && <Text dimColor>{extras.join(" · ")}</Text>}
      <Text> </Text>
      <Text>বাংলা, Banglish বা English-এ লিখুন · type <Text color="cyan">/</Text> for commands</Text>
    </Box>
  );
}

function ItemView({ item, width, bundle, session }: { item: Item; width: number; bundle: RuntimeBundle; session: Session }) {
  switch (item.kind) {
    case "banner":
      return <Banner bundle={bundle} session={session} />;
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="green" bold>
            ›{" "}
          </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {item.agent !== "supervisor" && <Text color="magenta">{item.agent}</Text>}
          <Text>{renderMarkdown(item.text, Math.max(20, width - 4))}</Text>
        </Box>
      );
    case "tool": {
      const color = item.status === undefined ? "cyan" : item.status === "ok" ? "gray" : "yellow";
      return (
        <Box paddingLeft={2}>
          <Text color={color}>
            ⚙ {item.tool}
            <Text dimColor>({toolArgs(item.input)})</Text>
            {item.status === undefined ? <Text dimColor> …</Text> : item.status === "ok" ? <Text dimColor> → {toolResult(item.output)} · {item.ms}ms</Text> : <Text> → {item.status}: {short(item.error ?? "", 80)}</Text>}
          </Text>
        </Box>
      );
    }
    case "transfer":
      return (
        <Box paddingLeft={2}>
          <Text color="magenta">↪ {item.to}</Text>
        </Box>
      );
    case "handoff":
      return (
        <Box marginTop={1} marginLeft={2} borderStyle="single" borderColor="yellow" borderLeft={false} borderRight={false}>
          <Text color="yellow">{item.pending ? "⏳ A human operator owns this conversation — the bot will not reply." : `👤 Handed to a human: ${item.reason}`}</Text>
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
          <Text color="red">✖ {item.text}</Text>
        </Box>
      );
  }
}

function StatusBar({ running, activity, startedAt, last, agent, session, notice }: { running: boolean; activity: string; startedAt: number; last: RunSummary | undefined; agent: string; session: Session; notice: string | undefined }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setFrame((f) => f + 1), 80);
    return () => clearInterval(t);
  }, [running]);
  const left = running ? (
    <Text color="cyan">
      {SPINNER[frame % SPINNER.length]} {activity} <Text dimColor>{((Date.now() - startedAt) / 1000).toFixed(1)}s · Esc to cancel</Text>
    </Text>
  ) : last !== undefined ? (
    <Text dimColor>
      <Text color={last.status === "completed" ? "green" : last.status === "error" ? "red" : "yellow"}>{last.status === "completed" ? "✔" : "•"} {last.status}</Text>
      {" · "}
      {last.agentPath.join(" ↪ ")} · {last.seconds.toFixed(1)}s{last.tools > 0 ? ` · ${last.tools} tool${last.tools === 1 ? "" : "s"}` : ""}
      {last.tokens !== undefined ? ` · ${last.tokens.input}→${last.tokens.output} tokens` : ""}
    </Text>
  ) : (
    <Text dimColor>ready</Text>
  );
  return (
    <Box justifyContent="space-between">
      {notice !== undefined ? <Text color="yellow">{notice}</Text> : left}
      <Text dimColor>
        {session.status === "handoff" ? <Text color="yellow">handoff · </Text> : null}
        agent {agent} · {session.id.slice(0, 8)}
      </Text>
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
    <Box borderStyle="single" borderColor={disabled ? "gray" : "green"} borderLeft={false} borderRight={false}>
      <Text color="green" bold>
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
        <Text key={c.name} {...(i === selected ? { color: "cyan" } : { dimColor: true })}>
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

  const submit = (raw: string) => {
    const text = raw.trim();
    if (text === "") return;
    appendHistory(text);
    history.push(text);
    setHistoryIndex(undefined);
    setText("");
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
        {(item) => <ItemView key={item.id} item={item} width={width} bundle={bundle} session={chat.session} />}
      </Static>
      {chat.live.map((item) => (
        <ItemView key={item.id} item={item} width={width} bundle={bundle} session={chat.session} />
      ))}
      <Box marginTop={1} flexDirection="column">
        <InputBox value={value} cursor={cursor} disabled={chat.running} />
        {menuOpen && <SlashMenu matches={matches} selected={selected} />}
        <Box paddingX={1} flexDirection="column">
          <StatusBar running={chat.running} activity={chat.activity} startedAt={chat.startedAt} last={chat.last} agent={chat.agent} session={chat.session} notice={notice} />
          <Text dimColor>Enter send · Alt+Enter newline · ↑↓ history · / commands · Ctrl+C twice quit</Text>
        </Box>
      </Box>
    </Box>
  );
}
