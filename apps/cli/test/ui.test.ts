import { describe, expect, it } from "vitest";
import { BanglaClawError, ConfigError } from "@entrogic-net/shared";
import { EXIT, toCliError } from "../src/ui/errors.js";
import { table, truncate } from "../src/ui/table.js";
import { setColor } from "../src/ui/theme.js";
import stringWidth from "string-width";

setColor(false);

describe("table", () => {
  it("aligns by display width, including Bangla", () => {
    const out = table(
      [
        { name: "calculator", note: "হিসাব" },
        { name: "time", note: "সময় বলুন" },
      ],
      [
        { header: "NAME", value: (r) => r.name },
        { header: "NOTE", value: (r) => r.note },
      ],
    ).split("\n");
    expect(out[0]).toBe("NAME        NOTE");
    const col = stringWidth("calculator  ");
    for (const line of out) expect(stringWidth(line.slice(0, line.indexOf(line.trim().split(/\s{2,}/)[1] ?? "")))).toBe(col);
  });

  it("shrinks the flexible column to the terminal width", () => {
    const out = table([{ a: "id-1", b: "x".repeat(200) }], [
      { header: "A", value: (r) => r.a },
      { header: "B", value: (r) => r.b, shrink: true },
    ], { maxWidth: 40 });
    for (const line of out.split("\n")) expect(stringWidth(line)).toBeLessThanOrEqual(40);
    expect(out).toContain("…");
  });

  it("truncates on grapheme boundaries", () => {
    const t = truncate("বাংলাদেশ আমার দেশ", 6);
    expect(stringWidth(t)).toBeLessThanOrEqual(6);
    expect(t.endsWith("…")).toBe(true);
    expect(truncate("short", 10)).toBe("short");
  });
});

describe("toCliError", () => {
  it("maps errors to hints and exit codes", () => {
    expect(toCliError(new ConfigError("OPENAI_API_KEY is not set"))).toMatchObject({ exitCode: EXIT.CONFIG, hint: expect.stringContaining("banglaclaw init") });
    expect(toCliError(new ConfigError("Database schema is behind (1/5 migrations)"))).toMatchObject({ exitCode: EXIT.CONFIG, hint: expect.stringContaining("db migrate") });
    expect(toCliError(new BanglaClawError("STORAGE_REQUIRED", "x"))).toMatchObject({ exitCode: EXIT.PREREQUISITE, code: "storage_required" });
    expect(toCliError(new BanglaClawError("KNOWLEDGE_DISABLED", "x")).hint).toContain("init");
    expect(toCliError(new Error("boom"))).toMatchObject({ exitCode: EXIT.ERROR, message: "boom" });
    expect(toCliError(Object.assign(new Error("aborted"), { name: "AbortError" })).exitCode).toBe(EXIT.CANCELLED);
  });
});
