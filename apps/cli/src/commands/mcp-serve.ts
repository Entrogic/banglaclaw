import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime, type GlobalOptions } from "../bootstrap.js";
import { createBanglaClawMcpServer } from "../mcp-server.js";
import { VERSION } from "../version.js";
import { prepareKnowledge, reportA2aFailures, reportMcpFailures } from "./shared.js";

/**
 * `banglaclaw mcp serve`: BanglaClaw as an MCP server on stdio (docs/10). stdout carries the
 * protocol, so everything else goes to stderr. Exits when the client closes the connection.
 */
export async function mcpServe(options: GlobalOptions): Promise<void> {
  const bundle = await createRuntime(options);
  const { services } = bundle;
  const config = services.loaded.config;
  try {
    await prepareKnowledge(bundle.knowledge, false);
    reportMcpFailures(bundle.mcp);
    reportA2aFailures(bundle.a2a);
    const server = createBanglaClawMcpServer({
      runtime: bundle.runtime,
      agentName: config.agent.name,
      version: VERSION,
      maxInputChars: config.gateway.maxInputChars,
      skills: bundle.skills,
      allowedTools: bundle.registry.list().filter((t) => bundle.policy.check(t).allowed).map((t) => t.name),
      model: () => bundle.providers.current().id,
      ...(bundle.knowledge.kb !== undefined && { knowledge: { kb: bundle.knowledge.kb, searchLimit: config.knowledge.searchLimit, minScore: config.knowledge.minScore } }),
    });
    const transport = new StdioServerTransport();
    const closed = new Promise<void>((resolve) => {
      transport.onclose = () => resolve();
      process.stdin.once("end", () => resolve());
      process.once("SIGINT", () => resolve());
      process.once("SIGTERM", () => resolve());
    });
    await server.connect(transport);
    process.stderr.write(`banglaclaw MCP server ${VERSION} ready on stdio (model ${bundle.providerId})\n`);
    await closed;
    await server.close();
  } finally {
    await services.close();
  }
}
