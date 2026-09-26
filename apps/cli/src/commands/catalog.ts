import { AllowlistPolicy } from "@entrogic-net/tools";
import type { GlobalOptions } from "../bootstrap.js";
import { buildRegistry, connectMcp, load, loadAgents, loadSkills } from "../bootstrap.js";
import { loadPlugins } from "../plugins.js";
import { emit, empty, print } from "../ui/output.js";
import { withSpinner } from "../ui/spinner.js";
import { table } from "../ui/table.js";
import { c, statusCell, statusWord } from "../ui/theme.js";
import { reportMcpFailures } from "./shared.js";

export async function toolList(options: GlobalOptions): Promise<void> {
  const loaded = load(options);
  const policy = new AllowlistPolicy(loaded.config.tools.allow);
  const plugins = await loadPlugins(loaded);
  const mcp = Object.keys(loaded.config.mcp.servers).length > 0 ? await withSpinner("Connecting MCP servers…", () => connectMcp(loaded)) : await connectMcp(loaded);
  try {
    reportMcpFailures(mcp);
    const pluginTools = new Map(plugins.flatMap((p) => (p.plugin.tools ?? []).map((t) => [t.name, p.plugin.name] as const)));
    const rows = buildRegistry(mcp, plugins.flatMap((p) => p.plugin.tools ?? [])).list().map((tool) => {
      const decision = policy.check(tool);
      const source = tool.name.includes("__") ? `mcp:${tool.name.split("__")[0]}` : pluginTools.has(tool.name) ? `plugin:${pluginTools.get(tool.name)}` : "builtin";
      return { name: tool.name, risk: tool.risk, source, allowed: decision.allowed, ...(!decision.allowed && { reason: decision.reason }), description: tool.description };
    });
    emit(rows, (list) =>
      print(
        table(list, [
          { header: "TOOL", value: (t) => t.name, color: (s) => c.bold(s) },
          { header: "RISK", value: (t) => t.risk },
          { header: "SOURCE", value: (t) => t.source, color: (s) => c.dim(s) },
          { header: "STATUS", value: (t) => (t.allowed ? "allowed" : "denied"), color: statusCell },
          { header: "DESCRIPTION", value: (t) => t.description, color: (s) => c.dim(s), shrink: true },
        ]),
      ),
    );
    print(c.dim("\nKnowledge and memory tools appear when those features are enabled. Allow tools in banglaclaw.yaml → tools.allow."));
  } finally {
    await mcp.close();
  }
}

export async function skillList(options: GlobalOptions): Promise<void> {
  const loaded = load(options);
  const policy = new AllowlistPolicy(loaded.config.tools.allow);
  const plugins = await loadPlugins(loaded);
  const registry = buildRegistry(undefined, plugins.flatMap((p) => p.plugin.tools ?? []));
  const skills = loadSkills(loaded, plugins)
    .list()
    .map((s) => ({
      name: s.name,
      version: s.version,
      description: s.description,
      tools: s.tools.map((name) => {
        const tool = registry.get(name);
        return { name, available: tool !== undefined && policy.check(tool).allowed };
      }),
      triggers: s.triggers,
      path: s.path,
    }));
  emit(skills, (list) => {
    if (list.length === 0) return empty(`No skills found in: ${loaded.config.skills.dirs.join(", ")}`);
    print(
      table(list, [
        { header: "SKILL", value: (s) => s.name, color: (t) => c.bold(t) },
        { header: "VERSION", value: (s) => s.version, color: (t) => c.dim(t) },
        { header: "TOOLS", value: (s) => s.tools.map((t) => (t.available ? t.name : `${t.name}?`)).join(", ") || "-" },
        { header: "TRIGGERS", value: (s) => s.triggers.slice(0, 6).join(", ") + (s.triggers.length > 6 ? ", …" : ""), color: (t) => c.dim(t), shrink: true },
      ]),
    );
    if (list.some((s) => s.tools.some((t) => !t.available))) print(c.dim("\n? = tool not registered or not in tools.allow (knowledge/MCP tools only exist at runtime)"));
  });
}

export async function agentList(options: GlobalOptions): Promise<void> {
  const loaded = load(options);
  const plugins = await loadPlugins(loaded);
  const profiles = loadAgents(loaded, plugins);
  const data = {
    supervisor: { name: "supervisor", description: profiles.length > 0 ? "Front desk; routes to specialists" : "Default agent" },
    specialists: profiles.map((p) => ({ name: p.name, version: p.version, description: p.description, tools: p.tools, skills: p.skills ?? "all", path: p.path })),
    handoff: loaded.config.handoff.enabled,
    maxTransfers: loaded.config.agents.maxTransfers,
  };
  emit(data, (d) => {
    const rows: { name: string; tools: string; skills: string; description: string }[] = [
      { name: d.supervisor.name, tools: profiles.length > 0 ? "tools no specialist claims" : "all allowed", skills: "all", description: d.supervisor.description },
      ...d.specialists.map((s) => ({ name: s.name, tools: s.tools.join(", ") || "-", skills: Array.isArray(s.skills) ? s.skills.join(", ") : s.skills, description: s.description })),
    ];
    print(
      table(rows, [
        { header: "AGENT", value: (a) => a.name, color: (t) => c.bold(t) },
        { header: "TOOLS", value: (a) => a.tools },
        { header: "SKILLS", value: (a) => a.skills },
        { header: "DESCRIPTION", value: (a) => a.description, color: (t) => c.dim(t), shrink: true },
      ]),
    );
    if (d.specialists.length === 0) print(c.dim(`\nNo specialists in ${loaded.config.agents.dirs.join(", ")} — add <dir>/<name>/AGENT.md (see examples/agents).`));
    print(c.dim(`\nhuman handoff: ${d.handoff ? "enabled" : "disabled"} · max ${d.maxTransfers} transfers per run`));
  });
}

export async function mcpList(options: GlobalOptions): Promise<void> {
  const loaded = load(options);
  if (Object.keys(loaded.config.mcp.servers).length === 0) {
    emit([], () => empty("No MCP servers configured. Add them under mcp.servers in banglaclaw.yaml (see docs/10-mcp.md)."));
    return;
  }
  const policy = new AllowlistPolicy(loaded.config.tools.allow);
  const mcp = await withSpinner("Connecting MCP servers…", () => connectMcp(loaded));
  try {
    const tools = new Map(mcp.tools().map((t) => [t.name, t]));
    const servers = mcp.status().map((s) => ({
      ...s,
      tools: s.tools.map((name) => ({ name, risk: tools.get(name)?.risk, allowed: tools.has(name) && policy.check(tools.get(name) as never).allowed })),
    }));
    emit(servers, (list) => {
      for (const s of list) {
        const info = s.serverInfo !== undefined ? c.dim(` ${s.serverInfo.name} ${s.serverInfo.version}`) : "";
        print(`${c.bold(s.name)} ${c.dim(`(${s.transport})`)} ${statusWord(s.state)}${info}`);
        if (s.error !== undefined) print(c.red(`  ${s.error.split("\n").join("\n  ")}`));
        if (s.tools.length > 0) {
          print(
            table(s.tools, [
              { header: "  TOOL", value: (t) => `  ${t.name}` },
              { header: "RISK", value: (t) => t.risk ?? "" },
              { header: "STATUS", value: (t) => (t.allowed ? "allowed" : "denied"), color: statusCell },
            ]),
          );
        }
        print();
      }
    });
    if (mcp.status().some((s) => s.state === "failed")) process.exitCode = 1;
  } finally {
    await mcp.close();
  }
}
