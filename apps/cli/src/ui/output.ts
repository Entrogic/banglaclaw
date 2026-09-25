import { c, sym } from "./theme.js";

interface OutputState {
  json: boolean;
  quiet: boolean;
}

const state: OutputState = { json: false, quiet: false };

export function configureOutput(options: Partial<OutputState>): void {
  if (options.json !== undefined) state.json = options.json;
  if (options.quiet !== undefined) state.quiet = options.quiet;
}

export function isJson(): boolean {
  return state.json;
}

export function isQuiet(): boolean {
  return state.quiet;
}

/** Prints `data` as JSON under --json, otherwise calls the human renderer. */
export function emit<T>(data: T, human: (data: T) => void): void {
  if (state.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else human(data);
}

/** A line of human output on stdout (suppressed by --json and --quiet). */
export function print(line = ""): void {
  if (!state.json && !state.quiet) process.stdout.write(`${line}\n`);
}

/** A line of human output that must survive --quiet (e.g. a one-time API token). */
export function printAlways(line = ""): void {
  if (!state.json) process.stdout.write(`${line}\n`);
}

/** Secondary information on stderr so it never pollutes piped stdout. */
export function note(line: string): void {
  if (!state.json && !state.quiet) process.stderr.write(`${c.dim(line)}\n`);
}

export function warn(line: string): void {
  if (!state.json) process.stderr.write(`${c.yellow(`${sym.warn} ${line}`)}\n`);
}

export function success(line: string): void {
  print(`${c.green(sym.ok)} ${line}`);
}

export function empty(message: string): void {
  print(c.dim(message));
}
