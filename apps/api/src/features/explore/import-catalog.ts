import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { officialSchedule, hackathonSource } from '@hallway/shared';
import { atLocal, localDay } from '../schedule/calendar.js';
import { db } from '../../shared/db.js';

const topicPatterns = {
  Kubernetes: /\bkubernetes\b|\bk8s\b/i,
  Go: /\bgolang\b|\bgo (?:language|modules|programming|developers|toolchain)\b|written in go\b|\bwith Go\b/,
  AI: /\bAI\b|\bLLMs?\b|machine learning|inference/i,
  DevOps: /\bdevops\b|gitops|CI\/CD|continuous delivery/i,
  Security: /security|secure|supply chain|threat model/i,
  Observability: /observability|opentelemetry|distributed tracing/i,
  eBPF: /\bebpf\b/i,
  'Open Source': /open.source|contribfest|maintainer/i,
};
const feedUrl = 'https://sessionize.com/api/v2/svi82w6c/view/All';
const schema = z.object({
  speakers: z.array(z.object({ id: z.string(), fullName: z.string() })),
  rooms: z.array(z.object({ id: z.number(), name: z.string() })),
  categories: z.array(
    z.object({ title: z.string(), items: z.array(z.object({ id: z.number(), name: z.string() })) }),
  ),
  sessions: z
    .array(
      z.object({
        id: z.string().regex(/^\d+$/),
        title: z.string().min(1),
        description: z.string().nullable(),
        startsAt: z.string().nullable(),
        endsAt: z.string().nullable(),
        roomId: z.number().nullable(),
        speakers: z.array(z.string()),
        categoryItems: z.array(z.number()),
      }),
    )
    .min(100),
});

export function normalizeFeed(payload: unknown) {
  const feed = schema.parse(payload);
  const speakers = new Map(feed.speakers.map((speaker) => [speaker.id, speaker.fullName]));
  const rooms = new Map(feed.rooms.map((room) => [room.id, room.name]));
  const tags = new Map(
    feed.categories.flatMap((category) =>
      category.items.map((item) => [item.id, { ...item, type: category.title }] as const),
    ),
  );
  const records = new Map<string, Prisma.CatalogItemCreateManyInput>();
  const days = new Set<string>();
  for (const session of feed.sessions) {
    if (!session.startsAt || !session.endsAt) continue;
    const parseTime = (value: string) =>
      /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? new Date(value) : atLocal(value);
    const startsAt = parseTime(session.startsAt);
    const endsAt = parseTime(session.endsAt);
    if (!(endsAt > startsAt)) continue;
    const day = localDay(startsAt);
    if (day < '2026-11-09' || day > '2026-11-12') continue;
    days.add(day);
    const labels = session.categoryItems.flatMap((id) => tags.get(id) ?? []);
    const skill = labels.find((label) => label.type === 'Audience Level')?.name ?? null;
    const title = session.title.trim().slice(0, 200);
    const trackNames = labels
      .filter((label) => label.type !== 'Audience Level')
      .map((label) => label.name);
    const content = [title, session.description, ...trackNames].join(' ');
    const inferred = Object.entries(topicPatterns)
      .filter(([, pattern]) => pattern.test(content))
      .map(([topic]) => topic);
    const topics = [...new Set([...trackNames, ...inferred])];
    const id = 'kubecon-na-2026:' + session.id;
    const category = /hackathon/i.test(title)
      ? 'hackathon'
      : /workshop|contribfest|tutorial/i.test(title)
        ? 'workshop'
        : /networking|meetup|reception/i.test(title)
          ? 'networking'
          : 'session';
    records.set(id, {
      id,
      title,
      category,
      startsAt,
      endsAt,
      day,
      skill,
      topics,
      sourceUrl: officialSchedule + '?id=' + session.id,
      description: (session.description ?? '').slice(0, 4000),
      location: session.roomId === null ? '' : (rooms.get(session.roomId) ?? ''),
      speakers: session.speakers.flatMap((id) => speakers.get(id) ?? []),
    });
  }
  if (records.size < 100 || days.size !== 4)
    throw new Error('Conference feed is incomplete; the prior catalog was preserved.');
  return [...records.values()];
}

export async function importCatalog(payload: unknown) {
  const rows = normalizeFeed(payload);
  const hackathon = {
    id: 'wemakedevs:cnh-2026',
    title: 'Cloud Native Hackathon',
    category: 'hackathon',
    day: '2026-11-09',
    location: 'The Shop Workspace · 350 E 400 S',
    description:
      'In-person build day. Bring a laptop and charger and review the organizer’s registration details.',
    speakers: [],
    topics: ['Kubernetes', 'Open Source'],
    sourceUrl: hackathonSource,
  };
  const importedAt = new Date();
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(20261109)`;
      await tx.catalogItem.updateMany({
        where: { id: { startsWith: 'kubecon-na-2026:', notIn: rows.map((row) => row.id) } },
        data: { active: false },
      });
      for (const row of [...rows, hackathon]) {
        await tx.catalogItem.upsert({
          where: { id: row.id },
          create: { ...row, importedAt },
          update: { ...row, importedAt, active: true },
        });
      }
    },
    { timeout: 60000 },
  );
  return rows.length + 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = process.argv[2];
    const payload = file
      ? JSON.parse(await readFile(file, 'utf8'))
      : await (async () => {
          const response = await fetch(feedUrl, { signal: AbortSignal.timeout(20000) });
          if (!response.ok) throw new Error('Organizer feed returned HTTP ' + response.status);
          return response.json();
        })();
    console.log('Imported ' + (await importCatalog(payload)) + ' confirmed catalog records.');
  } finally {
    await db.$disconnect();
  }
}
