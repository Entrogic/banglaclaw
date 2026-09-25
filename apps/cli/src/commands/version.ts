import { existsSync } from "node:fs";
import { load, type GlobalOptions } from "../bootstrap.js";
import { emit, print } from "../ui/output.js";
import { c, sym } from "../ui/theme.js";
import { VERSION } from "../version.js";

export function version(options: GlobalOptions): void {
  let info: Record<string, string | undefined> = { cli: VERSION, node: process.versions.node, platform: `${process.platform}-${process.arch}` };
  try {
    const loaded = load(options);
    const m = loaded.config.models.default;
    info = { ...info, config: loaded.source ?? "(defaults)", model: `${m.provider}:${m.model}`, storage: loaded.config.storage.provider, env: existsSync(".env") ? ".env loaded" : undefined };
  } catch (error) {
    info.config = `invalid: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
  }
  emit(info, (i) => {
    print(`${c.bold(`${sym.paw} BanglaClaw ${i.cli}`)}`);
    for (const [k, v] of Object.entries(i)) if (k !== "cli" && v !== undefined) print(`  ${c.dim(k.padEnd(9))} ${v}`);
  });
}
