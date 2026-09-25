import { describe, expect, it } from "vitest";
import { InMemoryAuditStore, auditRecorder, createLogger } from "../src/index.js";

describe("audit", () => {
  it("stores and filters events, newest first", async () => {
    const store = new InMemoryAuditStore();
    await store.record({ action: "key.created", outcome: "success", actorId: "cli", target: "k1" });
    await store.record({ action: "auth.failed", outcome: "failure", ip: "10.0.0.1" });
    await store.record({ action: "key.revoked", outcome: "success", actorId: "cli", target: "k1" });
    expect((await store.list()).map((e) => e.action)).toEqual(["key.revoked", "auth.failed", "key.created"]);
    expect((await store.list({ action: "auth.failed" }))[0]).toMatchObject({ ip: "10.0.0.1", id: "2" });
    expect(await store.list({ actorId: "cli", limit: 1 })).toHaveLength(1);
  });

  it("never throws from the recorder", async () => {
    const lines: string[] = [];
    const record = auditRecorder({ record: () => Promise.reject(new Error("db down")), list: async () => [] }, createLogger({ level: "info", write: (l) => lines.push(l) }));
    expect(() => record({ action: "tool.denied", outcome: "denied", target: "shell" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(lines.some((l) => l.includes("audit write failed"))).toBe(true);
  });
});
