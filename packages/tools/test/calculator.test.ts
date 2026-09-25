import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../src/index.js";

describe("evaluateExpression", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["10 / 4", 2.5],
    ["10 % 3", 1],
    ["2 ^ 3 ^ 2", 512],
    ["-2 ^ 2", -4],
    ["-(3 - 5)", 2],
    [".5 + 1.25", 1.75],
    ["1e3 + 1", 1001],
    ["৫ × ৬", 30],
    ["২৫ * ৪", 100],
    ["১০০ ÷ ৮", 12.5],
  ])("%s = %d", (expr, expected) => {
    expect(evaluateExpression(expr)).toBeCloseTo(expected);
  });

  it.each([
    ["1 / 0", /Division by zero/],
    ["(1 + 2", /Missing closing parenthesis/],
    ["1 +", /Unexpected end/],
    ["", /Empty expression/],
    ["2 3", /Unexpected "3"|Unexpected/],
    ["process.exit()", /Unexpected character/],
    ["constructor.constructor('return 1')()", /Unexpected character/],
    ["9 ^ 999", /not a finite number/],
  ])("rejects %j", (expr, message) => {
    expect(() => evaluateExpression(expr)).toThrow(message);
  });
});
