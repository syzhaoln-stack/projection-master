import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIEditError, DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, EDIT_PLAN_TIMEOUT_MS,
  requestEditPlan, validateEditPlan
} from '../ai-edit-protocol.js';

const TEST_KEY = 'test-only-memory-credential';
const PRIVATE_RESPONSE = 'private-response-content-do-not-display';
const context = () => ({
  targetId: 'bridge:girder', label: '当前箱梁',
  parameters: [
    { key: 'width', label: '梁宽', value: 2.5, min: 1, max: 5, step: 0.1, unit: 'm' },
    { key: 'height', label: '梁高', value: 1.2, min: 0.5, max: 3, step: 0.1, unit: 'm' }
  ]
});
const plan = () => ({
  targetId: 'bridge:girder', summary: '将梁宽调整为3米。', changes: [{ key: 'width', value: 3 }]
});
const envelope = value => ({
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }]
});
const response = body => ({ ok: true, status: 200, json: async () => body });
const options = fetchImpl => ({ apiKey: TEST_KEY, instruction: '把梁宽改为3米', context: context(), fetchImpl });

function safeError(code) {
  return error => {
    assert.ok(error instanceof AIEditError);
    assert.equal(error.code, code);
    assert.match(error.message, /[\u4e00-\u9fff]/);
    const output = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
    assert.ok(!output.includes(TEST_KEY));
    assert.ok(!output.includes(PRIVATE_RESPONSE));
    assert.equal(error.cause, undefined, 'raw transport errors must not be retained');
    return true;
  };
}

test('valid plans return independent data and permit an explicit no-change explanation', () => {
  const source = plan();
  const model = context();
  const result = validateEditPlan(source, model);
  assert.deepEqual(result, source);
  result.changes[0].value = 4;
  assert.equal(source.changes[0].value, 3);
  assert.equal(model.parameters[0].value, 2.5, 'validation never applies a change');
  assert.deepEqual(validateEditPlan({ ...plan(), summary: ' 当前参数不支持此要求。 ', changes: [] }, model), {
    targetId: model.targetId, summary: '当前参数不支持此要求。', changes: []
  });
});

test('plan validation rejects unknown fields, unsupported keys, duplicates and mismatched targets', () => {
  const invalid = [
    { ...plan(), targetId: 'another-model' },
    { ...plan(), execute: 'arbitrary code' },
    { ...plan(), changes: [{ key: 'width', value: 3, unit: 'mm' }] },
    { ...plan(), changes: [{ key: 'newPart', value: 3 }] },
    { ...plan(), changes: [{ key: 'width', value: 3 }, { key: 'width', value: 4 }] },
    { ...plan(), changes: [{ key: 'constructor', value: 3 }] },
    { ...plan(), changes: [{ value: 3 }] },
    { ...plan(), changes: 'width=3' },
    { ...plan(), summary: '' },
    { ...plan(), summary: '字'.repeat(601) },
    JSON.parse('{"targetId":"bridge:girder","summary":"更改尺寸","changes":[],"__proto__":{}}'),
    Object.assign(Object.create({ hidden: true }), plan()),
    null, [], 'not a plan'
  ];
  const symbolField = plan();
  symbolField[Symbol('extra')] = true;
  invalid.push(symbolField);
  for (const value of invalid) assert.throws(() => validateEditPlan(value, context()), safeError('INVALID_PLAN'));
});

test('parameter values must be finite numbers, within bounds and on the allowed step', () => {
  for (const value of [NaN, Infinity, -Infinity, '3', null, true, {}, 0.9, 5.1, 2.55]) {
    assert.throws(() => validateEditPlan({ ...plan(), changes: [{ key: 'width', value }] }, context()), safeError('INVALID_PLAN'));
  }
  for (const value of [1, 5, 1.3, 1 + 0.1 + 0.1]) {
    assert.equal(validateEditPlan({ ...plan(), changes: [{ key: 'width', value }] }, context()).changes[0].value, value);
  }
});

test('current context is checked again when applying a previously valid plan', () => {
  const generated = validateEditPlan(plan(), context());
  const switchedModel = { ...context(), targetId: 'other-target' };
  assert.throws(() => validateEditPlan(generated, switchedModel), safeError('INVALID_PLAN'));
  const narrowerLimits = context();
  narrowerLimits.parameters[0].max = 2.8;
  assert.throws(() => validateEditPlan(generated, narrowerLimits), safeError('INVALID_PLAN'));
});

test('malformed parameter contracts fail before any request', async () => {
  const invalid = [
    null, {}, { ...context(), parameters: [] },
    { ...context(), parameters: [...context().parameters, context().parameters[0]] },
    { ...context(), parameters: [{ ...context().parameters[0], step: 0 }] },
    { ...context(), parameters: [{ ...context().parameters[0], max: Infinity }] },
    { ...context(), parameters: [{ ...context().parameters[0], value: 100 }] },
    { ...context(), parameters: [{ ...context().parameters[0], key: '__proto__' }] }
  ];
  let requests = 0;
  for (const value of invalid) {
    await assert.rejects(requestEditPlan({ ...options(() => { requests++; }), context: value }), safeError('INVALID_CONTEXT'));
  }
  assert.equal(requests, 0);
});

test('official JSON request sends only the parameter contract and keeps credentials out of the body', async () => {
  let captured;
  const model = { ...context(), apiKey: 'context-secret', internalNotes: PRIVATE_RESPONSE };
  const result = await requestEditPlan({
    ...options(async (url, init) => { captured = { url, init }; return response(envelope(plan())); }),
    context: model
  });
  assert.deepEqual(result, plan());
  assert.equal(captured.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(captured.url, DEEPSEEK_ENDPOINT);
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Authorization, `Bearer ${TEST_KEY}`);
  assert.equal(captured.init.credentials, 'omit');
  assert.equal(captured.init.redirect, 'error', 'credentials cannot follow a redirect to another host');
  assert.equal(captured.init.cache, 'no-store');
  assert.equal(captured.init.referrerPolicy, 'no-referrer');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, DEEPSEEK_MODEL);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.stream, false);
  assert.ok(body.max_tokens >= 1024);
  assert.match(body.messages[0].content, /JSON/);
  assert.deepEqual(JSON.parse(body.messages[1].content).context, context());
  for (const secret of [TEST_KEY, 'context-secret', PRIVATE_RESPONSE]) assert.ok(!captured.init.body.includes(secret));
  assert.equal(model.parameters[0].value, 2.5);
});

test('blank or invalid user inputs never reach the network', async () => {
  let requests = 0;
  const base = options(async () => { requests++; });
  for (const change of [
    { apiKey: '' }, { apiKey: 'bad\r\nkey' }, { instruction: ' ' },
    { instruction: '字'.repeat(4001) }, { fetchImpl: null }, { signal: {} }
  ]) {
    await assert.rejects(requestEditPlan({ ...base, ...change }), safeError('INVALID_INPUT'));
  }
  await assert.rejects(requestEditPlan(), safeError('INVALID_INPUT'));
  assert.equal(requests, 0);
});

test('the bounded model scope is transmitted so whole-model scaling cannot imply part-specific dimensions', async () => {
  const description = '整体缩放改变全体构件，不能单独修改桥面；教学格没有毫米换算依据。';
  let requestBody;
  await requestEditPlan({ ...options(async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return response(envelope(plan()));
  }), context: { ...context(), description, privateMetadata: 'must-not-be-sent' } });
  const sent = JSON.parse(requestBody.messages[1].content);
  assert.equal(sent.context.description, description);
  assert.equal(sent.context.privateMetadata, undefined);
  assert.match(requestBody.messages[0].content, /整体比例缩放不能冒充单个构件尺寸调整/);
  assert.match(requestBody.messages[0].content, /不能猜测换算/);
  await assert.rejects(requestEditPlan({ ...options(() => { throw new Error('must not request'); }),
    context: { ...context(), description: '字'.repeat(1201) }
  }), safeError('INVALID_CONTEXT'));
});

test('HTTP errors are mapped to safe Chinese messages without reading the response body', async () => {
  const cases = [[400, 'REQUEST_REJECTED'], [401, 'AUTH_ERROR'], [402, 'INSUFFICIENT_BALANCE'],
    [403, 'FORBIDDEN'], [429, 'RATE_LIMIT'], [500, 'SERVER_ERROR'], [503, 'SERVER_ERROR']];
  for (const [status, code] of cases) {
    let bodyReads = 0;
    await assert.rejects(requestEditPlan(options(async () => ({
      ok: false, status, json() { bodyReads++; throw new Error(`${TEST_KEY} ${PRIVATE_RESPONSE}`); }
    }))), safeError(code));
    assert.equal(bodyReads, 0);
  }
});

test('network exceptions are sanitized instead of exposing their message or cause', async () => {
  await assert.rejects(requestEditPlan(options(async () => {
    throw new Error(`${TEST_KEY} ${PRIVATE_RESPONSE}`);
  })), safeError('NETWORK_ERROR'));
});

test('empty, truncated, non-JSON, tool-call and malformed envelopes cannot become plans', async () => {
  const valid = envelope(plan());
  const invalid = [
    {}, null, { choices: [] }, { choices: [valid.choices[0], valid.choices[0]] },
    { choices: [{ ...valid.choices[0], finish_reason: 'length' }] },
    { choices: [{ ...valid.choices[0], message: { role: 'assistant', content: '' } }] },
    { choices: [{ ...valid.choices[0], message: { role: 'assistant', content: `\`\`\`json\n${JSON.stringify(plan())}\n\`\`\`` } }] },
    { choices: [{ ...valid.choices[0], message: { role: 'assistant', content: PRIVATE_RESPONSE } }] },
    { choices: [{ ...valid.choices[0], message: { ...valid.choices[0].message, tool_calls: [{}] } }] }
  ];
  for (const value of invalid) {
    await assert.rejects(requestEditPlan(options(async () => response(value))), safeError('INVALID_RESPONSE'));
  }
  await assert.rejects(requestEditPlan(options(async () => ({
    ok: true, status: 200, json: async () => { throw new Error(PRIVATE_RESPONSE); }
  }))), safeError('INVALID_RESPONSE'));
  await assert.rejects(requestEditPlan(options(async () => response(envelope({ ...plan(), code: PRIVATE_RESPONSE })))), safeError('INVALID_PLAN'));
});

test('already-aborted requests do not send credentials or expose the abort reason', async () => {
  const controller = new AbortController();
  controller.abort(new Error(`${TEST_KEY} ${PRIVATE_RESPONSE}`));
  let requests = 0;
  await assert.rejects(requestEditPlan({
    ...options(async () => { requests++; }), signal: controller.signal
  }), safeError('ABORTED'));
  assert.equal(requests, 0);
});

test('cancellation settles immediately even if the transport ignores its abort signal', async () => {
  const controller = new AbortController();
  let transportSignal;
  const pending = requestEditPlan({
    ...options((_url, init) => { transportSignal = init.signal; return new Promise(() => {}); }),
    signal: controller.signal
  });
  controller.abort(new Error(`${TEST_KEY} ${PRIVATE_RESPONSE}`));
  await assert.rejects(pending, safeError('ABORTED'));
  assert.equal(transportSignal.aborted, true);
});

test('the timeout aborts an unresponsive transport and returns a safe error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let transportSignal;
  const pending = requestEditPlan(options((_url, init) => {
    transportSignal = init.signal;
    return new Promise(() => {});
  }));
  t.mock.timers.tick(EDIT_PLAN_TIMEOUT_MS);
  await assert.rejects(pending, safeError('TIMEOUT'));
  assert.equal(transportSignal.aborted, true);
});

test('the same timeout covers response-body parsing and successful requests clear their timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let bodyRead = false;
  const pending = requestEditPlan(options(async () => ({
    ok: true, status: 200, json() { bodyRead = true; return new Promise(() => {}); }
  })));
  await Promise.resolve();
  assert.equal(bodyRead, true);
  t.mock.timers.tick(EDIT_PLAN_TIMEOUT_MS);
  await assert.rejects(pending, safeError('TIMEOUT'));

  let transportSignal;
  await requestEditPlan(options(async (_url, init) => {
    transportSignal = init.signal;
    return response(envelope(plan()));
  }));
  t.mock.timers.tick(EDIT_PLAN_TIMEOUT_MS * 2);
  assert.equal(transportSignal.aborted, false, 'a completed request must not be aborted later');
});
