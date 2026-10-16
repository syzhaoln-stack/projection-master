import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApiGateway, extractApiKey, localWorkerConfig } from '../tools/start-local-shared.mjs';

const origin = 'https://syzhaoln-stack.github.io';
const token = `sk-${'x'.repeat(32)}`;
async function withGateway(action, fetchImpl = async () => new Response(JSON.stringify({ ready: true }), { headers: { 'Content-Type': 'application/json' } })) {
  const server = createApiGateway({ workerUrl: 'http://127.0.0.1:8798', allowedOrigins: [origin], fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('key parsing accepts one explicit official token without echoing ambiguous or invalid content', () => {
  assert.equal(extractApiKey(`官方接口\n${token}\n`), token);
  assert.equal(extractApiKey(`${token}\n${token}`), token);
  for (const text of ['empty', `${token}\nsk-${'y'.repeat(32)}`]) {
    assert.throws(() => extractApiKey(text), error => error.message === 'KEY_FILE_FORMAT' && !error.message.includes(text));
  }
});

test('local config preserves the existing quota binding and limits while excluding assets and deployment metadata', () => {
  const source = { name: 'sample', main: './worker/index.ts', compatibility_date: '2026-05-22', compatibility_flags: ['nodejs_compat'],
    vars: { AI_GLOBAL_PER_DAY: '300' }, durable_objects: { bindings: [{ name: 'AI_QUOTA', class_name: 'AiQuota' }] },
    migrations: [{ tag: 'shared-ai-v1', new_sqlite_classes: ['AiQuota'] }], assets: { directory: './dist' }, account_id: 'not-copied' };
  const result = localWorkerConfig(source);
  assert.deepEqual(result.vars, source.vars); assert.deepEqual(result.durable_objects, source.durable_objects);
  assert.deepEqual(result.migrations, source.migrations); assert.equal(result.assets, undefined); assert.equal(result.account_id, undefined);
  assert.equal(Object.keys(result).some(key => /secret|key/i.test(key)), false);
});

test('gateway exposes only the two exact API routes and never the inspector, dev metadata, files or upgrades', async () => {
  let forwarded = 0;
  await withGateway(async url => {
    for (const path of ['/', '/.dev.vars', '/cdn-cgi/handler', '/__scheduled', '/json', '/api/ai/status?inspect=1']) {
      assert.equal((await fetch(url + path)).status, 404);
    }
    assert.equal((await fetch(url + '/api/ai/chat', { method: 'GET' })).status, 405);
    assert.equal(forwarded, 0);
  }, async () => { forwarded++; throw new Error('must not forward'); });
});

test('gateway rejects missing and disallowed origins before forwarding chat and bounds claimed request size', async () => {
  let forwarded = 0;
  await withGateway(async url => {
    for (const headers of [{}, { Origin: 'https://unrelated.example' }]) assert.equal((await fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await fetch(url + '/api/ai/status', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
    const tooLarge = await new Promise((resolve, reject) => {
      const request = httpRequest(url + '/api/ai/chat', { method: 'POST', headers: { Origin: origin, 'Content-Length': 26 * 1024 * 1024 + 1 } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end('{}');
    });
    assert.equal(tooLarge, 413);
    assert.equal(forwarded, 0);
  }, async () => { forwarded++; throw new Error('must not forward'); });
});

test('gateway preserves existing Worker validation and Cloudflare IP while dropping arbitrary forwarding headers', async () => {
  await withGateway(async url => {
    const result = await fetch(url + '/api/ai/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': '1.2.3.4', Authorization: 'client-key-must-be-rejected' }, body: '{}' });
    assert.equal(result.status, 400); assert.equal(result.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(result.headers.get('X-Private-Debug'), null);
  }, async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8798/api/ai/chat'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.get('cf-connecting-ip'), '203.0.113.9'); assert.equal(options.headers.get('x-forwarded-for'), null);
    assert.ok(options.headers.has('authorization'), 'the Worker must reject an accidental client credential itself');
    return new Response(JSON.stringify({ error: { code: 'INVALID_REQUEST' } }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'X-Private-Debug': 'never-public' } });
  });
});

test('status and preflight work without DeepSeek, and non-JSON developer error pages are replaced', async () => {
  await withGateway(async url => {
    assert.equal((await (await fetch(url + '/api/ai/status')).json()).ready, true);
    assert.equal((await fetch(url + '/api/ai/chat', { method: 'OPTIONS', headers: { Origin: origin } })).status, 204);
  }, async (_url, options) => options.method === 'OPTIONS' ? new Response(null, { status: 204 }) : new Response('{"ready":true}', { headers: { 'Content-Type': 'application/json' } }));
  await withGateway(async url => {
    const result = await fetch(url + '/api/ai/status'); assert.equal(result.status, 502);
    assert.equal((await result.text()).includes('private-stack'), false);
  }, async () => new Response('<html>private-stack</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }));
});
