"""python -m banglaclaw_evals run <dataset> — see evals/deepeval/README.md and docs/26."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .dataset import DatasetError, load_dataset
from .gateway import Gateway, GatewayError
from .metrics import DEFAULT_METRICS, METRICS, needs_judge
from .report import pass_rate
from .runner import EvalOptions, run_eval


def _pairs(values: list[str], what: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for value in values:
        key, sep, val = value.partition("=")
        if not sep or not key:
            raise SystemExit(f"--{what} expects key=value, got {value!r}")
        out[key] = val
    return out


def _label_value(value: str) -> str | int | float | bool:
    if value in ("true", "false"):
        return value == "true"
    for cast in (int, float):
        try:
            return cast(value)
        except ValueError:
            pass
    return value


def _ci_labels() -> dict[str, str]:
    """Commit and run labels from GitHub Actions, when present."""
    env = os.environ
    labels = {"commit": env.get("GITHUB_SHA", "")[:12], "ref": env.get("GITHUB_REF_NAME", ""), "ci_run": env.get("GITHUB_RUN_ID", "")}
    return {k: v for k, v in labels.items() if v}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="banglaclaw_evals", description="Evaluate a BanglaClaw agent with DeepEval and record the results on the gateway.")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run a dataset through the agent and score it")
    run.add_argument("dataset", help="YAML or JSON file with goldens")
    run.add_argument("--gateway", default=os.environ.get("BANGLACLAW_GATEWAY_URL", "http://127.0.0.1:3000"), help="gateway URL (env BANGLACLAW_GATEWAY_URL)")
    run.add_argument("--name", help="eval name shown in the dashboard (default: the dataset file name)")
    run.add_argument("--metrics", default=",".join(DEFAULT_METRICS), help=f"comma-separated, from: {', '.join(sorted(METRICS))}")
    run.add_argument("--threshold", action="append", default=[], metavar="METRIC=VALUE", help="override a metric's pass threshold (0-1)")
    run.add_argument("--judge-model", default=os.environ.get("BANGLACLAW_EVAL_JUDGE_MODEL"), help="model for LLM-as-a-judge metrics (DeepEval's default when unset)")
    run.add_argument("--label", action="append", default=[], metavar="KEY=VALUE", help="free-form label stored with the run, e.g. commit=abc123")
    run.add_argument("--parallel", type=int, default=1, help="agent runs in flight at once (the gateway limits runs per key)")
    run.add_argument("--judge-concurrency", type=int, default=8, help="DeepEval metric evaluations in flight at once")
    run.add_argument("--output", type=Path, help="also write the result JSON to this file")
    run.add_argument("--no-record", action="store_true", help="do not send the result to the gateway")
    run.add_argument("--min-pass-rate", type=float, help="exit with status 1 when fewer cases pass (0-1), for CI")
    run.add_argument("-v", "--verbose", action="store_true", help="show DeepEval's progress and per-case results")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    api_key = os.environ.get("BANGLACLAW_API_KEY")
    if not api_key:
        print("Set BANGLACLAW_API_KEY to an admin API key (bck_…).", file=sys.stderr)
        return 2
    metrics = [m.strip() for m in args.metrics.split(",") if m.strip()]
    unknown = [m for m in metrics if m not in METRICS]
    if unknown:
        print(f"Unknown metrics {unknown}; choose from {', '.join(sorted(METRICS))}.", file=sys.stderr)
        return 2
    try:
        goldens = load_dataset(args.dataset)
    except (OSError, DatasetError, ValueError) as error:
        print(f"Cannot load {args.dataset}: {error}", file=sys.stderr)
        return 2
    if needs_judge(metrics) and not args.judge_model and not os.environ.get("OPENAI_API_KEY"):
        print("Note: LLM-judged metrics use DeepEval's default model, which needs OPENAI_API_KEY (or pass --judge-model).", file=sys.stderr)

    options = EvalOptions(
        name=args.name or Path(args.dataset).stem,
        dataset=args.dataset,
        metrics=metrics,
        judge_model=args.judge_model,
        thresholds={k: float(v) for k, v in _pairs(args.threshold, "threshold").items()},
        labels={**_ci_labels(), **{k: _label_value(v) for k, v in _pairs(args.label, "label").items()}},
        parallel=args.parallel,
        judge_concurrency=args.judge_concurrency,
        verbose=args.verbose,
    )

    with Gateway(args.gateway, api_key) as gateway:
        try:
            me = gateway.me()
            if not args.no_record and me.get("user", {}).get("role") != "admin":
                print(f"The key belongs to {me['user'].get('name')!r} (role {me['user'].get('role')}); recording results needs an admin key, or pass --no-record.", file=sys.stderr)
                return 2
            payload = run_eval(gateway, goldens, options, log=lambda line: print(line, file=sys.stderr))
            if args.output is not None:
                args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            if not args.no_record:
                stored = gateway.record_eval(payload)
                print(f"Recorded eval {stored['id']}: open /admin/evals/{stored['id']}", file=sys.stderr)
        except GatewayError as error:
            print(f"Gateway error: {error}", file=sys.stderr)
            return 1

    rate = pass_rate(payload)
    passed = round(rate * len(payload["cases"]))
    print(f"{options.name}: {passed}/{len(payload['cases'])} cases passed ({rate:.0%})")
    if args.min_pass_rate is not None and rate < args.min_pass_rate:
        print(f"Pass rate {rate:.0%} is below --min-pass-rate {args.min_pass_rate:.0%}.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
