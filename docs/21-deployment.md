# 21 — Deployment

## Docker (recommended)

The repository `Dockerfile` builds a production image with a multi-stage build, a production-only install (`pnpm deploy`), the non-root `node` user and a healthcheck. The image contains the CLI, gateway and channels, the admin dashboard, the bundled skills, examples, and the Bangladesh MCP server.

```bash
cp .env.example .env            # set OPENAI_API_KEY (or ANTHROPIC_API_KEY), POSTGRES_PASSWORD, channel tokens…
docker compose -f docker/compose.prod.yaml up -d --build
docker compose -f docker/compose.prod.yaml run --rm banglaclaw db migrate
docker compose -f docker/compose.prod.yaml run --rm banglaclaw key create --user my-app
docker compose -f docker/compose.prod.yaml run --rm banglaclaw key create --user ops --role admin
```

The stack runs BanglaClaw, PostgreSQL 17 and Qdrant. The gateway publishes on `127.0.0.1:3000` only; put a TLS-terminating reverse proxy in front of it.

The image ships `docker/banglaclaw.docker.yaml` as `/app/banglaclaw.yaml` (postgres storage, gateway on `0.0.0.0:3000`, web chat on, admin dashboard at `/admin`). Mount your own config over it:

```yaml
services:
  banglaclaw:
    volumes:
      - ./banglaclaw.yaml:/app/banglaclaw.yaml:ro
      - ./knowledge:/app/knowledge:ro      # knowledge.sources
      - ./agents:/app/agents:ro            # AGENT.md specialists
```

## Reverse proxy

Behind nginx, Caddy or Cloudflare:

- Set `gateway.trustProxy: true` so client IPs (for audit and rate limiting) come from `X-Forwarded-For`. Only do this when the proxy is the only way in.
- Allow WebSocket upgrades on `/v1/ws` and disable response buffering for SSE (`/v1/agents/run?stream=true`, `/v1/sessions/:id/messages`).
- Telegram webhook mode, WhatsApp and Messenger need a public HTTPS URL that reaches `/channels/*`.

Example Caddyfile:

```text
bot.example.com {
  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1
  }
}
```

nginx (key directives):

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_buffering off;              # SSE
  proxy_read_timeout 120s;
}
```

## Without Docker

Requires Node.js 22+ and pnpm.

```bash
pnpm install --frozen-lockfile && pnpm build
pnpm --filter @entrogic-net/cli deploy --prod /opt/banglaclaw
node /opt/banglaclaw/dist/index.js db migrate
node /opt/banglaclaw/dist/index.js serve
```

Run it under systemd or PM2 with `Restart=always`. `serve` shuts down gracefully on SIGTERM: it stops polling, drains channel queues, then closes the gateway and database connections.

## Checklist

- [ ] `storage.provider: postgres`, migrations applied (`banglaclaw db status`)
- [ ] Secrets only in the environment: `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, `DATABASE_URL`, channel tokens, `METRICS_TOKEN`
- [ ] Gateway reachable only through TLS; `trustProxy` set correctly
- [ ] `tools.allow` reviewed; channel access lists set (`access: allowlist`)
- [ ] An admin key for the audit log and the dashboard at `/admin`; an operator key if handoff is enabled
- [ ] `/metrics` scraped (with `METRICS_TOKEN`), tracing endpoint set if used
- [ ] Postgres and Qdrant backups (docs/22)
- [ ] `banglaclaw doctor` passes inside the container
