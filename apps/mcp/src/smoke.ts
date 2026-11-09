import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mcpTools } from '@hallway/shared/mcp';

const url = new URL(process.env.HALLWAY_API_URL || 'http://127.0.0.1:3000');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Run this smoke test against a local test stack.');
const register = await fetch(new URL('/api/auth/register', url), {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'mcp-' + randomUUID() + '@example.test', password: 'hallway-smoke-test', demo: true }),
});
assert.equal(register.status, 201, await register.text());
const cookie = register.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
const credential = await fetch(new URL('/api/mcp/credentials', url), {
  method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ label: 'SDK smoke test' }),
});
assert.equal(credential.status, 200);
const { token, id } = await credential.json() as { token: string; id: string };
const client = new Client({ name: 'hallway-external-smoke', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ['--import', 'tsx', fileURLToPath(new URL('index.ts', import.meta.url))],
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { HALLWAY_API_URL: url.href, HALLWAY_MCP_TOKEN: token },
  }));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), Object.keys(mcpTools).sort());
  const result = await client.callTool({ name: 'get_next_event', arguments: { includeRecommendation: true, question: 'I have 15 minutes. What should I do next?' } });
  assert.ok(!result.isError);
  const content = Array.isArray(result.content) ? result.content[0] : null;
  assert.equal(content?.type, 'text');
  const value = JSON.parse(String(content?.text));
  assert.equal(value.recommendation.action.kind, 'quest');
  assert.equal(value.recommendation.minutes, 15);
  const denied = await client.callTool({ name: 'complete_quest', arguments: { questId: randomUUID() } });
  assert.equal(denied.isError, true);
  console.log('MCP stdio verified: all 13 tools, a scoped recommendation, and a denied write.');
} finally {
  await client.close();
  await fetch(new URL('/api/mcp/credentials/' + id, url), { method: 'DELETE', headers: { cookie } });
  await fetch(new URL('/api/auth/logout', url), { method: 'POST', headers: { cookie } });
}
