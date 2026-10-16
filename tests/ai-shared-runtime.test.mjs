import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { MockAgent } from 'undici';

test('actual Worker and SQLite DO enforce concurrent caps across runtime restart, without network', { timeout: 30000 }, async () => {
  const code = await build({ entryPoints: [fileURLToPath(new URL('../worker/index.ts', import.meta.url))], bundle: true, format: 'esm', platform: 'browser', write: false });
  const testRoot = resolve(tmpdir());
  const persistence = await mkdtemp(join(testRoot, 'projection-ai-quota-test-'));
  const mock = new MockAgent(); mock.disableNetConnect();
  mock.get('https://api.deepseek.com').intercept({ path: '/chat/completions', method: 'POST' }).reply(200, {
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"message":"offline test"}' } }]
  }).times(3);
  const options = {
    name: 'projection-ai-runtime-test', modules: true, script: code.outputFiles[0].text,
    compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'],
    bindings: { DEEPSEEK_API_KEY: 'offline-runtime-test-key', AI_ALLOWED_ORIGINS: 'https://syzhaoln-stack.github.io', AI_GLOBAL_PER_DAY: '3' },
    durableObjects: { AI_QUOTA: { className: 'AiQuota', useSQLite: true } }, durableObjectsPersist: persistence, fetchMock: mock
  };
  const init = ip => ({ method: 'POST', headers: { Origin: 'https://syzhaoln-stack.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ messages: [{ role: 'system', content: 'JSON only' }, { role: 'user', content: 'Test' }] }) });
  let runtime;
  try {
    runtime = new Miniflare(options);
    const status = await runtime.dispatchFetch('https://test.example/api/ai/status');
    assert.equal((await status.json()).ready, true);
    const replies = await Promise.all(Array.from({ length: 12 }, () => runtime.dispatchFetch('https://test.example/api/ai/chat', init('203.0.113.1'))));
    const results = await Promise.all(replies.map(async reply => ({ status: reply.status, body: await reply.text() })));
    assert.equal(replies.filter(reply => reply.status === 200).length, 3, JSON.stringify(results));
    assert.equal(replies.filter(reply => reply.status === 429).length, 9);
    mock.assertNoPendingInterceptors();
    await runtime.dispose(); runtime = new Miniflare(options);
    const exhausted = await runtime.dispatchFetch('https://test.example/api/ai/chat', init('203.0.113.2'));
    assert.equal(exhausted.status, 429); assert.equal((await exhausted.json()).error.code, 'RATE_LIMIT');
    assert.equal((await runtime.dispatchFetch('https://test.example/unrelated')).status, 404);
  } finally {
    if (runtime) await runtime.dispose();
    await mock.close();
    // Only remove this test's freshly created directory, never a computed parent.
    assert.ok(resolve(persistence).startsWith(`${testRoot}${sep}projection-ai-quota-test-`));
    await rm(persistence, { recursive: true, force: true });
  }
});
