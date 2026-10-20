"""Offline tests: no model or network calls (the gateway is an httpx MockTransport)."""

from __future__ import annotations

import json
from types import SimpleNamespace

import httpx
import pytest
from deepeval.test_case import LLMTestCase

from banglaclaw_evals.__main__ import main
from banglaclaw_evals.dataset import DatasetError, Golden, parse_goldens
from banglaclaw_evals.gateway import AgentAnswer, Gateway
from banglaclaw_evals.language import detect_language
from banglaclaw_evals.metrics import LanguageMatchMetric, build_metrics
from banglaclaw_evals.report import build_payload, pass_rate, to_test_case


@pytest.fixture(autouse=True)
def no_model_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    """DeepEval builds a judge model even for deterministic metrics; any real call would fail fast here."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-offline")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://127.0.0.1:9/v1")
    monkeypatch.setenv("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("৬ গুণ ৭ কত?", "bn"),
        ("bkash e payment kivabe korbo?", "bn-en"),
        ("ami bhalo achi", "bn-en"),
        ("What is 15% VAT on 2400 taka?", "en"),
        ("আমার order টা কোথায়?", "bn"),
        ("my order কোথায় is it shipped", "bn-en"),
        ("", "en"),
    ],
)
def test_detect_language_matches_the_agent(text: str, expected: str) -> None:
    assert detect_language(text) == expected


def test_parse_goldens_validates() -> None:
    goldens = parse_goldens({"goldens": [{"input": "হ্যালো"}, {"name": "x", "input": "hi", "expected_tools": ["calculator"], "reply_language": "en"}]})
    assert goldens[0].name == "case-1"
    assert goldens[1].expected_tools == ["calculator"]
    with pytest.raises(DatasetError, match="unknown keys"):
        parse_goldens([{"input": "a", "expected": "b"}])
    with pytest.raises(DatasetError, match="used twice"):
        parse_goldens([{"name": "a", "input": "x"}, {"name": "a", "input": "y"}])
    with pytest.raises(DatasetError, match="reply_language"):
        parse_goldens([{"input": "x", "reply_language": "fr"}])


def test_sample_dataset_loads() -> None:
    from pathlib import Path

    from banglaclaw_evals.dataset import load_dataset

    goldens = load_dataset(Path(__file__).parent.parent / "datasets" / "sample.yaml")
    assert len(goldens) >= 5
    assert {g.name for g in goldens} >= {"multiply-bn", "vat-en", "discount-banglish"}


def _case(input_text: str, reply: str, **metadata: object) -> LLMTestCase:
    return LLMTestCase(input=input_text, actual_output=reply, metadata=metadata)


def test_language_match_metric() -> None:
    metric = LanguageMatchMetric()
    assert metric.measure(_case("ঢাকা কোথায়?", "ঢাকা বাংলাদেশে।", input_language="bn")) == 1.0
    assert metric.is_successful()
    assert metric.measure(_case("ঢাকা কোথায়?", "Dhaka is in Bangladesh.", input_language="bn")) == 0.0
    assert "expected bn" in (metric.reason or "")
    # Banglish questions may be answered in Banglish or Bengali script.
    assert metric.measure(_case("ami kemon achi?", "apni bhalo achen")) == 1.0
    assert metric.measure(_case("ami kemon achi?", "আপনি ভালো আছেন")) == 1.0
    # An explicit reply_language wins.
    assert metric.measure(_case("naam ki? answer in English", "It is jackfruit.", reply_language="en")) == 1.0


def test_build_metrics_rejects_unknown_names() -> None:
    assert [type(m).__name__ for m in build_metrics(["tool_correctness", "language_match"])] == ["ToolCorrectnessMetric", "LanguageMatchMetric"]
    with pytest.raises(ValueError, match="unknown metrics"):
        build_metrics(["vibes"])


RUN = {
    "id": "run-1",
    "status": "completed",
    "language": "bn",
    "toolCalls": [
        {"id": "c1", "tool": "calculator", "input": {"expression": "6*7"}, "status": "ok", "output": {"result": 42}},
        {"id": "c2", "tool": "search_knowledge", "input": {"query": "x"}, "status": "ok", "output": {"results": [{"citation": "faq.md#0", "title": "FAQ", "score": 0.9, "text": "ডেলিভারি ৳৬০"}]}},
    ],
}


def test_to_test_case_carries_tools_and_retrieval_context() -> None:
    golden = Golden(name="g", input="৬ গুণ ৭?", expected_output="৪২", expected_tools=["calculator"])
    case = to_test_case(golden, AgentAnswer(reply="৪২", session_id="s-1", run=RUN))
    assert [t.name for t in case.tools_called or []] == ["calculator", "search_knowledge"]
    assert [t.name for t in case.expected_tools or []] == ["calculator"]
    assert case.retrieval_context == ["[faq.md#0] ডেলিভারি ৳৬০"]
    assert case.metadata is not None and case.metadata["session_id"] == "s-1"


def _metric(name: str, score: float | None, success: bool, reason: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(name=name, score=score, threshold=0.7, success=success, reason=reason, error=None)


def test_build_payload_matches_results_by_name_and_keeps_failed_runs() -> None:
    goldens = [Golden(name="a", input="৬ গুণ ৭?"), Golden(name="b", input="hi"), Golden(name="c", input="boom")]
    answers = {"a": AgentAnswer("৪২", "s-a", RUN), "b": AgentAnswer("hello", "s-b", {"id": "run-b", "language": "en", "toolCalls": []})}
    # DeepEval may report out of order.
    results = [
        SimpleNamespace(name="b", metrics_data=[_metric("Answer Relevancy", 0.4, False, "অপ্রাসঙ্গিক")]),
        SimpleNamespace(name="a", metrics_data=[_metric("Answer Relevancy", 1.2, True)]),
    ]
    payload = build_payload(name="nightly", goldens=goldens, answers=answers, test_results=results, failed_runs={"c": "502 run_failed: boom"}, metadata={"commit": "abc"})
    assert payload["framework"] == "deepeval"
    assert payload["metadata"] == {"commit": "abc"}
    assert "judgeModel" not in payload
    a, b, c = payload["cases"]
    assert a["toolsCalled"] == ["calculator", "search_knowledge"]
    assert a["metrics"][0]["score"] == 1.0  # clamped to the gateway's 0–1 range
    assert b["metrics"][0]["reason"] == "অপ্রাসঙ্গিক"
    assert c["metrics"][0] == {"name": "Agent Run", "score": 0.0, "threshold": 1.0, "success": False, "error": "502 run_failed: boom"}
    assert pass_rate(payload) == pytest.approx(1 / 3)
    json.dumps(payload, ensure_ascii=False)


def test_cli_runs_goldens_and_records_the_result(tmp_path, monkeypatch, capsys) -> None:
    dataset = tmp_path / "smoke.yaml"
    dataset.write_text('goldens:\n  - name: hello\n    turns: ["আমার নাম রাহিম।"]\n    input: "আমার নাম কী?"\n    expected_tools: []\n', encoding="utf-8")
    seen: list[tuple[str, str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        seen.append((request.method, request.url.path, body))
        assert request.headers["authorization"] == "Bearer bck_test"
        if request.url.path == "/v1/me":
            return httpx.Response(200, json={"user": {"id": "u1", "name": "ci", "role": "admin"}})
        if request.url.path == "/v1/agents/run":
            reply = "আপনার নাম রাহিম।" if body["text"].endswith("কী?") else "ধন্যবাদ!"
            return httpx.Response(200, json={"sessionId": "s-1", "reply": reply, "run": {"id": "r-1", "language": "bn", "toolCalls": []}})
        if request.url.path == "/v1/admin/evals":
            return httpx.Response(201, json={"eval": {"id": "e-1", **body}})
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "nope"}})

    real_init = Gateway.__init__
    monkeypatch.setattr(Gateway, "__init__", lambda self, url, key, **kw: real_init(self, url, key, transport=httpx.MockTransport(handler)))
    monkeypatch.setenv("BANGLACLAW_API_KEY", "bck_test")
    out = tmp_path / "result.json"

    code = main(["run", str(dataset), "--metrics", "tool_correctness,language_match", "--label", "pr=42", "--output", str(out), "--min-pass-rate", "1"])

    assert code == 0, capsys.readouterr().err
    runs = [b for m, p, b in seen if p == "/v1/agents/run"]
    assert [r["text"] for r in runs] == ["আমার নাম রাহিম।", "আমার নাম কী?"]
    assert runs[0]["externalId"] == runs[1]["externalId"]  # one session per golden
    recorded = next(b for m, p, b in seen if p == "/v1/admin/evals")
    assert recorded["name"] == "smoke"
    assert recorded["metadata"]["pr"] == 42
    case = recorded["cases"][0]
    assert case["sessionId"] == "s-1"
    assert {m["name"]: m["success"] for m in case["metrics"]} == {"Tool Correctness": True, "Language Match": True}
    assert json.loads(out.read_text(encoding="utf-8"))["cases"][0]["actualOutput"] == "আপনার নাম রাহিম।"
    assert "1/1 cases passed" in capsys.readouterr().out
