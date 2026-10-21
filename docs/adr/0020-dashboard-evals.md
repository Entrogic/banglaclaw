# ADR-0020: Running Evals from the Dashboard

## Status

Accepted

## Context

ADR-0017 put evaluation in a Python DeepEval harness that drives the gateway over `/v1` and records scores there. That suits CI, but an operator who changes a prompt, skill or provider in the dashboard (ADR-0019) has to leave it, set up Python and a judge key, and run a command to see whether answers got worse. The roadmap also asked for multi-turn metrics and judge prompts written for Bangla. DeepEval's prompts are in English.

## Decision

- **A built-in runner in TypeScript, not the harness behind a button.** The new `@entrogic-net/evals` package holds `EvalJobRunner`, which calls `AgentRuntime.run` directly and scores the answers. The gateway never starts Python, and the Docker image stays Node-only. Results go into the same `EvalStore` with `framework: banglaclaw`, so the Evals history mixes both sources.
- **Datasets live on the gateway** (`EvalDatasetStore` in `shared`; `eval_datasets` in Postgres). They use the harness's golden format and validation (`parseGoldens`, a Zod port of `dataset.py`), so a file works in both places.
- **Metrics:** deterministic `tool_correctness` and `language_match` (the agent's own `detectLanguage`, so no port is needed), plus four LLM-as-a-judge metrics: `correctness`, `answer_relevancy`, `fluency`, and a multi-turn `conversation` metric for goldens with `turns`, which judges the whole transcript. Metrics a golden lacks inputs for are skipped, as in the harness.
- **Bangla judge prompts.** Every judge rubric exists in Bangla and English with the same rules: meaning over script, ৪২ = 42, ৳ / Tk / taka. Bangla is the default. The judge returns `{score: 0-10, reason}` JSON, validated with Zod, and gets one retry before the metric is recorded as an error. A judge failure never fails the job.
- **The judge is any configured provider:** the agent's current provider or a profile from ADR-0019 (`ProviderManager.providerFor`). No separate judge key or configuration.
- **Cost and safety controls.** Admin role only, one job per gateway at a time (`409 eval_running`), and each start and cancel is audited. Eval sessions use the `eval` channel and are owned by the admin who started them. Jobs live in memory; a restart or cancel records nothing.
- **Wiring** follows ADR-0005: shared defines `EvalRunner`, the gateway only validates and forwards, and the CLI builds the runner with the runtime, stores and provider manager.

## Consequences

Positive:
- A dataset can be run from the dashboard after any change, with the providers already configured
- Bangla-native judge rubrics and a multi-turn metric, which the harness lacks
- One dataset format and one results history for both runners

Trade-offs:
- Two scorers to keep consistent: the rubrics mirror the harness's G-Eval criteria, and changes should go to both
- Judge and agent calls run inside the gateway process and spend its providers' quota; one job at a time keeps this bounded, but there is no budget cap yet
- Fewer metrics than DeepEval (no faithfulness or contextual relevancy) and no scheduling; CI gating stays with the harness
