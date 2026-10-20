"""Minimal client for the BanglaClaw gateway's /v1 API (docs/18)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx

# The knowledge tool whose results become DeepEval's retrieval_context (packages/knowledge/src/tools.ts).
KNOWLEDGE_TOOL = "search_knowledge"


class GatewayError(RuntimeError):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code


@dataclass(frozen=True)
class AgentAnswer:
    """The reply to the last message of a golden, with the run that produced it."""

    reply: str
    session_id: str
    run: dict[str, Any]

    @property
    def run_id(self) -> str | None:
        return self.run.get("id")

    @property
    def language(self) -> str | None:
        return self.run.get("language")

    @property
    def status(self) -> str:
        return str(self.run.get("status", "unknown"))

    @property
    def tool_calls(self) -> list[dict[str, Any]]:
        return [c for c in self.run.get("toolCalls", []) if isinstance(c, dict)]

    def retrieval_context(self) -> list[str]:
        """Passages the agent retrieved with search_knowledge, as `[citation] text`."""
        passages: list[str] = []
        for call in self.tool_calls:
            if call.get("tool") != KNOWLEDGE_TOOL or call.get("status") != "ok":
                continue
            output = call.get("output")
            results = output.get("results", []) if isinstance(output, dict) else []
            for hit in results:
                if isinstance(hit, dict) and isinstance(hit.get("text"), str):
                    passages.append(f"[{hit.get('citation', '?')}] {hit['text']}")
        return passages


class Gateway:
    def __init__(self, base_url: str, api_key: str, *, timeout: float = 180.0, transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}", "User-Agent": "banglaclaw-evals"},
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Gateway":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _request(self, method: str, path: str, body: Any = None) -> dict[str, Any]:
        res = self._http.request(method, path, content=None if body is None else json.dumps(body, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"} if body is not None else None)
        if res.status_code >= 400:
            try:
                err = res.json().get("error", {})
            except ValueError:
                err = {}
            raise GatewayError(res.status_code, err.get("code", "http_error"), err.get("message", res.reason_phrase))
        return res.json() if res.content else {}

    def me(self) -> dict[str, Any]:
        return self._request("GET", "/v1/me")

    def run(self, text: str, *, external_id: str) -> AgentAnswer:
        """Sends one message in the session named by `external_id` (created on first use)."""
        data = self._request("POST", "/v1/agents/run", {"text": text, "externalId": external_id})
        return AgentAnswer(reply=data.get("reply", ""), session_id=data["sessionId"], run=data.get("run", {}))

    def record_eval(self, payload: dict[str, Any]) -> dict[str, Any]:
        """POST /v1/admin/evals (admin role) → the stored eval run summary."""
        return self._request("POST", "/v1/admin/evals", payload)["eval"]
