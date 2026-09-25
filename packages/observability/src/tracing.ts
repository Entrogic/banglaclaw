import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export interface Telemetry {
  enabled: boolean;
  endpoint?: string;
  /** Flushes pending spans. Safe to call when disabled. */
  shutdown(): Promise<void>;
}

/**
 * Starts OpenTelemetry tracing when OTEL_EXPORTER_OTLP_ENDPOINT (or ..._TRACES_ENDPOINT) is set;
 * otherwise tracing stays a no-op. Exports OTLP/HTTP to Jaeger, Tempo, Honeycomb, Langfuse, …
 * Standard OTEL_* variables (headers, service name) are honoured by the exporter.
 */
export function initTelemetry(options: { serviceName?: string; version: string; env?: NodeJS.ProcessEnv }): Telemetry {
  const env = options.env ?? process.env;
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint === undefined || endpoint.trim() === "" || env.OTEL_SDK_DISABLED === "true") {
    return { enabled: false, shutdown: async () => {} };
  }
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? options.serviceName ?? "banglaclaw",
      [ATTR_SERVICE_VERSION]: options.version,
    }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  return {
    enabled: true,
    endpoint,
    shutdown: async () => {
      await provider.shutdown();
      trace.disable();
    },
  };
}
