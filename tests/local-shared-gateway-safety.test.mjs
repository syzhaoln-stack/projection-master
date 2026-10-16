import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApiGateway } from '../tools/start-local-shared.mjs';

const origin = 'https://syzhaoln-stack.github.io';
const headers = { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' };
const ok = () => new Response('{"ready":true}', { headers: { 'Content-Type': 'application/json' } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await delay(5); }
  assert.fail('gateway state did not settle');
}
async function withGateway(options, action) {
  const server = createApiGateway({ workerUrl: 'http://127.0.0.1:8798', allowedOrigins: [origin], ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('four unfinished bodies occupy the default slots before any body is buffered or forwarded', { timeout: 5000 }, async () => {
  let forwarded = 0;
  await withGateway({ fetchImpl: async () => { forwarded++; return ok(); } }, async url => {
    const partials = Array.from({ length: 4 }, () => {
      const request = httpRequest(url + '/api/ai/chat', { method: 'POST', headers });
      request.on('error', () => {}); request.flushHeaders(); request.write('{'); return request;
    });
    try {
      await delay(35);
      const blocked = await fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}' });
      assert.equal(blocked.status, 429, 'the fifth request must fail before its body/upstream is handled');
      assert.equal(forwarded, 0);
    } finally { partials.forEach(request => request.destroy()); }
    await delay(35);
    const next = await fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}' });
    assert.equal(next.status, 200); assert.equal(forwarded, 1, 'disconnecting an upload must release its slot');
  });
});

test('slow body timeout terminates the upload and releases its slot without forwarding a partial request', { timeout: 5000 }, async () => {
  let forwarded = 0;
  await withGateway({ maxConcurrent: 1, bodyTimeoutMs: 50, totalTimeoutMs: 1000, fetchImpl: async () => { forwarded++; return ok(); } }, async url => {
    const finished = new Promise(resolve => {
      const request = httpRequest(url + '/api/ai/chat', { method: 'POST', headers }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      request.on('error', () => resolve('disconnected'));
      request.flushHeaders(); request.write('{');
    });
    const timeout = await finished;
    assert.ok(timeout === 'disconnected' || [408, 503, 504].includes(timeout)); assert.equal(forwarded, 0);
    const next = await fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}' });
    assert.equal(next.status, 200); assert.equal(forwarded, 1);
  });
});

test('upstream timeout aborts the pending fetch and frees the global concurrency slot', { timeout: 5000 }, async () => {
  let forwarded = 0, aborted = 0;
  await withGateway({ maxConcurrent: 1, bodyTimeoutMs: 200, totalTimeoutMs: 70,
    fetchImpl: async (_url, options) => {
      if (++forwarded > 1) return ok();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(new Error('private transport failure')); }, { once: true }));
    } }, async url => {
    const result = await fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}' });
    assert.equal(result.status, 503); assert.equal((await result.text()).includes('private transport failure'), false); assert.equal(aborted, 1);
    const next = await fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}' });
    assert.equal(next.status, 200); assert.equal(forwarded, 2);
  });
});

test('a disconnected public client aborts its upstream call and releases the slot', { timeout: 5000 }, async () => {
  let forwarded = 0, aborted = 0;
  await withGateway({ maxConcurrent: 1, bodyTimeoutMs: 500, totalTimeoutMs: 1000,
    fetchImpl: async (_url, options) => {
      if (++forwarded > 1) return ok();
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(new Error('cancelled')); }, { once: true }));
    } }, async url => {
    const controller = new AbortController();
    const pending = fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}', signal: controller.signal }).catch(() => null);
    await until(() => forwarded === 1); controller.abort(); await pending; await until(() => aborted === 1);
    const next = await fetch(url + '/api/ai/chat', { method: 'POST', headers, body: '{}' });
    assert.equal(next.status, 200); assert.equal(forwarded, 2);
  });
});
