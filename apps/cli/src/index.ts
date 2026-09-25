#!/usr/bin/env node
import { Command } from "commander";
import { AgentRunError } from "@banglaclaw/agent";
import {
  agentList,
  auditList,
  agentRun,
  chat,
  dbMigrate,
  dbStatus,
  describe,
  doctor,
  handoffList,
  handoffRelease,
  handoffReply,
  handoffShow,
  init,
  kbDelete,
  kbIngest,
  kbList,
  kbSearch,
  keyCreate,
  keyList,
  keyRevoke,
  mcpList,
  memoryForget,
  memoryList,
  runList,
  runShow,
  serve,
  sessionList,
  sessionShow,
  skillList,
  toolList,
} from "./commands.js";
import { initTelemetry } from "@banglaclaw/observability";
import { loadDotEnv } from "./env.js";
import { red } from "./render.js";
import { VERSION } from "./version.js";

loadDotEnv();
const telemetry = initTelemetry({ serviceName: "banglaclaw", version: VERSION });

const program = new Command()
  .name("banglaclaw")
  .description("Bangla-first AI agent runtime")
  .version(VERSION)
  .option("-c, --config <path>", "path to banglaclaw.yaml");

const globals = () => program.opts<{ config?: string }>();

program
  .command("chat")
  .description("interactive chat with the default agent")
  .option("-s, --session <id>", "resume an existing session")
  .action((opts: { session?: string }) => chat({ ...globals(), ...opts }));

const agent = program.command("agent").description("run and inspect agents");
agent
  .command("run")
  .description("send one message to the default agent and stream the reply")
  .argument("<message...>", "message text")
  .option("-s, --session <id>", "continue an existing session")
  .action((words: string[], opts: { session?: string }) => agentRun(words.join(" "), { ...globals(), ...opts }));
agent.command("list").description("list the supervisor and specialist agents (AGENT.md)").action(() => agentList(globals()));

const handoff = program.command("handoff").description("human handoff queue (postgres storage)");
handoff.command("list").description("conversations waiting for a human").action(() => handoffList(globals()));
handoff
  .command("show")
  .description("show a handed-off conversation")
  .argument("<sessionId>")
  .option("-n, --limit <n>", "maximum messages", "30")
  .action((id: string, opts: { limit: string }) => handoffShow(id, { ...globals(), ...opts }));
handoff
  .command("reply")
  .description("reply to the user as a human operator (sent via the session's channel)")
  .argument("<sessionId>")
  .argument("<text...>")
  .option("--as <name>", "operator name recorded with the message", process.env.USER ?? "operator")
  .action((id: string, words: string[], opts: { as: string }) => handoffReply(id, words.join(" "), { ...globals(), ...opts }));
handoff
  .command("release")
  .description("give the conversation back to the bot")
  .argument("<sessionId>")
  .option("--as <name>", "operator name recorded in the audit log", process.env.USER ?? "operator")
  .action((id: string, opts: { as: string }) => handoffRelease(id, { ...globals(), ...opts }));

const session = program.command("session").description("inspect sessions");
session
  .command("list")
  .description("list recent sessions")
  .option("-n, --limit <n>", "maximum sessions", "20")
  .action((opts: { limit: string }) => sessionList({ ...globals(), ...opts }));
session
  .command("show")
  .description("show a session's recent messages and runs")
  .argument("<id>", "session id")
  .option("-n, --limit <n>", "maximum messages", "30")
  .action((id: string, opts: { limit: string }) => sessionShow(id, { ...globals(), ...opts }));

const run = program.command("run").description("inspect agent runs");
run
  .command("list")
  .description("list runs of a session")
  .requiredOption("-s, --session <id>", "session id")
  .option("-n, --limit <n>", "maximum runs", "20")
  .action((opts: { session: string; limit: string }) => runList({ ...globals(), ...opts }));
run
  .command("show")
  .description("show a run with its tool calls")
  .argument("<id>", "run id")
  .action((id: string) => runShow(id, globals()));

const tool = program.command("tool").description("inspect tools");
tool.command("list").description("list registered tools and whether they are allowed").action(() => toolList(globals()));

const skill = program.command("skill").description("inspect skills");
skill.command("list").description("list discovered skills").action(() => skillList(globals()));

const db = program.command("db").description("manage PostgreSQL storage (uses DATABASE_URL)");
db.command("migrate").description("apply schema migrations and create checkpoint tables").action(() => dbMigrate(globals()));
db.command("status").description("show migration status").action(() => dbStatus(globals()));

const mcp = program.command("mcp").description("inspect MCP servers");
mcp.command("list").description("connect to configured MCP servers and list their tools").action(() => mcpList(globals()));
program
  .command("serve")
  .description("start the HTTP gateway (REST, SSE, WebSocket, web chat) and enabled channels")
  .option("-p, --port <port>", "port (default gateway.port, 3000)")
  .option("-H, --host <host>", "bind address (default gateway.host, 127.0.0.1)")
  .action((opts: { port?: string; host?: string }) => serve({ ...globals(), ...opts }));

const key = program.command("key").description("manage gateway API keys (postgres storage)");
key
  .command("create")
  .description("create an API key (creates the user if needed)")
  .requiredOption("-u, --user <name>", "user the key belongs to")
  .option("-n, --name <name>", "key label", "default")
  .option("-r, --role <role>", "user (default), operator (answers human handoffs) or admin (also reads the audit log)")
  .option("-s, --scopes <scopes>", "comma-separated key scopes: read (GET endpoints), run (agent runs and writes)", "read,run")
  .action((opts: { user: string; name: string; role?: string; scopes: string }) => keyCreate({ ...globals(), ...opts }));

program
  .command("audit")
  .description("show the security audit log (postgres storage)")
  .option("-a, --action <action>", "filter, e.g. auth.failed, key.created, tool.denied, handoff.replied")
  .option("-n, --limit <n>", "maximum events", "50")
  .action((opts: { action?: string; limit: string }) => auditList({ ...globals(), ...opts }));
key
  .command("list")
  .description("list API keys")
  .option("-u, --user <name>", "only this user's keys")
  .action((opts: { user?: string }) => keyList({ ...globals(), ...opts }));
key
  .command("revoke")
  .description("revoke an API key")
  .argument("<id>", "key id (the part after bck_)")
  .action((id: string) => keyRevoke(id, globals()));

const kb = program.command("kb").description("manage the knowledge base (RAG)");
kb.command("ingest").description("ingest files or directories (.txt .md .html .pdf)").argument("<paths...>").action((paths: string[]) => kbIngest(paths, globals()));
kb.command("list").description("list ingested documents").action(() => kbList(globals()));
kb
  .command("search")
  .description("search the knowledge base")
  .argument("<query...>")
  .option("-n, --limit <n>", "maximum results", "5")
  .action((words: string[], opts: { limit: string }) => kbSearch(words.join(" "), { ...globals(), ...opts }));
kb.command("delete").description("remove a document by source path").argument("<source>").action((source: string) => kbDelete(source, globals()));

const memory = program.command("memory").description("inspect long-term memories (qdrant vector store)");
memory
  .command("list")
  .description("list memories of an owner")
  .option("-o, --owner <owner>", "owner id: cli:local, user:<id>, telegram:<chat id>, whatsapp:<number>", "cli:local")
  .action((opts: { owner: string }) => memoryList({ ...globals(), ...opts }));
memory
  .command("forget")
  .description("delete a memory")
  .argument("<id>")
  .option("-o, --owner <owner>", "owner id", "cli:local")
  .action((id: string, opts: { owner: string }) => memoryForget(id, { ...globals(), ...opts }));

program
  .command("init")
  .description("create banglaclaw.yaml in the current directory")
  .option("-f, --force", "overwrite an existing file")
  .action((opts: { force?: boolean }) => init(opts));
program.command("doctor").description("check configuration and environment").action(() => doctor(globals()));

try {
  await program.parseAsync();
} catch (error) {
  // Run errors were already rendered by the event stream.
  if (!(error instanceof AgentRunError)) console.error(red(`✖ ${describe(error)}`));
  process.exitCode = 1;
} finally {
  await telemetry.shutdown();
}
