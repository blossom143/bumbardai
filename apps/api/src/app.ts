import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { authRoutes, HttpError } from './auth.js';
import { eventRoutes } from './events.js';
import { todayRoutes } from './today.js';
import { peopleRoutes } from './people.js';
import { mcpRoutes } from './mcp.js';
import { reminderRoutes } from './reminders.js';
import { questRoutes } from './quests.js';

export async function createApp({ logger = false } = {}) {
  const app = Fastify({ logger, disableRequestLogging: true, bodyLimit: 1024 * 1024, trustProxy: process.env.TRUST_PROXY === 'true' });
  const spans = new WeakMap<object, Span>();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', (request, _reply, done) => {
    trace.getTracer('hallway-quest').startActiveSpan('http.request', span => {
      spans.set(request, span);
      done();
    });
  });
  app.addHook('onResponse', (request, reply, done) => {
    const span = spans.get(request);
    span?.setAttributes({ 'http.request.method': request.method, 'http.route': request.routeOptions.url ?? 'unknown',
      'http.response.status_code': reply.statusCode });
    if (reply.statusCode >= 500) span?.setStatus({ code: SpanStatusCode.ERROR });
    span?.end();
    done();
  });
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    const sameHost = origin && URL.canParse(origin) && new URL(origin).host === request.headers.host;
    const publicOrigin = process.env.PUBLIC_ORIGIN;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (request.headers['sec-fetch-site'] === 'cross-site' || (origin && (publicOrigin ? origin !== publicOrigin : !sameHost)))) {
      throw new HttpError(403, 'Request must come from the Hallway Quest origin.');
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: error.issues[0]?.message ?? 'Invalid input.' });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error({ name: error instanceof Error ? error.name : 'unknown' }, 'Request failed');
    return reply.code(500).send({ error: 'Something went wrong. Try again.' });
  });
  app.get('/api/health', async () => ({ status: 'ok' }));
  authRoutes(app);
  eventRoutes(app);
  todayRoutes(app);
  questRoutes(app);
  peopleRoutes(app);
  mcpRoutes(app);
  reminderRoutes(app);
  const webRoot = resolve(process.env.WEB_ROOT || '../web/dist');
  if (existsSync(webRoot + '/index.html')) {
    await app.register(staticFiles, { root: webRoot, wildcard: false, setHeaders(response, file) {
      if (file.endsWith('/sw.js') || file.endsWith('/index.html')) response.setHeader('Cache-Control', 'no-cache');
    } });
    app.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith('/api/') && request.method === 'GET' && request.headers.accept?.includes('text/html')) {
        return reply.sendFile('index.html', { maxAge: 0 });
      }
      return reply.code(404).send({ error: 'Page not found.' });
    });
  }
  return app;
}
