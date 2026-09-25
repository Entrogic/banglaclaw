import { describe, expect, it } from "vitest";
import { ApiKeyAuthenticator, InMemoryAuthStore, generateApiKey, hashSecret, parseApiKey, verifySecret } from "../src/index.js";

describe("API keys", () => {
  it("generates parseable tokens whose secret matches the stored hash", () => {
    const key = generateApiKey();
    expect(key.token).toMatch(/^bck_[0-9a-z]{12}_[0-9A-Za-z]{40}$/);
    const parsed = parseApiKey(key.token);
    expect(parsed?.id).toBe(key.id);
    expect(verifySecret(parsed?.secret ?? "", key.hash)).toBe(true);
    expect(verifySecret("x".repeat(40), key.hash)).toBe(false);
    expect(key.hash).toBe(hashSecret(parsed?.secret ?? ""));
    expect(generateApiKey().token).not.toBe(key.token);
  });

  it.each(["", "Bearer x", "bck_short_secret", `sk_${"a".repeat(12)}_${"b".repeat(40)}`, `bck_${"A".repeat(12)}_${"b".repeat(40)}`])(
    "rejects malformed token %j",
    (token) => {
      expect(parseApiKey(token)).toBeUndefined();
    },
  );
});

describe("ApiKeyAuthenticator", () => {
  it("issues, authenticates and revokes keys", async () => {
    const store = new InMemoryAuthStore();
    const auth = new ApiKeyAuthenticator(store);
    const issued = await auth.issueKey("shop-bot", "prod");
    expect(issued.key).not.toHaveProperty("hash");
    expect(issued.key.scopes).toEqual(["read", "run"]);
    expect((await auth.issueKey("reader", "ro", undefined, ["read", "read"])).key.scopes).toEqual(["read"]);

    const principal = await auth.authenticate(issued.token);
    expect(principal).toMatchObject({ user: { name: "shop-bot" }, key: { id: issued.key.id, name: "prod" } });
    expect((await store.getApiKey(issued.key.id))?.lastUsedAt).toBeInstanceOf(Date);

    const second = await auth.issueKey("shop-bot", "staging");
    expect(second.user.id).toBe(issued.user.id);
    expect(await store.listApiKeys({ userId: issued.user.id })).toHaveLength(2);

    expect(await store.revokeApiKey(issued.key.id)).toBe(true);
    expect(await store.revokeApiKey(issued.key.id)).toBe(false);
    expect(await auth.authenticate(issued.token)).toBeUndefined();
    expect(await auth.authenticate(second.token)).toBeDefined();
  });

  it("orders roles", async () => {
    const { hasRole } = await import("../src/index.js");
    const u = (role: "user" | "operator" | "admin") => ({ id: "1", name: "x", role, createdAt: new Date() });
    expect(hasRole(u("user"), "operator")).toBe(false);
    expect(hasRole(u("operator"), "operator")).toBe(true);
    expect(hasRole(u("admin"), "operator")).toBe(true);
    expect(hasRole(u("operator"), "admin")).toBe(false);
  });

  it("rejects unknown, tampered and missing tokens", async () => {
    const auth = new ApiKeyAuthenticator(new InMemoryAuthStore());
    const { token } = await auth.issueKey("u");
    const tampered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await auth.authenticate(tampered)).toBeUndefined();
    expect(await auth.authenticate(generateApiKey().token)).toBeUndefined();
    expect(await auth.authenticate(undefined)).toBeUndefined();
  });
});
