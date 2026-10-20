"""Evaluate a BanglaClaw agent with DeepEval and record the results on its gateway (docs/26)."""

from .dataset import Golden, load_dataset
from .gateway import AgentAnswer, Gateway, GatewayError
from .language import detect_language
from .metrics import DEFAULT_METRICS, LanguageMatchMetric, build_metrics
from .report import build_payload, pass_rate, to_test_case
from .runner import EvalOptions, run_eval

__all__ = [
    "AgentAnswer",
    "DEFAULT_METRICS",
    "EvalOptions",
    "Gateway",
    "GatewayError",
    "Golden",
    "LanguageMatchMetric",
    "build_metrics",
    "build_payload",
    "detect_language",
    "load_dataset",
    "pass_rate",
    "run_eval",
    "to_test_case",
]
