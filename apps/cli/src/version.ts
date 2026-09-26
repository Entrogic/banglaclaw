import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Released version, shown by --version and reported in /health and metrics. Read from this
 * package's package.json (../package.json from both src/ and dist/), which Changesets bumps.
 */
export const VERSION = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))).version;
