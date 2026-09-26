---
"@entrogic-net/gateway": patch
"@entrogic-net/session": patch
---

`/v1/admin/stats?days=N` no longer returns an extra day between local midnight and UTC midnight: the window now starts at local midnight in the configured timezone.
