"""Builds DeepEval test cases from agent answers, and the POST /v1/admin/evals payload from DeepEval's results."""

from __future__ import annotations

from typing import Any, Iterable

from deepeval.test_case import LLMTestCase, ToolCall

from .dataset import Golden
from .gateway import AgentAnswer

# Gateway limits (packages/gateway/src/schemas.ts); longer text is cut rather than rejected.
_MAX = {"input": 20_000, "actualOutput": 50_000, "expectedOutput": 20_000, "reason": 4_000}


def _cut(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    return text if len(text) <= limit else text[: limit - 1] + "…"


def to_test_case(golden: Golden, answer: AgentAnswer) -> LLMTestCase:
    tools_called = [
        ToolCall(name=c["tool"], input_parameters=c.get("input") if isinstance(c.get("input"), dict) else None, output=c.get("output"))
        for c in answer.tool_calls
        if isinstance(c.get("tool"), str)
    ]
    return LLMTestCase(
        name=golden.name,
        input=golden.input,
        actual_output=answer.reply,
        expected_output=golden.expected_output,
        context=golden.context,
        retrieval_context=answer.retrieval_context() or None,
        tools_called=tools_called,
        expected_tools=[ToolCall(name=t) for t in golden.expected_tools] if golden.expected_tools is not None else None,
        tags=golden.tags or None,
        metadata={
            "session_id": answer.session_id,
            "run_id": answer.run_id,
            "input_language": answer.language,
            "reply_language": golden.reply_language,
            "run_status": answer.status,
        },
    )


def _metric_json(m: Any) -> dict[str, Any]:
    score = getattr(m, "score", None)
    return {
        "name": str(m.name),
        "score": None if score is None else min(1.0, max(0.0, float(score))),
        "threshold": min(1.0, max(0.0, float(m.threshold if m.threshold is not None else 0.5))),
        "success": bool(m.success),
        "reason": _cut(getattr(m, "reason", None), _MAX["reason"]),
        "error": _cut(getattr(m, "error", None), _MAX["reason"]),
    }


def build_payload(
    *,
    name: str,
    goldens: list[Golden],
    answers: dict[str, AgentAnswer],
    test_results: Iterable[Any],
    dataset: str | None = None,
    framework_version: str | None = None,
    judge_model: str | None = None,
    metadata: dict[str, str | int | float | bool] | None = None,
    failed_runs: dict[str, str] | None = None,
) -> dict[str, Any]:
    """One case per golden, in dataset order. DeepEval may finish cases out of order, so results are matched by name.

    Goldens whose agent run failed (`failed_runs`: name → error) are kept as failed cases so they count against the pass rate.
    """
    by_name = {r.name: r for r in test_results}
    cases: list[dict[str, Any]] = []
    for golden in goldens:
        answer = answers.get(golden.name)
        result = by_name.get(golden.name)
        if answer is None or result is None:
            error = (failed_runs or {}).get(golden.name, "The agent produced no answer")
            cases.append({
                "name": golden.name,
                "input": _cut(golden.input, _MAX["input"]),
                "expectedOutput": _cut(golden.expected_output, _MAX["expectedOutput"]),
                "expectedTools": golden.expected_tools,
                "metrics": [{"name": "Agent Run", "score": 0.0, "threshold": 1.0, "success": False, "error": _cut(error, _MAX["reason"])}],
            })
            continue
        cases.append({
            "name": golden.name,
            "input": _cut(golden.input, _MAX["input"]),
            "actualOutput": _cut(answer.reply, _MAX["actualOutput"]),
            "expectedOutput": _cut(golden.expected_output, _MAX["expectedOutput"]),
            "language": answer.language,
            "sessionId": answer.session_id,
            "runId": answer.run_id,
            "toolsCalled": [c["tool"] for c in answer.tool_calls if isinstance(c.get("tool"), str)],
            "expectedTools": golden.expected_tools,
            "metrics": [_metric_json(m) for m in (result.metrics_data or [])],
        })
    payload: dict[str, Any] = {
        "name": name,
        "framework": "deepeval",
        "dataset": dataset,
        "frameworkVersion": framework_version,
        "judgeModel": judge_model,
        "metadata": metadata or None,
        "cases": cases,
    }
    return {k: v for k, v in payload.items() if v is not None}


def pass_rate(payload: dict[str, Any]) -> float:
    cases = payload["cases"]
    passed = sum(1 for c in cases if c["metrics"] and all(m["success"] for m in c["metrics"]))
    return passed / len(cases) if cases else 0.0
