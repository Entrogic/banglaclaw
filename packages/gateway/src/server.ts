import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { createGatewayApp } from "./app.js";
import type { GatewayDeps } from "./context.js";

export interface RunningGateway {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Starts the gateway on Node with REST, SSE and WebSocket support. */
export async function startGateway(deps: GatewayDeps): Promise<RunningGateway> {
  const root = new Hono();
  const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({ app: root });
  root.route("/", createGatewayApp(deps, upgradeWebSocket));

  const { host, port } = deps.config;
  const server = await new Promise<ServerType>((resolve, reject) => {
    const s = serve({ fetch: root.fetch, hostname: host, port }, () => resolve(s));
    s.once("error", reject);
  });
  injectWebSocket(server);

  const address = server.address() as AddressInfo;
  const displayHost = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    url: `http://${displayHost}:${address.port}`,
    port: address.port,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => server.close((error) => (error !== undefined ? reject(error) : resolve())));
    },
  };
}
