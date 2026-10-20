---
"@entrogic-net/shared": minor
"@entrogic-net/storage": minor
"@entrogic-net/gateway": minor
"@entrogic-net/client": minor
"@entrogic-net/cli": minor
---

Evaluations: `/v1/admin/evals` records, lists, shows and deletes evaluation runs (DeepEval harness in `evals/deepeval`), stored in the new `eval_runs` / `eval_cases` tables (migration `0006_evals`) and shown on the dashboard's Evals page. Adds `EvalStore`, `InMemoryEvalStore` and `PostgresEvalStore`, the audit actions `eval.recorded` and `eval.deleted`, and `admin.evals()`, `admin.eval()`, `admin.recordEval()` and `admin.deleteEval()` in the typed client.
