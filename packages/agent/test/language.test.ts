import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/index.js";

describe("detectLanguage", () => {
  it.each([
    ["আমি ভালো আছি", "bn"],
    ["২৫ * ৪ কত?", "bn"],
    ["আজকের weather কেমন?", "bn"],
    ["ami bhalo achi", "bn-en"],
    ["ekhon koyta baje?", "bn-en"],
    ["bhai, eta ki possible?", "bn-en"],
    ["kemon acho", "bn-en"],
    ["Please check this code, আজকেই লাগবে", "bn-en"],
    ["What time is it in Dhaka?", "en"],
    ["Calculate 25 times 4", "en"],
    ["I do not know", "en"],
    ["O Romeo", "en"],
    ["12345 + 6", "en"],
    ["", "en"],
  ])("%j → %s", (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });
});
