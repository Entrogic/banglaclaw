# ADR-0016: A2A Client — Remote Agents as Tools

## Status

Accepted

## Context

ADR-0015 made BanglaClaw an A2A server. The other direction is just as useful: a BanglaClaw deployment often needs a specialist that someone else runs (a weather, logistics or payments agent built on Google ADK, LangGraph, or another BanglaClaw). Local specialists (ADR-0009) share the process, tools and prompt; remote agents do not, and they speak A2A over HTTP.

## Decision

- **A remote agent is a tool, not a team member.** Each `a2a.agents.<name>` entry becomes one `BanglaClawTool`, `a2a__<name>`, with input `{ message }` and a text reply. It goes through the same allowlist, validation, timeout and audit path as every tool, and like MCP tools it is `sensitive`, so nothing is callable until it is in `tools.allow`. Supervisor transfers (`transfer_to_*`) stay for local specialists, whose history and handoff the runtime owns.
- **A new package, `@entrogic-net/a2a`**, mirrors `@entrogic-net/mcp`: `A2aManager` fetches the configured cards in parallel at startup, reports unreachable agents through `status()` and never throws. It depends on `shared`, `tools` and `@a2a-js/sdk` only (the SDK's client entry, which loads no web framework); the CLI wires it in. `${VAR}` expansion moved from `mcp` to `shared` so both use it.
- **Any binding and version the card offers:** the SDK's JSON-RPC and HTTP+JSON transports with v0.3 compatibility on.
- **One remote conversation per BanglaClaw session,** keyed by the `contextId` the remote agent returns, kept in a bounded in-memory map. The remote side owns that conversation's history; we do not persist it.
- **Credentials only to the configured origin.** Headers from config (with `${VAR}` secrets) are attached only to requests for the origin of `url`, so a card that points elsewhere cannot collect them.
- **`input-required` is not continued yet.** The task's question comes back as a tool error. Continuing interrupted tasks (including a remote human handoff) is deferred.

## Consequences

Positive:
- Any A2A agent becomes usable with a few lines of config, under the existing permission model and audit log
- No change to the agent runtime, graph or gateway

Trade-offs:
- Remote conversations are forgotten on restart (a new one starts)
- A remote agent's reply and card are untrusted text in the prompt, as with MCP; operators can override the description
- A multi-turn clarification with a remote agent is not possible until `input-required` continuation lands
