import type { AdminKey, AdminSession, AdminStats, AuditEvent, Features, KnowledgeHit, Me, Memory, Message, Run, RunResponse, Session, SessionEvent, StreamEvent, WorkspaceEntry } from "./types.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class BanglaClawApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "BanglaClawApiError";
  }
}

export interface ClientOptions {
  /** Gateway base URL, e.g. http://127.0.0.1:3000 */
  baseUrl: string;
  /** bck_… API key. */
  apiKey: string;
  fetch?: FetchLike;
  /** Extra headers on every request (e.g. X-Request-Id). */
  headers?: Record<string, string>;
}

export interface RunOptions {
  sessionId?: string;
  externalId?: string;
  signal?: AbortSignal;
}

/** Parses a Server-Sent Events byte stream into {event, data} objects. Ends when `signal` aborts. */
export async function* parseSSE(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const stop = () => void reader.cancel().catch(() => undefined);
  if (signal?.aborted === true) stop();
  signal?.addEventListener("abort", stop, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value !== undefined) buffer += decoder.decode(value, { stream: true });
      if (done) buffer += decoder.decode();
      let boundary: number;
      while ((boundary = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        let event = "message";
        const data: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (data.length > 0) yield { event, data: data.join("\n") };
      }
      if (done) return;
    }
  } finally {
    // Also runs when the consumer stops early (break/return): release the connection.
    signal?.removeEventListener("abort", stop);
    stop();
  }
}

/** Typed client for the BanglaClaw gateway (docs/18). Works in Node 18+, browsers, Deno and Bun. */
export class BanglaClawClient {
  readonly #base: string;
  readonly #fetch: FetchLike;
  readonly #headers: Record<string, string>;

  constructor(options: ClientOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#headers = { Authorization: `Bearer ${options.apiKey}`, ...options.headers };
  }

  async #request(method: string, path: string, body?: unknown, init: { signal?: AbortSignal; accept?: string } = {}): Promise<Response> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers: {
        ...this.#headers,
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(init.accept !== undefined && { Accept: init.accept }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      ...(init.signal !== undefined && { signal: init.signal }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; requestId?: string } };
      throw new BanglaClawApiError(res.status, err.error?.code ?? "http_error", err.error?.message ?? res.statusText, err.error?.requestId ?? res.headers.get("x-request-id") ?? undefined);
    }
    return res;
  }

  /** POSTs raw bytes (uploads, audio) and parses the JSON answer. */
  async #binary<T>(path: string, data: Uint8Array | Blob, contentType: string): Promise<T> {
    const res = await this.#fetch(`${this.#base}${path}`, { method: "POST", headers: { ...this.#headers, "Content-Type": contentType }, body: data });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string; requestId?: string } };
      throw new BanglaClawApiError(res.status, err.error?.code ?? "http_error", err.error?.message ?? res.statusText, err.error?.requestId ?? res.headers.get("x-request-id") ?? undefined);
    }
    return (await res.json()) as T;
  }

  async #json<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.#request(method, path, body, signal !== undefined ? { signal } : {});
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async *#stream(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const res = await this.#request("POST", path, body, { accept: "text/event-stream", ...(signal !== undefined && { signal }) });
    if (res.body === null) return;
    for await (const { event, data } of parseSSE(res.body)) yield { event, data: JSON.parse(data) } as StreamEvent;
  }

  async *#sessionEvents(id: string, signal?: AbortSignal): AsyncGenerator<SessionEvent> {
    const res = await this.#request("GET", `/v1/sessions/${enc(id)}/events`, undefined, { accept: "text/event-stream", ...(signal !== undefined && { signal }) });
    if (res.body === null) return;
    try {
      for await (const { event, data } of parseSSE(res.body, signal)) {
        if (event === "operator_message" || event === "handoff_released") yield JSON.parse(data) as SessionEvent;
      }
    } catch (error) {
      if (signal?.aborted) return;
      throw error;
    }
  }

  health(): Promise<{ status: string; version: string }> {
    return this.#json("GET", "/health");
  }

  me(): Promise<Me> {
    return this.#json("GET", "/v1/me");
  }

  agents(): Promise<{ agents: { id: string; model: string; tools: string[]; skills: string[] }[] }> {
    return this.#json("GET", "/v1/agents");
  }

  tools(): Promise<{ tools: { name: string; description: string; risk: string; allowed: boolean }[] }> {
    return this.#json("GET", "/v1/tools");
  }

  skills(): Promise<{ skills: { name: string; description: string; version: string; tools: string[]; triggers: string[] }[] }> {
    return this.#json("GET", "/v1/skills");
  }

  /** Runs the agent and waits for the reply. Resumes `sessionId`/`externalId` or creates a session. */
  run(text: string, options: RunOptions = {}): Promise<RunResponse> {
    const { signal, ...rest } = options;
    return this.#json("POST", "/v1/agents/run", { text, ...rest }, signal);
  }

  /** Streams run events (tokens, tool calls, transfers…) ending with `done`. */
  stream(text: string, options: RunOptions = {}): AsyncGenerator<StreamEvent> {
    const { signal, ...rest } = options;
    return this.#stream("/v1/agents/run", { text, ...rest }, signal);
  }

  readonly sessions = {
    create: (options: { externalId?: string } = {}): Promise<{ session: Session; created: boolean }> => this.#json("POST", "/v1/sessions", options),
    /** `q` matches the title, a session id prefix or the external id. */
    list: (options: { limit?: number; q?: string } = {}): Promise<{ sessions: Session[] }> => this.#json("GET", `/v1/sessions${query(options)}`),
    /** Renames a session; null clears the title. */
    rename: (id: string, title: string | null): Promise<{ session: Session }> => this.#json("PATCH", `/v1/sessions/${enc(id)}`, { title }),
    /** Deletes a session with its messages and runs. */
    delete: (id: string): Promise<void> => this.#json("DELETE", `/v1/sessions/${enc(id)}`),
    get: (id: string): Promise<{ session: Session; messageCount: number }> => this.#json("GET", `/v1/sessions/${enc(id)}`),
    messages: (id: string, options: { limit?: number } = {}): Promise<{ sessionId: string; messages: Message[] }> =>
      this.#json("GET", `/v1/sessions/${enc(id)}/messages${query(options)}`),
    send: (id: string, text: string, signal?: AbortSignal): Promise<RunResponse> => this.#json("POST", `/v1/sessions/${enc(id)}/messages`, { text }, signal),
    stream: (id: string, text: string, signal?: AbortSignal): AsyncGenerator<StreamEvent> => this.#stream(`/v1/sessions/${enc(id)}/messages`, { text }, signal),
    runs: (id: string, options: { limit?: number } = {}): Promise<{ runs: Run[] }> => this.#json("GET", `/v1/sessions/${enc(id)}/runs${query(options)}`),
    /** Follows a session: operator replies and handoff releases as they happen, until `signal` aborts. */
    events: (id: string, options: { signal?: AbortSignal } = {}): AsyncGenerator<SessionEvent> => this.#sessionEvents(id, options.signal),
  };

  /** Optional features of this gateway (workspace, uploads, transcription). */
  features(): Promise<Features> {
    return this.#json("GET", "/v1/features");
  }

  /** Speech to text (the gateway needs voice.enabled). */
  transcribe(audio: Uint8Array | Blob, mimeType: string, options: { language?: string } = {}): Promise<{ text: string }> {
    return this.#binary(`/v1/transcriptions${query(options)}`, audio, mimeType);
  }

  /** The caller's workspace files (docs/24). */
  readonly workspace = {
    list: (path?: string): Promise<{ entries: WorkspaceEntry[]; truncated: boolean }> => this.#json("GET", `/v1/workspace/files${query(path === undefined ? {} : { path })}`),
    read: (path: string): Promise<{ path: string; content: string; totalLines: number; truncated: boolean }> => this.#json("GET", `/v1/workspace/file${query({ path })}`),
    delete: (path: string): Promise<{ path: string; trashed: string }> => this.#json("DELETE", `/v1/workspace/file${query({ path })}`),
    history: (path: string): Promise<{ path: string; versions: { version: number; savedAt: string; size: number }[]; inTrash: boolean }> =>
      this.#json("GET", `/v1/workspace/history${query({ path })}`),
    restore: (path: string, version?: number): Promise<{ path: string; restoredFrom: "history" | "trash"; bytes: number }> =>
      this.#json("POST", "/v1/workspace/restore", { path, ...(version !== undefined && { version }) }),
    /** Stores a file under uploads/ (PDF, DOCX and HTML as text). */
    upload: (filename: string, data: Uint8Array | Blob): Promise<{ path: string; characters: number }> =>
      this.#binary(`/v1/workspace/uploads${query({ filename })}`, data, "application/octet-stream"),
  };

  readonly runs = {
    get: (id: string): Promise<{ run: Run }> => this.#json("GET", `/v1/runs/${enc(id)}`),
  };

  readonly knowledge = {
    search: (q: string, options: { limit?: number } = {}): Promise<{ results: KnowledgeHit[] }> => this.#json("GET", `/v1/knowledge/search${query({ q, ...options })}`),
    documents: (): Promise<{ documents: { documentId: string; source: string; title: string; chunkCount: number; ingestedAt: string }[] }> =>
      this.#json("GET", "/v1/knowledge/documents"),
  };

  readonly memories = {
    list: (): Promise<{ memories: Memory[] }> => this.#json("GET", "/v1/memories"),
    delete: (id: string): Promise<void> => this.#json("DELETE", `/v1/memories/${enc(id)}`),
  };

  /** Operator role required. */
  readonly handoffs = {
    list: (options: { limit?: number } = {}): Promise<{ handoffs: Session[] }> => this.#json("GET", `/v1/handoffs${query(options)}`),
    get: (id: string, options: { limit?: number } = {}): Promise<{ session: Session; messages: Message[] }> => this.#json("GET", `/v1/handoffs/${enc(id)}${query(options)}`),
    reply: (id: string, text: string): Promise<{ delivered: boolean; runId: string }> => this.#json("POST", `/v1/handoffs/${enc(id)}/reply`, { text }),
    release: (id: string): Promise<{ session: Session }> => this.#json("POST", `/v1/handoffs/${enc(id)}/release`, {}),
  };

  /** Admin role required. */
  readonly admin = {
    stats: (options: { days?: number } = {}): Promise<AdminStats> => this.#json("GET", `/v1/admin/stats${query(options)}`),
    sessions: (options: { limit?: number; status?: "active" | "handoff"; channel?: string; q?: string } = {}): Promise<{ sessions: AdminSession[] }> =>
      this.#json("GET", `/v1/admin/sessions${query(options)}`),
    session: (id: string, options: { limit?: number } = {}): Promise<{ session: Session; messages: Message[]; runs: Run[] }> =>
      this.#json("GET", `/v1/admin/sessions/${enc(id)}${query(options)}`),
    keys: (): Promise<{ keys: AdminKey[] }> => this.#json("GET", "/v1/admin/keys"),
    createKey: (body: { user: string; name?: string; role?: "user" | "operator" | "admin"; scopes?: ("read" | "run")[] }): Promise<{ key: Omit<AdminKey, "status" | "createdAt">; token: string }> =>
      this.#json("POST", "/v1/admin/keys", body),
    revokeKey: (id: string): Promise<{ revoked: string }> => this.#json("POST", `/v1/admin/keys/${enc(id)}/revoke`, {}),
  };

  /** Admin role required. */
  readonly audit = {
    list: (options: { action?: string; limit?: number } = {}): Promise<{ events: AuditEvent[] }> => this.#json("GET", `/v1/audit${query(options)}`),
  };
}

function enc(id: string): string {
  return encodeURIComponent(id);
}

function query(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter((e): e is [string, string | number] => e[1] !== undefined);
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}
