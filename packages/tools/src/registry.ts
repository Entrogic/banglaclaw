import { z } from "zod";
import type { ToolSpec } from "@entrogic-net/shared";
import type { AnyTool } from "./tool.js";

const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export class ToolRegistry {
  readonly #tools = new Map<string, AnyTool>();

  register(tool: AnyTool): this {
    if (!TOOL_NAME.test(tool.name)) {
      throw new Error(`Invalid tool name "${tool.name}": use snake_case (a-z, 0-9, _)`);
    }
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.#tools.set(tool.name, tool);
    return this;
  }

  get(name: string): AnyTool | undefined {
    return this.#tools.get(name);
  }

  list(): AnyTool[] {
    return [...this.#tools.values()];
  }

  /** Specs for the given tools (default: all), for binding to a chat model. */
  toSpecs(tools: AnyTool[] = this.list()): ToolSpec[] {
    return tools.map((tool) => {
      const parameters: Record<string, unknown> = { ...(tool.parameters ?? z.toJSONSchema(tool.inputSchema, { io: "input" })) };
      delete parameters.$schema;
      return {
        type: "function",
        function: { name: tool.name, description: tool.description, parameters },
      };
    });
  }
}
