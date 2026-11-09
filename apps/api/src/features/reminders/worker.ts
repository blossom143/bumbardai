import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const telemetry = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  ? new NodeSDK({ serviceName: 'hallway-quest-reminders', traceExporter: new OTLPTraceExporter() }) : null;
telemetry?.start();
const { runReminderCycle } = await import('./reminders.js');
const { db } = await import('../../shared/db.js');
let stopped = false;
let timer: NodeJS.Timeout | undefined;
let pending: Promise<void> | undefined;
function tick() {
  pending = runReminderCycle().catch(() => { console.error('Reminder cycle failed.'); }).finally(() => {
    if (!stopped) timer = setTimeout(tick, 30000);
  });
}
tick();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    stopped = true;
    clearTimeout(timer);
    await pending;
    await db.$disconnect();
    await telemetry?.shutdown();
  });
}
