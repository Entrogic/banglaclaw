#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

// stdout carries the MCP protocol; diagnostics go to stderr only.
const server = createServer();
await server.connect(new StdioServerTransport());
process.stderr.write("banglaclaw-bangladesh MCP server ready on stdio\n");
