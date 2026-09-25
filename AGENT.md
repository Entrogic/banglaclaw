# AGENTS.md

## Project Overview

This project is an open-source, modular AI Agent platform built with:

* Node.js
* TypeScript
* pnpm
* LangGraph
* MCP (Model Context Protocol)
* PostgreSQL
* Redis

The goal is to build reliable, extensible, stateful AI agents that can use tools, interact with external services, maintain memory, and execute multi-step workflows.

---

# 1. Core Principles

All development must follow these principles:

### 1.1 Modularity

Keep agents, tools, workflows, MCP integrations, memory, and infrastructure separated.

Do not create a single large agent file containing all business logic.

Prefer:

```text
agents/
tools/
workflows/
mcp/
memory/
llm/
shared/
```

### 1.2 Type Safety

Use TypeScript throughout the project.

Avoid:

```ts
const data: any = ...
```

Prefer explicit types:

```ts
interface Customer {
  id: string;
  name: string;
  email?: string;
}
```

Use `unknown` when the type is genuinely unknown and validate it before use.

### 1.3 Explicit Tool Contracts

Every agent tool must have:

* A clear name
* Description
* Input schema
* Output schema
* Error handling
* Permission boundaries

Tools must never silently perform destructive operations.

### 1.4 Agents Should Be Small

An agent should have one clear responsibility.

Good:

```text
BookingAgent
SupportAgent
SalesAgent
ResearchAgent
```

Avoid:

```text
EverythingAgent
```

A supervisor/router may coordinate multiple agents.

---

# 2. Repository Structure

Use the following structure:

```text
.
├── apps/
│   ├── api/
│   └── worker/
│
├── packages/
│   ├── agents/
│   ├── tools/
│   ├── mcp/
│   ├── memory/
│   ├── llm/
│   ├── shared/
│   └── config/
│
├── docs/
├── examples/
│
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── tsconfig.json
```

### Responsibilities

#### `apps/api`

HTTP/API layer.

It should handle:

* Authentication
* Request validation
* Agent invocation
* Streaming responses
* API errors

Business logic should not live here.

#### `apps/worker`

Background processing.

Examples:

* Long-running agent tasks
* Scheduled jobs
* Queue processing
* Document processing
* Embedding generation

#### `packages/agents`

Agent definitions.

Examples:

```text
packages/agents/
├── supervisor/
├── booking/
├── support/
├── sales/
└── research/
```

#### `packages/tools`

Reusable tools used by agents.

Examples:

```text
packages/tools/
├── database/
├── web/
├── email/
├── crm/
└── filesystem/
```

#### `packages/mcp`

MCP clients and MCP server implementations.

#### `packages/memory`

Memory implementations.

Examples:

* Short-term state
* Conversation history
* Semantic memory
* PostgreSQL persistence
* Vector search

#### `packages/llm`

LLM provider abstraction.

Do not tightly couple agent logic to a single provider.

---

# 3. Package Manager

This project uses **pnpm**.

Do not use:

```bash
npm install
```

or:

```bash
yarn add
```

Use:

```bash
pnpm install
```

Add dependencies:

```bash
pnpm add <package>
```

Add a development dependency:

```bash
pnpm add -D <package>
```

Add a dependency to a specific workspace:

```bash
pnpm --filter <workspace> add <package>
```

Example:

```bash
pnpm --filter @agent/api add fastify
```

---

# 4. TypeScript Rules

Use strict TypeScript.

`tsconfig.json` should enable:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

Avoid unnecessary type assertions:

```ts
const user = data as User;
```

Prefer validation:

```ts
const user = UserSchema.parse(data);
```

Use schemas for external data.

Recommended validation library:

```text
Zod
```

---

# 5. Agent Architecture

Agents should follow a predictable structure.

Example:

```text
packages/agents/booking/
├── index.ts
├── state.ts
├── graph.ts
├── prompts.ts
├── tools.ts
└── types.ts
```

Basic flow:

```text
User
  ↓
Input Validation
  ↓
Supervisor / Router
  ↓
Agent
  ↓
LLM
  ↓
Tool Call
  ↓
Tool Result
  ↓
LLM
  ↓
Final Response
```

---

# 6. LangGraph Rules

Use LangGraph for stateful agent workflows.

Each graph should clearly define:

* State
* Nodes
* Edges
* Conditional routing
* Tool execution
* Termination conditions

Example:

```text
START
  ↓
classify_intent
  ↓
route_agent
  ↓
agent
  ↓
should_use_tool?
  ├── yes → tool
  │          ↓
  │        agent
  │
  └── no → END
```

Avoid unnecessary graph complexity.

If a simple function can solve the problem, do not create a graph.

---

# 7. State Management

Agent state must be explicit.

Example:

```ts
interface AgentState {
  messages: Message[];
  userId: string;
  sessionId: string;
  intent?: string;
  toolResults?: unknown[];
}
```

Do not hide important state inside global variables.

Never store request-specific state globally.

---

# 8. Tool Development

Tools are capabilities available to agents.

Every tool should have:

```text
name
description
input schema
execution logic
output
error handling
```

Example:

```ts
const getCustomer = tool(
  async ({ customerId }) => {
    // implementation
  },
  {
    name: "get_customer",
    description: "Retrieve a customer by ID",
    schema: CustomerInputSchema
  }
);
```

Tool names should be:

* Short
* Descriptive
* Consistent
* Action-oriented

Good:

```text
get_customer
create_order
search_products
check_inventory
send_email
```

Avoid:

```text
doStuff
helper
magicTool
```

---

# 9. Destructive Tools

Destructive operations require additional protection.

Examples:

```text
delete_customer
delete_order
refund_payment
cancel_booking
execute_shell
```

These tools must:

* Validate input
* Check authorization
* Log the action
* Handle failures
* Require confirmation where appropriate

Never allow an LLM to bypass authorization.

The LLM decides what it wants to do.

The application decides whether it is allowed to do it.

---

# 10. MCP Rules

Use MCP when an external capability should be exposed to agents through a standardized tool interface.

Example:

```text
Agent
  ↓
MCP Client
  ↓
MCP Server
  ↓
External System
```

Possible MCP integrations:

```text
PostgreSQL
Laravel API
CRM
GitHub
Filesystem
Browser
Email
Calendar
POS
```

MCP tools must still enforce authorization.

Never assume that because a tool is exposed through MCP it is safe.

---

# 11. Database Rules

Primary database:

```text
PostgreSQL
```

Use migrations for schema changes.

Never manually modify production databases without a migration.

Database operations should be isolated from agent logic.

Bad:

```text
Agent → raw SQL everywhere
```

Prefer:

```text
Agent
 ↓
Tool
 ↓
Service
 ↓
Repository
 ↓
Database
```

---

# 12. Redis Rules

Redis may be used for:

* Caching
* Queues
* Rate limiting
* Temporary state
* Distributed locks

Do not treat Redis as the permanent source of truth for important business data.

Persistent business data belongs in PostgreSQL.

---

# 13. LLM Provider Abstraction

Agent logic should not depend directly on a single LLM provider.

Prefer:

```text
Agent
 ↓
LLM Interface
 ↓
Provider
 ├── OpenAI
 ├── Anthropic
 ├── Ollama
 ├── vLLM
 └── Other providers
```

The provider should be configurable through environment variables.

Example:

```env
LLM_PROVIDER=openai
LLM_MODEL=...
```

Never hard-code API keys.

---

# 14. Environment Variables

Secrets must never be committed to Git.

Use:

```text
.env
```

and provide:

```text
.env.example
```

Example:

```env
NODE_ENV=development

DATABASE_URL=

REDIS_URL=

LLM_PROVIDER=
LLM_MODEL=
LLM_API_KEY=

MCP_SERVER_URL=
```

Never commit:

```text
.env
```

---

# 15. Error Handling

Errors must be explicit.

Do not silently swallow errors.

Bad:

```ts
try {
  await something();
} catch {}
```

Prefer:

```ts
try {
  await something();
} catch (error) {
  logger.error(error);
  throw new ToolExecutionError("Failed to execute tool");
}
```

Errors should contain enough information for debugging without leaking secrets.

---

# 16. Logging

Use structured logging.

Logs should include useful context:

```text
requestId
sessionId
userId
agent
tool
duration
status
error
```

Never log:

```text
API keys
passwords
access tokens
cookies
private credentials
```

---

# 17. Observability

Agent systems should be observable.

Track:

* Agent execution
* Tool calls
* LLM calls
* Latency
* Token usage
* Errors
* Retries
* Workflow state

Recommended future integration:

```text
OpenTelemetry
LangSmith
Prometheus
Grafana
```

---

# 18. Testing

Every important component should have tests.

Test:

```text
Tools
Agents
Graph routing
Input validation
MCP integrations
API endpoints
```

Agent tests should not depend entirely on live LLM responses.

Prefer deterministic tests for:

* Routing
* State transitions
* Tool validation
* Permission checks

Use mocked LLM responses where appropriate.

---

# 19. Security

Security is a first-class concern.

Never allow an agent to:

* Execute arbitrary commands
* Access arbitrary files
* Access secrets
* Modify databases without authorization
* Call unrestricted external APIs

unless the capability is explicitly designed, sandboxed, and authorized.

Use:

```text
Authentication
Authorization
Input validation
Rate limiting
Sandboxing
Audit logging
```

---

# 20. Prompt Rules

Prompts should be version-controlled.

Store prompts separately:

```text
packages/agents/<agent>/prompts.ts
```

Prompts should clearly define:

```text
Role
Goal
Available tools
Tool usage rules
Constraints
Output requirements
Failure behavior
```

Do not put security-critical authorization rules only inside prompts.

Application code must enforce them.

---

# 21. Git Rules

Use small, focused commits.

Good:

```text
feat: add booking agent
feat: add customer search tool
fix: handle MCP timeout
docs: update deployment guide
refactor: simplify supervisor graph
```

Avoid:

```text
update
changes
fix stuff
```

Do not commit:

```text
.env
credentials
private keys
database dumps
large generated files
```

---

# 22. Dependency Rules

Before adding a dependency:

1. Check whether the functionality already exists.
2. Check whether the package is actively maintained.
3. Check its license.
4. Check bundle/runtime impact.
5. Prefer well-maintained dependencies.

Do not add dependencies unnecessarily.

---

# 23. Documentation Rules

Every major feature should have documentation.

Documentation belongs in:

```text
docs/
```

Recommended documents:

```text
docs/
├── architecture.md
├── installation.md
├── configuration.md
├── agents.md
├── tools.md
├── mcp.md
├── memory.md
├── workflows.md
├── api.md
├── deployment.md
└── troubleshooting.md
```

When behavior changes, update the documentation in the same change.

---

# 24. Development Workflow

Before starting:

```bash
pnpm install
```

Run development environment:

```bash
pnpm dev
```

Build:

```bash
pnpm build
```

Run tests:

```bash
pnpm test
```

Lint:

```bash
pnpm lint
```

Type check:

```bash
pnpm typecheck
```

Before opening a pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All relevant checks should pass.

---

# 25. Agent Development Checklist

Before adding a new agent:

* [ ] Define the agent responsibility.
* [ ] Define the agent state.
* [ ] Define required tools.
* [ ] Define permissions.
* [ ] Define system prompt.
* [ ] Define success criteria.
* [ ] Define failure behavior.
* [ ] Add tests.
* [ ] Add documentation.

Example:

```text
BookingAgent

Responsibility:
Handle customer booking requests.

Tools:
- search_customer
- check_availability
- create_booking
- cancel_booking

State:
- customerId
- bookingId
- requestedDate
- requestedTime

Permissions:
- Can create booking
- Cannot issue refunds
- Cannot delete customer
```

---

# 26. Multi-Agent Architecture

When multiple agents are required, prefer a supervisor architecture.

```text
                    ┌───────────────┐
                    │     User      │
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │  Supervisor   │
                    └───────┬───────┘
                            ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
   Booking Agent       Support Agent       Sales Agent
        ↓                   ↓                   ↓
        └───────────────────┼───────────────────┘
                            ↓
                       MCP / Tools
                            ↓
                 External Applications
```

Agents should communicate through structured state/messages rather than hidden global state.

---

# 27. Human Handoff

Agents must be able to stop and request human assistance.

Use human handoff when:

* The user explicitly requests a human.
* The agent lacks required permissions.
* The operation is high-risk.
* The agent cannot confidently complete the workflow.
* A business rule requires human approval.

Example:

```text
Agent
 ↓
Needs human?
 ├── No → Continue
 └── Yes
      ↓
Human Handoff
      ↓
Human
```

---

# 28. Performance

Avoid unnecessary LLM calls.

Prefer:

```text
One LLM call
 ↓
Tool execution
 ↓
One final LLM call
```

instead of unnecessary repeated reasoning.

Use caching where appropriate.

Use streaming for long-running responses.

Use background jobs for expensive operations.

---

# 29. Cost Control

Track:

```text
Input tokens
Output tokens
Model
Request count
Tool calls
Execution duration
```

Avoid infinite agent loops.

Every graph should have explicit termination conditions.

Implement:

```text
max iterations
max tool calls
timeout
retry limit
```

---

# 30. Production Deployment

Recommended production stack:

```text
                    Cloudflare
                        ↓
                      Nginx
                        ↓
                 API / Web Server
                        ↓
                  Agent Runtime
                  /           \
                 ↓             ↓
            PostgreSQL       Redis
                 ↓
             MCP Servers
                 ↓
          External Services
```

Recommended infrastructure:

```text
Docker
Nginx
PM2 or container orchestration
PostgreSQL
Redis
Cloudflare
OpenTelemetry
```

---

# 31. Definition of Done

A feature is considered complete when:

* [ ] Implementation is complete.
* [ ] TypeScript passes.
* [ ] Tests pass.
* [ ] Lint passes.
* [ ] Error handling exists.
* [ ] Security considerations are addressed.
* [ ] Documentation is updated.
* [ ] Environment variables are documented.
* [ ] No secrets are committed.
* [ ] Production behavior is considered.

---

# 32. Golden Rule

The AI agent is a decision-making component, not the security boundary.

Always remember:

```text
LLM decides what it wants to do.

Application decides whether it is allowed to do it.

Tools execute the authorized action.

Database remains the source of truth.
```

Build agents that are:

```text
Modular
Type-safe
Observable
Secure
Testable
Stateful
Extensible
Production-ready
```
