# BanglaClaw evals (DeepEval)

Scores a running BanglaClaw agent with [DeepEval](https://github.com/confident-ai/deepeval) and records the results on its gateway, where the admin dashboard shows them under **Evals**. Full guide: [docs/26-evals.md](../../docs/26-evals.md).

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e '.[test]'

export BANGLACLAW_GATEWAY_URL=http://127.0.0.1:3000
export BANGLACLAW_API_KEY=bck_…     # admin key
export OPENAI_API_KEY=sk-…          # DeepEval's judge model
python -m banglaclaw_evals run datasets/sample.yaml --judge-model gpt-4.1-mini --min-pass-rate 0.8
```

Metrics: `answer_relevancy`, `correctness` (Bangla-aware G-Eval), `fluency`, `faithfulness`, `contextual_relevancy`, `tool_correctness`, `language_match`. Choose with `--metrics`; `python -m banglaclaw_evals run --help` lists every option.

```bash
python -m pytest -q   # offline tests: no model or network calls
```

`banglaclaw_evals/language.py` ports `packages/agent/src/language.ts`; change both together.
