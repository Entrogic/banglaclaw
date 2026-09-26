# 11 — Channels

Channels are adapters around external communication platforms. They normalise platform messages, pass them to the agent runtime, and send the reply back. They contain no reasoning logic (ADR-0005).

## Architecture (v0.5)

```text
Telegram (polling | webhook) ─┐
WhatsApp Cloud API (webhook) ─┤
Facebook Messenger (webhook) ─┼─→ ChannelRouter ─→ SessionStore (channel, conversationId) ─→ AgentRuntime
                              │     access check, per-chat rate limit, /start /new,
Web chat (/chat → /v1/ws) ────┘     per-conversation ordering, typing, reply splitting
   (goes through the gateway API)
```

`packages/channels`:

```ts
interface InboundMessage { conversationId: string; senderId: string; senderName?: string; text?: string }

interface ChannelAdapter {
  readonly name: string;              // session channel, e.g. "telegram"
  readonly maxMessageLength: number;  // replies are split to fit
  send(conversationId: string, text: string): Promise<void>;
  typing?(conversationId: string): Promise<void>;
}
```

`ChannelRouter.handle(adapter, message)`:

1. **Access check.** In `allowlist` mode (the default), senders not listed are refused with a localised message, and the refusals themselves are rate limited. `open` answers anyone.
2. **Per-chat rate limit.** `rateLimitPerMinute`, default 10.
3. **Commands.** `/start` sends a welcome; `/new` (or `/reset`) detaches the conversation from its session so the next message starts fresh. The old session is kept.
4. **Session.** Keyed by `(channel, conversationId)`, then the agent runs. Replies are split at paragraph, line or word boundaries to fit the platform limit.
5. **Ordering.** Messages in one conversation are processed strictly in order; different conversations run concurrently.
6. **Errors.** Failures send a localised "try again" message. Non-text messages (photos, stickers) get a "text only" notice, and voice notes too unless `voice` is enabled (below).

Notices are localised in Bangla, Banglish and English using `detectLanguage`.

## Telegram

- Bot API over `fetch` (no SDK). Plain-text replies (no `parse_mode`), so model output never breaks Markdown rules.
- `mode: polling`: long polling with backoff. It calls `deleteWebhook` first. No public URL is needed, which makes it good for development.
- `mode: webhook`: the gateway mounts `POST /channels/telegram/webhook`, verifies `X-Telegram-Bot-Api-Secret-Token` against `TELEGRAM_WEBHOOK_SECRET` with a timing-safe comparison, and registers `<webhookUrl>/channels/telegram/webhook` with `setWebhook` on startup. It answers 200 immediately and processes the message in the background.
- v0.5 handles private chats only; group messages are ignored.
- To find your user id for the allowlist: message the bot, then read `senderId` in the gateway log ("message from sender not in allowlist").

## WhatsApp (Cloud API)

- Webhook only, so it needs a public HTTPS URL to the gateway. Configure `https://<host>/channels/whatsapp/webhook` in the Meta app dashboard.
- `GET` performs the verification handshake (`hub.verify_token` must equal `WHATSAPP_VERIFY_TOKEN`).
- `POST` bodies must carry a valid `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with `WHATSAPP_APP_SECRET`); others get 401. Events for other phone-number ids and status updates are acknowledged and ignored.
- Replies go through `POST /{graphApiVersion}/{phoneNumberId}/messages` with `WHATSAPP_ACCESS_TOKEN`.

## Facebook Messenger

For a Facebook page, which is how many shops in Bangladesh sell. The Meta webhook model is the same as WhatsApp's; the signature and handshake code are shared (`meta.ts`).

- Webhook only, at `https://<host>/channels/messenger/webhook`. In the Meta app dashboard, add the Messenger product, generate a page access token, set the callback URL and verify token, and subscribe the page to `messages` and `messaging_postbacks`.
- `GET` performs the verification handshake (`MESSENGER_VERIFY_TOKEN`); `POST` bodies need a valid `X-Hub-Signature-256` made with `MESSENGER_APP_SECRET`, otherwise 401.
- The conversation id and sender id are the page-scoped user id (PSID). Echoes of the page's own messages, delivery and read receipts, and events for pages other than `pageId` are acknowledged and ignored.
- Postbacks (buttons) arrive as their title. The **Get Started** button (payload `GET_STARTED`) is answered like `/start`. Attachments without text get the "text only" notice.
- Replies go through the Send API (`POST /{graphApiVersion}/me/messages`, `messaging_type: RESPONSE`), split at 2,000 characters, with a `typing_on` indicator while the agent works.
- Messenger only allows replies within 24 hours of the user's last message. Operator replies during a handoff can use the `HUMAN_AGENT` tag (7 days) with `humanAgentTag: true`, which needs Meta's `human_agent` permission for the app.
- For a public page, set `access: open` (rate limits still apply; every message costs model tokens). With `allowlist`, find PSIDs in the gateway log.

```yaml
channels:
  messenger:
    enabled: true
    pageId: "104512345678901"
    access: open
```

## Voice notes

Many people in Bangladesh send voice messages instead of typing Bangla on a phone. With `voice.enabled`, voice notes and audio messages on Telegram, WhatsApp and Messenger are transcribed and then answered like text:

1. The access check and rate limit run first; audio from senders who aren't allowed is never downloaded.
2. Voice notes longer than `voice.maxSeconds` (default 120, when the platform reports the length) are refused before download with a localised "too long" notice.
3. The audio is downloaded (Telegram `getFile`; the WhatsApp Media API with the access token; the https URL of a Messenger attachment), up to 25 MB.
4. It is transcribed by an OpenAI-compatible `POST /audio/transcriptions` endpoint (`voice.model`, default `whisper-1`; `voice.baseUrl` for a self-hosted server) with the `voice.language` hint (default `bn`, or `auto`).
5. The transcript becomes the user's message: the agent sees it, it is stored in the session, and the reply goes back as text. An empty or failed transcription gets a "couldn't understand, please type" notice.

`TRANSCRIPTION_API_KEY` overrides `OPENAI_API_KEY` for this endpoint. The `Transcriber` interface lives in `shared` and `OpenAICompatibleTranscriber` in `providers`, so channels stay provider-independent.

```yaml
voice:
  enabled: true
  model: whisper-1        # or gpt-4o-mini-transcribe
  language: bn
  maxSeconds: 120
```

## Web

`GET /chat` on the gateway serves a self-contained chat page with a strict CSP and no external assets. It connects to `/v1/ws` with an API key, which is kept in the browser's localStorage, resumes the last session and follows it, so a human operator's replies during a handoff appear live. The layout follows OpenClaw's Control UI: a sidebar of the key's own sessions (`GET /v1/sessions`, labelled by their first message, grouped by day) that reloads a transcript from `GET /v1/sessions/:id/messages`, a flat reply stream rendered as markdown while it streams (lists, tables, code blocks with Copy; only http(s) links, everything else escaped), tool calls as expandable cards that fold into a "Worked for 1.2s · 2 tools" line when the run ends, and a composer with a Stop button, `/new`, `/sessions`, `/theme` and `/logout` commands and a footer with the agent, session and token count. It follows the OS light/dark preference, and a sidebar button overrides it (saved in localStorage). It's intended for developers and internal users. For your website's visitors, use the widget below.

## Website widget

A chat bubble for any website, answered by the agent, for anonymous visitors ([ADR-0013](adr/0013-website-widget.md)). Enable it and list the sites that may embed it:

```yaml
channels:
  widget:
    enabled: true
    allowedOrigins: [https://shop.example.com]    # required; "*" allows any site (development only)
    title: Dokan সহায়তা
    greeting: আসসালামু আলাইকুম! শাড়ি, দাম বা ডেলিভারি নিয়ে জিজ্ঞেস করুন।
    color: "#0b6b4f"
    position: right                               # right | left
```

Set `BANGLACLAW_WIDGET_SECRET` (32+ characters, for example `openssl rand -hex 32`), run `banglaclaw serve`, and add one line to your pages. `serve` prints it with the gateway's address:

```html
<script src="https://bot.example.com/widget.js" async></script>
```

How it works:

- **Loader.** `/widget.js` (about 4 KB, settings baked in) adds a bubble in a shadow root and, on first open, an iframe with `/widget/frame`. It exposes `window.BanglaClaw.open()`, `.close()` and `.toggle()`, shows an unread dot when a reply arrives while closed, and goes full screen on phones.
- **Frame.** The chat page is same-origin with the gateway, so it needs no CORS. `Content-Security-Policy: frame-ancestors <allowedOrigins>` makes browsers refuse to show it on any other site. It streams replies as markdown with the same escaping renderer as the web chat, reloads the conversation, keeps following it for operator replies during a handoff, and has a "new conversation" button.
- **Visitors.** A visitor gets a signed token (`POST /widget/api/session`, HMAC-SHA256 with the widget secret, 30 days by default) instead of an API key. The token's random id keys one `widget` session (`externalId`), which appears in the admin dashboard and the handoff queue like any channel. Renewing a valid token keeps the conversation, and "new conversation" detaches it.
- **Privacy.** Visitors see replies only: tool names, inputs and outputs are never sent to the browser, and the history endpoint returns text messages only.
- **Limits.** `messagesPerMinute` per visitor (and 5× that per IP), `sessionsPerMinute` new visitors per IP, one reply at a time per visitor, `maxConcurrentRuns` across all visitors, and `maxInputChars` per message. Behind a reverse proxy set `gateway.trustProxy: true`, or every visitor shares the proxy's IP. Allowed tools (`tools.allow`) are available to anyone who can open your site, so keep that list to what the public may use.

`examples/widget/index.html` is a demo shop page: serve it from an allowed origin (for example `python3 -m http.server 5173` with `allowedOrigins: [http://localhost:5173]`) and point its script tag at your gateway.

## Configuration

See docs/16. Secrets come from environment variables only: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN`, `BANGLACLAW_WIDGET_SECRET`. `banglaclaw serve` starts the enabled channels; `banglaclaw doctor` validates them (Telegram `getMe`, the Messenger page behind the token).

## Planned

- Telegram groups (mention/reply triggers), voice notes via speech-to-text, images
- Streaming replies by editing messages
- Discord
- Widget: file and image uploads, visitor identity from the host site (signed user hints)
- Linking channel identities to gateway users
