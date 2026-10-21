# @entrogic-net/cli

The `banglaclaw` command: a full-screen terminal chat, the HTTP gateway (`serve`), a setup wizard, and admin commands for sessions, keys, handoffs, the knowledge base and MCP.

Part of [BanglaClaw](https://github.com/Entrogic/banglaclaw), a Bangla-first, open-source AI agent runtime that understands বাংলা, Banglish and English.

## Install

```bash
npx banglaclaw init            # guided setup, no install needed
# or
npm install -g @entrogic-net/cli
banglaclaw init
banglaclaw chat
```

Requires Node.js 22+. `banglaclaw init` sets up OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, Together AI or a local OpenAI-compatible server such as Ollama. Without any key, `banglaclaw serve` still starts, so you can add a provider in the admin dashboard at `/admin/providers` (set `BANGLACLAW_SECRET_KEY` to store its key).

## Common commands

| Command | What it does |
|---|---|
| `banglaclaw chat` | Terminal chat (Ctrl+O tool details, Ctrl+P sessions) |
| `banglaclaw agent run "২৫ * ৪ কত?"` | One message, streamed reply |
| `banglaclaw serve` | HTTP gateway with `/v1` API, web chat at `/chat` and channels |
| `banglaclaw doctor` | Check configuration, keys, storage and integrations |
| `banglaclaw mcp serve` | Expose BanglaClaw as an MCP server over stdio (tools, resources, skill prompts) |

Run `banglaclaw --help` for everything, and see the [CLI docs](https://github.com/Entrogic/banglaclaw/blob/master/docs/17-cli.md) and [configuration reference](https://github.com/Entrogic/banglaclaw/blob/master/docs/16-configuration.md).

## License

[Apache-2.0](https://github.com/Entrogic/banglaclaw/blob/master/LICENSE)
