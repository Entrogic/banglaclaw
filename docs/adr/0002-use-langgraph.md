# ADR-0002: Use LangGraph

## Status

Accepted

## Context

BanglaClaw needs stateful, multi-step and inspectable agent workflows.

## Decision

Use LangGraph as the core agent orchestration engine.

## Consequences

Positive:
- Stateful graph execution
- Checkpointing
- Conditional routing
- Human-in-the-loop support
- Explicit workflow structure

Trade-offs:
- Graph design adds complexity
- Runtime abstractions must remain disciplined
