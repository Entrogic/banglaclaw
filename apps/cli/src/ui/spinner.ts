import { isJson, isQuiet } from "./output.js";
import { c, sym } from "./theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Shows a spinner on stderr while `task` runs (only on a TTY, never under --json/--quiet),
 * then a ✔/✖ line. Returns the task's result and rethrows its error.
 */
export async function withSpinner<T>(label: string, task: () => Promise<T>, options: { done?: (result: T) => string } = {}): Promise<T> {
  const live = process.stderr.isTTY === true && !isJson() && !isQuiet();
  if (!live) return task();
  let frame = 0;
  const render = () => process.stderr.write(`\r\x1b[2K${c.cyan(FRAMES[frame++ % FRAMES.length] ?? "")} ${label}`);
  render();
  const timer = setInterval(render, 80);
  try {
    const result = await task();
    clearInterval(timer);
    process.stderr.write(`\r\x1b[2K${c.green(sym.ok)} ${options.done?.(result) ?? label}\n`);
    return result;
  } catch (error) {
    clearInterval(timer);
    process.stderr.write(`\r\x1b[2K${c.red(sym.fail)} ${label}\n`);
    throw error;
  }
}
