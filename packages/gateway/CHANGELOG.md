# @entrogic-net/gateway

## 1.3.0

### Minor Changes

- 0fbd3fe: Website widget: add `<script src="https://<gateway>/widget.js" async></script>` to any site listed in `channels.widget.allowedOrigins` for a chat bubble that anonymous visitors can use without an API key (signed visitor tokens, CSP frame-ancestors, per-visitor and per-IP limits, live operator replies during a handoff). Set `BANGLACLAW_WIDGET_SECRET` so visitors keep their conversation across restarts.

### Patch Changes

- Updated dependencies [3fccbd1]
- Updated dependencies [0fbd3fe]
  - @entrogic-net/shared@1.3.0
  - @entrogic-net/agent@1.3.0
  - @entrogic-net/auth@1.3.0
  - @entrogic-net/knowledge@1.3.0
  - @entrogic-net/session@1.3.0
  - @entrogic-net/skills@1.3.0
  - @entrogic-net/tools@1.3.0

## 1.2.0

### Minor Changes

- cfbed9e: First release on npm. Install the CLI with `npm install -g @entrogic-net/cli` or run `npx banglaclaw init`. This release also includes the admin dashboard, the Facebook Messenger channel, voice notes, DOCX and URL knowledge sources, BanglaClaw as an MCP server, live operator replies for API clients, and the OpenClaw-style web and terminal chat UIs.

### Patch Changes

- Updated dependencies [cfbed9e]
  - @entrogic-net/agent@1.2.0
  - @entrogic-net/auth@1.2.0
  - @entrogic-net/knowledge@1.2.0
  - @entrogic-net/session@1.2.0
  - @entrogic-net/shared@1.2.0
  - @entrogic-net/skills@1.2.0
  - @entrogic-net/tools@1.2.0
