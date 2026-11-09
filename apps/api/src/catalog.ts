import { type CatalogItem, type User } from '@prisma/client';
import { officialSchedule, hackathonSource, profileInput } from '@hallway/shared';
import { z } from 'zod';
import { atLocal, clock, localDay, overlaps } from './calendar.js';
import { db } from './db.js';

export const catalogQuery = z.object({
  q: z.string().trim().max(250).default(''), day: z.string().date().optional(),
  topic: z.string().trim().max(100).optional(), skill: z.string().trim().max(40).optional(),
  onlyFitting: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type CatalogQuery = z.infer<typeof catalogQuery>;
const replayDay = '2026-11-10';
const replay = [
  ['demo-hack', 'Cloud Native Hackathon rehearsal', 'hackathon', '13:00', '15:00', 'The Shop Workspace', 'Kubernetes', 'Bring your laptop and charger for a hands-on build.'],
  ['demo-ai', 'Running AI inference on Kubernetes', 'session', '10:00', '10:25', 'Salt Palace · Grand Ballroom', 'AI', 'A practical introduction to serving models and using Kubernetes to scale inference workloads.'],
  ['demo-go', 'Go tools for cloud native beginners', 'session', '11:30', '12:05', 'Salt Palace · 151', 'Go', 'A beginner-friendly guide to building lightweight Kubernetes tools with Go.'],
  ['demo-obs', 'An introduction to eBPF observability', 'workshop', '15:15', '16:00', 'Salt Palace · 250', 'Observability', 'Learn how eBPF helps you observe real workloads, with a beginner-friendly exercise.'],
  ['demo-open', 'Contribute your first patch', 'workshop', '16:15', '17:00', 'Salt Palace · 155', 'Open Source', 'Pick an issue and see what it takes to make a small, useful contribution.'],
].map(([id, title, category, start, end, location, topic, description]) => ({
  id: id!, title: title!, category: category!, location: location!, description: description!, demo: true,
  startsAt: atLocal(replayDay + 'T' + start), endsAt: atLocal(replayDay + 'T' + end),
  day: replayDay, topics: [topic!, 'Kubernetes'].filter((value, index, all) => all.indexOf(value) === index),
  speakers: category === 'hackathon' ? [] : ['Demo speaker'], skill: 'Beginner', sourceUrl: officialSchedule,
}));

export async function ensureDemoCatalog() {
  await db.catalogItem.createMany({ data: replay, skipDuplicates: true });
}

export const catalogFilter = (user: User, input: CatalogQuery) => ({
  demo: user.demo, active: true, ...(input.day ? { day: input.day } : {}),
  ...(input.topic ? { topics: { has: input.topic } } : {}),
  ...(input.skill ? { skill: input.skill } : {}),
});

export function reasonFor(item: CatalogItem, interests: string[], q = '') {
  const haystack = [item.title, item.description, ...item.topics].join(' ').toLowerCase();
  const shared = interests.filter(interest => haystack.includes(interest.toLowerCase()));
  if (shared.length) return 'Matches your interest in ' + shared.join(', ') + '.';
  if (q && item.topics.length) return 'Related track: ' + item.topics[0] + '.';
  return item.skill ? 'Published audience level: ' + item.skill + '.' : 'From the conference catalog.';
}

export async function catalogSearch(user: User, input: CatalogQuery) {
  if (user.demo) await ensureDemoCatalog();
  const rows = await db.catalogItem.findMany({
    where: catalogFilter(user, input), orderBy: [{ day: 'asc' }, { startsAt: 'asc' }, { title: 'asc' }],
  });
  const interests = profileInput.safeParse(user.profile).data?.interests ?? [];
  const tokens = input.q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const results = rows.map(item => {
    const title = item.title.toLowerCase();
    const body = [item.description, item.skill, ...item.speakers, ...item.topics].join(' ').toLowerCase();
    const score = tokens.reduce((rank, term) => rank + (title.includes(term) ? 3 : body.includes(term) ? 1 : 0), 0);
    return { item, score };
  });
  return { mode: 'catalog', results: results.filter(({ score }) => !tokens.length || score > 0)
    .sort((a, b) => b.score - a.score).slice(0, input.limit)
    .map(({ item }) => ({ ...item, reason: reasonFor(item, interests, input.q) })) };
}

export async function nextSession(user: User, events: Awaited<ReturnType<typeof import('./events.js').agenda>>, until?: Date) {
  if (user.demo) await ensureDemoCatalog();
  const now = clock(user.demo);
  const day = localDay(now);
  const interests = profileInput.safeParse(user.profile).data?.interests ?? [];
  const rows = await db.catalogItem.findMany({
    where: { demo: user.demo, active: true, day, startsAt: { gte: now }, ...(until ? { endsAt: { lte: until } } : {}) },
    orderBy: { startsAt: 'asc' },
  });
  const available = rows.filter(item => item.startsAt && item.endsAt && !events.some(event =>
    event.catalogId === item.id || overlaps(item.startsAt!, item.endsAt!, event)));
  const item = available.find(item => reasonFor(item, interests).startsWith('Matches')) ?? available[0];
  return item ? { ...item, reason: reasonFor(item, interests) } : null;
}

export const sourceMeta = { officialSchedule, hackathonSource };
