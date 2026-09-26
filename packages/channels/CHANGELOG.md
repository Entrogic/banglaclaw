# @entrogic-net/channels

## 1.5.0

### Minor Changes

- bab41ba: Files sent on Telegram, WhatsApp or Messenger are saved to the sender's workspace under `uploads/` (PDF, DOCX and HTML as extracted text), and the agent is told where to read them. Controlled by `workspace.uploads` and `workspace.maxUploadBytes`. Adds `extractText` to `@entrogic-net/knowledge`.

### Patch Changes

- Updated dependencies [bab41ba]
- Updated dependencies [e1eb01e]
  - @entrogic-net/shared@1.5.0
  - @entrogic-net/session@1.5.0
  - @entrogic-net/agent@1.5.0

## 1.4.0

### Minor Changes

- 62e3e8e: Live Telegram replies: the bot's message is edited as the answer is written (at most every 1.5 s), spilling into new messages past 4096 characters. Turn it off with `channels.telegram.liveReplies: false`. Channel adapters can opt in by exposing `editable`.

### Patch Changes

- Updated dependencies [44ca0e0]
- Updated dependencies [62e3e8e]
- Updated dependencies [44ca0e0]
  - @entrogic-net/session@1.4.0
  - @entrogic-net/shared@1.4.0
  - @entrogic-net/agent@1.4.0

## 1.3.0

### Patch Changes

- Updated dependencies [3fccbd1]
- Updated dependencies [0fbd3fe]
  - @entrogic-net/shared@1.3.0
  - @entrogic-net/agent@1.3.0
  - @entrogic-net/session@1.3.0

## 1.2.0

### Minor Changes

- cfbed9e: First release on npm. Install the CLI with `npm install -g @entrogic-net/cli` or run `npx banglaclaw init`. This release also includes the admin dashboard, the Facebook Messenger channel, voice notes, DOCX and URL knowledge sources, BanglaClaw as an MCP server, live operator replies for API clients, and the OpenClaw-style web and terminal chat UIs.

### Patch Changes

- Updated dependencies [cfbed9e]
  - @entrogic-net/agent@1.2.0
  - @entrogic-net/session@1.2.0
  - @entrogic-net/shared@1.2.0
