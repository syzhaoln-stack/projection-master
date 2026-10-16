import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSharedAIHandler, normalizeChatPayload, readBoundedJson, quotaLimits, SHARED_ENDPOINT, SHARED_MODEL, MAX_BODY_BYTES } from '../worker/ai-shared.js';
import { AiQuota } from '../worker/ai-quota.js';

const SITE = 'https://syzhaoln-stack.github.io';
const WORKER = 'https://projection-master-ai.example.workers.dev';
const TEST_KEY = 'unit-test-secret-never-live';
const payload = () => ({ model: 'deepseek-flash', messages: [{ role: 'system', content: 'Return a JSON model edit.' }, { role: 'user', content: 'Increase the tower height.' }], stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, max_tokens: 4096 });
const upstream = (content = '{"message":"ok","edits":[]}') => new Response(JSON.stringify({ id: 'private-provider-id', model: 'provider-model', usage: { total_tokens: 10 }, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] }));
function request(body = payload(), overrides = {}) {
  const { headers = {}, ...rest } = overrides;
  return new Request(`${WORKER}/api/ai/chat`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ...rest });
}

// Serial transactions with rollback model the contract relied on by AiQuota.
// Runtime integration is separately checked by Wrangler's local Worker bundle.
class Storage {
  constructor() { this.data = new Map(); this.alarmAt = null; this.tail = Promise.resolve(); this.fail = false; }
  async get(key) { if (this.fail) throw Error('storage offline'); return structuredClone(this.data.get(key)); }
  async put(key, value) { if (this.fail) throw Error('storage offline'); this.data.set(key, structuredClone(value)); }
  async getAlarm() { if (this.fail) throw Error('storage offline'); return this.alarmAt; }
  async setAlarm(value) { if (this.fail) throw Error('storage offline'); this.alarmAt = value; }
  async list({ prefix = '', end, limit }) { return new Map([...this.data].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => key.startsWith(prefix) && (!end || key < end)).slice(0, limit)); }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key); }
  async transaction(fn) {
    const work = this.tail.then(async () => {
      if (this.fail) throw Error('storage offline');
      const before = structuredClone(this.data);
      try { return await fn(this); } catch (error) { this.data = before; throw error; }
    });
    this.tail = work.catch(() => {});
    return work;
  }
}
function fixture(vars = {}, fetchImpl) {
  const storage = new Storage();
  const env = { DEEPSEEK_API_KEY: TEST_KEY, AI_ALLOWED_ORIGINS: SITE, ...vars };
  const quota = new AiQuota({ storage }, env);
  let now = Date.parse('2026-10-16T10:00:05Z'); quota.now = () => now;
  env.AI_QUOTA = { idFromName: name => { assert.equal(name, 'shared-default'); return name; }, get: () => quota };
  const calls = [];
  const handle = createSharedAIHandler({ fetchImpl: fetchImpl || (async (...args) => { calls.push(args); return upstream(); }) });
  return { storage, env, quota, calls, handle, advance: ms => now += ms, now: () => now };
}
const reserve = (quota, client = 'a'.repeat(64)) => quota.fetch(new Request('https://internal/reserve', { method: 'POST', body: JSON.stringify({ client }) }));
const responseCode = async response => (await response.json()).error?.code;

test('default quota configuration is explicit and invalid configuration fails closed', () => {
  assert.deepEqual(quotaLimits(), { perMinute: 3, perDay: 20, globalPerDay: 300 });
  for (const value of ['0', '-1', 'NaN', '1.5', '100001']) assert.throws(() => quotaLimits({ AI_GLOBAL_PER_DAY: value }), /SERVICE_UNAVAILABLE/);
});

test('server fixes endpoint, model, completion cap and strips upstream metadata', async () => {
  const f = fixture(); const body = { ...payload(), model: 'expensive-model', stream: true, max_tokens: 999999, thinking: { type: 'enabled' }, response_format: { type: 'text' } };
  const reply = await f.handle(request(body), f.env);
  assert.equal(reply.status, 200); assert.equal(f.calls.length, 1);
  const [url, options] = f.calls[0]; const forwarded = JSON.parse(options.body);
  assert.equal(url, SHARED_ENDPOINT); assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.Authorization, `Bearer ${TEST_KEY}`);
  assert.equal(forwarded.model, SHARED_MODEL); assert.equal(forwarded.max_tokens, 4096);
  assert.equal(forwarded.stream, false); assert.deepEqual(forwarded.thinking, { type: 'disabled' });
  assert.deepEqual(forwarded.response_format, { type: 'json_object' });
  const output = await reply.text(); assert.equal(output.includes(TEST_KEY), false); assert.equal(output.includes('private-provider'), false); assert.equal(output.includes('usage'), false);
  assert.equal(reply.headers.get('Access-Control-Allow-Origin'), SITE); assert.equal(reply.headers.get('Cache-Control'), 'no-store');
});

test('readiness probes are non-billable and disclose no secret or storage records', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) {
    const result = await f.handle(new Request(`${WORKER}/api/ai/status`, { headers: { Origin: SITE } }), f.env);
    assert.deepEqual(await result.json(), { ready: true, model: SHARED_MODEL, mode: 'shared', limits: { perMinute: 3, perDay: 20 } });
  }
  assert.equal(f.calls.length, 0); assert.equal(f.storage.data.size, 0);
  for (const env of [{ ...f.env, DEEPSEEK_API_KEY: undefined }, { ...f.env, AI_QUOTA: undefined }]) {
    const result = await f.handle(new Request(`${WORKER}/api/ai/status`), env); assert.equal((await result.json()).ready, false);
  }
  f.storage.fail = true;
  assert.equal((await (await f.handle(new Request(`${WORKER}/api/ai/status`), f.env)).json()).ready, false);
});

test('CORS allows the configured site and same origin without wildcard or credentials', async () => {
  const f = fixture();
  for (const origin of [SITE, WORKER]) {
    const preflight = await f.handle(new Request(`${WORKER}/api/ai/chat`, { method: 'OPTIONS', headers: { Origin: origin } }), f.env);
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(preflight.headers.has('Access-Control-Allow-Credentials'), false);
    assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  }
  for (const origin of ['https://evil.example', 'null', `${SITE}.evil.example`]) {
    const reply = await f.handle(request(payload(), { headers: { Origin: origin } }), f.env);
    assert.equal(reply.status, 403); assert.equal(reply.headers.has('Access-Control-Allow-Origin'), false);
  }
  const absent = request(); absent.headers.delete('Origin');
  assert.equal((await f.handle(absent, f.env)).status, 403);
  assert.equal(f.calls.length, 0); assert.equal(f.storage.data.size, 0);
});

test('missing backend dependencies, trusted IP or storage cause zero upstream calls', async () => {
  const f = fixture();
  for (const env of [{ ...f.env, DEEPSEEK_API_KEY: undefined }, { ...f.env, AI_QUOTA: undefined }, { ...f.env, AI_IP_PER_MINUTE: '0' }]) assert.equal((await f.handle(request(), env)).status, 503);
  const noIP = request(); noIP.headers.delete('CF-Connecting-IP'); noIP.headers.set('X-Forwarded-For', '1.2.3.4');
  assert.equal((await f.handle(noIP, f.env)).status, 503);
  f.storage.fail = true; assert.equal((await f.handle(request(), f.env)).status, 503);
  assert.equal(f.calls.length, 0);
});

test('malformed or forbidden relay fields are rejected before reservation', async () => {
  const f = fixture();
  const cases = [
    request('{bad'), request({ ...payload(), endpoint: 'https://evil.example' }), request({ ...payload(), apiKey: TEST_KEY }),
    request(payload(), { headers: { Authorization: 'Bearer any-client-key' } }), request(payload(), { headers: { 'Content-Type': 'text/plain' } }),
    request({ ...payload(), tools: [{}] }), request({ ...payload(), messages: [{ role: 'system', content: 's' }, { role: 'tool', content: 't' }] }),
    request({ ...payload(), messages: [{ role: 'system', content: 's' }, { role: 'user', content: TEST_KEY }] }),
    request({ ...payload(), messages: Array.from({ length: 11 }, (_, index) => ({ role: index ? 'user' : 'system', content: 'x' })) }),
    request({ ...payload(), messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'x'.repeat(65537) }] })
  ];
  for (const item of cases) assert.equal((await f.handle(item, f.env)).status, 400);
  assert.equal(f.calls.length, 0); assert.equal(f.storage.data.size, 0);
});

test('body limits check actual streamed bytes as well as Content-Length', async () => {
  const f = fixture();
  assert.equal((await f.handle(request(payload(), { headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } }), f.env)).status, 413);
  const source = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"x":"123456789"}')); controller.close(); } }));
  await assert.rejects(readBoundedJson(source, 10), error => error.code === 'REQUEST_TOO_LARGE');
  await assert.rejects(readBoundedJson(new Response(new Uint8Array([0xff])), 10), /INVALID_REQUEST/);
  assert.equal(f.calls.length, 0);
});

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRdwAAAAASUVORK5CYII=';
function pictured(url = png, count = 1) {
  const body = payload(); body.messages[1].content = [{ type: 'text', text: 'Inspect this view.' }, ...Array.from({ length: count }, () => ({ type: 'image_url', image_url: { url } }))]; return body;
}
test('vision accepts bounded inline raster images only on the latest user turn', () => {
  assert.equal(normalizeChatPayload(pictured()).messages[1].content[1].image_url.detail, 'high');
  for (const url of ['https://example.com/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHN2Zz48L3N2Zz4=', 'data:image/jpeg;base64,abcd', 'data:image/png;base64,@@@@']) assert.throws(() => normalizeChatPayload(pictured(url)), /INVALID_IMAGES/);
  assert.throws(() => normalizeChatPayload(pictured(png, 7)), /INVALID_IMAGES/);
  const oldImage = pictured(); oldImage.messages.push({ role: 'user', content: 'Next turn' }); assert.throws(() => normalizeChatPayload(oldImage), /INVALID_IMAGES/);
});

test('parallel requests honor one persistent minute quota and persist only hashes/counts', async () => {
  const f = fixture();
  const replies = await Promise.all(Array.from({ length: 25 }, () => f.handle(request(), f.env)));
  assert.equal(replies.filter(reply => reply.status === 200).length, 3);
  assert.equal(replies.filter(reply => reply.status === 429).length, 22); assert.equal(f.calls.length, 3);
  assert.equal(replies.find(reply => reply.status === 429).headers.get('Retry-After'), '55');
  const serialized = JSON.stringify([...f.storage.data]);
  for (const value of ['203.0.113.5', 'Increase the tower', TEST_KEY]) assert.equal(serialized.includes(value), false);
  const restarted = new AiQuota({ storage: f.storage }, f.env); restarted.now = f.now; f.env.AI_QUOTA.get = () => restarted;
  assert.equal((await f.handle(request(), f.env)).status, 429);
  f.advance(60000); assert.equal((await f.handle(request(), f.env)).status, 200);
});

test('per-IP daily and global daily caps survive minute changes and reset at UTC midnight', async () => {
  const f = fixture({ AI_IP_PER_MINUTE: '1', AI_IP_PER_DAY: '2', AI_GLOBAL_PER_DAY: '3' });
  assert.equal((await reserve(f.quota)).status, 200); f.advance(60000);
  assert.equal((await reserve(f.quota)).status, 200); f.advance(60000);
  assert.equal((await reserve(f.quota)).status, 429);
  assert.equal((await reserve(f.quota, 'b'.repeat(64))).status, 200);
  assert.equal((await reserve(f.quota, 'c'.repeat(64))).status, 429);
  f.advance(86400000); assert.equal((await reserve(f.quota)).status, 200);
  await f.quota.alarm();
  assert.ok([...f.storage.data.keys()].every(key => key.startsWith('day:2026-10-17:')));
});

test('failed upstream attempts consume quota and upstream error text never leaks', async () => {
  let count = 0;
  const f = fixture({}, async () => { count++; return new Response(`provider leaked ${TEST_KEY}`, { status: 401 }); });
  for (let i = 0; i < 3; i++) {
    const reply = await f.handle(request(), f.env); assert.equal(reply.status, 503);
    const text = await reply.text(); assert.equal(text.includes(TEST_KEY), false); assert.equal(text.includes('provider leaked'), false);
  }
  assert.equal((await f.handle(request(), f.env)).status, 429); assert.equal(count, 3);
});

test('invalid, truncated, oversized or secret-bearing completions are never returned', async () => {
  const responses = [
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }),
    () => upstream(`contains ${TEST_KEY}`), () => upstream('x'.repeat(32001)), () => new Response('not JSON'),
    () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '{}' } }] })),
    () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{}', tool_calls: [{}] } }] })),
    () => new Response('x'.repeat(65537))
  ];
  for (const build of responses) {
    const f = fixture({}, async () => build()); const reply = await f.handle(request(), f.env);
    assert.equal(reply.status, 503); assert.equal(await responseCode(reply), 'UPSTREAM_UNAVAILABLE');
  }
});

test('upstream deadlines abort work without exposing transport details', async () => {
  const f = fixture(); let signal;
  const handle = createSharedAIHandler({ timeoutMs: 5, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error(`network ${TEST_KEY}`)), { once: true }));
  } });
  const reply = await handle(request(), f.env); assert.equal(reply.status, 504); assert.equal(signal.aborted, true);
  assert.equal(await responseCode(reply), 'UPSTREAM_TIMEOUT');
});

test('unknown routes preserve asset fallback and supported routes enforce methods', async () => {
  const f = fixture(); assert.equal(await f.handle(new Request(`${WORKER}/index.html`), f.env), null);
  for (const path of ['/api/ai/status', '/api/ai/chat']) {
    const reply = await f.handle(new Request(`${WORKER}${path}`, { method: 'DELETE', headers: { Origin: SITE } }), f.env); assert.equal(reply.status, 405);
  }
});

test('deployment config uses persistent SQLite quota without a client-side secret', async () => {
  const config = JSON.parse(await readFile(new URL('../wrangler.ai.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.main, './worker/index.ts'); assert.deepEqual(config.migrations[0].new_sqlite_classes, ['AiQuota']);
  assert.deepEqual(config.durable_objects.bindings, [{ name: 'AI_QUOTA', class_name: 'AiQuota' }]);
  assert.deepEqual(config.vars.AI_ALLOWED_ORIGINS.split(','), [SITE, 'http://127.0.0.1:5186', 'http://localhost:5186']);
  assert.equal(config.vars.DEEPSEEK_API_KEY, undefined);
  assert.equal(config.observability.enabled, false);
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(ignore.split(/\r?\n/).includes('/.dev.vars')); assert.ok(ignore.split(/\r?\n/).includes('/.dev.vars.*'));
});
