import { readFileSync } from "node:fs";
import { z } from "zod";

const State = z.object({ baseUrl: z.string(), userKey: z.string(), adminKey: z.string(), dashboard: z.boolean() });

/** Keys and settings written by src/server.ts when the gateway started. */
export function e2eState(): z.infer<typeof State> {
  return State.parse(JSON.parse(readFileSync(process.env.E2E_STATE ?? new URL("../.state.json", import.meta.url), "utf8")));
}
