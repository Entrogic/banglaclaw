"""Runs a dataset through the agent, scores it with DeepEval and records the result on the gateway (docs/26)."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Callable

from deepeval import evaluate
from deepeval.evaluate.configs import AsyncConfig, DisplayConfig, ErrorConfig

from .dataset import Golden
from .gateway import AgentAnswer, Gateway, GatewayError
from .metrics import build_metrics
from .report import build_payload, to_test_case


@dataclass
class EvalOptions:
    name: str
    metrics: list[str]
    dataset: str | None = None
    judge_model: str | None = None
    thresholds: dict[str, float] = field(default_factory=dict)
    labels: dict[str, str | int | float | bool] = field(default_factory=dict)
    parallel: int = 1
    judge_concurrency: int = 8
    verbose: bool = False


def deepeval_version() -> str | None:
    try:
        return version("deepeval")
    except PackageNotFoundError:
        return None


def ask(gateway: Gateway, golden: Golden, session_key: str, retries: int = 5) -> AgentAnswer:
    """Sends the golden's earlier turns, then its input, in one session; retries while the gateway is busy (429)."""
    answer: AgentAnswer | None = None
    for text in [*golden.turns, golden.input]:
        for attempt in range(retries + 1):
            try:
                answer = gateway.run(text, external_id=session_key)
                break
            except GatewayError as error:
                if error.status != 429 or attempt == retries:
                    raise
                time.sleep(min(2**attempt, 10))
    assert answer is not None
    return answer


def run_agent(gateway: Gateway, goldens: list[Golden], options: EvalOptions, log: Callable[[str], None]) -> tuple[dict[str, AgentAnswer], dict[str, str]]:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    answers: dict[str, AgentAnswer] = {}
    failed: dict[str, str] = {}

    def one(golden: Golden) -> None:
        key = f"eval/{options.name}/{stamp}/{golden.name}"[:200]
        try:
            answers[golden.name] = ask(gateway, golden, key)
            log(f"  ✓ {golden.name}")
        except GatewayError as error:
            failed[golden.name] = str(error)
            log(f"  ✕ {golden.name}: {error}")

    with ThreadPoolExecutor(max_workers=max(1, options.parallel)) as pool:
        list(pool.map(one, goldens))
    return answers, failed


def score(goldens: list[Golden], answers: dict[str, AgentAnswer], options: EvalOptions) -> list[Any]:
    cases = [to_test_case(g, answers[g.name]) for g in goldens if g.name in answers]
    if not cases:
        return []
    result = evaluate(
        test_cases=cases,
        metrics=build_metrics(options.metrics, judge_model=options.judge_model, thresholds=options.thresholds),
        async_config=AsyncConfig(max_concurrent=options.judge_concurrency),
        display_config=DisplayConfig(print_results=options.verbose, show_indicator=options.verbose),
        # Metrics whose inputs a case lacks (no expected_output, no retrieval context…) are skipped for that case.
        error_config=ErrorConfig(ignore_errors=True, skip_on_missing_params=True),
    )
    return list(result.test_results)


def run_eval(gateway: Gateway, goldens: list[Golden], options: EvalOptions, log: Callable[[str], None] = print) -> dict[str, Any]:
    """Returns the POST /v1/admin/evals payload."""
    log(f"Asking the agent {len(goldens)} question(s)…")
    answers, failed = run_agent(gateway, goldens, options, log)
    log(f"Scoring with DeepEval: {', '.join(options.metrics)}…")
    results = score(goldens, answers, options)
    return build_payload(
        name=options.name,
        goldens=goldens,
        answers=answers,
        test_results=results,
        dataset=options.dataset,
        framework_version=deepeval_version(),
        judge_model=options.judge_model,
        metadata=options.labels,
        failed_runs=failed,
    )
