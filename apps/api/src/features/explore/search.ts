import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { traced } from '../../shared/telemetry.js';

const endpoint = process.env.ELASTICSEARCH_URL;
const token = process.env.ELASTICSEARCH_API_KEY;
const sessionIndex = 'hallway-sessions-v1';
const peopleIndex = 'hallway-attendees-v1';
const dimensions = 256;
const textModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const topics = [
  /kubernetes|k8s|cloud native|cluster|orchestrat|containers/,
  /\bgo\b|golang|programming|coding|software|cli/,
  /\bai\b|models?|inference|llm|machine learning|artificial intelligence|agents?/,
  /devops|ci\/cd|platform|gitops|deliver|deployment/,
  /security|secure|authorization|rbac|identity/,
  /observability|monitor|metrics|logs|trac|telemetry|visibility/,
  /ebpf|kernel|syscall/,
  /open.source|contribut|maintain|community|oss|first patch/,
  /beginner|intro|newcomer|basics|getting started|fundamental/,
];
export type SearchDoc = {
  id: string;
  demo: boolean;
  title: string;
  text: string;
  topics: string[];
  skill?: string | null;
  day?: string;
};
type Filter = Record<string, unknown>;
type Hit = { _id: string; _source?: { fingerprint?: string; vector?: number[] } };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function elastic<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  raw = false,
  tolerateNotFound = false,
) {
  if (!endpoint) throw new Error('Elasticsearch is disabled.');
  const result = await fetch(endpoint.replace(/\/$/, '') + path, {
    method,
    body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body),
    headers: {
      ...(body === undefined
        ? {}
        : { 'Content-Type': raw ? 'application/x-ndjson' : 'application/json' }),
      ...(token ? { Authorization: 'ApiKey ' + token } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (result.status === 404 && tolerateNotFound) return null as T;
  const json = await result.json();
  if (!result.ok) throw new Error('Elasticsearch HTTP ' + result.status);
  return json as T;
}

const initialized = new Map<string, Promise<void>>();
function initialize(index: string) {
  const existing = initialized.get(index);
  if (existing) return existing;
  const pending = (async () => {
    if (await elastic('/' + index, 'GET', undefined, false, true)) return;
    try {
      await elastic('/' + index, 'PUT', {
        mappings: {
          properties: {
            demo: { type: 'boolean' },
            title: { type: 'text' },
            text: { type: 'text' },
            topics: { type: 'keyword' },
            skill: { type: 'keyword' },
            day: { type: 'keyword' },
            fingerprint: { type: 'keyword' },
            vector: { type: 'dense_vector', dims: dimensions, index: true, similarity: 'cosine' },
          },
        },
      });
    } catch (error) {
      if (!(await elastic('/' + index, 'GET', undefined, false, true))) throw error;
    }
  })().catch((error) => {
    initialized.delete(index);
    throw error;
  });
  initialized.set(index, pending);
  return pending;
}

function demoVector(text: string) {
  const result = Array.from({ length: dimensions }, () => 0);
  const lower = text.toLowerCase();
  topics.forEach((matcher, index) => {
    if (matcher.test(lower)) result[index] = 3;
  });
  for (const word of lower.match(/[a-z\d]{3,}/g) ?? []) {
    const key =
      topics.length + (parseInt(digest(word).slice(0, 4), 16) % (dimensions - topics.length));
    result[key] = (result[key] ?? 0) + 0.2;
  }
  if (!result.some(Boolean)) result[dimensions - 1] = 1;
  return result;
}

async function embeddings(input: string[], demo: boolean) {
  if (!input.length) return [];
  if (demo && !process.env.OPENAI_API_KEY) return input.map(demoVector);
  if (!process.env.OPENAI_API_KEY) return [];
  return traced('openai.embeddings', async () => {
    try {
      const response = await new OpenAI({ timeout: 12000, maxRetries: 0 }).embeddings.create({
        model: textModel,
        input,
        dimensions,
      });
      return response.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
    } catch {
      return [];
    }
  });
}

const syncs = new Map<string, { version: string; ready: Promise<void> }>();
async function sync(index: string, docs: SearchDoc[], demo: boolean) {
  await initialize(index);
  const mode = process.env.OPENAI_API_KEY ? textModel : demo ? 'demo-topics-v1' : 'keyword';
  const desired = docs.map((doc) => ({ doc, fingerprint: digest(JSON.stringify([mode, doc])) }));
  const wanted = new Set(docs.map((doc) => doc.id));
  const existing = await elastic<{ hits: { hits: Hit[] } }>('/' + index + '/_search', 'POST', {
    size: 10000,
    query: { term: { demo } },
    _source: ['fingerprint'],
  });
  const current = new Map(existing.hits.hits.map((hit) => [hit._id, hit._source?.fingerprint]));
  const pending = desired.filter((row) => current.get(row.doc.id) !== row.fingerprint);
  const lines: string[] = [];
  for (const id of current.keys()) {
    if (!wanted.has(id)) lines.push(JSON.stringify({ delete: { _index: index, _id: id } }));
  }
  // Make the initial lexical index available even when the embedding provider is down.
  for (const { doc, fingerprint } of pending) {
    lines.push(
      JSON.stringify({ index: { _index: index, _id: doc.id } }),
      JSON.stringify({
        ...doc,
        fingerprint: mode === 'keyword' ? fingerprint : 'pending:' + fingerprint,
      }),
    );
  }
  await bulk(lines);
  if (mode === 'keyword' || !pending.length) return;
  for (let offset = 0; offset < pending.length; offset += 80) {
    const batch = pending.slice(offset, offset + 80);
    const vectors = await embeddings(
      batch.map(({ doc }) => [doc.title, doc.text, ...doc.topics].join(' ')),
      demo,
    );
    if (vectors.length !== batch.length) throw new Error('Embeddings are unavailable.');
    await bulk(
      batch.flatMap(({ doc, fingerprint }, indexInBatch) => [
        JSON.stringify({ index: { _index: index, _id: doc.id } }),
        JSON.stringify({ ...doc, fingerprint, vector: vectors[indexInBatch] }),
      ]),
    );
  }
}

async function bulk(lines: string[]) {
  if (!lines.length) return;
  const response = await elastic<{ errors: boolean }>(
    '/_bulk?refresh=wait_for',
    'POST',
    lines.join('\n') + '\n',
    true,
  );
  if (response.errors) throw new Error('Elasticsearch rejected index changes.');
}

function ensure(index: string, docs: SearchDoc[], demo: boolean) {
  const key = index + ':' + demo;
  const version = digest(JSON.stringify(docs));
  const existing = syncs.get(key);
  if (existing?.version === version) return existing.ready;
  const ready = (existing?.ready.catch(() => {}) ?? Promise.resolve())
    .then(() => sync(index, docs, demo))
    .catch((error) => {
      if (syncs.get(key)?.version === version) syncs.delete(key);
      throw error;
    });
  syncs.set(key, { version, ready });
  return ready;
}

export function fuse(...rankings: string[][]) {
  const scores = new Map<string, number>();
  for (const ranking of rankings)
    ranking.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1)));
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

async function rank(
  index: string,
  q: string,
  docs: SearchDoc[],
  demo: boolean,
  extra: Filter[] = [],
) {
  if (!endpoint || !q.trim() || !docs.length) return null;
  return traced('elasticsearch.rank', async () => {
    try {
      await ensure(index, docs, demo).catch(() => {});
      const filters = [{ term: { demo } }, ...extra];
      const request = (payload: unknown) =>
        elastic<{ hits: { hits: Hit[] } }>('/' + index + '/_search', 'POST', payload).then(
          (result) => result.hits.hits.map((hit) => hit._id),
        );
      const vector = (await embeddings([q], demo))[0];
      const [keyword, semantic] = await Promise.all([
        request({
          size: 70,
          _source: false,
          query: {
            bool: {
              filter: filters,
              must: [
                {
                  multi_match: {
                    query: q,
                    fields: ['title^4', 'text', 'topics^2', 'skill'],
                    operator: 'or',
                  },
                },
              ],
            },
          },
        }),
        vector
          ? request({
              size: 70,
              _source: false,
              knn: {
                field: 'vector',
                query_vector: vector,
                k: 70,
                num_candidates: 110,
                filter: { bool: { filter: filters } },
              },
            }).catch(() => [])
          : [],
      ]);
      return { ids: fuse(keyword, semantic), mode: semantic.length ? 'hybrid' : 'keyword' };
    } catch {
      return null;
    }
  });
}

export const sessionSearch = (query: string, docs: SearchDoc[], demo: boolean, filters: Filter[]) =>
  rank(sessionIndex, query, docs, demo, filters);
export const attendeeSearch = (query: string, docs: SearchDoc[], demo: boolean, userId: string) =>
  rank(peopleIndex, query, docs, demo, [{ bool: { must_not: [{ ids: { values: [userId] } }] } }]);
