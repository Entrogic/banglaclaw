import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DocumentRejected } from "@entrogic-net/channels";
import type { Session } from "@entrogic-net/session";
import { Workspace } from "@entrogic-net/workspace";
import { createDocumentSaver, uploadName } from "../src/documents.js";

const session: Session = { id: "s1", channel: "telegram", externalId: "555", agentId: "banglaclaw", status: "active", createdAt: new Date(), updatedAt: new Date() };
const bytes = (s: string) => new TextEncoder().encode(s);

function setup(maxFileBytes = 10_000) {
  const root = mkdtempSync(join(tmpdir(), "bc-docs-"));
  const workspace = new Workspace(root, { maxFileBytes, maxFiles: 50, maxTotalBytes: 100_000, historyVersions: 2 });
  return { saver: createDocumentSaver(workspace, 1_000_000), folder: join(root, "telegram_555") };
}

describe("chat uploads", () => {
  it("saves text formats as they are under uploads/ in the sender's folder", async () => {
    const { saver, folder } = setup();
    expect(await saver.save(session, { filename: "দামের তালিকা.csv", data: bytes("item,price\nচাল,৫০") })).toEqual({ path: "uploads/দামের_তালিকা.csv", characters: 17 });
    expect(readFileSync(join(folder, "uploads", "দামের_তালিকা.csv"), "utf8")).toBe("item,price\nচাল,৫০");
  });

  it("stores HTML, PDF and DOCX as extracted text and never overwrites", async () => {
    const { saver, folder } = setup();
    expect((await saver.save(session, { filename: "page.html", data: bytes("<p>Hello</p>") })).path).toBe("uploads/page.txt");
    expect((await saver.save(session, { filename: "page.html", data: bytes("<p>Again</p>") })).path).toBe("uploads/page-2.txt");
    expect(readFileSync(join(folder, "uploads", "page-2.txt"), "utf8")).toBe("Again");
  });

  it("refuses unsupported types and text that doesn't fit the workspace", async () => {
    const { saver } = setup(10);
    await expect(saver.save(session, { filename: "setup.exe", data: bytes("MZ") })).rejects.toBeInstanceOf(DocumentRejected);
    await expect(saver.save(session, { filename: "big.txt", data: bytes("x".repeat(50)) })).rejects.toMatchObject({ reason: "tooLarge" });
  });

  it("cleans file names", () => {
    expect(uploadName("../../etc/passwd")).toBe("etcpasswd");
    expect(uploadName(".env")).toBe("env");
    expect(uploadName("my report (final).PDF")).toBe("my_report_final.PDF");
    expect(uploadName("???")).toBe("document");
  });
});
