import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Workspace } from "@entrogic-net/workspace";
import { createGatewayApp, type GatewayUploads } from "../src/index.js";
import { makeDeps } from "./helpers.js";

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const json = (token: string, body: unknown, method = "POST"): RequestInit => ({ method, headers: { ...auth(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function setup() {
  const made = await makeDeps({ script: [{ content: "উত্তর" }] });
  const workspace = new Workspace(mkdtempSync(join(tmpdir(), "bc-gw-ws-")), { maxFileBytes: 10_000, maxFiles: 50, maxTotalBytes: 100_000, historyVersions: 3 });
  const uploads: GatewayUploads = {
    maxBytes: 1_000,
    save: async (owner, file) => {
      const text = new TextDecoder().decode(file.data);
      const path = `uploads/${file.filename}`;
      await workspace.create(owner, path, text);
      return { path, characters: text.length };
    },
  };
  const transcriber = { id: "fake", transcribe: async (audio: { data: Uint8Array; mimeType: string }) => `শুনেছি ${audio.data.byteLength} বাইট (${audio.mimeType})` };
  const app = createGatewayApp({ ...made.deps, workspace, uploads, transcriber, transcriptionLanguage: "bn" });
  const aliceId = (await (await app.request("/v1/me", { headers: auth(made.alice) })).json()) as { user: { id: string } };
  return { ...made, app, workspace, aliceOwner: `user:${aliceId.user.id}` };
}

describe("workspace API", () => {
  it("lists, reads, downloads, deletes and restores only the caller's files", async () => {
    const { app, alice, bob, workspace, aliceOwner } = await setup();
    await workspace.write(aliceOwner, "notes/todo.md", "v1");
    await workspace.write(aliceOwner, "notes/todo.md", "- চাল\n- ডাল");

    const list = (await (await app.request("/v1/workspace/files", { headers: auth(alice) })).json()) as { entries: { path: string }[] };
    expect(list.entries.map((e) => e.path)).toEqual(["notes", "notes/todo.md"]);
    expect(await (await app.request("/v1/workspace/files", { headers: auth(bob) })).json()).toEqual({ entries: [], truncated: false });

    expect(await (await app.request("/v1/workspace/file?path=notes/todo.md", { headers: auth(alice) })).json()).toMatchObject({ content: "- চাল\n- ডাল" });
    const download = await app.request("/v1/workspace/file?path=notes/todo.md&download=1", { headers: auth(alice) });
    expect(download.headers.get("content-disposition")).toContain("filename*=UTF-8''todo.md");
    expect(await download.text()).toBe("- চাল\n- ডাল");

    expect((await app.request("/v1/workspace/file?path=notes/todo.md", { headers: auth(bob) })).status).toBe(404);
    expect((await app.request("/v1/workspace/file?path=../../etc/passwd", { headers: auth(alice) })).status).toBe(400);
    expect((await app.request("/v1/workspace/file", { headers: auth(alice) })).status).toBe(400);

    const history = (await (await app.request("/v1/workspace/history?path=notes/todo.md", { headers: auth(alice) })).json()) as { versions: unknown[] };
    expect(history.versions).toHaveLength(1);
    expect(await (await app.request("/v1/workspace/restore", json(alice, { path: "notes/todo.md" }))).json()).toMatchObject({ restoredFrom: "history" });
    expect((await workspace.read(aliceOwner, "notes/todo.md")).content).toBe("v1");

    expect(await (await app.request("/v1/workspace/file?path=notes/todo.md", { method: "DELETE", headers: auth(alice) })).json()).toMatchObject({ trashed: expect.stringContaining(".trash/") });
    expect((await app.request("/v1/workspace/file?path=notes/todo.md", { headers: auth(alice) })).status).toBe(404);
    expect(await (await app.request("/v1/workspace/restore", json(alice, { path: "notes/todo.md" }))).json()).toMatchObject({ restoredFrom: "trash" });
  });

  it("uploads files into the caller's uploads/ folder within the size limit", async () => {
    const { app, alice, workspace, aliceOwner } = await setup();
    const res = await app.request("/v1/workspace/uploads?filename=list.csv", { method: "POST", headers: { ...auth(alice), "Content-Type": "application/octet-stream" }, body: "item,price\nচাল,৫০" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ path: "uploads/list.csv", characters: 17 });
    expect((await workspace.read(aliceOwner, "uploads/list.csv")).content).toBe("item,price\nচাল,৫০");
    const big = await app.request("/v1/workspace/uploads?filename=big.txt", { method: "POST", headers: { ...auth(alice), "Content-Type": "application/octet-stream" }, body: "x".repeat(2_000) });
    expect(big.status).toBe(413);
    expect((await app.request("/v1/workspace/uploads", { method: "POST", headers: auth(alice), body: "x" })).status).toBe(400);
  });

  it("reports features and answers 404 when they are off", async () => {
    const { app, alice } = await setup();
    expect(await (await app.request("/v1/features", { headers: auth(alice) })).json()).toEqual({ workspace: true, uploads: { maxBytes: 1_000 }, transcription: true });

    const { deps, alice: key } = await makeDeps();
    const bare = createGatewayApp(deps);
    expect(await (await bare.request("/v1/features", { headers: auth(key) })).json()).toEqual({ workspace: false, uploads: null, transcription: false });
    for (const [path, init] of [["/v1/workspace/files", {}], ["/v1/transcriptions", { method: "POST", body: "x" }], ["/v1/workspace/uploads?filename=a.txt", { method: "POST", body: "x" }]] as const) {
      expect((await bare.request(path, { ...init, headers: auth(key) })).status).toBe(404);
    }
  });
});

describe("transcriptions", () => {
  it("turns uploaded audio into text", async () => {
    const { app, alice } = await setup();
    const res = await app.request("/v1/transcriptions", { method: "POST", headers: { ...auth(alice), "Content-Type": "audio/webm;codecs=opus" }, body: new Uint8Array(1_234) });
    expect(await res.json()).toEqual({ text: "শুনেছি 1234 বাইট (audio/webm)" });
    expect((await app.request("/v1/transcriptions", { method: "POST", headers: { ...auth(alice), "Content-Type": "text/plain" }, body: "hi" })).status).toBe(415);
  });
});

describe("session management", () => {
  it("renames, searches and deletes the caller's own sessions", async () => {
    const { app, alice, bob, deps } = await setup();
    const { sessionId } = (await (await app.request("/v1/agents/run", json(alice, { text: "bKash payment" }))).json()) as { sessionId: string };

    expect((await app.request(`/v1/sessions/${sessionId}`, json(bob, { title: "stolen" }, "PATCH"))).status).toBe(404);
    const renamed = (await (await app.request(`/v1/sessions/${sessionId}`, json(alice, { title: "  পেমেন্ট   প্রশ্ন " }, "PATCH"))).json()) as { session: { title: string } };
    expect(renamed.session.title).toBe("পেমেন্ট প্রশ্ন");
    expect((await app.request(`/v1/sessions/${sessionId}`, json(alice, { title: "" }, "PATCH"))).status).toBe(400);

    const found = (await (await app.request("/v1/sessions?q=পেমেন্ট", { headers: auth(alice) })).json()) as { sessions: { id: string }[] };
    expect(found.sessions.map((s) => s.id)).toEqual([sessionId]);
    expect(await (await app.request("/v1/sessions?q=nothing", { headers: auth(alice) })).json()).toEqual({ sessions: [] });

    expect((await app.request(`/v1/sessions/${sessionId}`, { method: "DELETE", headers: auth(bob) })).status).toBe(404);
    expect((await app.request(`/v1/sessions/${sessionId}`, { method: "DELETE", headers: auth(alice) })).status).toBe(204);
    expect((await app.request(`/v1/sessions/${sessionId}`, { headers: auth(alice) })).status).toBe(404);
    expect(await deps.runs.listBySession(sessionId)).toEqual([]);
  });
});
