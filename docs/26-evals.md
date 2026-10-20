# 26 — Evaluations (DeepEval)

Unit tests (FakeProvider) prove the runtime is correct; they cannot tell you whether a real model, prompt and tool set answer Bangla, Banglish and English questions *well*. Evaluations do that: a dataset of questions ("goldens") runs through a live agent and each answer is scored. BanglaClaw uses [DeepEval](https://github.com/confident-ai/deepeval) for the scoring and stores the results on the gateway, where the admin dashboard shows them ([ADR-0017](adr/0017-deepeval-evals.md)).

```
evals/deepeval (Python)                         gateway                    dashboard
  goldens.yaml ──► POST /v1/agents/run ──────►  agent runs (real model)
               ◄── reply + run (tools, language)
  DeepEval metrics (judge model) score each case
  POST /v1/admin/evals ─────────────────────►  eval_runs / eval_cases ──►  /admin/evals
```

- The harness talks to the gateway only through the stable `/v1` API, so it evaluates exactly what users get: the same prompt, skills, tools, permissions and model.
- Every case runs in its own session (`externalId` `eval/<name>/<timestamp>/<golden>`), owned by the key's user. The dashboard links each case to that conversation.
- Scoring happens in Python; the gateway only validates and stores the numbers, so it never calls a judge model or needs DeepEval installed.

## Running it

```bash
cd evals/deepeval
python -m venv .venv && . .venv/bin/activate
pip install -e '.[test]'

export BANGLACLAW_GATEWAY_URL=http://127.0.0.1:3000
export BANGLACLAW_API_KEY=bck_…            # an admin key (banglaclaw key create --user ci --role admin)
export OPENAI_API_KEY=sk-…                 # for DeepEval's judge model
python -m banglaclaw_evals run datasets/sample.yaml --judge-model gpt-4.1-mini
```

It prints `sample: 6/7 cases passed (86%)` and the dashboard link. Options:

| Option | Meaning |
|---|---|
| `--name` | Name shown in the dashboard and used to compare runs (default: dataset file name) |
| `--metrics a,b,c` | Metrics to compute (below); default `answer_relevancy,correctness,tool_correctness,language_match` |
| `--threshold metric=0.8` | Override a metric's pass threshold |
| `--judge-model` | Judge for LLM-as-a-judge metrics (env `BANGLACLAW_EVAL_JUDGE_MODEL`; DeepEval's default otherwise) |
| `--label key=value` | Stored with the run, e.g. `commit=abc123`; on GitHub Actions `commit`, `ref` and `ci_run` are added automatically |
| `--parallel N` | Agent runs in flight (the gateway allows `gateway.rateLimit.maxConcurrentRuns` per key; 429s are retried) |
| `--output file.json` | Also write the result JSON |
| `--no-record` | Score only; a non-admin key is enough |
| `--min-pass-rate 0.9` | Exit 1 when fewer cases pass, for CI |

A case passes when every metric that applied to it passed. If the agent run itself fails (model error, timeout), the case is recorded as failed with an `Agent Run` metric holding the error.

## Datasets

YAML (or JSON) with a `goldens` list. `datasets/sample.yaml` covers the built-in tools in all three languages.

```yaml
goldens:
  - name: vat-en                        # unique; [A-Za-z0-9._-]
    input: "What is 15% VAT on 2400 taka?"
    expected_output: "15% VAT on ৳2,400 is ৳360."
    expected_tools: [calculator]        # [] = no tool should be called; omit to skip tool_correctness
    tags: [en, tools]
  - name: follow-up-bn
    turns: ["আমার নাম রাহিম।"]           # sent first, in the same session
    input: "আমার নাম কী বলেছিলাম?"
    expected_output: "আপনার নাম রাহিম।"
  - name: english-on-request
    input: "national fruit er naam ki? Please answer in English."
    reply_language: en                  # overrides "reply in the user's language"
```

`context` (a list of strings) is optional ground truth for metrics that use it. Retrieval context is never written by hand: it is the text the agent actually retrieved with `search_knowledge`.

## Metrics

| Name | Kind | Uses | Default threshold |
|---|---|---|---|
| `answer_relevancy` | DeepEval `AnswerRelevancyMetric` (judge) | input, answer | 0.7 |
| `correctness` | DeepEval `GEval` with Bangla-aware criteria (judge) | input, answer, `expected_output` | 0.6 |
| `fluency` | `GEval` "Bangla Fluency": natural Bangla / Banglish / English (judge) | input, answer | 0.6 |
| `faithfulness` | DeepEval `FaithfulnessMetric` (judge) | answer, retrieved passages | 0.7 |
| `contextual_relevancy` | DeepEval `ContextualRelevancyMetric` (judge) | input, retrieved passages | 0.5 |
| `tool_correctness` | DeepEval `ToolCorrectnessMetric` (no judge calls) | tools called, `expected_tools` | 1.0 |
| `language_match` | BanglaClaw, deterministic | input language, answer | 1.0 |

- **Bangla-aware correctness.** The `correctness` criteria tell the judge to compare meaning, not wording or script: Bengali and Latin digits are equal (৪২ = 42), ৳/Tk/taka are one currency, and a correct answer in Bangla to an English reference still counts. Generic exact-match or English-centric metrics mark such answers wrong.
- **`language_match`** checks the system prompt's rule (docs/04): answer in the user's language. It ports the agent's own detector (`packages/agent/src/language.ts` → `banglaclaw_evals/language.py`, keep them in sync) and accepts Bengali script for Banglish questions. `reply_language` overrides it.
- A metric whose inputs a case lacks (no `expected_output`, nothing retrieved) is skipped for that case rather than failed.
- DeepEval's built-in judge prompts are in English; they score Bangla answers reasonably with strong judge models (GPT-4.1 class), less so with small ones. Pin the judge model with `--judge-model` so runs stay comparable.

## API and storage

`/v1/admin/evals` (admin role; docs/18):

| Method | Path | Description |
|---|---|---|
| GET | `/v1/admin/evals?name=&limit=` | Runs, newest first, with case and pass counts and the mean score per metric |
| POST | `/v1/admin/evals` | Record a run `{ name, dataset?, framework?, frameworkVersion?, judgeModel?, agentModel?, metadata?, cases[] }` → 201 `{ eval }`. Up to 1,000 cases and 10 MB; scores are 0–1; `null` is accepted for optional fields. `agentModel` defaults to the gateway's model. Audited as `eval.recorded`. |
| GET | `/v1/admin/evals/:id` | One run with every case and metric (score, threshold, reason) |
| DELETE | `/v1/admin/evals/:id` | Delete a run (204, audited as `eval.deleted`) |

The gateway computes each case's `success` and the run summary itself (`summarizeEval` in `@entrogic-net/shared`), so a client cannot submit a pass rate that disagrees with its cases. Postgres stores runs in `eval_runs` (with the summary) and cases in `eval_cases` (docs/13); memory storage keeps the last 500 runs until restart. Gateways built without an eval store answer these routes with 404 `evals_disabled`. The typed client has `admin.evals()`, `admin.eval(id)`, `admin.recordEval(body)` and `admin.deleteEval(id)`.

Any framework can record results through the same endpoint (`framework` is free text); the harness here is the supported one.

## Dashboard

**Evals** (`/admin/evals`) lists runs with their pass rate and mean metric scores, filters by name, and charts passed and failed cases for the last 30 runs. A run's page shows its labels, judge and agent model, a tile per metric, and every case with input, expected and actual answer, tools called versus expected, and each metric's score, threshold and reason, with a link to the conversation. **Failed only** narrows the list.

## In CI

```yaml
- run: pip install -e evals/deepeval
- run: python -m banglaclaw_evals run evals/deepeval/datasets/sample.yaml --judge-model gpt-4.1-mini --min-pass-rate 0.85
  env:
    BANGLACLAW_GATEWAY_URL: ${{ secrets.STAGING_GATEWAY_URL }}
    BANGLACLAW_API_KEY: ${{ secrets.STAGING_EVAL_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

Evals call a real model and cost money, so run them on a schedule or before a release, not on every push. The repository's own CI runs only the harness's offline tests (`pytest` in `evals/deepeval`, no network).

## Security

- Recording and reading results needs an admin key; the harness refuses to start with another role unless `--no-record` is set.
- Eval cases contain the questions and the agent's answers. Use synthetic or consented data, never real customer conversations with personal data, because every admin can read them.
- The eval key's runs are ordinary runs: they count in analytics and token usage under that user. A dedicated `ci` user keeps them easy to tell apart.
