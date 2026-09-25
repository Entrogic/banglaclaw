import { AgentRunError } from "@banglaclaw/agent";
import { BanglaClawError } from "@banglaclaw/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface ErrorBody {
  error: { code: string; message: string; requestId: string; runId?: string };
}

/** Maps any thrown value to a stable HTTP error. Unknown errors never leak internals. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof AgentRunError) {
    const { record } = error;
    if (record.status === "aborted") {
      return record.error?.startsWith("Run timed out") === true
        ? new HttpError(504, "run_timeout", record.error)
        : new HttpError(499 as ContentfulStatusCode, "run_cancelled", "Run cancelled");
    }
    return new HttpError(502, "run_failed", "The agent run failed (model provider error)");
  }
  if (error instanceof BanglaClawError) {
    switch (error.code) {
      case "SESSION_NOT_FOUND":
        return new HttpError(404, "session_not_found", "Session not found");
      case "EMPTY_INPUT":
        return new HttpError(400, "invalid_request", error.message);
      default:
        break;
    }
  }
  return new HttpError(500, "internal_error", "Internal server error");
}
