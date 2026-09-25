import { z } from "zod";
import type { AudioInput, Transcriber } from "@banglaclaw/shared";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class TranscriptionError extends Error {
  constructor(status: number, detail: string) {
    super(`Transcription failed (${status}): ${detail}`);
    this.name = "TranscriptionError";
  }
}

export interface OpenAICompatibleTranscriberOptions {
  model: string;
  /** Omit for keyless self-hosted servers. */
  apiKey?: string;
  /** Default https://api.openai.com/v1; any server with POST /audio/transcriptions works. */
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

/** Speech to text over the OpenAI-compatible /audio/transcriptions endpoint (Whisper and successors). */
export class OpenAICompatibleTranscriber implements Transcriber {
  readonly id: string;
  readonly #o: OpenAICompatibleTranscriberOptions;
  readonly #fetch: FetchLike;

  constructor(options: OpenAICompatibleTranscriberOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.id = `openai-compatible:${options.model}`;
  }

  async transcribe(audio: AudioInput, options: { language?: string; signal?: AbortSignal } = {}): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([audio.data.slice()], { type: audio.mimeType }), audio.filename);
    form.append("model", this.#o.model);
    form.append("response_format", "json");
    if (options.language !== undefined) form.append("language", options.language);
    const timeout = AbortSignal.timeout(this.#o.timeoutMs ?? 60_000);
    const res = await this.#fetch(`${(this.#o.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: this.#o.apiKey !== undefined ? { Authorization: `Bearer ${this.#o.apiKey}` } : {},
      body: form,
      signal: options.signal !== undefined ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!res.ok) throw new TranscriptionError(res.status, (await res.text()).slice(0, 300));
    const body = z.object({ text: z.string() }).safeParse(await res.json().catch(() => undefined));
    if (!body.success) throw new TranscriptionError(res.status, "response has no text");
    return body.data.text.trim();
  }
}
