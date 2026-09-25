import { describe, expect, it } from "vitest";
import { OpenAICompatibleTranscriber, TranscriptionError } from "../src/index.js";

const audio = { data: new Uint8Array([1, 2, 3]), mimeType: "audio/ogg", filename: "voice.ogg" };

function stub(response: () => Response) {
  const requests: { url: string; auth: string | null; form: FormData }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    requests.push({ url, auth: new Headers(init?.headers).get("authorization"), form: init?.body as FormData });
    return response();
  };
  return { fetchFn, requests };
}

describe("OpenAICompatibleTranscriber", () => {
  it("posts the audio as multipart with model and language and returns the text", async () => {
    const { fetchFn, requests } = stub(() => Response.json({ text: "  আমার অর্ডার কোথায়?  " }));
    const t = new OpenAICompatibleTranscriber({ model: "whisper-1", apiKey: "sk-test", fetch: fetchFn });
    expect(t.id).toBe("openai-compatible:whisper-1");
    expect(await t.transcribe(audio, { language: "bn" })).toBe("আমার অর্ডার কোথায়?");
    const [req] = requests;
    expect(req?.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(req?.auth).toBe("Bearer sk-test");
    expect(req?.form.get("model")).toBe("whisper-1");
    expect(req?.form.get("language")).toBe("bn");
    const file = req?.form.get("file") as File;
    expect(file.name).toBe("voice.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(audio.data);
  });

  it("works keyless against a self-hosted base URL and reports errors", async () => {
    const ok = stub(() => Response.json({ text: "hi" }));
    await new OpenAICompatibleTranscriber({ model: "large-v3", baseUrl: "http://localhost:8000/v1/", fetch: ok.fetchFn }).transcribe(audio);
    expect(ok.requests[0]?.url).toBe("http://localhost:8000/v1/audio/transcriptions");
    expect(ok.requests[0]?.auth).toBeNull();
    expect(ok.requests[0]?.form.get("language")).toBeNull();

    const failing = stub(() => new Response("quota exceeded", { status: 429 }));
    await expect(new OpenAICompatibleTranscriber({ model: "whisper-1", apiKey: "k", fetch: failing.fetchFn }).transcribe(audio)).rejects.toThrow(TranscriptionError);
    const malformed = stub(() => Response.json({ nope: true }));
    await expect(new OpenAICompatibleTranscriber({ model: "whisper-1", apiKey: "k", fetch: malformed.fetchFn }).transcribe(audio)).rejects.toThrow("response has no text");
  });
});
