import type { FastifyInstance, FastifyRequest } from 'fastify';
import { mcpTools } from '@hallway/shared/mcp';
import { z } from 'zod';
import { digest, HttpError, requireUser, secret } from '../auth/auth.js';
import { db } from '../../shared/db.js';
import { agenda, nextEvent } from '../schedule/events.js';
import { clock, localDay } from '../schedule/calendar.js';
import { catalogQuery, catalogSearch, nextSession } from '../explore/catalog.js';
import { nextAction, today } from '../today/today.js';
import { venueFor, weather } from '../today/weather.js';
import { findPeople } from '../explore/people.js';
import { activeQuests, completeQuest, generateQuest, icebreaker, progress } from '../quests/quests.js';

const tokenSelect = { id: true, label: true, canWrite: true, expiresAt: true } as const;
async function credential(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.length > 150) throw new HttpError(401, 'An MCP credential is required.');
  const token = await db.mcpToken.findUnique({ where: { digest: digest(header.slice(7)) }, include: { user: true } });
  if (!token || token.expiresAt <= new Date()) throw new HttpError(401, 'This MCP credential is invalid or expired.');
  return token;
}
export function mcpRoutes(app: FastifyInstance) {
  app.get('/api/mcp/credentials', async request => db.mcpToken.findMany({
    where: { userId: (await requireUser(request)).id, expiresAt: { gt: new Date() } }, select: tokenSelect,
  }));
  app.post('/api/mcp/credentials', async request => {
    const user = await requireUser(request);
    const input = z.object({ label: z.string().trim().min(1).max(80), canWrite: z.boolean().default(false) }).parse(request.body);
    const token = 'hq_' + secret();
    const record = await db.mcpToken.create({
      data: { ...input, digest: digest(token), userId: user.id, expiresAt: new Date(Date.now() + 30 * 86400000) }, select: tokenSelect,
    });
    return { ...record, token };
  });
  app.delete('/api/mcp/credentials/:id', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.mcpToken.deleteMany({ where: { id, userId: user.id } });
    return reply.code(204).send();
  });
  app.post('/api/mcp/tools/:tool', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async request => {
    const token = await credential(request);
    const { user } = token;
    const { tool } = z.object({ tool: z.string().refine((value): value is keyof typeof mcpTools => Object.hasOwn(mcpTools, value)) }).parse(request.params);
    const input = request.body ?? {};
    const now = clock(user.demo);
    switch (tool) {
      case 'get_my_schedule': {
        const { from, until } = mcpTools[tool].input.parse(input);
        if ((from && !until) || (!from && until) || (from && until && until <= from)) throw new HttpError(400, 'Provide both dates, with until after from.');
        return agenda(user.id, from, until);
      }
      case 'get_next_event': {
        const { includeRecommendation, question } = mcpTools[tool].input.parse(input);
        const event = await nextEvent(user.id, now);
        return includeRecommendation ? { event, recommendation: await nextAction(user, question ?? 'What should I do next?', false) } : { event };
      }
      case 'get_weather_forecast': {
        const { day } = mcpTools[tool].input.parse(input);
        const event = await nextEvent(user.id, now);
        return weather(day ?? localDay(now), user.demo, venueFor(event?.location));
      }
      case 'get_preparation_checklist': {
        const { eventId } = mcpTools[tool].input.parse(input);
        const event = eventId ? await db.event.findFirst({ where: { id: eventId, userId: user.id }, include: { checklist: true } }) : await nextEvent(user.id, now);
        if (eventId && !event) throw new HttpError(404, 'Event not found.');
        return { eventId: event?.id, title: event?.title, items: event?.checklist ?? [] };
      }
      case 'search_sessions':
        return catalogSearch(user, catalogQuery.parse(mcpTools[tool].input.parse(input)));
      case 'complete_quest': {
        if (!token.canWrite) throw new HttpError(403, 'This credential cannot complete quests.');
        const { questId } = mcpTools[tool].input.parse(input);
        return completeQuest(user.id, questId);
      }
      case 'generate_icebreaker': {
        const { topic } = mcpTools[tool].input.parse(input);
        return icebreaker(user, undefined, topic);
      }
      default:
        mcpTools[tool].input.parse(input);
        switch (tool) {
          case 'get_daily_briefing': return today(user);
          case 'recommend_sessions': return { session: await nextSession(user, await agenda(user.id)) };
          case 'generate_quests': return generateQuest(user, false);
          case 'get_active_quests': return activeQuests(user.id);
          case 'find_opt_in_connections': return findPeople(user);
          case 'get_my_progress': return progress(user.id);
        }
    }
  });
}
