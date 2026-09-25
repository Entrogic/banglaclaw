import { createRuntime, type RuntimeBundle } from "../bootstrap.js";
import { createLineRenderer, plainChat } from "../chat-plain.js";
import { EXIT } from "../ui/errors.js";
import { emit, isJson, note } from "../ui/output.js";
import { prepareKnowledge, reportMcpFailures, resolveSession, type SessionOption } from "./shared.js";

async function openChat(options: SessionOption): Promise<{ bundle: RuntimeBundle; session: Awaited<ReturnType<typeof resolveSession>> }> {
  const bundle = await createRuntime(options);
  try {
    await prepareKnowledge(bundle.knowledge, false);
    const session = await resolveSession(bundle.runtime, bundle.services, options.session);
    return { bundle, session };
  } catch (error) {
    await bundle.services.close();
    throw error;
  }
}

/** `banglaclaw chat`: full-screen TUI in a terminal, line mode for pipes or with --plain. */
export async function chat(options: SessionOption & { plain?: boolean }): Promise<void> {
  const { bundle, session } = await openChat(options);
  const tui = options.plain !== true && process.stdin.isTTY === true && process.stdout.isTTY === true;
  let last = session.session;
  try {
    if (tui) {
      const { runTui } = await import("../tui/run.js");
      last = await runTui(bundle, session);
    } else {
      reportMcpFailures(bundle.mcp);
      last = await plainChat(bundle, session);
    }
  } finally {
    if (bundle.services.persistent) note(`Resume with: banglaclaw chat --session ${last.id}`);
    await bundle.services.close();
  }
}

/** `banglaclaw agent run`: one message, streamed reply (or the run record under --json). */
export async function agentRun(message: string, options: SessionOption): Promise<void> {
  const { bundle, session } = await openChat(options);
  const { runtime, services, mcp } = bundle;
  try {
    reportMcpFailures(mcp);
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    const json = isJson();
    const record = await runtime.run(message, {
      sessionId: session.session.id,
      signal: controller.signal,
      ...(!json && { onEvent: createLineRenderer() }),
    });
    emit({ sessionId: session.session.id, reply: record.output ?? "", run: record }, () => {
      if (services.persistent) note(`session ${session.session.id} · run ${record.id}`);
    });
    if (record.status === "limited") process.exitCode = EXIT.LIMIT;
  } finally {
    await services.close();
  }
}
