---
"@entrogic-net/cli": patch
"@entrogic-net/observability": patch
"@entrogic-net/shared": patch
---

The npm CLI now ships the built-in `calculation` and `time-and-date` skills (turn them off with `skills.builtin: false`). Metrics move from the deprecated `prom-client` to `@prometheus-io/client`, and `marked` is pinned to 15.x for `marked-terminal` compatibility.
