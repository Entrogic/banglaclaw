import { z } from "zod";
import { defineTool } from "../tool.js";

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

export function normalizeDigits(text: string): string {
  return text.replace(/[০-৯]/g, (d) => String(BANGLA_DIGITS.indexOf(d)));
}

type Token = { kind: "num"; value: number } | { kind: "op"; value: string };

function tokenize(input: string): Token[] {
  const src = normalizeDigits(input).replace(/×/g, "*").replace(/÷/g, "/");
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const match = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
      if (match === null) throw new Error(`Invalid number at position ${i}`);
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
    } else if ("+-*/%^()".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i++;
    } else {
      throw new Error(`Unexpected character "${ch}" at position ${i}`);
    }
  }
  return tokens;
}

/**
 * Evaluates arithmetic with + - * / % ^ and parentheses via recursive descent.
 * Never uses eval/Function — only numbers and operators are accepted.
 */
export function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error("Empty expression");
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const isOp = (value: string): boolean => {
    const t = peek();
    return t?.kind === "op" && t.value === value;
  };

  // expr := term (('+' | '-') term)*
  const expr = (): number => {
    let value = term();
    while (isOp("+") || isOp("-")) {
      const op = (tokens[pos++] as Token).value;
      const rhs = term();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  };

  // term := unary (('*' | '/' | '%') unary)*
  const term = (): number => {
    let value = unary();
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = (tokens[pos++] as Token).value;
      const rhs = unary();
      if ((op === "/" || op === "%") && rhs === 0) throw new Error("Division by zero");
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
    return value;
  };

  // unary := ('-' | '+') unary | power
  const unary = (): number => {
    if (isOp("-")) {
      pos++;
      return -unary();
    }
    if (isOp("+")) {
      pos++;
      return unary();
    }
    return power();
  };

  // power := primary ('^' unary)?   (right-associative)
  const power = (): number => {
    const base = primary();
    if (isOp("^")) {
      pos++;
      return base ** unary();
    }
    return base;
  };

  // primary := number | '(' expr ')'
  const primary = (): number => {
    const t = peek();
    if (t === undefined) throw new Error("Unexpected end of expression");
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.value === "(") {
      pos++;
      const value = expr();
      if (!isOp(")")) throw new Error("Missing closing parenthesis");
      pos++;
      return value;
    }
    throw new Error(`Unexpected "${t.value}"`);
  };

  const result = expr();
  if (pos !== tokens.length) throw new Error(`Unexpected "${(tokens[pos] as Token).value}"`);
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}

export const calculatorTool = defineTool({
  name: "calculator",
  description:
    "Evaluate an arithmetic expression. Supports + - * / % ^ and parentheses. Bangla digits (০-৯) are accepted. Use this for any non-trivial math.",
  risk: "safe",
  timeoutMs: 1_000,
  inputSchema: z.strictObject({
    expression: z.string().min(1).max(500).describe("Arithmetic expression, e.g. (12.5 + 7) * 3"),
  }),
  outputSchema: z.strictObject({ expression: z.string(), result: z.number() }),
  async execute({ expression }) {
    return { expression, result: evaluateExpression(expression) };
  },
});
