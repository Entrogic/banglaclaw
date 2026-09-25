import { Command, Option } from "commander";
import type { GlobalOptions } from "./bootstrap.js";
import { auditList, dbMigrate, dbStatus, handoffList, handoffRelease, handoffReply, handoffShow, keyCreate, keyList, keyRevoke } from "./commands/admin.js";
import { agentList, mcpList, skillList, toolList } from "./commands/catalog.js";
import { agentRun, chat } from "./commands/chat.js";
import { completionScript } from "./commands/completion.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { kbDelete, kbIngest, kbList, kbSearch, memoryForget, memoryList } from "./commands/knowledge.js";
import { serve } from "./commands/serve.js";
import { runList, runShow, sessionList, sessionShow } from "./commands/session.js";
import { version } from "./commands/version.js";
import { configureOutput } from "./ui/output.js";
import { c, setColor } from "./ui/theme.js";
import { VERSION } from "./version.js";

interface RootOptions {
  config?: string;
  json?: boolean;
  quiet?: boolean;
  color?: boolean;
}

const examples = (lines: string[]) => `\nExamples:\n${lines.map((l) => `  $ ${l}`).join("\n")}\n`;

/** Builds the CLI command tree (docs/17). */
export function buildProgram(): Command {
  const program = new Command()
    .name("banglaclaw")
    .description("Bangla-first AI agent runtime — chat, serve and operate agents that speak Bangla, Banglish and English")
    .version(VERSION, "-v, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .option("-c, --config <path>", "path to banglaclaw.yaml (default: ./banglaclaw.yaml)")
    .option("--json", "machine-readable JSON output")
    .option("-q, --quiet", "only essential output")
    .addOption(new Option("--no-color", "disable colors (also honours NO_COLOR)"))
    .showSuggestionAfterError()
    .configureHelp({ sortSubcommands: false, showGlobalOptions: true })
    .addHelpText(
      "after",
      `\n${c.bold("Quick start")}\n  $ banglaclaw init          set up a model provider and features\n  $ banglaclaw chat          talk to your agent\n  $ banglaclaw serve         start the API, web chat and channels\n\nDocs: https://github.com/Entrogic/banglaclaw/tree/master/docs\n`,
    );

  program.hook("preAction", () => {
    const o = program.opts<RootOptions>();
    configureOutput({ json: o.json === true, quiet: o.quiet === true });
    if (o.color === false || o.json === true) setColor(false);
  });

  const g = (): GlobalOptions => {
    const cfg = program.opts<RootOptions>().config;
    return cfg !== undefined ? { config: cfg } : {};
  };

  // ── Chat ────────────────────────────────────────────────────────────────
  program.commandsGroup("Chat:");
  program
    .command("chat")
    .description("interactive chat (full-screen in a terminal, line mode when piped)")
    .option("-s, --session <id>", "resume an existing session")
    .option("--plain", "force line mode (no full-screen UI)")
    .addHelpText("after", examples(["banglaclaw chat", "banglaclaw chat --session 0e56422d-…", "printf 'hi\\n/exit\\n' | banglaclaw chat"]))
    .action((o: { session?: string; plain?: boolean }) => chat({ ...g(), ...o }));

  const agent = program.command("agent").description("run agents and list specialists");
  agent
    .command("run")
    .description("send one message and stream the reply")
    .argument("<message...>", "message text")
    .option("-s, --session <id>", "continue an existing session")
    .addHelpText("after", examples(['banglaclaw agent run "২৫ * ৪ কত?"', 'banglaclaw agent run --json "ekhon koyta baje?" | jq .reply']))
    .action((words: string[], o: { session?: string }) => agentRun(words.join(" "), { ...g(), ...o }));
  agent.command("list").description("supervisor and AGENT.md specialists").action(() => agentList(g()));

  // ── Data ────────────────────────────────────────────────────────────────
  program.commandsGroup("Data:");
  const session = program.command("session").description("inspect conversations");
  session.command("list").description("recent sessions").option("-n, --limit <n>", "maximum sessions", "20").action((o: { limit: string }) => sessionList({ ...g(), ...o }));
  session
    .command("show")
    .description("messages and runs of a session")
    .argument("<id>", "session id")
    .option("-n, --limit <n>", "maximum messages", "30")
    .action((id: string, o: { limit: string }) => sessionShow(id, { ...g(), ...o }));

  const run = program.command("run").description("inspect agent runs");
  run
    .command("list")
    .description("runs of a session")
    .requiredOption("-s, --session <id>", "session id")
    .option("-n, --limit <n>", "maximum runs", "20")
    .action((o: { session: string; limit: string }) => runList({ ...g(), ...o }));
  run.command("show").description("a run with tool calls, tokens and checkpoint").argument("<id>", "run id").action((id: string) => runShow(id, g()));

  const kb = program.command("kb").description("knowledge base (RAG)");
  kb.command("ingest")
    .description("ingest files or folders (.txt .md .html .pdf)")
    .argument("<paths...>")
    .addHelpText("after", examples(["banglaclaw kb ingest docs/faq policies.pdf"]))
    .action((paths: string[]) => kbIngest(paths, g()));
  kb.command("list").description("ingested documents").action(() => kbList(g()));
  kb.command("search").description("search the knowledge base").argument("<query...>").option("-n, --limit <n>", "maximum results", "5").action((w: string[], o: { limit: string }) => kbSearch(w.join(" "), { ...g(), ...o }));
  kb.command("delete").description("remove a document by source path").argument("<source>").action((source: string) => kbDelete(source, g()));

  const memory = program.command("memory").description("long-term memories (qdrant)");
  const owner = "owner: cli:local, user:<id>, telegram:<chat>, whatsapp:<number>";
  memory.command("list").description("memories of an owner").option("-o, --owner <owner>", owner, "cli:local").action((o: { owner: string }) => memoryList({ ...g(), ...o }));
  memory.command("forget").description("delete a memory").argument("<id>").option("-o, --owner <owner>", owner, "cli:local").action((id: string, o: { owner: string }) => memoryForget(id, { ...g(), ...o }));

  // ── Server ──────────────────────────────────────────────────────────────
  program.commandsGroup("Server:");
  program
    .command("serve")
    .description("start the HTTP API, web chat, metrics and enabled channels")
    .option("-p, --port <port>", "port (default: gateway.port, 3000)")
    .option("-H, --host <host>", "bind address (default: gateway.host, 127.0.0.1)")
    .addHelpText("after", examples(["banglaclaw serve", "banglaclaw serve --port 8080 --host 0.0.0.0"]))
    .action((o: { port?: string; host?: string }) => serve({ ...g(), ...o }));

  const key = program.command("key").description("API keys (postgres)");
  key
    .command("create")
    .description("issue an API key (shown once)")
    .requiredOption("-u, --user <name>", "user the key belongs to (created if needed)")
    .option("-n, --name <name>", "key label", "default")
    .option("-r, --role <role>", "user | operator (answers handoffs) | admin (also reads the audit log)")
    .option("-s, --scopes <scopes>", "read (GET endpoints), run (runs and writes)", "read,run")
    .addHelpText("after", examples(["banglaclaw key create --user my-app", "banglaclaw key create --user dashboard --scopes read", "banglaclaw key create --user ops --role admin"]))
    .action((o: { user: string; name: string; role?: string; scopes: string }) => keyCreate({ ...g(), ...o }));
  key.command("list").description("API keys").option("-u, --user <name>", "only this user's keys").action((o: { user?: string }) => keyList({ ...g(), ...o }));
  key.command("revoke").description("revoke an API key").argument("<id>", "key id (the part after bck_)").action((id: string) => keyRevoke(id, g()));

  const handoff = program.command("handoff").description("human handoff queue (postgres)");
  handoff.command("list").description("conversations waiting for a human").action(() => handoffList(g()));
  handoff.command("show").description("a handed-off conversation").argument("<sessionId>").option("-n, --limit <n>", "maximum messages", "30").action((id: string, o: { limit: string }) => handoffShow(id, { ...g(), ...o }));
  const operator = process.env.USER ?? "operator";
  handoff
    .command("reply")
    .description("reply as a human operator (delivered through the session's channel)")
    .argument("<sessionId>")
    .argument("<text...>")
    .option("--as <name>", "operator name", operator)
    .action((id: string, w: string[], o: { as: string }) => handoffReply(id, w.join(" "), { ...g(), ...o }));
  handoff.command("release").description("give the conversation back to the bot").argument("<sessionId>").option("--as <name>", "operator name", operator).action((id: string, o: { as: string }) => handoffRelease(id, { ...g(), ...o }));

  program
    .command("audit")
    .description("security audit log (postgres)")
    .option("-a, --action <action>", "filter: auth.failed, key.created, tool.denied, handoff.replied, …")
    .option("-n, --limit <n>", "maximum events", "50")
    .action((o: { action?: string; limit: string }) => auditList({ ...g(), ...o }));

  // ── Setup ───────────────────────────────────────────────────────────────
  program.commandsGroup("Setup:");
  program
    .command("init")
    .description("interactive setup wizard (writes banglaclaw.yaml and .env)")
    .option("-y, --yes", "skip the wizard and write the commented template")
    .option("-f, --force", "overwrite an existing banglaclaw.yaml")
    .action((o: { yes?: boolean; force?: boolean }) => init(o));
  program.command("doctor").description("check configuration, keys, storage and integrations").action(() => doctor(g()));
  const db = program.command("db").description("PostgreSQL schema (DATABASE_URL)");
  db.command("migrate").description("apply migrations and create checkpoint tables").action(() => dbMigrate(g()));
  db.command("status").description("migration status").action(() => dbStatus(g()));
  program.command("tool").description("tools").command("list").description("built-in, plugin and MCP tools").action(() => toolList(g()));
  program.command("skill").description("skills").command("list").description("discovered skills").action(() => skillList(g()));
  program.command("mcp").description("MCP servers").command("list").description("connect and list MCP servers and tools").action(() => mcpList(g()));
  program.command("version").description("version and environment details").action(() => version(g()));
  program.helpCommand("help [command]", "show help for a command");
  program
    .command("completion")
    .description("print a shell completion script")
    .argument("<shell>", "bash | zsh | fish")
    .addHelpText("after", examples(['eval "$(banglaclaw completion bash)"   # ~/.bashrc', "banglaclaw completion zsh > ~/.zfunc/_banglaclaw", "banglaclaw completion fish > ~/.config/fish/completions/banglaclaw.fish"]))
    .action((shell: string) => {
      process.stdout.write(completionScript(program, shell));
    });

  return program;
}
