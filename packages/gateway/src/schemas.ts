import { z } from "zod";

export function runBody(maxInputChars: number) {
  return z.strictObject({
    text: z.string().trim().min(1, "text is required").max(maxInputChars, `text is limited to ${maxInputChars} characters`),
    sessionId: z.uuid().optional(),
    externalId: z.string().min(1).max(200).optional(),
  });
}

export function messageBody(maxInputChars: number) {
  return z.strictObject({
    text: z.string().trim().min(1, "text is required").max(maxInputChars, `text is limited to ${maxInputChars} characters`),
  });
}

export const createSessionBody = z.strictObject({ externalId: z.string().min(1).max(200).optional() });

export const limitQuery = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).catch(fallback);
