# ১০ — MCP (Model Context Protocol)

> ইংরেজি মূল: [../10-mcp.md](../10-mcp.md)

MCP BanglaClaw-এর প্রথম সারির ইন্টিগ্রেশন স্তর (ADR-0003)। v0.3 থেকে **ক্লায়েন্ট** দিক বাস্তবায়িত: BanglaClaw MCP সার্ভারে সংযোগ করে, তাদের টুল খুঁজে বের করে, এবং বিল্ট-ইন টুলের মতোই অনুমতি যাচাই করে এজেন্টকে সেগুলো কল করতে দেয়।

## ক্লায়েন্ট আর্কিটেকচার

```text
AgentRuntime ── ToolRegistry ──┬── বিল্ট-ইন টুল
                               └── MCP টুল  (<server>__<tool>)
                                        │
                                   McpManager  (packages/mcp)
                                        │
                     ┌──────────────────┼──────────────────┐
                 stdio প্রসেস        stdio প্রসেস       Streamable HTTP
               (bangladesh MCP)      (অন্য MCP)          (রিমোট MCP)
```

- `McpManager.connectAll()` সব চালু সার্ভারে একসাথে সংযোগ করে (`connectTimeoutMs` সহ) এবং `tools/list` পাতায় পাতায় পড়ে।
- প্রতিটি টুল `<server>__<tool>` নামে একটি `BanglaClawTool` হিসেবে মোড়ানো হয় (snake_case, সর্বোচ্চ ৬৪ অক্ষর, বেশি লম্বা হলে হ্যাশ)। ফলে বিল্ট-ইন টুল বা অন্য সার্ভারের টুলের সাথে নাম মেলে না।
- সার্ভারের JSON Schema মডেলকে হুবহু দেখানো হয় (`parameters`)। কল করার আগে ইনপুট স্থানীয়ভাবে `z.fromJSONSchema` দিয়ে যাচাই হয়।
- ফলাফল `{ content?, structured?, truncated }` আকারে সমতল করা হয়। যে টেক্সট শুধু structured কনটেন্টের পুনরাবৃত্তি তা বাদ যায়, আর আউটপুট ২০,০০০ অক্ষরে সীমিত। `isError` ফলাফল টুল এরর হয়ে যায়।
- কোনো সার্ভার সংযোগে ব্যর্থ হলে তা জানানো হয় (`mcp list`, `doctor`, এবং `chat` / `agent run`-এ সতর্কবার্তা), কিন্তু এজেন্ট থামে না। বন্ধ করার সময় সংযোগগুলো বন্ধ হয়।

## নিরাপত্তা সীমা (docs/14)

MCP সার্ভারকে **অবিশ্বস্ত** ধরা হয়:

- **ডিফল্টে নিষেধ।** MCP টুল চলে শুধু `tools.allow`-এ অনুমতি থাকলে, সঠিক নাম দিয়ে বা `bangladesh__*`-এর মতো সার্ভার ওয়াইল্ডকার্ড দিয়ে।
- **ঝুঁকি (risk)।** প্রতিটি MCP টুল অন্তত `sensitive`। `destructiveHint` থাকলে টুলটি `destructive` হয়, যা সবসময় নিষিদ্ধ। অ্যানোটেশন ঝুঁকি বাড়াতে পারে, কখনো কমাতে পারে না।
- **টাইমআউট।** প্রতিটি কল সার্ভারের `timeoutMs`-এ এবং পুরো রান `runtime.timeoutMs`-এ সীমিত।
- **এনভায়রনমেন্ট।** stdio সার্ভার শুধু নিরাপদ ডিফল্ট (PATH, HOME, …) ও নিজের কনফিগ করা `env` পায়; প্যারেন্ট প্রসেসের API key-সহ পুরো এনভায়রনমেন্ট কখনো পায় না। সিক্রেট `${VAR}` আকারে লেখা হয় এবং সংযোগের সময় এনভায়রনমেন্ট থেকে বসানো হয়।
- **কনটেক্সট।** টুলের বর্ণনার শুরুতে `[MCP <server>]` বসে এবং বর্ণনা ছোট করা হয়। সিস্টেম প্রম্পট মডেলকে বলে যে টুলের ফলাফল ডেটা, নির্দেশনা নয়। এটি শুধু ঝুঁকি কমানোর ব্যবস্থা; আসল নিরাপত্তা সীমা অ্যাপ্লিকেশনের পলিসি।
- **অডিট।** প্রতিটি কল রানের অডিট ট্রেইলে জমা হয় (PostgreSQL স্টোরেজে `tool_calls` টেবিল)।

## কনফিগারেশন

```yaml
tools:
  allow: [calculator, current_datetime, "bangladesh__*"]

mcp:
  servers:
    bangladesh:
      transport: stdio
      command: node
      args: [--import, tsx, mcp-servers/bangladesh/src/bin.ts]   # কনফিগ ফাইলের সাপেক্ষে
      env: {}
      timeoutMs: 30000
      connectTimeoutMs: 15000
    remote:
      transport: http
      url: https://mcp.example.com/mcp
      headers: { Authorization: "Bearer ${REMOTE_MCP_TOKEN}" }
      enabled: true
```

## নতুন MCP সার্ভার যুক্ত করা

১. `mcp.servers`-এ একটি নাম দিয়ে সার্ভার যোগ করুন (উপরের উদাহরণের মতো stdio বা http)। টোকেন সরাসরি YAML-এ নয়, `.env`-এ রাখুন এবং `${VAR}` দিয়ে উল্লেখ করুন।

২. `tools.allow`-এ টুলগুলোর অনুমতি দিন। শুধু দরকারি টুল দিন (যেমন `remote__search`); পুরো সার্ভারে বিশ্বাস থাকলে তবেই `remote__*` দিন।

৩. যাচাই করুন:

```bash
pnpm banglaclaw mcp list        # সংযোগের অবস্থা ও পাওয়া টুল
pnpm banglaclaw tool list       # কোন টুল অনুমোদিত (allowed)
pnpm banglaclaw doctor
```

## সাথে দেওয়া উদাহরণ সার্ভার

`mcp-servers/bangladesh` (`@banglaclaw/mcp-server-bangladesh`) একটি শুধু-পড়া (read-only) রেফারেন্স-ডেটা সার্ভার:

| টুল | কাজ |
|---|---|
| `list_divisions` | বাংলা নাম ও জেলার সংখ্যা সহ ৮টি বিভাগ |
| `list_districts` | ৬৪টি জেলা, অথবা একটি বিভাগের জেলা (ইংরেজি বা বাংলা নাম) |
| `find_district` | ইংরেজি/বাংলা নাম, শুরুর অংশ বা পুরনো বানান দিয়ে জেলা খোঁজা (Comilla → Cumilla) |
| `format_taka` | লাখ/কোটি গ্রুপিং (৳১,২৩,৪৫,৬৭৮.৫০) এবং কোটি/লক্ষ/হাজার ভাঙন |
| `convert_digits` | বাংলা ↔ ইংরেজি অঙ্ক |

## পরিকল্পনায় আছে

- BanglaClaw-এর নির্বাচিত ক্ষমতা MCP সার্ভার হিসেবে প্রকাশ করা
- সংযোগ ছিন্ন হলে পুনঃসংযোগ এবং `tools/list_changed` নোটিফিকেশন সামলানো
- MCP resources ও prompts
- প্রতি সার্ভারে টুল ফিল্টারিং এবং রিমোট সার্ভারের জন্য OAuth
