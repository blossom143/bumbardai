import { z } from 'zod';
import { eventSchema, questSchema } from '@hallway/shared/responses';
import type { User } from '../../shared/api';

const localKey = 'hallway-offline';
const snapshotSchema = z.object({
  owner: z.string().uuid(),
  nickname: z.string(),
  events: eventSchema.array().optional(),
  quests: questSchema.array().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export function readSnapshot(): Snapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(localKey) || 'null');
    return snapshotSchema.safeParse(value).data ?? null;
  } catch {
    return null;
  }
}
export function saveSnapshot(user: User, value: Partial<Pick<Snapshot, 'events' | 'quests'>> = {}) {
  const before = readSnapshot();
  try {
    localStorage.setItem(
      localKey,
      JSON.stringify({
        ...(before?.owner === user.id ? before : {}),
        owner: user.id,
        nickname: user.profile?.nickname || 'Attendee',
        ...value,
      }),
    );
  } catch {
    /* storage is optional */
  }
}
export function clearSnapshot() {
  try {
    localStorage.removeItem(localKey);
  } catch {
    /* storage is optional */
  }
}
