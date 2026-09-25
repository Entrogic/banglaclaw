# 11 — Channels

Channels are adapters around external communication platforms. They normalise platform messages, pass them to the agent runtime, and send the reply back. They contain no reasoning logic (ADR-0005).

## Architecture (v0.5)

```text
Telegram (polling | webhook) ─┐
WhatsApp Cloud API (webhook) ─┼─→ ChannelRouter ─→ SessionStore (channel, conversationId) ─→ AgentRuntime
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
6. **Errors.** Failures send a localised "try again" message. Non-text messages (photos, voice) get a "text only" notice.

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

## Web

`GET /chat` on the gateway serves a self-contained chat page with a strict CSP and no external assets. It connects to `/v1/ws` with an API key, which is kept in the browser's localStorage, resumes the last session and follows it, so a human operator's replies during a handoff appear live. It's intended for developers and internal users. A public, anonymous website widget needs a separate visitor-auth model and is planned.

## Configuration

See docs/16. Secrets come from environment variables only: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`. `banglaclaw serve` starts the enabled channels; `banglaclaw doctor` validates them (Telegram `getMe`).

## Planned

- Telegram groups (mention/reply triggers), voice notes via speech-to-text, images
- Streaming replies by editing messages
- Discord, Messenger, and a public web widget with visitor sessions
- Linking channel identities to gateway users
