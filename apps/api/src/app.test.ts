import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { createApp } from './app.js';
import { digest } from './features/auth/auth.js';
import { db } from './shared/db.js';
import { importCatalog } from './features/explore/import-catalog.js';
import { runReminderCycle } from './features/reminders/reminders.js';
import { weather } from './features/today/weather.js';
import { scheduleIntentSchema } from '@hallway/shared/responses';
import { z } from 'zod';

let app: FastifyInstance;
const userIds: string[] = [];
let ip = 1;
const enabled = !!process.env.TEST_DATABASE;
const setup = { skip: !enabled };
before(async () => {
  if (enabled) app = await createApp();
});
after(async () => {
  if (!enabled) return;
  await app.close();
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  await db.$disconnect();
});
async function request(
  url: string,
  method: InjectOptions['method'] = 'GET',
  payload?: object,
  cookie?: string,
  headers?: Record<string, string>,
) {
  return app.inject({
    url,
    method,
    payload,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    remoteAddress: '127.1.0.' + ip,
  });
}
async function attendee(discoverable = false) {
  ip++;
  const created = await request('/api/auth/register', 'POST', {
    email: randomUUID() + '@example.test',
    password: 'safe-test-password',
    demo: true,
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id as string;
  userIds.push(id);
  const cookie = (created.headers['set-cookie'] as string).split(';')[0]!;
  const profile = {
    nickname: 'Test ' + ip,
    background: 'private background',
    interests: ['Kubernetes', 'Go'],
    goals: 'Learn about tooling',
    firstTime: true,
    comfort: 'warming-up',
    difficulty: 'easy',
    discoverable,
    shareBackground: false,
  };
  const saved = await request('/api/profile', 'PUT', profile, cookie);
  assert.equal(saved.statusCode, 200, saved.body);
  return { id, cookie, profile };
}

const activity = {
  title: 'Personal hackathon',
  category: 'hackathon',
  location: 'The Shop Workspace',
  description: '',
  zone: 'America/Denver',
  startsAt: '2026-11-10T18:00:00Z',
  endsAt: '2026-11-10T19:00:00Z',
  day: null,
};
async function addEvent(cookie: string, event = activity, confirmConflict = false) {
  const result = await request('/api/events', 'POST', { event, confirmConflict }, cookie);
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
}
async function startQuest(cookie: string) {
  const generated = await request('/api/quests/generate', 'POST', {}, cookie);
  assert.equal(generated.statusCode, 200, generated.body);
  const id = generated.json().id as string;
  const started = await request(
    '/api/quests/' + id + '/action',
    'POST',
    { action: 'start' },
    cookie,
  );
  assert.equal(started.statusCode, 200, started.body);
  return id;
}

test(
  'accounts are isolated, writes guard origins, and schedule overlaps require confirmation',
  setup,
  async () => {
    const a = await attendee();
    const b = await attendee();
    const saved = await addEvent(a.cookie);
    const overlap = await addEvent(a.cookie, { ...activity, title: 'Conflicting session' });
    assert.deepEqual(
      overlap.conflicts.map((item: { id: string }) => item.id),
      [saved.event.id],
    );
    assert.ok(
      (await addEvent(a.cookie, { ...activity, title: 'Conflicting session' }, true)).event,
    );
    assert.deepEqual((await request('/api/events', 'GET', undefined, b.cookie)).json(), []);
    assert.equal(
      (await request('/api/events/' + saved.event.id, 'DELETE', undefined, b.cookie)).statusCode,
      404,
    );
    assert.equal(
      (
        await request('/api/profile', 'PUT', a.profile, a.cookie, {
          origin: 'https://other.invalid',
        })
      ).statusCode,
      403,
    );
    assert.equal((await request('/api/auth/logout', 'POST', undefined, a.cookie)).statusCode, 204);
    assert.equal((await request('/api/me', 'GET', undefined, a.cookie)).statusCode, 401);
  },
);

test(
  'assistant chat is private, clearable, and adds only conflict-free events',
  setup,
  async (t) => {
    const a = await attendee();
    const b = await attendee();
    const first = await request(
      '/api/assistant',
      'POST',
      { question: 'What is the weather?' },
      a.cookie,
    );
    assert.equal(first.statusCode, 200, first.body);
    const ownHistory = await request('/api/assistant/history', 'GET', undefined, a.cookie);
    assert.equal(ownHistory.json().length, 2);
    assert.deepEqual(
      (await request('/api/assistant/history', 'GET', undefined, b.cookie)).json(),
      [],
    );
    assert.equal(
      (await request('/api/assistant/history', 'DELETE', undefined, b.cookie)).statusCode,
      204,
    );
    assert.equal(
      (await request('/api/assistant/history', 'GET', undefined, a.cookie)).json().length,
      2,
    );

    const prior = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      AI_PROVIDER: process.env.AI_PROVIDER,
    };
    process.env.OPENAI_API_KEY = 'fixture-key';
    process.env.AI_PROVIDER = 'openai';
    let interpretation: z.infer<typeof scheduleIntentSchema> = {
      action: 'clarify',
      message: 'What start and end time should I use?',
      event: null,
    };
    const mock = t.mock.method(
      globalThis,
      'fetch',
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const output = body.tools
          ? [
              {
                type: 'function_call',
                id: 'fc_event',
                name: 'get_attendee_context',
                call_id: 'call_event',
                arguments: '{}',
                status: 'completed',
              },
            ]
          : [
              {
                type: 'message',
                id: 'msg_event',
                role: 'assistant',
                status: 'completed',
                content: [
                  { type: 'output_text', text: JSON.stringify(interpretation), annotations: [] },
                ],
              },
            ];
        return Response.json({ id: 'resp_event', status: 'completed', output });
      },
    );
    try {
      const clarify = await request(
        '/api/assistant',
        'POST',
        { question: 'Add lunch tomorrow' },
        a.cookie,
      );
      assert.match(clarify.json().messages[1].content, /start and end time/);
      assert.equal((await request('/api/events', 'GET', undefined, a.cookie)).json().length, 0);

      interpretation = {
        action: 'create',
        message: 'I found a time for lunch.',
        event: {
          title: 'Lunch with the team',
          category: 'meeting',
          location: '',
          description: '',
          day: '2026-11-10',
          startTime: '13:00',
          endTime: '14:00',
        },
      };
      const created = await request(
        '/api/assistant',
        'POST',
        { question: 'Tomorrow from 1 to 2' },
        a.cookie,
      );
      assert.match(created.json().messages[1].content, /Added “Lunch with the team”/);
      assert.equal((await request('/api/events', 'GET', undefined, a.cookie)).json().length, 1);

      await addEvent(a.cookie, {
        ...activity,
        title: 'Existing appointment',
        startsAt: '2026-11-10T21:00:00Z',
        endsAt: '2026-11-10T22:00:00Z',
      });
      interpretation = {
        action: 'create',
        message: 'I found another time.',
        event: {
          title: 'Conflicting lunch',
          category: 'meeting',
          location: '',
          description: '',
          day: '2026-11-10',
          startTime: '13:30',
          endTime: '14:30',
        },
      };
      const conflict = await request(
        '/api/assistant',
        'POST',
        { question: 'Schedule a follow-up tomorrow afternoon' },
        a.cookie,
      );
      assert.match(conflict.json().messages[1].content, /overlaps with Existing appointment/);
      assert.equal((await request('/api/events', 'GET', undefined, a.cookie)).json().length, 2);
    } finally {
      mock.mock.restore();
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  },
);

test(
  'calendar import previews and deduplicates; a broken catalog refresh preserves rows',
  setup,
  async () => {
    const a = await attendee();
    await addEvent(a.cookie);
    const exportResult = await request('/api/calendar/export', 'GET', undefined, a.cookie);
    const text = exportResult.body;
    const preview = await request('/api/calendar/import', 'POST', { text }, a.cookie);
    assert.equal(preview.json().entries.length, 1, preview.body);
    const imported = await request(
      '/api/calendar/import',
      'POST',
      { text, commit: true },
      a.cookie,
    );
    assert.equal(imported.json().imported, 1, imported.body);
    const retried = await request('/api/calendar/import', 'POST', { text, commit: true }, a.cookie);
    assert.equal(retried.json().duplicates, 1, retried.body);
    const before = await db.catalogItem.count({ where: { active: true, demo: false } });
    await assert.rejects(importCatalog({}));
    assert.equal(await db.catalogItem.count({ where: { active: true, demo: false } }), before);
  },
);

test(
  'stale weather is labeled and provider failures have a grounded assistant fallback',
  setup,
  async (t) => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-fixture-key';
    const fetch = t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('provider unavailable');
    });
    try {
      const at = new Date('2026-11-10T17:00:00Z');
      const payload = {
        hourly: {
          time: [+at / 1000],
          temperature_2m: [38],
          rain: [0],
          snowfall: [0],
          wind_gusts_10m: [15],
        },
      };
      const updatedAt = new Date(Date.now() - 3600000);
      await db.forecast.upsert({
        where: { venue: 'shop' },
        update: { payload, updatedAt },
        create: { venue: 'shop', payload, updatedAt },
      });
      const cached = await weather('2026-11-10', false, 'shop');
      assert.equal(cached.mode, 'stale');
      assert.equal(cached.low, 38);
      assert.equal((await weather('2027-01-01', false, 'shop')).mode, 'unavailable');
      const a = await attendee();
      const briefing = await request('/api/today', 'GET', undefined, a.cookie);
      assert.equal(briefing.json().briefing.mode, 'rules', briefing.body);
      assert.equal(briefing.json().forecast.mode, 'demo');
    } finally {
      fetch.mock.restore();
      if (original === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = original;
      await db.forecast.deleteMany({
        where: { venue: 'shop', updatedAt: { lt: new Date(Date.now() - 1800000) } },
      });
    }
  },
);

test('hybrid discovery, consent and mutual introduction use server-owned data', setup, async () => {
  const a = await attendee(true);
  const b = await attendee(true);
  const catalog = await request('/api/catalog?q=beginner+Go', 'GET', undefined, a.cookie);
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.ok(
    catalog.json().results.some((item: { id: string }) => item.id === 'demo-go'),
    catalog.body,
  );
  if (process.env.ELASTICSEARCH_URL) assert.equal(catalog.json().mode, 'hybrid', catalog.body);
  const matches = await request('/api/people', 'GET', undefined, a.cookie);
  const person = matches.json().people.find((item: { id: string }) => item.id === b.id);
  assert.ok(person, matches.body);
  assert.equal(person.background, undefined);
  const intro = await request('/api/people/' + b.id + '/intro', 'POST', {}, a.cookie);
  assert.equal(intro.json().status, 'pending', intro.body);
  assert.equal(
    (await request('/api/introductions/' + intro.json().id, 'PATCH', { accept: true }, a.cookie))
      .statusCode,
    404,
  );
  assert.equal(
    (
      await request('/api/introductions/' + intro.json().id, 'PATCH', { accept: true }, b.cookie)
    ).json().status,
    'accepted',
  );
  await request('/api/profile', 'PUT', { ...b.profile, discoverable: false }, b.cookie);
  const after = await request('/api/people', 'GET', undefined, a.cookie);
  assert.ok(!after.json().people.some((item: { id: string }) => item.id === b.id));
});

test(
  'demo reminder preferences only generate reminders for the caller and are rate limited',
  setup,
  async () => {
    const caller = await attendee();
    const other = await attendee();
    const prefs = { enabled: true, quietStart: '22:00', quietEnd: '07:00', zone: 'America/Denver' };
    await addEvent(caller.cookie);
    await addEvent(other.cookie);
    await db.user.update({ where: { id: other.id }, data: { reminderPrefs: prefs } });

    const save = () => request('/api/reminders/preferences', 'PUT', prefs, caller.cookie);
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await save();
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.equal((await save()).statusCode, 429);
    assert.equal(await db.reminder.count({ where: { userId: caller.id } }), 2);
    assert.equal(await db.reminder.count({ where: { userId: other.id } }), 0);

    await runReminderCycle();
    assert.equal(await db.reminder.count({ where: { userId: other.id } }), 2);
  },
);

test(
  'duplicate reminder cycles produce one reminder and completed checklists stay quiet',
  setup,
  async () => {
    const a = await attendee();
    const event = await addEvent(a.cookie);
    const prefs = { enabled: true, quietStart: '22:00', quietEnd: '07:00', zone: 'America/Denver' };
    await request('/api/reminders/preferences', 'PUT', prefs, a.cookie);
    await Promise.all([runReminderCycle(), runReminderCycle()]);
    const reminders = (await request('/api/reminders', 'GET', undefined, a.cookie)).json();
    assert.equal(reminders.length, 2);
    assert.ok(reminders.some((item: { message: string }) => item.message.startsWith('Get ready')));
    const later = await addEvent(a.cookie, {
      ...activity,
      title: 'Already prepared',
      startsAt: '2026-11-10T19:15:00Z',
      endsAt: '2026-11-10T19:30:00Z',
    });
    await db.checklistItem.updateMany({
      where: { eventId: later.event.id },
      data: { status: 'done' },
    });
    await runReminderCycle();
    assert.equal(await db.reminder.count({ where: { userId: a.id } }), 2);
    assert.ok(event.event.checklist.length > 0);
  },
);

test(
  'XP is atomic across simultaneous completions and QR verification rejects replay',
  setup,
  async () => {
    const a = await attendee();
    const b = await attendee();
    const questId = await startQuest(a.cookie);
    const finish = () =>
      request('/api/quests/' + questId + '/action', 'POST', { action: 'complete' }, a.cookie);
    const responses = await Promise.all([finish(), finish(), finish()]);
    assert.deepEqual(
      responses.map((result) => result.json().awarded).sort((x, y) => x - y),
      [0, 0, 50],
    );
    assert.deepEqual((await request('/api/progress', 'GET', undefined, a.cookie)).json().badges, [
      'First Hello',
    ]);
    const next = await startQuest(a.cookie);
    const code = (await request('/api/quests/' + next + '/code', 'POST', {}, a.cookie)).json().code;
    assert.equal((await request('/api/quests/verify', 'POST', { code }, a.cookie)).statusCode, 400);
    assert.equal((await request('/api/quests/verify', 'POST', { code }, b.cookie)).statusCode, 200);
    assert.equal((await request('/api/quests/verify', 'POST', { code }, b.cookie)).statusCode, 404);
  },
);

test(
  'MCP tokens enforce read scope, expiry, revocation, and the attendee boundary',
  setup,
  async () => {
    const a = await attendee();
    const b = await attendee();
    await addEvent(a.cookie);
    const questId = await startQuest(a.cookie);
    const created = await request(
      '/api/mcp/credentials',
      'POST',
      { label: 'Test client' },
      a.cookie,
    );
    const auth = { authorization: 'Bearer ' + created.json().token };
    const call = (tool: string, payload: object = {}) =>
      request('/api/mcp/tools/' + tool, 'POST', payload, undefined, auth);
    assert.equal((await call('get_my_schedule')).json().length, 1);
    assert.equal(
      (await call('get_next_event', { includeRecommendation: true })).json().recommendation.action
        .kind,
      'quest',
    );
    assert.equal((await call('complete_quest', { questId })).statusCode, 403);
    const writeToken = (
      await request(
        '/api/mcp/credentials',
        'POST',
        { label: 'Other attendee', canWrite: true },
        b.cookie,
      )
    ).json().token;
    assert.equal(
      (
        await request('/api/mcp/tools/complete_quest', 'POST', { questId }, undefined, {
          authorization: 'Bearer ' + writeToken,
        })
      ).statusCode,
      404,
    );
    await db.mcpToken.update({
      where: { digest: digest(created.json().token) },
      data: { expiresAt: new Date(0) },
    });
    assert.equal((await call('get_my_progress')).statusCode, 401);
    const record = (
      await request('/api/mcp/credentials', 'POST', { label: 'Revoked' }, a.cookie)
    ).json();
    await request('/api/mcp/credentials/' + record.id, 'DELETE', undefined, a.cookie);
    assert.equal(
      (
        await request('/api/mcp/tools/get_my_progress', 'POST', {}, undefined, {
          authorization: 'Bearer ' + record.token,
        })
      ).statusCode,
      401,
    );
  },
);
