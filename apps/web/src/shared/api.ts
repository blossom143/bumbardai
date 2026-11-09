export { useAction, useResource } from './hooks/use-api-request';
import { z } from 'zod';
import {
  adviceSchema,
  attendeeSchema,
  awardSchema,
  catalogSchema,
  checklistItemSchema,
  eventSchema,
  progressSchema,
  questSchema,
  reminderPreferences,
  saveEventSchema,
  todaySchema,
} from '@hallway/shared/responses';

export type User = z.infer<typeof attendeeSchema>;
export type Preferences = z.infer<typeof reminderPreferences>;
export type Item = z.infer<typeof checklistItemSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type Quest = z.infer<typeof questSchema>;
export type Progress = z.infer<typeof progressSchema>;
export type Award = z.infer<typeof awardSchema>;
export type Today = z.infer<typeof todaySchema>;
export type Advice = z.infer<typeof adviceSchema>;
export type SaveResult = z.infer<typeof saveEventSchema>;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const apiErrorSchema = z.object({ error: z.string() });

export async function api<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  method = 'GET',
  data?: unknown,
): Promise<z.output<S>> {
  const response = await fetch('/api' + path, {
    method,
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const detail = apiErrorSchema.safeParse(await response.json().catch(() => null));
    throw new ApiError(response.status, detail.data?.error ?? 'Could not complete the request.');
  }

  const payload = response.status === 204 ? undefined : await response.json().catch(() => null);
  const result = schema.safeParse(payload);
  if (!result.success)
    throw new ApiError(502, 'Hallway Quest returned an unexpected response. Try again.');
  return result.data;
}
