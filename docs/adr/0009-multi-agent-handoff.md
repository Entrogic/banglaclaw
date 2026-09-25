# ADR-0009: Supervisor with Handoff Tools and Human Session Takeover

## Status

Accepted

## Context

v0.7 adds specialist agents and human handoff. Agents must stay small (AGENT.md in AGENTS.md §1.4), routing must be explicit and bounded, tool permissions must stay application-enforced, and a person must be able to take over a conversation on any channel.

## Decision

- **Definitions.** Specialists live in `agents/<name>/AGENT.md` files (the same format as SKILL.md). Their `tools` narrow the global allowlist.
- **Routing.** The supervisor model routes with `transfer_to_<agent>` control tools, handled inside the LangGraph tool node. The specialist answers in the same run. The session stores `activeAgent` for follow-ups. Transfers per run are capped. The supervisor keeps only tools no specialist claims.
- **Enforcement.** Each agent's tool subset is enforced by a scoped `PermissionPolicy` at execution time, not only by what tools are advertised.
- **Handoff.** `request_human` sets `session.status = handoff`. The runtime then stores user messages without calling the model. Operators (`users.role = operator`) reply through `HandoffDesk`, which audits each reply as a run and delivers it through the channel, and release the session.

## Consequences

Positive:
- Routing is visible in events and in `RunRecord.agentPath`, and bounded by limits
- One mechanism serves every channel (CLI, API, Telegram, WhatsApp)
- Specialists can't use tools outside their subset, even if prompted to

Trade-offs:
- Each transfer costs an extra model call
- Small models may claim actions in text without calling the tool; state changes only happen through tools
- API-channel users must poll messages to see operator replies (no push yet)
