import { z } from 'zod';
import { db } from './db.js';
import { localDay } from './calendar.js';

const hourData = z.object({ hourly: z.object({
  time: z.array(z.number()), temperature_2m: z.array(z.number().nullable()), rain: z.array(z.number().nullable()),
  snowfall: z.array(z.number().nullable()), wind_gusts_10m: z.array(z.number().nullable()),
}) });
const venues = { saltPalace: [40.767, -111.896], shop: [40.7605, -111.8812] } as const;
type Venue = keyof typeof venues;
const inFlight = new Map<Venue, Promise<ReturnType<typeof hourData.parse> | null>>();

export function venueFor(location?: string): Venue {
  return location?.toLowerCase().includes('shop workspace') ? 'shop' : 'saltPalace';
}

async function refresh(venue: Venue) {
  const [latitude, longitude] = venues[venue];
  try {
    const query = new URLSearchParams({
      latitude: String(latitude), longitude: String(longitude), hourly: 'temperature_2m,rain,snowfall,wind_gusts_10m',
      timeformat: 'unixtime', temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', forecast_days: '7',
    });
    const result = await fetch('https://api.open-meteo.com/v1/forecast?' + query, { signal: AbortSignal.timeout(4500) });
    if (!result.ok) return null;
    const payload = hourData.parse(await result.json());
    const updatedAt = new Date();
    await db.forecast.upsert({ where: { venue }, update: { payload, updatedAt }, create: { venue, payload, updatedAt } });
    return payload;
  } catch { return null; }
}

function guidance(low: number, rain: boolean, snow: boolean, gust: number) {
  return [
    ...(low <= 50 ? ['Pack a warm layer.'] : []),
    ...(rain ? ['Rain is in the forecast. Bring an umbrella.'] : []),
    ...(snow ? ['Snow is in the forecast. Allow extra travel time.'] : []),
    ...(gust >= 25 ? ['Expect gusty conditions outside.'] : []),
  ];
}

export async function weather(day: string, demo: boolean, venue: Venue = 'saltPalace') {
  if (demo) return { mode: 'demo', venue, low: 36, high: 52, rain: false, snow: false, gust: 12,
    updatedAt: '2026-11-10T16:00:00Z', guidance: guidance(36, false, false, 12) };
  const cached = await db.forecast.findUnique({ where: { venue } });
  const age = cached ? Date.now() - +cached.updatedAt : Infinity;
  let data = cached && age < 24 * 60 * 60 * 1000 ? hourData.safeParse(cached.payload).data : undefined;
  let updatedAt = cached?.updatedAt ?? null;
  let stale = age >= 30 * 60 * 1000;
  if (stale || !data) {
    const pending = inFlight.get(venue) ?? refresh(venue).finally(() => inFlight.delete(venue));
    inFlight.set(venue, pending);
    const refreshed = await pending;
    if (refreshed) { data = refreshed; updatedAt = new Date(); stale = false; }
  }
  const hours = data?.hourly;
  const selected = hours?.time.flatMap((time, index) => localDay(new Date(time * 1000)) === day ? [index] : []) ?? [];
  const temps = selected.flatMap(index => {
    const temperature = hours?.temperature_2m[index];
    return temperature == null ? [] : [temperature];
  });
  if (!temps.length) return { mode: 'unavailable', venue, low: null, high: null, rain: null, snow: null, gust: null, updatedAt: null, guidance: [] };
  const low = Math.round(Math.min(...temps));
  const high = Math.round(Math.max(...temps));
  const rain = selected.some(index => (hours?.rain[index] ?? 0) > 0);
  const snow = selected.some(index => (hours?.snowfall[index] ?? 0) > 0);
  const gust = Math.round(Math.max(...selected.map(index => hours?.wind_gusts_10m[index] ?? 0)));
  return { mode: stale ? 'stale' : 'live', venue, low, high, rain, snow, gust, updatedAt, guidance: guidance(low, rain, snow, gust) };
}
