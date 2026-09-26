import { randomBytes } from "node:crypto";
import type { WidgetOptions } from "@entrogic-net/gateway";
import { ConfigError, type LoadedConfig } from "@entrogic-net/shared";

const MIN_SECRET_LENGTH = 32;

/**
 * Widget settings for the gateway, or undefined when channels.widget is off. Fails fast on a
 * config that would expose it to every site by accident, or on a weak secret. Without
 * BANGLACLAW_WIDGET_SECRET a random per-process secret is used (visitors lose their
 * conversation on restart) and a warning is returned, as it is without gateway.trustProxy.
 */
export function resolveWidget(loaded: LoadedConfig): { options?: WidgetOptions; warnings: string[] } {
  const { enabled, ...settings } = loaded.config.channels.widget;
  if (!enabled) return { warnings: [] };
  if (settings.allowedOrigins.length === 0) {
    throw new ConfigError('channels.widget.allowedOrigins is empty: list the sites that may embed the widget (for example ["https://shop.example.com"])');
  }
  const configured = loaded.secrets.widgetSecret;
  if (configured !== undefined && configured.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`BANGLACLAW_WIDGET_SECRET must be at least ${MIN_SECRET_LENGTH} characters (try: openssl rand -hex 32)`);
  }
  const options: WidgetOptions = { ...settings, secret: configured ?? randomBytes(32).toString("hex") };
  const warnings = [
    ...(configured === undefined ? ["BANGLACLAW_WIDGET_SECRET is not set: widget visitors start a new conversation whenever the gateway restarts"] : []),
    ...(loaded.config.gateway.trustProxy ? [] : ["Widget rate limits are per client IP: behind a reverse proxy set gateway.trustProxy: true, or all visitors share the proxy's IP"]),
  ];
  return { options, warnings };
}
