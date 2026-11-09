import { SpanStatusCode, trace } from '@opentelemetry/api';

export async function traced<T>(name: string, callback: () => Promise<T>): Promise<T> {
  return trace.getTracer('hallway-quest').startActiveSpan(name, async (span) => {
    try {
      return await callback();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
