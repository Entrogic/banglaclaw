"""DeepEval metrics for BanglaClaw: built-in LLM-as-a-judge metrics plus Bangla-aware ones (docs/26)."""

from __future__ import annotations

from collections.abc import Callable

from deepeval.metrics import (
    AnswerRelevancyMetric,
    BaseMetric,
    ContextualRelevancyMetric,
    FaithfulnessMetric,
    GEval,
    ToolCorrectnessMetric,
)
from deepeval.test_case import LLMTestCase, SingleTurnParams

from .language import Language, acceptable_reply_languages, detect_language

CORRECTNESS_CRITERIA = """\
Judge whether the actual output answers the input correctly, using the expected output as the reference answer.
The conversation may be in Bangla (Bengali script), Banglish (Bangla written in Latin letters) or English.
Judge meaning, not wording or script: a correct answer in another phrasing or script is still correct.
Bengali and Latin digits are equivalent (৪২ = 42), and ৳, Tk and taka mean the same currency.
Numbers, amounts, dates, names and places must agree with the expected output.
Penalise invented facts and missing key information; do not penalise extra helpful detail that is correct."""

FLUENCY_CRITERIA = """\
Judge the language quality of the actual output for a Bangladeshi reader.
If it is in Bangla, it should be natural, grammatical standard Bangla in Bengali script (not machine-translated phrasing).
If it is in Banglish, it should be natural romanised Bangla as people type it in chat.
If it is in English, it should be clear and grammatical.
Ignore whether the facts are correct; judge only how the answer reads."""


class LanguageMatchMetric(BaseMetric):
    """Deterministic: does the reply use the language the user wrote in (or `metadata.reply_language`)?

    Mirrors the agent's own detection (packages/agent/src/language.ts), so no judge model is needed.
    """

    def __init__(self, threshold: float = 1.0) -> None:
        self.threshold = threshold
        self.include_reason = True
        self.async_mode = False
        self.strict_mode = False
        self.verbose_mode = False
        self.evaluation_model = None
        self.evaluation_cost = None

    def measure(self, test_case: LLMTestCase, *_: object, **__: object) -> float:
        metadata = test_case.metadata or {}
        wanted: Language | None = metadata.get("reply_language")
        input_language: Language = metadata.get("input_language") or detect_language(test_case.input)
        allowed = frozenset({wanted}) if wanted is not None else acceptable_reply_languages(input_language)
        got = detect_language(test_case.actual_output or "")
        self.score = 1.0 if got in allowed else 0.0
        expected = " or ".join(sorted(allowed))
        self.reason = f"Reply detected as {got}; expected {expected} (input was {input_language})."
        self.success = self.score >= self.threshold
        return self.score

    async def a_measure(self, test_case: LLMTestCase, *args: object, **kwargs: object) -> float:
        return self.measure(test_case, *args, **kwargs)

    def is_successful(self) -> bool:
        return bool(getattr(self, "success", False))

    @property
    def __name__(self) -> str:  # DeepEval reads the metric name from here
        return "Language Match"


def _correctness(model: str | None, threshold: float) -> BaseMetric:
    return GEval(
        name="Correctness",
        criteria=CORRECTNESS_CRITERIA,
        evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT, SingleTurnParams.EXPECTED_OUTPUT],
        model=model,
        threshold=threshold,
    )


def _fluency(model: str | None, threshold: float) -> BaseMetric:
    return GEval(
        name="Bangla Fluency",
        criteria=FLUENCY_CRITERIA,
        evaluation_params=[SingleTurnParams.INPUT, SingleTurnParams.ACTUAL_OUTPUT],
        model=model,
        threshold=threshold,
    )


# name → (factory, default threshold, needs a judge model)
METRICS: dict[str, tuple[Callable[[str | None, float], BaseMetric], float, bool]] = {
    "answer_relevancy": (lambda model, t: AnswerRelevancyMetric(threshold=t, model=model), 0.7, True),
    "faithfulness": (lambda model, t: FaithfulnessMetric(threshold=t, model=model), 0.7, True),
    "contextual_relevancy": (lambda model, t: ContextualRelevancyMetric(threshold=t, model=model), 0.5, True),
    "correctness": (_correctness, 0.6, True),
    "fluency": (_fluency, 0.6, True),
    # Compares tools called with expected_tools without model calls, but DeepEval still builds a judge model for it.
    "tool_correctness": (lambda model, t: ToolCorrectnessMetric(threshold=t, model=model), 1.0, True),
    "language_match": (lambda _model, t: LanguageMatchMetric(threshold=t), 1.0, False),
}

DEFAULT_METRICS = ("answer_relevancy", "correctness", "tool_correctness", "language_match")


def build_metrics(names: list[str], *, judge_model: str | None = None, thresholds: dict[str, float] | None = None) -> list[BaseMetric]:
    unknown = [n for n in names if n not in METRICS]
    if unknown:
        raise ValueError(f"unknown metrics {unknown}; choose from {sorted(METRICS)}")
    thresholds = thresholds or {}
    metrics: list[BaseMetric] = []
    for name in names:
        factory, default, _ = METRICS[name]
        metrics.append(factory(judge_model, thresholds.get(name, default)))
    return metrics


def needs_judge(names: list[str]) -> bool:
    return any(METRICS[n][2] for n in names if n in METRICS)
