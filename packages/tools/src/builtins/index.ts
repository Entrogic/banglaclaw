import type { AnyTool } from "../tool.js";
import { calculatorTool } from "./calculator.js";
import { datetimeTool } from "./datetime.js";

export { calculatorTool, evaluateExpression, normalizeDigits } from "./calculator.js";
export { createDatetimeTool, datetimeTool } from "./datetime.js";

export const builtinTools: readonly AnyTool[] = [calculatorTool, datetimeTool];
