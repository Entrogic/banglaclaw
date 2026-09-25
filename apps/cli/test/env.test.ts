import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDotEnv } from "../src/env.js";

describe("loadDotEnv", () => {
  it("loads missing variables without overriding the shell", () => {
    const dir = mkdtempSync(join(tmpdir(), "banglaclaw-env-"));
    writeFileSync(join(dir, ".env"), "# comment\nOPENAI_API_KEY=from-file\nBANGLACLAW_MODEL=file-model\nEMPTY=\n");
    const env: NodeJS.ProcessEnv = { BANGLACLAW_MODEL: "shell-model" };
    expect(loadDotEnv(dir, env)).toBe(join(dir, ".env"));
    expect(env).toEqual({ OPENAI_API_KEY: "from-file", BANGLACLAW_MODEL: "shell-model", EMPTY: "" });
  });

  it("does nothing without a .env file", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadDotEnv(mkdtempSync(join(tmpdir(), "banglaclaw-env-")), env)).toBeUndefined();
    expect(env).toEqual({});
  });
});
