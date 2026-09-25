# ১১ — চ্যানেল (Channels)

> ইংরেজি মূল: [../11-channels.md](../11-channels.md)

চ্যানেল হলো বাইরের যোগাযোগ প্ল্যাটফর্মের চারপাশের অ্যাডাপ্টার। এরা প্ল্যাটফর্মের মেসেজকে সাধারণ রূপে আনে, এজেন্ট রানটাইমে পাঠায় এবং উত্তর ফেরত পাঠায়। চ্যানেলে কোনো যুক্তি বা সিদ্ধান্তের কোড থাকে না (ADR-0005)।

## আর্কিটেকচার (v0.5)

```text
Telegram (polling | webhook) ─┐
WhatsApp Cloud API (webhook) ─┤
Facebook Messenger (webhook) ─┼─→ ChannelRouter ─→ SessionStore (channel, conversationId) ─→ AgentRuntime
                              │     অ্যাক্সেস যাচাই, প্রতি চ্যাটে রেট লিমিট, /start /new,
Web chat (/chat → /v1/ws) ────┘     কথোপকথনভিত্তিক ক্রম, typing, উত্তর ভাগ করা
   (গেটওয়ে API দিয়ে যায়)
```

`packages/channels`:

```ts
interface InboundMessage { conversationId: string; senderId: string; senderName?: string; text?: string }

interface ChannelAdapter {
  readonly name: string;              // সেশনের চ্যানেল, যেমন "telegram"
  readonly maxMessageLength: number;  // উত্তর এই সীমায় ভাগ করা হয়
  send(conversationId: string, text: string): Promise<void>;
  typing?(conversationId: string): Promise<void>;
}
```

`ChannelRouter.handle(adapter, message)` যা করে:

১. **অ্যাক্সেস যাচাই।** `allowlist` মোডে (ডিফল্ট) তালিকার বাইরের প্রেরককে স্থানীয় ভাষায় একটি বার্তা দিয়ে ফিরিয়ে দেওয়া হয়; এই প্রত্যাখ্যানেরও রেট লিমিট আছে। `open` মোডে সবাইকে উত্তর দেওয়া হয়।

২. **প্রতি চ্যাটে রেট লিমিট।** `rateLimitPerMinute`, ডিফল্ট ১০।

৩. **কমান্ড।** `/start` স্বাগত বার্তা পাঠায়। `/new` (বা `/reset`) কথোপকথনটিকে তার সেশন থেকে আলাদা করে, ফলে পরের মেসেজ নতুন করে শুরু হয়। পুরনো সেশন রেখে দেওয়া হয়।

৪. **সেশন।** `(channel, conversationId)` দিয়ে সেশন খোঁজা হয়, তারপর এজেন্ট চলে। উত্তর প্ল্যাটফর্মের সীমায় আঁটাতে অনুচ্ছেদ, লাইন বা শব্দের সীমানায় ভাগ করা হয়।

৫. **ক্রম।** একটি কথোপকথনের মেসেজ কঠোরভাবে ক্রমানুসারে প্রক্রিয়া হয়; আলাদা কথোপকথন একসাথে চলে।

৬. **এরর।** ব্যর্থ হলে স্থানীয় ভাষায় "আবার চেষ্টা করুন" বার্তা যায়। টেক্সট নয় এমন মেসেজে (ছবি, ভয়েস) "শুধু টেক্সট" নোটিস যায়।

নোটিসগুলো `detectLanguage` দিয়ে বাংলা, বাংলিশ ও ইংরেজিতে স্থানীয়করণ করা হয়।

## Telegram

- `fetch` দিয়ে সরাসরি Bot API (কোনো SDK নেই)। উত্তর সাধারণ টেক্সটে যায় (`parse_mode` নেই), তাই মডেলের আউটপুট Markdown-এর নিয়ম ভাঙতে পারে না।
- `mode: polling`: backoff সহ long polling। শুরুতে `deleteWebhook` কল করে। কোনো পাবলিক URL লাগে না, তাই ডেভেলপমেন্টের জন্য ভালো।
- `mode: webhook`: গেটওয়ে `POST /channels/telegram/webhook` যুক্ত করে। এটি `X-Telegram-Bot-Api-Secret-Token`-কে `TELEGRAM_WEBHOOK_SECRET`-এর সাথে timing-safe তুলনায় যাচাই করে, এবং শুরুতে `setWebhook` দিয়ে `<webhookUrl>/channels/telegram/webhook` নিবন্ধন করে। সাথে সাথে 200 দেয় এবং মেসেজ ব্যাকগ্রাউন্ডে প্রক্রিয়া করে।
- v0.5 শুধু প্রাইভেট চ্যাট সামলায়; গ্রুপের মেসেজ উপেক্ষা করা হয়।
- অ্যালাউলিস্টের জন্য নিজের user id জানতে: বটকে মেসেজ দিন, তারপর গেটওয়ের লগে ("message from sender not in allowlist") `senderId` দেখুন।

### দ্রুত সেটআপ (polling)

```bash
# .env
TELEGRAM_BOT_TOKEN=123456:ABC...     # @BotFather থেকে
```

```yaml
# banglaclaw.yaml
channels:
  telegram:
    enabled: true
    mode: polling
    access: allowlist
    allowedUserIds: [123456789]      # আপনার Telegram user id (সংখ্যা)
```

```bash
pnpm banglaclaw doctor               # টোকেন যাচাই করে (getMe)
pnpm banglaclaw serve
```

## WhatsApp (Cloud API)

- শুধু webhook, তাই গেটওয়ের একটি পাবলিক HTTPS URL লাগে। Meta অ্যাপ ড্যাশবোর্ডে `https://<host>/channels/whatsapp/webhook` কনফিগ করুন।
- `GET` যাচাই হ্যান্ডশেক করে (`hub.verify_token` অবশ্যই `WHATSAPP_VERIFY_TOKEN`-এর সমান হতে হবে)।
- `POST` বডিতে বৈধ `X-Hub-Signature-256` থাকতে হবে (`WHATSAPP_APP_SECRET` দিয়ে কাঁচা বডির HMAC-SHA256); না থাকলে 401। অন্য phone-number id-র ইভেন্ট ও স্ট্যাটাস আপডেট গ্রহণ করে উপেক্ষা করা হয়।
- উত্তর যায় `WHATSAPP_ACCESS_TOKEN` দিয়ে `POST /{graphApiVersion}/{phoneNumberId}/messages`-এ।

```yaml
channels:
  whatsapp:
    enabled: true
    phoneNumberId: "123456789012345"
    access: allowlist
    allowedNumbers: ["8801712345678"]
```

## Facebook Messenger

ফেসবুক পেজের জন্য। বাংলাদেশে অনেক দোকান ফেসবুক পেজ দিয়েই বিক্রি করে। Meta-র webhook মডেল WhatsApp-এর মতোই; সিগনেচার ও হ্যান্ডশেক কোড একই (`meta.ts`)।

- শুধু webhook, ঠিকানা `https://<host>/channels/messenger/webhook`। Meta অ্যাপ ড্যাশবোর্ডে Messenger প্রোডাক্ট যোগ করুন, পেজ access token তৈরি করুন, callback URL ও verify token দিন, এবং পেজটিকে `messages` ও `messaging_postbacks`-এ subscribe করুন।
- `GET` যাচাই হ্যান্ডশেক করে (`MESSENGER_VERIFY_TOKEN`); `POST` বডিতে `MESSENGER_APP_SECRET` দিয়ে তৈরি বৈধ `X-Hub-Signature-256` লাগে, না থাকলে 401।
- কথোপকথন ও প্রেরকের id হলো page-scoped user id (PSID)। পেজের নিজের মেসেজের echo, delivery/read রসিদ এবং `pageId` ছাড়া অন্য পেজের ইভেন্ট গ্রহণ করে উপেক্ষা করা হয়।
- বাটনের postback তার শিরোনাম হিসেবে আসে। **Get Started** বাটন (payload `GET_STARTED`) `/start`-এর মতো উত্তর পায়। লেখা ছাড়া শুধু ছবি/ফাইল এলে "শুধু টেক্সট" নোটিস যায়।
- উত্তর যায় Send API দিয়ে (`POST /{graphApiVersion}/me/messages`), ২,০০০ অক্ষরে ভাগ করে, এজেন্ট কাজ করার সময় `typing_on` দেখিয়ে।
- Messenger ব্যবহারকারীর শেষ মেসেজের ২৪ ঘণ্টার মধ্যেই উত্তর দিতে দেয়। হ্যান্ডঅফে অপারেটরের উত্তরে `humanAgentTag: true` দিলে `HUMAN_AGENT` ট্যাগ (৭ দিন) ব্যবহার হয়; এর জন্য অ্যাপের Meta-র `human_agent` অনুমতি লাগে।
- পাবলিক পেজের জন্য `access: open` দিন (রেট লিমিট তবুও থাকে; প্রতিটি মেসেজে মডেলের খরচ হয়)। `allowlist`-এ PSID গেটওয়ের লগ থেকে নিন।

```bash
# .env
MESSENGER_PAGE_ACCESS_TOKEN=EAAG...
MESSENGER_APP_SECRET=...
MESSENGER_VERIFY_TOKEN=যেকোনো-গোপন-লেখা
```

```yaml
channels:
  messenger:
    enabled: true
    pageId: "104512345678901"
    access: open
```

## ওয়েব

গেটওয়ের `GET /chat` একটি স্বয়ংসম্পূর্ণ চ্যাট পেজ দেয়, কঠোর CSP সহ এবং কোনো বাইরের ফাইল ছাড়া। এটি একটি API key দিয়ে `/v1/ws`-এ সংযোগ করে; key ব্রাউজারের localStorage-এ থাকে, শেষ সেশন আবার চালু হয় এবং সেশনটি অনুসরণ করা হয়, ফলে হ্যান্ডঅফের সময় অপারেটরের উত্তর সাথে সাথে দেখা যায়। এটি ডেভেলপার ও ভেতরের ব্যবহারকারীদের জন্য। পাবলিক, বেনামি ওয়েবসাইট উইজেটের জন্য আলাদা ভিজিটর-অথেনটিকেশন মডেল দরকার, যা পরিকল্পনায় আছে।

## কনফিগারেশন

দেখুন docs/16। সিক্রেট আসে শুধু এনভায়রনমেন্ট ভেরিয়েবল থেকে: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `MESSENGER_PAGE_ACCESS_TOKEN`, `MESSENGER_APP_SECRET`, `MESSENGER_VERIFY_TOKEN`। `banglaclaw serve` চালু চ্যানেলগুলো শুরু করে; `banglaclaw doctor` সেগুলো যাচাই করে (Telegram `getMe`, token-এর পেছনের Messenger পেজ)। কোনো চ্যানেল চালু থাকলে কিন্তু তার সিক্রেট না থাকলে `serve` শুরুতেই কনফিগ এরর দিয়ে থামে।

## পরিকল্পনায় আছে

- Telegram গ্রুপ (mention/reply দিয়ে ট্রিগার), speech-to-text দিয়ে ভয়েস নোট, ছবি
- মেসেজ এডিট করে উত্তর স্ট্রিম করা
- Discord, Messenger, এবং ভিজিটর সেশন সহ পাবলিক ওয়েব উইজেট
- চ্যানেলের পরিচয়কে গেটওয়ে ইউজারের সাথে যুক্ত করা
