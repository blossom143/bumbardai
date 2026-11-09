import type { User } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { profileInput } from '@hallway/shared';
import { z } from 'zod';
import { HttpError, requireUser } from './auth.js';
import { briefingCopy, nextCopy } from './assistant.js';
import { clock, dayAfter, freeUntil, localDay, overlaps } from './calendar.js';
import { catalogQuery, catalogSearch, ensureDemoCatalog, nextSession, reasonFor } from './catalog.js';
import { agenda, nextEvent } from './events.js';
import { activeQuests, generateQuest, icebreaker, progress } from './quests.js';
import { venueFor, weather } from './weather.js';
import { db } from './db.js';
import { findPeople } from './people.js';

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
  const prepToday = events.find(event => !event.completedAt && event.checklist.length && (!event.endsAt || event.endsAt > now));
  const checklistEvent = next?.checklist.length ? next : prepToday ?? next;
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

export async function nextAction(user: User, question: string, persistQuest = true) {
  const now = clock(user.demo);
  const day = localDay(now);
  const events = await agenda(user.id, day, dayAfter(day));
  const end = freeUntil(now, events);
  const requested = /\b(\d{1,3})\s*(?:minutes?|mins?)\b/i.exec(question)?.[1];
  const cutoff = requested ? new Date(Math.min(+end, +now + Number(requested) * 60000)) : end;
  const minutes = Math.max(0, Math.floor((+cutoff - +now) / 60000));
  const current = events.find(event => overlaps(now, new Date(+now + 1), event));
  const session = await nextSession(user, events, cutoff);
  const quest = minutes >= 5 && !session ? await generateQuest(user, persistQuest) : null;
  const next = await nextEvent(user.id, now);
  const action = current ? { kind: 'event', title: current.title, detail: 'This activity is on your schedule now.', path: '/schedule' }
    : session ? { kind: 'session', title: session.title, detail: session.reason, path: '/explore' }
    : quest && quest.minutes <= minutes ? { kind: 'quest', title: quest.title, detail: quest.mission, path: '/quests' }
    : next ? { kind: 'event', title: next.title, detail: 'Review your schedule and get ready for your next event.', path: '/schedule' }
    : { kind: 'break', title: 'Take a short break', detail: 'Check the conference catalog when you’re ready.', path: '/explore' };
  const copy = await nextCopy({ kind: action.kind, minutes }, question);
  return { action, minutes, mode: copy ? 'ai' : 'rules', lead: copy?.lead ?? 'Here’s an option based on your plans.', tips: copy?.tips ?? [] };
}

async function answer(user: User, question: string) {
  const now = clock(user.demo);
  const day = localDay(now);
  const response = (kind: string, title: string, detail: string, path: string, mode = 'rules') => ({
    action: { kind, title, detail, path }, mode, minutes: 0, lead: '', tips: [],
  });
  if (/ice.?breaker|conversation starter|break the ice/i.test(question)) {
    const copy = await icebreaker(user);
    return response('quest', 'Try this conversation starter', copy.icebreaker, '/quests', copy.mode);
  }
  if (/weather|forecast|umbrella|jacket|how cold|will it rain/i.test(question)) {
    const next = await nextEvent(user.id, now);
    const forecast = await weather(day, user.demo, venueFor(next?.location));
    const title = forecast.mode === 'demo' ? 'Simulated venue forecast' : forecast.mode === 'stale' ? 'Cached venue forecast' : 'Venue forecast';
    const detail = forecast.high === null ? 'A forecast is unavailable for this date.'
      : `Low ${forecast.low}°F, high ${forecast.high}°F. ${forecast.guidance.join(' ')}`;
    return response('weather', title, detail, '/');
  }
  if (/prepare|pack|checklist|what.*bring/i.test(question)) {
    const events = await agenda(user.id, day, dayAfter(day));
    const event = (await nextEvent(user.id, now)) ?? events.find(item => !item.completedAt && item.checklist.length);
    const open = event?.checklist.filter(item => item.status === 'open').map(item => item.label) ?? [];
    return response('preparation', event?.title ?? 'Preparation checklist',
      open.length ? open.join(' · ') : 'There are no open preparation items.', '/schedule');
  }
  if (/who.*meet|find.*(?:people|attendee|someone)|suggest.*(?:people|connection)/i.test(question)) {
    const match = (await findPeople(user))[0];
    return response('people', match?.nickname ?? 'Meet fellow attendees',
      match ? match.reason + ' “' + match.icebreaker + '”' : 'Check the People tab and enable discovery from Profile if you want to see matches.', '/explore?tab=people');
  }
  if (/search.*(?:talks?|sessions?)|find.*(?:talks?|sessions?)|recommend.*(?:talks?|sessions?)/i.test(question) && !/next/i.test(question)) {
    const results = await catalogSearch(user, catalogQuery.parse({ q: question, limit: 1 }));
    const item = results.results[0];
    return response('session', item?.title ?? 'Search conference sessions',
      item?.reason ?? 'Try a broader topic in Explore.', item ? '/explore?session=' + encodeURIComponent(item.id) : '/explore');
  }
  return nextAction(user, question);
}

export function todayRoutes(app: FastifyInstance) {
  app.get('/api/today', async request => today(await requireUser(request)));
  app.post('/api/assistant', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => {
    const user = await requireUser(request);
    const { question } = z.object({ question: z.string().trim().min(1).max(700) }).parse(request.body);
    return answer(user, question);
  });
  app.get('/api/catalog/:id', async request => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string().max(200) }).parse(request.params);
    if (user.demo) await ensureDemoCatalog();
    const item = await db.catalogItem.findFirst({ where: { id, demo: user.demo, active: true } });
    if (!item) throw new HttpError(404, 'Session not found.');
    return { ...item, reason: reasonFor(item, profileInput.safeParse(user.profile).data?.interests ?? []) };
  });
  app.get('/api/catalog', async request => catalogSearch(await requireUser(request), catalogQuery.parse(request.query)));
}
