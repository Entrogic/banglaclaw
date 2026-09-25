import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AgentRuntime } from "@banglaclaw/agent";
import { ApiKeyAuthenticator, InMemoryAuthStore } from "@banglaclaw/auth";
import { BanglaClawClient } from "@banglaclaw/client";
import { createGatewayApp } from "@banglaclaw/gateway";
import { FakeProvider } from "@banglaclaw/providers";
import { InMemoryRunStore, InMemorySessionStore } from "@banglaclaw/session";
import { InMemoryAuditStore, createLogger } from "@banglaclaw/shared";
import { SkillSet } from "@banglaclaw/skills";
import { AllowlistPolicy, ToolRegistry, builtinTools } from "@banglaclaw/tools";
import { App } from "../src/App";

/** A real gateway app with one completed run; the dashboard talks to it through `fetch`. */
async function setup() {
  const silent = createLogger({ write: () => {} });
  const sessions = new InMemorySessionStore();
  const runs = new InMemoryRunStore(sessions);
  const registry = new ToolRegistry();
  for (const tool of builtinTools) registry.register(tool);
  const policy = new AllowlistPolicy(["calculator"]);
  const provider = new FakeProvider([{ toolCalls: [{ name: "calculator", args: { expression: "6*7" } }] }, { content: "৪২", usage: { input: 120, output: 8 } }]);
  const runtime = new AgentRuntime({ provider, registry, policy, sessions, runs, limits: { maxIterations: 4, maxToolCalls: 4 }, timeoutMs: 5_000, timezone: "Asia/Dhaka", logger: silent });
  const audit = new InMemoryAuditStore();
  const auth = new ApiKeyAuthenticator(new InMemoryAuthStore());
  const user = await auth.issueKey("shop-bot");
  const admin = await auth.issueKey("ops", "laptop", "admin");
  const app = createGatewayApp({
    runtime, sessions, runs, auth, registry, policy, skills: new SkillSet([]), agent: { name: "banglaclaw", model: provider.id },
    config: { host: "127.0.0.1", port: 0, corsOrigins: [], maxInputChars: 1000, trustProxy: false, metrics: false, rateLimit: { requestsPerMinute: 1000, maxConcurrentRuns: 2 } },
    version: "test", logger: silent, timezone: "Asia/Dhaka", audit, pricing: { [provider.id]: { input: 1, output: 2 } },
  });
  const fetchViaApp = async (url: string, init?: RequestInit) => app.request(url.replace(window.location.origin, ""), init);
  const client = new BanglaClawClient({ baseUrl: window.location.origin, apiKey: user.token, fetch: fetchViaApp });
  const { sessionId } = await client.run("৬ গুণ ৭ কত?", { externalId: "chat-77" });
  return { fetchViaApp, userToken: user.token, adminToken: admin.token, sessionId, sessions, audit };
}

async function signIn(token: string) {
  fireEvent.change(screen.getByLabelText("API key"), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/admin/");
});
afterEach(cleanup);

describe("dashboard", () => {
  it("rejects non-admin keys and shows analytics for an admin", async () => {
    const { fetchViaApp, userToken, adminToken } = await setup();
    render(<App fetch={fetchViaApp} />);

    await signIn(userToken);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("needs an admin key"));
    expect(sessionStorage.length).toBe(0);

    await signIn(adminToken);
    await screen.findByRole("heading", { name: "Overview" });
    const runsTile = (await screen.findByText("Runs")).closest(".stat");
    expect(runsTile?.textContent).toContain("1");
    expect(screen.getByText("Estimated cost").closest(".stat")?.textContent).toContain("$0.0001");
    expect(screen.getByText("Top tools").closest(".card")?.textContent).toContain("calculator");
    expect(screen.getByText("Days in Asia/Dhaka")).toBeTruthy();
    expect(sessionStorage.getItem("banglaclaw.adminKey")).toBe(adminToken);
  });

  it("lists sessions and opens one", async () => {
    const { fetchViaApp, adminToken, sessionId } = await setup();
    sessionStorage.setItem("banglaclaw.adminKey", adminToken);
    window.history.replaceState(null, "", "/admin/sessions");
    render(<App fetch={fetchViaApp} />);

    const row = (await screen.findByText(sessionId.slice(0, 8))).closest("tr");
    if (row === null) throw new Error("no row");
    expect(row.textContent).toContain("shop-bot");
    expect(row.textContent).toContain("chat-77");
    fireEvent.click(row);

    await screen.findByRole("heading", { name: sessionId });
    expect(window.location.pathname).toBe(`/admin/sessions/${sessionId}`);
    expect(screen.getByText("৬ গুণ ৭ কত?")).toBeTruthy();
    expect(screen.getByText("৪২")).toBeTruthy();
    expect(screen.getByText("Runs").closest(".card")?.textContent).toContain("Completed");
  });

  it("issues a read-only key and revokes it", async () => {
    const { fetchViaApp, adminToken } = await setup();
    sessionStorage.setItem("banglaclaw.adminKey", adminToken);
    window.history.replaceState(null, "", "/admin/keys");
    render(<App fetch={fetchViaApp} />);

    await screen.findByText("This key");
    const table = () => screen.getAllByRole("table")[0] as HTMLElement;
    expect(within(table()).getByText("This key")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("User"), { target: { value: "reporting" } });
    fireEvent.click(screen.getByLabelText("run"));
    fireEvent.click(screen.getByRole("button", { name: "Issue key" }));
    const notice = await screen.findByText(/New key for reporting/);
    const token = notice.closest(".notice")?.querySelector("code")?.textContent ?? "";
    expect(token).toMatch(/^bck_/);

    const row = (await within(table()).findByText("reporting")).closest("tr");
    if (row === null) throw new Error("no row");
    expect(row.textContent).toContain("read");
    expect(row.textContent).not.toContain("run");
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirm revoke" }));
    await waitFor(() => expect(within(table()).queryByText("reporting")).toBeNull());

    // The shop-bot user's role stayed "user": issuing without a role never changes it.
    const res = await fetchViaApp("/v1/admin/keys", { headers: { Authorization: `Bearer ${adminToken}` } });
    const { keys } = (await res.json()) as { keys: { user: string; role: string; status: string }[] };
    expect(keys.find((k) => k.user === "shop-bot")?.role).toBe("user");
    expect(keys.find((k) => k.user === "reporting")?.status).toBe("revoked");
  });

  it("returns to sign-in with a notice when the stored key is rejected", async () => {
    const { fetchViaApp } = await setup();
    sessionStorage.setItem("banglaclaw.adminKey", "bck_000000000000_0000000000000000000000000000000000000000");
    render(<App fetch={fetchViaApp} />);
    await screen.findByLabelText("API key");
    expect(await screen.findByText(/not valid or has been revoked|rejected/)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
  });

  it("answers and releases a handoff from the queue", async () => {
    const { fetchViaApp, adminToken, sessionId, sessions } = await setup();
    await sessions.update(sessionId, { status: "handoff", handoffReason: "Wants a refund" });
    sessionStorage.setItem("banglaclaw.adminKey", adminToken);
    window.history.replaceState(null, "", "/admin/handoffs");
    render(<App fetch={fetchViaApp} />);

    expect(await screen.findByLabelText("1 waiting")).toBeTruthy();
    fireEvent.click(await screen.findByText("Wants a refund"));
    const box = await screen.findByLabelText("Reply as operator");
    expect(window.location.pathname).toBe(`/admin/handoffs/${sessionId}`);

    fireEvent.change(box, { target: { value: "আপনার রিফান্ড প্রক্রিয়াধীন।" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // Nobody follows this API session, so the reply is stored for the client to read later.
    expect(await screen.findByText(/Saved to the conversation, but not delivered/)).toBeTruthy();
    expect(await screen.findByText("আপনার রিফান্ড প্রক্রিয়াধীন।")).toBeTruthy();
    expect(screen.getByText("Operator")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Release…" }));
    fireEvent.click(screen.getByRole("button", { name: "Return to bot" }));
    await waitFor(() => expect(window.location.pathname).toBe("/admin/handoffs"));
    expect(await screen.findByText(/Nobody is waiting/)).toBeTruthy();
    expect((await sessions.get(sessionId))?.status).toBe("active");
  });

  it("shows tools, skills, the audit log and a disabled knowledge base", async () => {
    const { fetchViaApp, adminToken, audit } = await setup();
    await audit.record({ action: "tool.denied", outcome: "denied", actorId: "system", target: "shell_exec", metadata: { reason: "not allowed" } });
    sessionStorage.setItem("banglaclaw.adminKey", adminToken);
    window.history.replaceState(null, "", "/admin/agent");
    render(<App fetch={fetchViaApp} />);

    const calculator = (await screen.findByText("calculator")).closest("tr");
    expect(calculator?.textContent).toContain("✓ Allowed");
    expect(screen.getByText("current_datetime").closest("tr")?.textContent).toContain("✕ Denied");

    fireEvent.click(screen.getByRole("link", { name: "Knowledge" }));
    expect(await screen.findByText(/knowledge base is not enabled/)).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Audit log" }));
    const row = (await screen.findByText("shell_exec")).closest("tr");
    expect(row?.textContent).toContain("tool.denied");
    expect(row?.textContent).toContain("Denied");
    expect(row?.textContent).toContain("reason=not allowed");
  });
});
