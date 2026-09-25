# 00 — Overview

## What is BanglaClaw?

BanglaClaw is an open-source AI agent runtime for building agents that can understand Bangla, Banglish and English, maintain state, use tools, invoke MCP servers, access memory and operate across multiple channels.

## Primary use cases

- Bangla/Banglish AI assistants
- Customer support agents
- Ecommerce agents
- Developer agents
- Business automation agents
- Research and RAG agents
- Multi-channel assistants

## Core components

```text
Channels
   ↓
Gateway
   ↓
Session Manager
   ↓
Agent Runtime (LangGraph)
   ↓
Skills / Tools / MCP
   ↓
Model Providers
   ↓
Storage / Memory / Observability
```

## Relationship to OpenClaw

BanglaClaw takes inspiration from agent-runtime patterns such as gateway/channel separation, skills, tools, sessions and extensibility. It is an independent implementation with LangGraph as the orchestration layer and MCP as a first-class integration protocol.

BanglaClaw must not depend on OpenClaw internals or copy proprietary implementation details.

## Target users

Developers building production-oriented AI agents with TypeScript/Node.js.
