# BanglaClaw — Project Brief

## One-line definition

BanglaClaw is a Bangla-first, open-source AI agent runtime built with TypeScript, LangGraph and MCP.

## Core architecture

```text
Channels → Gateway → Sessions → LangGraph Runtime → Skills/Tools/MCP → Models
```

## Initial priorities

1. Agent runtime
2. Tool calling
3. Skills
4. Sessions
5. MCP
6. Gateway
7. Security
8. Observability

## Development rule

Do not start with a giant multi-agent platform.

First make one reliable agent capable of:

- receiving a message
- understanding Bangla/Banglish/English
- deciding whether a tool is needed
- executing a permitted tool
- returning a response
- persisting the run

Then expand the runtime.
