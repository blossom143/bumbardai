import type { User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { profileInput } from '@hallway/shared';
import { z } from 'zod';
import { requireUser } from './auth.js';
import { briefingCopy, nextCopy } from './assistant.js';
import { clock, dayAfter, freeUntil, localDay, overlaps } from './calendar.js';
import { catalogQuery, catalogSearch, nextSession } from './catalog.js';
import { agenda, nextEvent } from './events.js';
import { activeQuests, generateQuest, progress } from './quests.js';
import { venueFor, weather } from './weather.js';

export async function briefingContext(user: User) {
  const now = clock(user.demo);
  const day = localDay(now);
  const [events, next, quests, status] = await Promise.all([
    agenda(user.id, day, dayAfter(day)), nextEvent(user.id, now), activeQuests(user.id), progress(user.id),
  ]);
  const current = events.find(event => overlaps(now, new Date(+now + 1), event));
  const [forecast, recommendation] = await Promise.all([
    weather(day, user.demo, venueFor((current ?? next)?.location)),
    nextSession(user, events),
  ]);
  const checklistEvent = next ?? events.find(event => !event.completedAt && event.checklist.length);
  const checklist = checklistEvent ? {
    eventId: checklistEvent.id, title: checklistEvent.title, items: checklistEvent.checklist,
  } : null;
  const freeMinutes = Math.max(0, Math.floor((+freeUntil(now, events) - +now) / 60000));
  return { now, day, events, current: current ?? null, next, forecast, recommendation, checklist, quest: quests[0] ?? null, progress: status, freeMinutes };
}

export async function today(user: User) {
  const facts = await briefingContext(user);
  const profile = profileInput.safeParse(user.profile).data;
  const copy = await briefingCopy({
    nickname: profile?.nickname, interests: profile?.interests, firstTime: profile?.firstTime,
    goals: profile?.goals, count: facts.events.length, nextCategory: facts.next?.category, freeMinutes: facts.freeMinutes,
    weatherGuidance: facts.forecast.guidance, completedQuests: facts.progress.completed,
  });
  return { ...facts, briefing: { mode: copy ? 'ai' : 'rules', lead: copy?.lead ?? 'Make time for what brought you here.',
    tips: copy?.tips ?? (profile?.firstTime ? ['Give yourself a moment to get oriented between activities.'] : []) } };
}

export async function nextAction(user: User, question: string) {
  const now = clock(user.demo);
  const day = localDay(now);
  const events = await agenda(user.id, day, dayAfter(day));
  const end = freeUntil(now, events);
  const requested = /\b(\d{1,3})\s*(?:minutes?|mins?)\b/i.exec(question)?.[1];
  const cutoff = requested ? new Date(Math.min(+end, +now + Number(requested) * 60000)) : end;
  const minutes = Math.max(0, Math.floor((+cutoff - +now) / 60000));
  const current = events.find(event => overlaps(now, new Date(+now + 1), event));
  const session = await nextSession(user, events, cutoff);
  const quest = minutes >= 5 && !session ? await generateQuest(user) : null;
  const next = await nextEvent(user.id, now);
  const action = current ? { kind: 'event', title: current.title, detail: 'This activity is on your schedule now.', path: '/schedule' }
    : session ? { kind: 'session', title: session.title, detail: session.reason, path: '/explore' }
    : quest && quest.minutes <= minutes ? { kind: 'quest', title: quest.title, detail: quest.mission, path: '/quests' }
    : next ? { kind: 'event', title: next.title, detail: 'Review your schedule and get ready for your next event.', path: '/schedule' }
    : { kind: 'break', title: 'Take a short break', detail: 'Check the conference catalog when you’re ready.', path: '/explore' };
  const copy = await nextCopy({ kind: action.kind, minutes }, question);
  return { action, minutes, mode: copy ? 'ai' : 'rules', lead: copy?.lead ?? 'Here’s an option based on your plans.', tips: copy?.tips ?? [] };
}

export function todayRoutes(app: FastifyInstance) {
  app.get('/api/today', async request => today(await requireUser(request)));
  app.post('/api/assistant', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => {
    const user = await requireUser(request);
    const { question } = z.object({ question: z.string().trim().min(1).max(700) }).parse(request.body);
    return nextAction(user, question);
  });
  app.get('/api/catalog', async request => catalogSearch(await requireUser(request), catalogQuery.parse(request.query)));
}
