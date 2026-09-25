#!/usr/bin/env node
import { Command } from "commander";
import { AgentRunError } from "@banglaclaw/agent";
import {
  agentRun,
  chat,
  dbMigrate,
  dbStatus,
  describe,
  doctor,
  init,
  planned,
  runList,
  runShow,
  sessionList,
  sessionShow,
  skillList,
  toolList,
} from "./commands.js";
import { red } from "./render.js";

const program = new Command()
  .name("banglaclaw")
  .description("Bangla-first AI agent runtime")
  .version("0.2.0")
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
agent.command("list").description("list configured agents").action(planned("agent list", "v0.7 (multi-agent)"));

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

program.command("mcp").description("inspect MCP servers").command("list").action(planned("mcp list", "v0.3"));
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
}
