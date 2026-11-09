import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ProfileInput, EventInput } from '@hallway/shared';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type User = { id: string; email: string; demo: boolean; profile: ProfileInput | null; reminderPrefs?: Preferences | null };
export type Preferences = { enabled: boolean; quietStart: string; quietEnd: string; zone: string };
export type Item = { id: string; label: string; status: 'open' | 'done' | 'dismissed' };
export type Event = EventInput & { id: string; catalogId: string | null; completedAt: string | null; checklist: Item[] };
export type Catalog = Omit<EventInput, 'zone'> & { id: string; topics: string[]; speakers: string[]; skill: string | null; demo: boolean; sourceUrl: string; reason: string };
export type Quest = { id: string; title: string; mission: string; icebreaker: string; category: string; minutes: number;
  difficulty: 'easy' | 'medium' | 'hard'; status: 'suggested' | 'active' | 'completed' | 'skipped'; mode: 'ai' | 'rules' };
export type Progress = { xp: number; level: number; badges: string[]; completed: number };
export type Award = { awarded: number; badges: string[]; progress: Progress };
export type Today = {
  now: string; day: string; freeMinutes: number; events: Event[]; next: Event | null; current: Event | null;
  forecast: { mode: string; venue: string; low: number | null; high: number | null; updatedAt: string | null; guidance: string[] };
  briefing: { mode: string; lead: string; tips: string[] }; progress: Progress; quest: Quest | null; recommendation: Catalog | null;
  checklist: { eventId: string; title: string; items: Item[] } | null;
};
export type Advice = { action: { kind: string; title: string; detail: string; path: string }; minutes: number; mode: string; lead: string; tips: string[] };
export type SaveResult = { event?: Event; conflicts?: { id: string; title: string }[] };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const result = await fetch('/api' + path, {
    method, headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!result.ok) {
    const detail = await result.json().catch(() => null);
    throw new ApiError(result.status, detail?.error || 'Could not complete the request.');
  }
  return result.status === 204 ? undefined as T : result.json();
}

export const useUI = create<{ dark: boolean; collapsed: boolean; toggleDark: () => void; toggleSidebar: () => void }>()(persist(
  set => ({ dark: false, collapsed: false, toggleDark: () => set(state => ({ dark: !state.dark })), toggleSidebar: () => set(state => ({ collapsed: !state.collapsed })) }),
  { name: 'hallway-ui' },
));
export function useAction<T, V>(run: (input: V) => Promise<T>, refresh: string[] = []) {
  const client = useQueryClient();
  return useMutation({ mutationFn: run, onSuccess: async () => {
    await Promise.all(refresh.map(key => client.invalidateQueries({ queryKey: [key] })));
  } });
}

const localKey = 'hallway-offline';
export type Snapshot = { owner: string; nickname: string; events?: Event[]; quests?: Quest[] };
export function readSnapshot(): Snapshot | null {
  try { return JSON.parse(localStorage.getItem(localKey) || 'null') as Snapshot | null; } catch { return null; }
}
export function saveSnapshot(user: User, value: Partial<Pick<Snapshot, 'events' | 'quests'>> = {}) {
  const before = readSnapshot();
  try { localStorage.setItem(localKey, JSON.stringify({
    ...(before?.owner === user.id ? before : {}), owner: user.id, nickname: user.profile?.nickname || 'Attendee', ...value,
  })); } catch { /* storage is optional */ }
}
export function clearSnapshot() {
  try { localStorage.removeItem(localKey); } catch { /* storage is optional */ }
}
