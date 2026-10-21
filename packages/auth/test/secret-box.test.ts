import { describe, expect, it } from "vitest";
import { ConfigError } from "@entrogic-net/shared";
import { SecretBox } from "../src/index.js";

const SECRET = "x".repeat(32);

describe("SecretBox", () => {
  it("round-trips and never repeats a ciphertext", () => {
    const box = new SecretBox(SECRET);
    const a = box.encrypt("sk-live-কী", "row-1");
    const b = box.encrypt("sk-live-কী", "row-1");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain("sk-live");
    expect(box.decrypt(a, "row-1")).toBe("sk-live-কী");
  });

  it("rejects another key, another row and tampering", () => {
    const box = new SecretBox(SECRET);
    const sealed = box.encrypt("secret", "row-1");
    expect(() => new SecretBox("y".repeat(32)).decrypt(sealed, "row-1")).toThrow();
    expect(() => box.decrypt(sealed, "row-2")).toThrow();
    const parts = sealed.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => box.decrypt(parts.join(":"), "row-1")).toThrow();
    expect(() => box.decrypt("garbage", "row-1")).toThrow(/format/);
  });

  it("requires a long enough secret", () => {
    expect(() => new SecretBox("short")).toThrow(ConfigError);
  });
});
