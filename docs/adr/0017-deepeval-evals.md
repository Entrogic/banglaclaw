# ADR-0017: Evaluations with DeepEval, Results on the Gateway

## Status

Accepted

## Context

Tests with `FakeProvider` keep the runtime deterministic (docs/14), but say nothing about answer quality with a real model, prompt and tool set, which is what changes when a prompt, skill, model or knowledge base changes. Answer quality in Bangla and Banglish is the project's main promise. We want repeatable scores over a dataset, a pass/fail gate for releases, and a history operators can look at.

DeepEval is the most complete open-source framework for this: LLM-as-a-judge metrics (answer relevancy, faithfulness, G-Eval), tool-call metrics and test-case plumbing. It is Python only.

## Decision

- **DeepEval runs out of process, as a Python harness in `evals/deepeval/`**, not as a dependency of any TypeScript package. It is not part of the pnpm workspace and is not published to npm.
- **The harness drives the agent through the stable `/v1` API** (`POST /v1/agents/run`), one session per golden, so it measures the deployed configuration end to end and needs no access to internals. Tool calls and retrieved passages come from the run record in the response.
- **Scores are stored on the gateway, not in DeepEval's cloud.** `POST /v1/admin/evals` (admin role) accepts a run with its cases; `eval_runs` / `eval_cases` hold it (summary columns on the run so the list needs no aggregation). The gateway validates the payload with Zod and recomputes each case's success and the summary itself. The store interface (`EvalStore`) lives in `shared` next to `AuditStore`, with in-memory and Postgres implementations; the CLI wires it into `serve`.
- **The dashboard shows the history** (`/admin/evals`) through `@entrogic-net/client`, like every other page.
- **Bangla-specific metrics live in the harness:** a G-Eval correctness criterion that compares meaning across scripts and digit systems, a fluency criterion, and a deterministic language-match metric that ports the agent's own language detector.
- The API is framework-neutral (`framework` is a string), so other evaluators can record results the same way.

## Consequences

Positive:
- Quality regressions show up as numbers per metric and per case, with links to the conversations
- No Python in the Node runtime, Docker image or npm packages; the `/v1` API stays additive
- Results stay with the operator's data, under the same auth and audit log

Trade-offs:
- Two languages in the repository; `language.py` must be kept in sync with `language.ts` by hand
- Evals call real models (agent and judge), so they cost money and are not deterministic; CI runs only the harness's offline tests
- DeepEval's judge prompts are English; scores for Bangla answers depend on the judge model's Bangla ability
- Eval runs count as ordinary runs in analytics under the key's user
