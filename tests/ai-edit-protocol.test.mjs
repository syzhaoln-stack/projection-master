import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIEditError, DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, DEEPSEEK_MODEL_LABEL, EDIT_PLAN_TIMEOUT_MS, AI_SERVICE_STATUS_TIMEOUT_MS,
  requestEditPlan, requestAiServiceStatus, resolveAiProxyEndpoints, validateEditPlan
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
const options = fetchImpl => ({ mode: 'direct', apiKey: TEST_KEY, instruction: '把梁宽改为3米', context: context(), fetchImpl });

test('shared endpoint configuration accepts a public origin or API path and refuses credential-bearing URLs', () => {
  assert.deepEqual(resolveAiProxyEndpoints(), { chat: '/api/ai/chat', status: '/api/ai/status' });
  for (const value of ['https://shared.example', 'https://shared.example/', 'https://shared.example/api/ai', 'https://shared.example/api/ai/chat']) {
    assert.deepEqual(resolveAiProxyEndpoints(value), { chat: 'https://shared.example/api/ai/chat', status: 'https://shared.example/api/ai/status' });
  }
  assert.equal(resolveAiProxyEndpoints('http://127.0.0.1:8787').chat, 'http://127.0.0.1:8787/api/ai/chat');
  for (const value of ['https://name:secret@shared.example', 'https://shared.example?key=secret', '//shared.example', 'http://shared.example', 'javascript:alert(1)', '/\\shared.example']) {
    assert.throws(() => resolveAiProxyEndpoints(value), safeError('INVALID_PROXY_CONFIG'));
  }
});

test('explicit shared request retains vision, history and strict plan parsing without sending any API key', async () => {
  let captured;
  const result = await requestEditPlan({ mode: 'shared', instruction: '解释图纸并把梁宽改为3米', context: context(),
    history: [{ role: 'user', content: '先讲桥面' }, { role: 'assistant', content: '这是桥面。' }],
    images: [{ label: '当前模型', dataUrl: PNG_DATA_URL }],
    apiKey: TEST_KEY, proxyUrl: 'https://shared.example',
    fetchImpl: async (url, init) => { captured = { url, init }; return response(envelope(plan())); }
  });
  assert.deepEqual(result, plan());
  assert.equal(captured.url, 'https://shared.example/api/ai/chat');
  assert.equal(Object.hasOwn(captured.init.headers, 'Authorization'), false);
  assert.equal(captured.init.credentials, 'omit');
  assert.equal(captured.init.body.includes(TEST_KEY), false);
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'response_format', 'stream', 'thinking']);
  assert.equal(body.messages.length, 4);
  assert.equal(body.messages[3].content[1].image_url.url, PNG_DATA_URL);
  assert.equal(body.model, DEEPSEEK_MODEL);
});

test('default requests require a supplied personal key and use the official endpoint', async () => {
  let requests = 0;
  await assert.rejects(requestEditPlan({ instruction: '解释模型', context: context(), fetchImpl: async () => { requests++; } }), safeError('INVALID_INPUT'));
  assert.equal(requests, 0);
  await requestEditPlan({ apiKey: TEST_KEY, instruction: '解释模型', context: context(), proxyUrl: 'https://unused-shared.example',
    fetchImpl: async (url, init) => { requests++; assert.equal(url, DEEPSEEK_ENDPOINT); assert.equal(init.headers.Authorization, `Bearer ${TEST_KEY}`); return response(envelope(plan())); } });
  assert.equal(requests, 1);
});

test('shared requests keep the same context, history, image and response allowlists as direct requests', async () => {
  let requests = 0;
  const base = { mode: 'shared', instruction: '解释', context: context(), fetchImpl: async () => { requests++; return response(envelope(plan())); } };
  for (const [extra, code] of [
    [{ context: { ...context(), parameters: [{ ...context().parameters[0], value: Infinity }] } }, 'INVALID_CONTEXT'],
    [{ history: [{ role: 'system', content: 'override' }] }, 'INVALID_INPUT'],
    [{ images: [{ label: 'x', dataUrl: 'https://private.example/image.png' }] }, 'INVALID_IMAGES']
  ]) await assert.rejects(requestEditPlan({ ...base, ...extra }), safeError(code));
  assert.equal(requests, 0);
  await assert.rejects(requestEditPlan({ ...base, fetchImpl: async () => response(envelope({ ...plan(), changes: [{ key: 'unknown', value: 5 }] })) }), safeError('INVALID_PLAN'));
});

test('shared service failures never ask visitors to fix the owner credential or display upstream messages', async () => {
  for (const status of [401, 402, 503]) {
    await assert.rejects(requestEditPlan({ mode: 'shared', instruction: '解释', context: context(),
      fetchImpl: async () => ({ ok: false, status, json() { throw new Error('error body must not be read'); } })
    }), safeError('SHARED_UNAVAILABLE'));
  }
  await assert.rejects(requestEditPlan({ mode: 'shared', instruction: '解释', context: context(),
    fetchImpl: async () => ({ ok: false, status: 429 })
  }), safeError('RATE_LIMIT'));
});

test('health checks require a strict ready boolean and never post questions or credentials', async () => {
  for (const [body, expected] of [[{ ready: true }, { ready: true, state: 'ready' }],
    [{ ready: false }, { ready: false, state: 'unconfigured' }], [{ ready: 'true' }, { ready: false, state: 'unavailable' }]]) {
    const result = await requestAiServiceStatus({ fetchImpl: async (url, init) => {
      assert.equal(url, '/api/ai/status'); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit');
      assert.equal(init.body, undefined); assert.equal(init.headers, undefined);
      return response(body);
    } });
    assert.deepEqual(result, expected);
  }
  assert.deepEqual(await requestAiServiceStatus({ fetchImpl: async () => ({ ok: false, status: 404 }) }), { ready: false, state: 'unconfigured' });
  for (const fetchImpl of [async () => ({ ok: false, status: 503 }), async () => { throw new Error(PRIVATE_RESPONSE); },
    async () => ({ ok: true, json: async () => { throw new Error('HTML page is not service status'); } })]) {
    assert.deepEqual(await requestAiServiceStatus({ fetchImpl }), { ready: false, state: 'unavailable' });
  }
});

test('health timeout and cancellation settle even when the transport ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let transportSignal;
  const check = requestAiServiceStatus({ fetchImpl: (_url, init) => { transportSignal = init.signal; return new Promise(() => {}); } });
  t.mock.timers.tick(AI_SERVICE_STATUS_TIMEOUT_MS);
  assert.deepEqual(await check, { ready: false, state: 'unavailable' });
  assert.equal(transportSignal.aborted, true);
  const controller = new AbortController();
  const cancelled = requestAiServiceStatus({ signal: controller.signal, fetchImpl: () => new Promise(() => {}) });
  controller.abort();
  assert.deepEqual(await cancelled, { ready: false, state: 'unavailable' });
});

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
    { ...plan(), summary: '字'.repeat(5001) },
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
    null, {}, { ...context(), parameters: null },
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
  assert.equal(DEEPSEEK_MODEL_LABEL, 'DeepSeek V4.1 Flash');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 4096);
  assert.match(body.messages[0].content, /JSON/);
  assert.match(body.messages[0].content, /本轮没有附图片/);
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

const facts = () => ({
  type: '双塔斜拉桥', summary: '由桥面、两座索塔和成对布置的斜拉索组成的教学模型。',
  components: [{ label: '桥面', count: 1 }, { label: '索塔', count: 2, description: '桥面两端附近的竖向构件' }, { label: '斜拉索', count: 24 }],
  dimensions: [{ label: '主跨', value: 12, unit: 'm' }],
  projectionNotes: ['工程 X 沿桥长，Z 向上。', '主视图表达纵向轮廓与高度，俯视图表达平面布置。'],
  currentStep: { label: '完整模型', description: '已显示全部构件。' },
  selectedComponent: { label: '左索塔', type: '索塔', description: '当前选择的竖向构件', dimensions: [{ label: '塔高', value: 4, unit: 'm' }] }
});

test('read-only contexts support substantive multi-paragraph explanations without editable parameters', async () => {
  const model = { ...context(), parameters: [], modelFacts: facts() };
  const summary = `当前模型是一座双塔斜拉桥。\n\n${'主视图反映纵向轮廓和高度关系；俯视图反映平面布置。'.repeat(35)}`;
  const answer = { targetId: model.targetId, summary, changes: [] };
  let body;
  const result = await requestEditPlan({ ...options(async (_url, init) => {
    body = JSON.parse(init.body); return response(envelope(answer));
  }), instruction: '描述当前模型并解释主、俯、左视图', context: model });
  assert.deepEqual(result, answer);
  assert.ok(result.summary.length > 600);
  assert.match(result.summary, /\n\n/);
  assert.deepEqual(JSON.parse(body.messages.at(-1).content).context.modelFacts, facts());
  assert.equal(validateEditPlan({ ...answer, summary: '字'.repeat(5000) }, model).summary.length, 5000);
  assert.throws(() => validateEditPlan({ ...answer, changes: [{ key: 'span', value: 14 }] }, model), safeError('INVALID_PLAN'));
});

test('model facts are copied from the explicit schema and do not make descriptive dimensions editable', async () => {
  const model = { ...context(), modelFacts: facts(), privateMetadata: PRIVATE_RESPONSE, apiKey: TEST_KEY };
  model.parameters[0].privateMetadata = PRIVATE_RESPONSE;
  let body;
  await requestEditPlan({ ...options(async (_url, init) => {
    body = JSON.parse(init.body);
    model.modelFacts.components[0].count = 100;
    return response(envelope(plan()));
  }), context: model });
  const sent = JSON.parse(body.messages.at(-1).content).context;
  assert.equal(sent.modelFacts.components[0].count, 1);
  assert.equal(sent.parameters[0].privateMetadata, undefined);
  assert.equal(JSON.stringify(body).includes(PRIVATE_RESPONSE), false);
  assert.equal(JSON.stringify(body).includes(TEST_KEY), false);
  assert.throws(() => validateEditPlan({ ...plan(), changes: [{ key: '主跨', value: 14 }] }, model), safeError('INVALID_PLAN'));
});

test('model facts reject unknown fields, executable objects, invalid numbers and excessive data before requesting', async () => {
  const dimension = { label: '宽度', value: 3, unit: 'm' };
  const invalid = [
    null, [], 'not facts', { apiKey: TEST_KEY }, { ...facts(), privateMetadata: PRIVATE_RESPONSE },
    { components: [{ label: '索塔', count: 2, secret: PRIVATE_RESPONSE }] },
    { components: [{ label: '索塔', count: 1.5 }] }, { components: [{ label: '索塔', count: -1 }] },
    { components: [{ label: '索塔', count: 1_000_001 }] },
    { dimensions: [{ ...dimension, value: Infinity }] }, { dimensions: [{ ...dimension, value: '3' }] },
    { dimensions: [{ ...dimension, value: 1e13 }] }, { dimensions: [{ ...dimension, extra: true }] },
    { projectionNotes: [3] }, { projectionNotes: ['字'.repeat(1001)] },
    { currentStep: { label: '构建中', run: 'arbitrary code' } },
    { selectedComponent: { label: '索塔', sourcePath: PRIVATE_RESPONSE } },
    { selectedComponent: { label: '索塔', dimensions: [{ ...dimension, unit: null }] } },
    { type: '字'.repeat(161) }, { summary: '字'.repeat(4001) },
    { components: Array.from({ length: 65 }, () => ({ label: '构件', count: 1 })) },
    { dimensions: Array.from({ length: 33 }, () => dimension) },
    { projectionNotes: Array.from({ length: 17 }, () => '投影说明') },
    { components: Array.from({ length: 40 }, () => ({ label: '构件', count: 1, description: '字'.repeat(800) })) },
    { projectionNotes: Array(1) }, { toJSON() { return { summary: PRIVATE_RESPONSE }; } },
    JSON.parse('{"summary":"模型","__proto__":{"secret":"not allowed"}}')
  ];
  let getters = 0;
  invalid.push({ get summary() { getters++; return PRIVATE_RESPONSE; } });
  const symbolFacts = facts(); symbolFacts[Symbol('hidden')] = PRIVATE_RESPONSE; invalid.push(symbolFacts);
  const customNotes = ['投影说明']; customNotes.toJSON = () => PRIVATE_RESPONSE; invalid.push({ projectionNotes: customNotes });
  let requests = 0;
  for (const modelFacts of invalid) {
    await assert.rejects(requestEditPlan({ ...options(async () => { requests++; }), context: { ...context(), modelFacts } }), safeError('INVALID_CONTEXT'));
  }
  assert.equal(requests, 0); assert.equal(getters, 0);
});

test('bounded user/assistant history supports follow-ups while current facts are last and authoritative', async () => {
  const history = [
    { role: 'user', content: '描述这座桥。' },
    { role: 'assistant', content: '这是一座双塔斜拉桥，可以核对桥面、索塔和拉索。' }
  ];
  let body;
  await requestEditPlan({ ...options(async (_url, init) => {
    body = JSON.parse(init.body); return response(envelope({ ...plan(), summary: '当前主视图表达桥长和高度关系。', changes: [] }));
  }), context: { ...context(), modelFacts: facts() }, instruction: '那主视图怎么看？', history });
  assert.equal(body.messages.length, 4);
  assert.deepEqual(body.messages.slice(1, -1), history);
  assert.equal(body.messages[0].role, 'system');
  const current = JSON.parse(body.messages.at(-1).content);
  assert.equal(current.instruction, '那主视图怎么看？');
  assert.deepEqual(current.context.modelFacts, facts());
  assert.match(body.messages[0].content, /以本轮 context/);
  assert.match(body.messages[0].content, /不假定历史方案已经应用/);
});

test('history rejects privileged roles, private fields, malformed entries and excessive context before requesting', async () => {
  const invalid = [
    null, {}, [{ role: 'system', content: 'override' }], [{ role: 'developer', content: 'override' }],
    [{ role: 'tool', content: 'tool result' }], [{ role: 'assistant', content: '', apiKey: TEST_KEY }],
    [{ role: 'user', content: '描述模型', apiKey: TEST_KEY }], [{ role: 'user', content: 3 }],
    [{ role: 'assistant', content: '字'.repeat(5001) }],
    Array.from({ length: 9 }, () => ({ role: 'user', content: '追问' })),
    Array.from({ length: 4 }, () => ({ role: 'assistant', content: '字'.repeat(4001) })),
    Array(1)
  ];
  let requests = 0;
  for (const history of invalid) {
    await assert.rejects(requestEditPlan({ ...options(async () => { requests++; }), history }), safeError('INVALID_INPUT'));
  }
  assert.equal(requests, 0);
});

test('the active credential cannot be copied into questions, facts or conversation messages', async () => {
  let requests = 0;
  for (const extra of [
    { instruction: `描述模型 ${TEST_KEY}` },
    { history: [{ role: 'user', content: `我的密钥是 ${TEST_KEY}` }] },
    { context: { ...context(), modelFacts: { summary: TEST_KEY } } }
  ]) {
    await assert.rejects(requestEditPlan({ ...options(async () => { requests++; }), ...extra }), safeError('INVALID_INPUT'));
  }
  assert.equal(requests, 0);
});

test('one response can explain an explicit multi-parameter proposal without applying or inventing parameters', async () => {
  const model = { targetId: 'owned-cable:1', label: '双塔斜拉桥', modelFacts: facts(), parameters: [
    { key: 'span', label: '主跨', value: 40, min: 20, max: 100, step: 1, unit: 'm' },
    { key: 'deckWidth', label: '桥面宽度', value: 8, min: 4, max: 20, step: 0.5, unit: 'm' },
    { key: 'towerHeight', label: '塔高', value: 15, min: 8, max: 30, step: 0.5, unit: 'm' },
    { key: 'cablesPerSide', label: '每侧拉索数量', value: 8, min: 4, max: 24, step: 1, unit: '根' }
  ] };
  const proposal = { targetId: model.targetId, summary: '桥面由8米加宽到10米，塔高保持15米。\n\n索密一点按每侧从8根增加到10根提出建议，这个数量是待核对的假设。',
    changes: [{ key: 'deckWidth', value: 10 }, { key: 'cablesPerSide', value: 10 }] };
  let system;
  const result = await requestEditPlan({ ...options(async (_url, init) => {
    system = JSON.parse(init.body).messages[0].content; return response(envelope(proposal));
  }), context: model, instruction: '桥面加宽2米，塔高不动，索密一点' });
  assert.deepEqual(result, proposal);
  assert.equal(model.parameters[1].value, 8); assert.equal(model.parameters[2].value, 15);
  assert.match(system, /可基于当前数值、范围和步长提出/);
  assert.match(system, /建议值和假设/);
  assert.match(system, /不可声称看到了截图/);
  assert.match(system, /modelFacts 中的尺寸只是说明事实/);
});

test('unknown or hostile error codes always produce a fixed safe message', () => {
  for (const code of ['constructor', '__proto__', TEST_KEY, { toString() { throw new Error(PRIVATE_RESPONSE); } }]) {
    assert.equal(new AIEditError(code).code, 'INVALID_RESPONSE');
    assert.equal(new AIEditError(code).message, new AIEditError('INVALID_RESPONSE').message);
  }
});

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('current images use V4.1 Flash image blocks, with labels and facts in the newest user text', async () => {
  const images = [
    { label: '当前三维模型', dataUrl: PNG_DATA_URL },
    { label: '主视图', dataUrl: PNG_DATA_URL }
  ];
  const history = [{ role: 'user', content: '介绍桥型。' }, { role: 'assistant', content: '已说明模型事实。' }];
  let body;
  const answer = { ...plan(), summary: '图片可以辅助核对构件外观；精确尺寸以模型参数和清晰标注为准。', changes: [] };
  const result = await requestEditPlan({ ...options(async (_url, init) => {
    body = JSON.parse(init.body); return response(envelope(answer));
  }), images, history, context: { ...context(), modelFacts: facts() }, instruction: '结合截图解释主视图。' });
  assert.deepEqual(result, answer);
  assert.equal(body.model, 'deepseek-flash');
  assert.deepEqual(body.messages.slice(1, -1), history);
  const latest = body.messages.at(-1);
  assert.equal(latest.role, 'user'); assert.equal(latest.content.length, 3);
  assert.equal(latest.content[0].type, 'text');
  const text = JSON.parse(latest.content[0].text);
  assert.deepEqual(text.imageLabels, ['当前三维模型', '主视图']);
  assert.deepEqual(text.context.modelFacts, facts());
  assert.equal(latest.content[0].text.includes('base64,'), false);
  assert.deepEqual(latest.content.slice(1), images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } })));
  assert.match(body.messages[0].content, /本轮附有图片/);
  assert.match(body.messages[0].content, /图片与 modelFacts 不一致时必须指出差异/);
  assert.match(body.messages[0].content, /不能凭截图比例猜精确尺寸/);
  assert.ok(body.messages.slice(0, -1).every(message => typeof message.content === 'string' && !message.content.includes(PNG_DATA_URL)));
});

test('only the four supported MIME formats with matching image signatures are accepted', async () => {
  const images = [
    { label: 'PNG', dataUrl: PNG_DATA_URL },
    { label: 'JPEG', dataUrl: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64')}` },
    { label: 'GIF', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
    { label: 'WebP', dataUrl: `data:image/webp;base64,${Buffer.from('RIFF\0\0\0\0WEBP', 'latin1').toString('base64')}` }
  ];
  let count;
  await requestEditPlan({ ...options(async (_url, init) => {
    count = JSON.parse(init.body).messages.at(-1).content.length; return response(envelope(plan()));
  }), images });
  assert.equal(count, 5);
});

test('image input rejects links, private fields, malformed encodings and spoofed formats before requesting', async () => {
  const invalid = [
    null, {}, [{ label: '外链', dataUrl: 'https://example.com/image.png' }],
    [{ label: '本地路径', dataUrl: 'file:///private/image.png' }],
    [{ label: 'SVG', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }],
    [{ label: 'HTML', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }],
    [{ label: '纯文本冒充图片', dataUrl: `data:image/png;base64,${Buffer.from(PRIVATE_RESPONSE).toString('base64')}` }],
    [{ label: '错误格式', dataUrl: PNG_DATA_URL.replace('image/png', 'image/jpeg') }],
    [{ label: '空图片', dataUrl: 'data:image/png;base64,' }],
    [{ label: '非base64', dataUrl: `${PNG_DATA_URL}\n` }],
    [{ label: '错误padding', dataUrl: `${PNG_DATA_URL}===` }],
    [{ label: 'x', dataUrl: PNG_DATA_URL, apiKey: TEST_KEY }],
    [{ label: 'x', dataUrl: PNG_DATA_URL, sourcePath: PRIVATE_RESPONSE }],
    [{ label: '字'.repeat(101), dataUrl: PNG_DATA_URL }],
    [{ label: '', dataUrl: PNG_DATA_URL }],
    Array.from({ length: 7 }, () => ({ label: 'x', dataUrl: PNG_DATA_URL })),
    Array(1)
  ];
  let requests = 0;
  for (const images of invalid) {
    await assert.rejects(requestEditPlan({ ...options(async () => { requests++; }), images }), error => {
      assert.equal(String(error).includes('base64,'), false);
      return safeError('INVALID_IMAGES')(error);
    });
  }
  assert.equal(requests, 0);
});

test('image payloads enforce per-image and combined character limits without leaking data', async () => {
  const prefix = `data:image/png;base64,${Buffer.from('\x89PNG\r\n\x1a\n' + '\0'.repeat(16), 'latin1').toString('base64')}`;
  const large = prefix + 'A'.repeat(9 * 1024 * 1024);
  const overSingle = prefix + 'A'.repeat(12 * 1024 * 1024);
  let requests = 0;
  for (const images of [[{ label: '过大', dataUrl: overSingle }],
    Array.from({ length: 3 }, () => ({ label: '合计过大', dataUrl: large }))]) {
    await assert.rejects(requestEditPlan({ ...options(async () => { requests++; }), images }), error => {
      assert.equal(String(error).includes('base64,'), false);
      return safeError('INVALID_IMAGES')(error);
    });
  }
  assert.equal(requests, 0);
});

test('pictures cannot be persisted in history or accompanied by the current credential as a label', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests++; };
  await assert.rejects(requestEditPlan({ ...options(fetchImpl), history: [{ role: 'user', content: PNG_DATA_URL }] }), safeError('INVALID_INPUT'));
  await assert.rejects(requestEditPlan({ ...options(fetchImpl), history: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: PNG_DATA_URL } }] }] }), safeError('INVALID_INPUT'));
  await assert.rejects(requestEditPlan({ ...options(fetchImpl), images: [{ label: TEST_KEY, dataUrl: PNG_DATA_URL }] }), safeError('INVALID_INPUT'));
  assert.equal(requests, 0);
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
  const modifiedError = new AIEditError('SERVER_ERROR');
  modifiedError.message = `${TEST_KEY} ${PRIVATE_RESPONSE}`;
  modifiedError.cause = new Error(PRIVATE_RESPONSE);
  await assert.rejects(requestEditPlan(options(async () => { throw modifiedError; })), safeError('SERVER_ERROR'));
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
  assert.equal(EDIT_PLAN_TIMEOUT_MS, 60_000);
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
