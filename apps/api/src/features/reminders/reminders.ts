import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { timeZone } from '@hallway/shared';
import webPush from 'web-push';
import { HttpError, requireUser } from '../auth/auth.js';
import { db } from '../../shared/db.js';
import { traced } from '../../shared/telemetry.js';
import { replayTime } from '../schedule/calendar.js';

const hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const settings = z.object({ enabled: z.boolean(), quietStart: hhmm, quietEnd: hhmm, zone: timeZone });
type Settings = z.infer<typeof settings>;
const key = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT;
const vapid = key && privateKey && subject ? { publicKey: key, privateKey, subject } : null;

export function quiet(now: Date, prefs: Settings) {
  const local = Temporal.Instant.fromEpochMilliseconds(+now).toZonedDateTimeISO(prefs.zone);
  const time = String(local.hour).padStart(2, '0') + ':' + String(local.minute).padStart(2, '0');
  const { quietStart: start, quietEnd: end } = prefs;
  return start === end ? false : start < end ? time >= start && time < end : time >= start || time < end;
}

const pushHost = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(host) ||
        host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com'));
  } catch { return false; }
};

async function push(userId: string) {
  if (!vapid) return;
  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  await traced('reminder.push', () => Promise.all(subscriptions.map(async subscription => {
    if (!pushHost(subscription.endpoint)) return;
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, JSON.stringify({ title: 'Hallway Quest', body: 'You have a conference reminder.' }), { vapidDetails: vapid, TTL: 300, timeout: 3500 });
    } catch (error) {
      const code = (error as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint, userId } });
    }
  })));
}

export async function runReminderCycle(realNow = new Date()) {
  return traced('reminder.schedule', async () => {
    const users = await db.user.findMany({ where: { reminderPrefs: { path: ['enabled'], equals: true } },
      select: { id: true, demo: true, reminderPrefs: true } });
    for (const user of users) {
      const prefs = settings.safeParse(user.reminderPrefs).data;
      const now = user.demo ? replayTime : realNow;
      if (!prefs?.enabled || quiet(now, prefs)) continue;
      const upcoming = await db.event.findMany({
        where: { userId: user.id, completedAt: null, startsAt: { gt: now, lte: new Date(+now + 2 * 3600000) } },
        include: { checklist: { where: { status: 'open' }, take: 2 } },
      });
      for (const event of upcoming) {
        if (!event.startsAt) continue;
        const minutes = Math.ceil((+event.startsAt - +now) / 60000);
        const candidates = [
          ...(minutes <= 15 ? [{ kind: 'start', message: event.title + ' starts in ' + minutes + ' min.' }] : []),
          ...(event.checklist.length ? [{ kind: 'prep', message: 'Get ready for ' + event.title + '. ' + event.checklist.map(item => item.label).join(' · ') + '.' }] : []),
        ];
        for (const candidate of candidates) {
          const result = await db.reminder.createMany({ skipDuplicates: true, data: {
            key: [event.id, event.startsAt.toISOString(), candidate.kind].join(':'),
            userId: user.id, message: candidate.message,
          } });
          if (result.count) await push(user.id);
        }
      }
    }
  });
}

export function reminderRoutes(app: FastifyInstance) {
  app.get('/api/reminders', async request => db.reminder.findMany({
    where: { userId: (await requireUser(request)).id, dismissedAt: null },
    orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, message: true, createdAt: true },
  }));
  app.put('/api/reminders/preferences', async request => {
    const user = await requireUser(request);
    const prefs = settings.parse(request.body);
    await db.user.update({ where: { id: user.id }, data: { reminderPrefs: prefs } });
    if (prefs.enabled && user.demo) await runReminderCycle();
    return prefs;
  });
  app.delete('/api/reminders/:id', async (request, reply) => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await db.reminder.updateMany({ where: { id, userId: user.id, dismissedAt: null }, data: { dismissedAt: new Date() } });
    return reply.code(204).send();
  });
  app.get('/api/push/key', async request => {
    await requireUser(request);
    return { key: vapid?.publicKey ?? null };
  });
  app.post('/api/push/subscriptions', async request => {
    const user = await requireUser(request);
    const prefs = settings.safeParse(user.reminderPrefs).data;
    if (!prefs?.enabled) throw new HttpError(409, 'Enable reminders first.');
    if (!vapid) throw new HttpError(503, 'Browser push is not configured.');
    const { endpoint, keys } = z.object({ endpoint: z.string().url().max(1024).refine(pushHost, 'Unsupported push provider.'),
      keys: z.object({ p256dh: z.string().regex(/^[\w-]{85,90}=?$/), auth: z.string().regex(/^[\w-]{21,24}=?$/) }) }).parse(request.body);
    await db.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, userId: user.id, ...keys }, update: { userId: user.id, ...keys } });
    return { ok: true };
  });
}
