# syntax=docker/dockerfile:1
# BanglaClaw production image: gateway + channels + CLI (banglaclaw serve) + admin dashboard (/admin).
#   docker build -t banglaclaw .
#   docker run -p 3000:3000 --env-file .env banglaclaw

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter @entrogic-net/cli deploy --prod /out \
 && pnpm --filter @entrogic-net/mcp-server-bangladesh deploy --prod /out-mcp

FROM node:24-alpine
ENV NODE_ENV=production \
    BANGLACLAW_GATEWAY_HOST=0.0.0.0 \
    BANGLACLAW_GATEWAY_PORT=3000
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /out-mcp ./mcp-servers/bangladesh
COPY --from=build /repo/skills ./skills
COPY --from=build /repo/examples ./examples
COPY --from=build /repo/apps/dashboard/dist ./dashboard
COPY docker/banglaclaw.docker.yaml ./banglaclaw.yaml
RUN ln -s /app/dist/index.js /usr/local/bin/banglaclaw && chmod +x /app/dist/index.js
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- "http://127.0.0.1:${BANGLACLAW_GATEWAY_PORT}/health" >/dev/null || exit 1
ENTRYPOINT ["node", "/app/dist/index.js"]
CMD ["serve"]
