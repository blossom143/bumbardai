import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atLocal, freeUntil, overlaps, readIcs, writeIcs } from './calendar.js';
import { normalizeFeed } from './import-catalog.js';
import { fuse } from './search.js';

test('calendar preserves real instants across DST and rejects ambiguous wall-clock inputs', () => {
  assert.equal(atLocal('2026-03-08T01:30').toISOString(), '2026-03-08T08:30:00.000Z');
  assert.equal(atLocal('2026-03-08T03:30').toISOString(), '2026-03-08T09:30:00.000Z');
  assert.throws(() => atLocal('2026-03-08T02:30'), RangeError);
  assert.throws(() => atLocal('2026-11-01T01:30'), RangeError);
});
test('availability respects exclusive boundaries and ignores date-only and completed activities', () => {
  const time = (hour: string) => new Date('2026-11-10T' + hour + ':00Z');
  const busy = { startsAt: time('17:30'), endsAt: time('18:00') };
  assert.equal(overlaps(time('18:00'), time('18:30'), busy), false);
  assert.equal(overlaps(time('17:59'), time('18:30'), busy), true);
  assert.equal(+freeUntil(time('17:00'), [busy, { startsAt: null, endsAt: null }]), +time('17:30'));
  assert.equal(+freeUntil(time('17:45'), [busy]), +time('17:45'));
  assert.equal(overlaps(time('17:45'), time('18:30'), { ...busy, completedAt: time('17:50') }), false);
});
test('ICS round-trip preserves times, all-day bounds, and escaped text', () => {
  const events = [
    { id: 'timed', title: 'A, B; C', startsAt: new Date('2026-11-10T17:00:00Z'), endsAt: new Date('2026-11-10T18:00:00Z'),
      day: null, endDay: null, location: '', description: 'Line one\nLine two' },
    { id: 'all-day', title: 'Field day', startsAt: null, endsAt: null, day: '2026-11-10', endDay: '2026-11-12', location: '', description: '' },
  ];
  const roundTrip = readIcs(writeIcs(events), 'America/Denver', '2026-11-01', '2026-12-01');
  assert.equal(roundTrip.skipped, 0);
  assert.equal(roundTrip.entries[0]?.event.startsAt, events[0]?.startsAt?.toISOString());
  assert.equal(roundTrip.entries[0]?.event.description, events[0]?.description);
  assert.equal(roundTrip.entries[1]?.event.endDay, '2026-11-12');
});
test('ICS accepts standard IANA TZID without requiring embedded VTIMEZONE', () => {
  const source = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:known-zone', 'SUMMARY:Local talk',
    'DTSTART;TZID=America/New_York:20261110T110000', 'DTEND;TZID=America/New_York:20261110T120000',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const result = readIcs(source, 'America/Denver', '2026-11-01', '2026-12-01');
  assert.equal(result.entries[0]?.event.startsAt, '2026-11-10T16:00:00.000Z');
});
test('incomplete schedule feed is rejected and rank fusion favors agreement', () => {
  assert.throws(() => normalizeFeed({ speakers: [], rooms: [], categories: [], sessions: [] }));
  assert.deepEqual(fuse(['keyword', 'shared'], ['semantic', 'shared']), ['shared', 'keyword', 'semantic']);
});
