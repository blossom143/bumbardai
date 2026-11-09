import { Temporal } from '@js-temporal/polyfill';
import ICAL from 'ical.js';
import { eventInput, type EventInput } from '@hallway/shared';
import { createHash } from 'node:crypto';

export const zone = 'America/Denver';
export const replayTime = new Date('2026-11-10T17:45:00Z');
export const clock = (demo: boolean) => demo ? new Date(replayTime) : new Date();

export function localDay(at: Date, timeZone = zone) {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function atLocal(value: string, timeZone = zone, disambiguation: 'reject' | 'compatible' = 'reject') {
  return new Date(Temporal.PlainDateTime.from(value).toZonedDateTime(timeZone, { disambiguation }).epochMilliseconds);
}

export function dayAfter(day: string, days = 1) {
  return Temporal.PlainDate.from(day).add({ days }).toString();
}

export type Interval = { startsAt: Date | null; endsAt: Date | null; completedAt?: Date | null };

export function overlaps(start: Date, end: Date, event: Interval) {
  return !event.completedAt && !!event.startsAt && !!event.endsAt && start < event.endsAt && end > event.startsAt;
}

export function freeUntil(now: Date, events: Interval[], cap?: Date) {
  const limit = cap ?? atLocal(localDay(now) + 'T23:59:59', zone, 'compatible');
  if (events.some(event => overlaps(now, new Date(+now + 1), event))) return now;
  return events.reduce((end, event) => !event.completedAt && event.startsAt && event.startsAt >= now && event.startsAt < end
    ? event.startsAt : end, limit);
}

function parseTime(time: ICAL.Time, fallbackZone: string) {
  const id = time.zone.tzid;
  if (id === 'UTC' || id === 'Z') return time.toJSDate().toISOString();
  const result = Intl.supportedValuesOf('timeZone').includes(id) ? id : undefined;
  if (result || id === 'floating' || id === 'local') return atLocal(time.toString(), result ?? fallbackZone).toISOString();
  return time.toJSDate().toISOString();
}

export function readIcs(input: string, fallbackZone: string, from: string, until: string) {
  const root = new ICAL.Component(ICAL.parse(input));
  for (const component of root.getAllSubcomponents('vtimezone')) {
    const timezone = new ICAL.Timezone({ component });
    ICAL.TimezoneService.register(timezone);
  }
  const entries: { sourceKey: string; event: EventInput }[] = [];
  let skipped = 0;
  const components = root.getAllSubcomponents('vevent');
  const overrides = new Map<string, ICAL.Component[]>();
  for (const component of components) {
    if (!component.hasProperty('recurrence-id')) continue;
    const uid = String(component.getFirstPropertyValue('uid'));
    overrides.set(uid, [...(overrides.get(uid) ?? []), component]);
  }
  for (const component of components) {
    if (component.hasProperty('recurrence-id')) continue;
    try {
      const event = new ICAL.Event(component, { exceptions: overrides.get(String(component.getFirstPropertyValue('uid'))) });
      if (component.getFirstPropertyValue('status') === 'CANCELLED') continue;
      const append = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time, instance: string) => {
        const sourceKey = 'ics:' + createHash('sha256').update(event.uid + ':' + instance).digest('hex');
        const startZone = Intl.supportedValuesOf('timeZone').includes(start.zone.tzid) ? start.zone.tzid : fallbackZone;
        entries.push({ sourceKey, event: eventInput.parse({
          title: item.summary || 'Imported event', category: 'personal', location: item.location || '',
          description: item.description || '', zone: startZone,
          startsAt: start.isDate ? null : parseTime(start, fallbackZone),
          endsAt: start.isDate ? null : parseTime(end, fallbackZone),
          day: start.isDate ? start.toString() : null,
          endDay: start.isDate && end.compare(start) > 0 ? end.toString() : null,
        }) });
      };
      if (!event.isRecurring()) {
        append(event, event.startDate, event.endDate, '');
        continue;
      }
      const iterator = event.iterator();
      for (let n = 0; n < 20000 && entries.length < 500; n++) {
        const start = iterator.next();
        if (!start || start.toString().slice(0, 10) >= until) break;
        if (start.toString().slice(0, 10) < from) continue;
        const occurrence = event.getOccurrenceDetails(start);
        if (occurrence.item.component.getFirstPropertyValue('status') === 'CANCELLED') continue;
        append(occurrence.item, occurrence.startDate, occurrence.endDate, start.toString());
      }
    } catch { skipped++; }
    if (entries.length >= 500) break;
  }
  return { entries, skipped };
}

export function writeIcs(events: (Interval & { id: string; day: string | null; endDay: string | null; title: string; location: string; description: string })[]) {
  const root = new ICAL.Component(['vcalendar', [], []]);
  root.addPropertyWithValue('version', '2.0');
  root.addPropertyWithValue('prodid', '-//Hallway Quest//Schedule//EN');
  const timestamp = ICAL.Time.fromJSDate(new Date(), true);
  for (const event of events) {
    const item = new ICAL.Component('vevent');
    item.addPropertyWithValue('uid', event.id + '@hallway-quest');
    item.addPropertyWithValue('dtstamp', timestamp);
    item.addPropertyWithValue('summary', event.title);
    item.addPropertyWithValue('location', event.location);
    item.addPropertyWithValue('description', event.description);
    if (event.startsAt && event.endsAt) {
      item.addPropertyWithValue('dtstart', ICAL.Time.fromJSDate(event.startsAt, true));
      item.addPropertyWithValue('dtend', ICAL.Time.fromJSDate(event.endsAt, true));
    } else if (event.day) {
      item.addPropertyWithValue('dtstart', ICAL.Time.fromDateString(event.day));
      item.addPropertyWithValue('dtend', ICAL.Time.fromDateString(event.endDay ?? dayAfter(event.day)));
    }
    root.addSubcomponent(item);
  }
  return root.toString() + '\r\n';
}
