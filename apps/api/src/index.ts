import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const telemetry = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  ? new NodeSDK({ serviceName: 'hallway-quest-api', traceExporter: new OTLPTraceExporter() }) : null;
telemetry?.start();
const { createApp } = await import('./app.js');
const { db } = await import('./shared/db.js');
const app = await createApp({ logger: true });
await db.$connect();
await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT || 3000) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await db.$disconnect();
    await telemetry?.shutdown();
  });
}
