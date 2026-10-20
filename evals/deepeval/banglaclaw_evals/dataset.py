"""Eval datasets: YAML or JSON files with a list of goldens (docs/26)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .language import Language

_NAME = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
_LANGUAGES = ("bn", "bn-en", "en")


class DatasetError(ValueError):
    pass


@dataclass(frozen=True)
class Golden:
    """One test input. `turns` are earlier user messages sent first, in the same session."""

    name: str
    input: str
    expected_output: str | None = None
    expected_tools: list[str] | None = None
    context: list[str] | None = None
    turns: list[str] = field(default_factory=list)
    reply_language: Language | None = None
    tags: list[str] = field(default_factory=list)


def _str_list(value: Any, where: str) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise DatasetError(f"{where} must be a list of strings")
    return list(value)


def parse_goldens(data: Any) -> list[Golden]:
    """Validates the parsed file: `{goldens: [...]}` or a bare list."""
    items = data.get("goldens") if isinstance(data, dict) else data
    if not isinstance(items, list) or not items:
        raise DatasetError("the dataset must contain a non-empty list of goldens")

    goldens: list[Golden] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        where = f"goldens[{index}]"
        if not isinstance(item, dict):
            raise DatasetError(f"{where} must be a mapping")
        unknown = set(item) - {"name", "input", "expected_output", "expected_tools", "context", "turns", "reply_language", "tags"}
        if unknown:
            raise DatasetError(f"{where}: unknown keys {sorted(unknown)}")
        text = item.get("input")
        if not isinstance(text, str) or not text.strip():
            raise DatasetError(f"{where}.input is required")
        name = item.get("name", f"case-{index + 1}")
        if not isinstance(name, str) or not _NAME.match(name):
            raise DatasetError(f"{where}.name must match {_NAME.pattern}")
        if name in seen:
            raise DatasetError(f"{where}.name {name!r} is used twice")
        seen.add(name)
        expected = item.get("expected_output")
        if expected is not None and not isinstance(expected, str):
            raise DatasetError(f"{where}.expected_output must be a string")
        reply_language = item.get("reply_language")
        if reply_language is not None and reply_language not in _LANGUAGES:
            raise DatasetError(f"{where}.reply_language must be one of {_LANGUAGES}")
        goldens.append(
            Golden(
                name=name,
                input=text,
                expected_output=expected,
                expected_tools=_str_list(item.get("expected_tools"), f"{where}.expected_tools"),
                context=_str_list(item.get("context"), f"{where}.context"),
                turns=_str_list(item.get("turns"), f"{where}.turns") or [],
                reply_language=reply_language,
                tags=_str_list(item.get("tags"), f"{where}.tags") or [],
            )
        )
    return goldens


def load_dataset(path: str | Path) -> list[Golden]:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    data = json.loads(text) if file.suffix == ".json" else yaml.safe_load(text)
    return parse_goldens(data)
