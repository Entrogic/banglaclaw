#!/usr/bin/env node
import { Command } from "commander";
import { AgentRunError } from "@banglaclaw/agent";
import { agentRun, chat, describe, doctor, planned, toolList } from "./commands.js";
import { red } from "./render.js";

const program = new Command()
  .name("banglaclaw")
  .description("Bangla-first AI agent runtime")
  .version("0.1.0")
  .option("-c, --config <path>", "path to banglaclaw.yaml");

const globals = () => program.opts<{ config?: string }>();

program.command("chat").description("interactive chat with the default agent").action(() => chat(globals()));

const agent = program.command("agent").description("run and inspect agents");
agent
  .command("run")
  .description("send one message to the default agent and stream the reply")
  .argument("<message...>", "message text")
  .action((words: string[]) => agentRun(words.join(" "), globals()));
agent.command("list").description("list configured agents").action(planned("agent list", "v0.2"));

const tool = program.command("tool").description("inspect tools");
tool.command("list").description("list registered tools and whether they are allowed").action(() => toolList(globals()));

program.command("skill").description("inspect skills").command("list").action(planned("skill list", "v0.2"));
program.command("mcp").description("inspect MCP servers").command("list").action(planned("mcp list", "v0.3"));
program.command("init").description("create banglaclaw.yaml").action(planned("init", "v0.2"));
program.command("doctor").description("check configuration and environment").action(() => doctor(globals()));

try {
  await program.parseAsync();
} catch (error) {
  // Run errors were already rendered by the event stream.
  if (!(error instanceof AgentRunError)) console.error(red(`✖ ${describe(error)}`));
  process.exitCode = 1;
}
