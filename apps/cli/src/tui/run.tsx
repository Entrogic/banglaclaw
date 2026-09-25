import { render } from "ink";
import type { Session } from "@banglaclaw/session";
import type { RuntimeBundle } from "../bootstrap.js";
import { App } from "./App.js";

/** Runs the chat TUI until the user quits; returns the last active session. */
export async function runTui(bundle: RuntimeBundle, initial: { session: Session; created: boolean }): Promise<Session> {
  let last = initial.session;
  const app = render(<App bundle={bundle} initial={initial.session} onExit={(s) => (last = s)} />, { exitOnCtrlC: false });
  await app.waitUntilExit();
  return last;
}
