import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const chatResponse = z.object({
  done: z.literal(true),
  message: z.object({ content: z.string() }),
});

export async function ollamaCopy<T extends z.ZodTypeAny>(
  instructions: string,
  question: string,
  context: unknown,
  format: T,
): Promise<z.infer<T> | null> {
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!model) return null;

  const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434';
  const schema = zodTextFormat(format, 'hallway_response').schema;
  const response = await fetch(new URL('/api/chat', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: instructions },
        {
          role: 'user',
          content: JSON.stringify({ question, context }),
        },
      ],
      format: schema,
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 450 },
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;

  const chat = chatResponse.safeParse(await response.json());
  if (!chat.success) return null;
  const output = format.safeParse(JSON.parse(chat.data.message.content));
  return output.success ? output.data : null;
}
