import { z } from "zod";
import { defineTool } from "../tool.js";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function createDatetimeTool(now: () => Date = () => new Date()) {
  return defineTool({
    name: "current_datetime",
    description:
      "Get the current date and time. Optionally pass an IANA timezone (e.g. Asia/Dhaka, Europe/London); defaults to the configured timezone.",
    risk: "safe",
    timeoutMs: 1_000,
    inputSchema: z.strictObject({
      timezone: z.string().refine(isValidTimeZone, "Unknown IANA timezone").optional(),
    }),
    outputSchema: z.strictObject({
      iso: z.string(),
      timezone: z.string(),
      english: z.string(),
      bangla: z.string(),
    }),
    async execute({ timezone }, ctx) {
      const tz = timezone ?? ctx.timezone;
      const date = now();
      const options: Intl.DateTimeFormatOptions = { timeZone: tz, dateStyle: "full", timeStyle: "short" };
      return {
        iso: date.toISOString(),
        timezone: tz,
        english: new Intl.DateTimeFormat("en-GB", options).format(date),
        bangla: new Intl.DateTimeFormat("bn-BD", options).format(date),
      };
    },
  });
}

export const datetimeTool = createDatetimeTool();
