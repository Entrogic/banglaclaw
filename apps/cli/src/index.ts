#!/usr/bin/env node
import { initTelemetry } from "@entrogic-net/observability";
import { loadDotEnv } from "./env.js";
import { buildProgram } from "./program.js";
import { EXIT, printError, toCliError } from "./ui/errors.js";
import { VERSION } from "./version.js";

// `banglaclaw … | head` closes the pipe early: exit quietly instead of crashing on EPIPE.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}

loadDotEnv();
const telemetry = initTelemetry({ serviceName: "banglaclaw", version: VERSION });

try {
  await buildProgram().parseAsync();
} catch (error) {
  const cli = toCliError(error);
  // Run errors were already rendered by the event stream; everything else is printed here.
  if (cli.code !== "run_failed") printError(cli);
  process.exitCode = cli.exitCode;
} finally {
  await telemetry.shutdown();
}
if (process.exitCode === undefined) process.exitCode = EXIT.OK;
