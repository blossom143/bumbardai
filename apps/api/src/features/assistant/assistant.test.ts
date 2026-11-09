import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefingCopy, preparationCopy } from './assistant.js';

test('the OpenAI adapter supplies strict tool and output schemas, and passes authoritative context', async (t) => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'fixture-key';
  const sent: Record<string, unknown>[] = [];
  const fake = t.mock.method(
    globalThis,
    'fetch',
    async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(request);
      const output = request.tools
        ? [
            {
              type: 'function_call',
              id: 'fc_fixture',
              name: 'get_attendee_context',
              call_id: 'call_fixture',
              arguments: '{}',
              status: 'completed',
            },
          ]
        : [
            {
              type: 'message',
              id: 'msg_fixture',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: '{"lead":"Make room for curiosity.","tips":["Take a moment to get oriented."]}',
                  annotations: [],
                },
              ],
            },
          ];
      return new Response(JSON.stringify({ id: 'resp_fixture', status: 'completed', output }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  try {
    const response = await briefingCopy({
      count: 2,
      freeMinutes: 15,
      weatherGuidance: ['Pack a warm layer.'],
    });
    assert.deepEqual(response, {
      lead: 'Make room for curiosity.',
      tips: ['Take a moment to get oriented.'],
    });
    assert.equal(sent.length, 2);
    const first = sent[0] as { store: boolean; tools: { strict: boolean }[] };
    const second = sent[1] as {
      store: boolean;
      text: { format: { strict: boolean } };
      input: { type?: string; output?: string }[];
    };
    assert.equal(first.store, false);
    assert.equal(first.tools[0]?.strict, true);
    assert.equal(second.store, false);
    assert.equal(second.text.format.strict, true);
    const context = second.input.find((item) => item.type === 'function_call_output')?.output;
    assert.match(context ?? '', /"freeMinutes":15/);
    assert.equal(await preparationCopy({ category: 'hackathon' }), null);
  } finally {
    fake.mock.restore();
    if (prior === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prior;
  }
});
