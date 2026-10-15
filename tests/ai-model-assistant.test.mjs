import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AIEditError, DEEPSEEK_MODEL_LABEL, validateEditPlan } from '../ai-edit-protocol.js';
import { getStayedParameterContext } from '../parametric-stayed-bridge.js';

const source = await readFile(new URL('../ai-model-assistant.js', import.meta.url), 'utf8');
// Execute the production drawer and its real validator. Only browser surfaces,
// timers and the network boundary are substituted; no browser/API is contacted.
const loadAssistant = new Function('document', 'window', 'setInterval', 'clearInterval',
  'AIEditError', 'DEEPSEEK_MODEL_LABEL', 'requestEditPlan', 'validateEditPlan', 'FileReader', 'localStorage', 'sessionStorage', 'console',
  `${source.replace(/^import .*;\r?$/gm, '').replace('export function ', 'function ')}\nreturn createAiModelAssistant;`);

function fakeDom() {
  const htmlWrites = [], storageCalls = [], logs = [], intervals = new Map(), readers = [];
  const storage = new Proxy({}, { get(_target, key) { storageCalls.push(key); throw new Error('Storage is forbidden'); } });
  let timerId = 0;
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase(); this.children = []; this.attributes = new Map();
      this.listeners = new Map(); this.value = ''; this.hidden = false; this.disabled = false;
      this._text = ''; this._classes = new Set();
      this.classList = { toggle: (name, force) => force ? this._classes.add(name) : this._classes.delete(name) };
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; this._text = ''; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    set innerHTML(value) {
      htmlWrites.push(value); this.replaceChildren();
      const stack = [this];
      for (const match of value.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)) {
        if (match[1]) { stack.pop(); continue; }
        const child = new Element(match[2]);
        for (const attribute of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
          child.setAttribute(attribute[1], attribute[2] ?? '');
        }
        stack.at(-1).append(child);
        if (!['input', 'br', 'hr', 'img', 'meta', 'link'].includes(match[2])) stack.push(child);
      }
    }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
      if (['id', 'type', 'value'].includes(key)) this[key] = String(value);
      if (['hidden', 'disabled'].includes(key)) this[key] = true;
    }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    querySelectorAll(selector) {
      const attribute = selector.match(/^\[([^=]+)="([^"]*)"\]$/);
      const matches = node => selector.startsWith('#') ? node.id === selector.slice(1)
        : attribute ? node.getAttribute(attribute[1]) === attribute[2]
          : node.tagName.toLowerCase() === selector.toLowerCase();
      const found = [];
      const walk = parent => { for (const child of parent.children) { if (matches(child)) found.push(child); walk(child); } };
      walk(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }
    dispatch(type, event = {}) {
      if (type === 'click' && this.disabled) return Promise.resolve();
      return Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
    }
    click() { return this.dispatch('click'); }
    focus() { document.activeElement = this; }
  }
  const document = {
    body: new Element('body'), activeElement: null,
    createElement: tag => new Element(tag),
    getElementById(id) { return this.body.querySelector(`#${id}`); }
  };
  Object.defineProperty(document, 'cookie', { set() { storageCalls.push('cookie'); throw new Error('Cookies are forbidden'); } });
  const brand = document.createElement('div'); brand.id = 'brand'; document.body.append(brand);
  const window = new Element('window'); window.localStorage = storage; window.sessionStorage = storage;
  class FileReader {
    constructor() { readers.push(this); }
    readAsDataURL(file) {
      this.file = file;
      if (!file.defer) Promise.resolve().then(() => file.fail ? this.fail() : this.finish());
    }
    finish(dataUrl = this.file.dataUrl || 'data:image/png;base64,QUJD') { this.result = dataUrl; this.onload?.(); }
    fail() { this.onerror?.(new Error('private file-reader failure')); }
  }
  const create = loadAssistant(document, window,
    callback => { const id = ++timerId; intervals.set(id, callback); return id; },
    id => intervals.delete(id), AIEditError, DEEPSEEK_MODEL_LABEL,
    () => { throw new Error('Real API calls are forbidden in this test'); }, validateEditPlan,
    FileReader, storage, storage, new Proxy({}, { get: () => (...args) => logs.push(args) }));
  return { document, window, create, htmlWrites, storageCalls, logs, intervals, readers };
}

function makeContext() {
  return { targetId: 'model-a:1', conversationId: 'explore:model-a', label: '模型 A', description: '尺寸参数', example: '宽度改为 4',
    parameters: [{ key: 'width', label: '宽度', value: 2, min: 1, max: 10, step: 0.5, unit: '格' }] };
}
function makePlan(context, value = 4, summary = '调整宽度') {
  return { targetId: context.targetId, summary, changes: [{ key: 'width', value }] };
}
function fixture(options = {}) {
  const dom = fakeDom();
  let context = options.context === undefined ? makeContext() : options.context;
  let applyCount = 0, restoreCount = 0;
  const requests = [];
  const requestPlan = options.requestPlan || (args => new Promise((resolve, reject) => requests.push({ args, resolve, reject })));
  const applyPlan = options.applyPlan || (plan => {
    applyCount++;
    const previous = structuredClone(context);
    context = { ...context, targetId: `${context.targetId}:edited`, parameters: context.parameters.map(p => ({
      ...p, value: plan.changes.find(c => c.key === p.key)?.value ?? p.value
    })) };
    return { restore() { restoreCount++; context = previous; } };
  });
  const assistant = dom.create({ getContext: () => context, applyPlan, requestPlan, captureImages: options.captureImages || null });
  const panel = dom.document.getElementById('ai-edit-panel');
  const get = name => panel.querySelector(`[data-ai="${name}"]`);
  const key = panel.querySelector('#ai-edit-key');
  const instruction = panel.querySelector('#ai-edit-instruction');
  const launcher = dom.document.getElementById('ai-edit-launcher');
  return { ...dom, assistant, panel, get, key, instruction, launcher, requests,
    get context() { return context; }, set context(value) { context = value; },
    get applyCount() { return applyCount; }, get restoreCount() { return restoreCount; },
    start(question = '宽度改为 4') { key.value = 'test-memory-only-key'; instruction.value = question; return get('generate').click(); },
    field() { return get('parameters').querySelector('input'); }
  };
}

test('无模型时禁用助手；有模型无参数时仍能问答，修改控件隐藏', async () => {
  const h = fixture({ context: null });
  for (const button of ['generate', 'manual-preview', 'apply', 'undo']) assert.equal(h.get(button).disabled, true);
  await h.launcher.click();
  assert.match(h.get('target').textContent, /暂不支持/);
  h.context = makeContext(); h.assistant.refresh();
  assert.equal(h.get('generate').disabled, false);
  assert.equal(h.get('manual-preview').disabled, false);
  h.context = { ...makeContext(), parameters: [] }; h.assistant.refresh();
  assert.equal(h.get('generate').disabled, false);
  assert.equal(h.get('manual').hidden, true);
  for (const button of ['manual-preview', 'apply', 'undo']) assert.equal(h.get(button).disabled, true);
  h.context = null; h.assistant.refresh();
  await h.get('generate').click(); await h.get('manual-preview').click();
  assert.equal(h.requests.length, 0);
});

test('缺少密钥或修改要求时不请求服务', async () => {
  const h = fixture(); h.instruction.value = '宽度改为 4';
  await h.get('generate').click();
  assert.equal(h.requests.length, 0);
  assert.equal(h.document.activeElement, h.key);
  assert.equal(h.get('connection').open, true);
  h.key.value = 'test-memory-only-key'; h.instruction.value = '  ';
  await h.get('generate').click();
  assert.equal(h.requests.length, 0);
  assert.equal(h.document.activeElement, h.instruction);
});

test('AI 只生成参数预览，应用和撤销各执行一次', async () => {
  const h = fixture(); const task = h.start();
  assert.equal(h.requests.length, 1);
  assert.equal(h.get('generate').disabled, true);
  assert.equal(h.get('apply').disabled, true);
  assert.equal(h.requests[0].args.apiKey, h.key.value);
  h.requests[0].resolve(makePlan(h.context)); await task;
  assert.equal(h.applyCount, 0); assert.equal(h.context.parameters[0].value, 2);
  assert.equal(h.get('plan').hidden, false); assert.equal(h.get('apply').disabled, false);
  assert.match(h.get('changes').textContent, /宽度2格4格/);
  await h.get('apply').click(); await h.get('apply').click();
  assert.equal(h.applyCount, 1); assert.equal(h.context.parameters[0].value, 4);
  assert.equal(h.get('plan').hidden, true); assert.equal(h.get('apply').disabled, true);
  assert.equal(h.get('undo').disabled, false);
  await h.get('undo').click(); await h.get('undo').click();
  assert.equal(h.restoreCount, 1); assert.equal(h.context.parameters[0].value, 2);
  assert.equal(h.get('undo').disabled, true);
});

test('响应返回前切换模型或原位修改参数，旧响应不能应用', async () => {
  for (const change of [h => { h.context = { ...makeContext(), targetId: 'model-b:1' }; },
    h => { h.context.parameters[0].value = 3; }]) {
    const h = fixture(); const before = structuredClone(h.context); const task = h.start();
    change(h);
    assert.equal(h.requests[0].args.context.parameters[0].value, 2, 'request context is an immutable value snapshot');
    h.requests[0].resolve(makePlan(before)); await task;
    assert.equal(h.get('plan').hidden, true); assert.equal(h.get('apply').disabled, true);
    assert.equal(h.applyCount, 0); assert.match(h.get('status').textContent, /已变化/);
  }
});

test('刷新过期请求立即恢复按钮，旧请求不能覆盖后来的请求', async () => {
  const h = fixture(); const firstContext = structuredClone(h.context); const first = h.start();
  h.context = { ...makeContext(), targetId: 'model-b:1' }; h.assistant.refresh();
  assert.equal(h.requests[0].args.signal.aborted, true);
  assert.equal(h.get('generate').disabled, false); assert.equal(h.get('cancel').hidden, true);
  const second = h.start();
  h.requests[0].resolve(makePlan(firstContext)); await first;
  assert.equal(h.get('plan').hidden, true); assert.equal(h.get('generate').disabled, true);
  assert.equal(h.get('cancel').hidden, false);
  h.requests[1].resolve(makePlan(h.context, 5)); await second;
  assert.match(h.get('changes').textContent, /5格/); assert.equal(h.get('apply').disabled, false);
});

test('应用前再次检查模型状态；外部修改后不能撤销覆盖新状态', async () => {
  const h = fixture(); let task = h.start(); h.requests[0].resolve(makePlan(h.context)); await task;
  h.context.parameters[0].value = 3; // No polling tick before the apply click.
  await h.get('apply').click();
  assert.equal(h.applyCount, 0); assert.equal(h.get('apply').disabled, true);
  assert.match(h.get('status').textContent, /已变化/);
  task = h.start(); h.requests[1].resolve(makePlan(h.context)); await task;
  await h.get('apply').click();
  h.context.parameters[0].value = 6;
  await h.get('undo').click();
  assert.equal(h.restoreCount, 0); assert.equal(h.context.parameters[0].value, 6);
  assert.equal(h.get('undo').disabled, true);
});

test('取消请求后立即可重试，迟到响应保持无效', async () => {
  const h = fixture(); const task = h.start();
  await h.get('cancel').click();
  assert.equal(h.requests[0].args.signal.aborted, true);
  assert.equal(h.get('generate').disabled, false); assert.equal(h.get('cancel').hidden, true);
  h.requests[0].resolve(makePlan(h.context)); await task;
  assert.equal(h.get('plan').hidden, true); assert.equal(h.applyCount, 0);
  assert.match(h.get('status').textContent, /取消/);
});

test('清除密钥、关闭面板和离开页面都取消待处理请求', async () => {
  for (const action of ['clear-key', 'close', 'pagehide']) {
    const h = fixture(); await h.launcher.click(); const task = h.start();
    assert.equal(h.intervals.size, 1);
    if (action === 'pagehide') await h.window.dispatch('pagehide');
    else await h.get(action).click();
    assert.equal(h.requests[0].args.signal.aborted, true);
    if (action !== 'close') assert.equal(h.key.value, '');
    if (action !== 'clear-key') { assert.equal(h.intervals.size, 0); assert.equal(h.panel.hidden, true); }
    h.requests[0].resolve(makePlan(h.context)); await task;
    assert.equal(h.get('plan').hidden, true); assert.equal(h.applyCount, 0);
  }
});

test('手动预览不请求服务，空值、越界和不合步长值不会改变模型', async () => {
  const h = fixture();
  for (const value of ['', 'abc', '11', '4.1']) {
    h.field().value = value; await h.get('manual-preview').click();
    assert.equal(h.get('plan').hidden, true); assert.equal(h.get('apply').disabled, true);
  }
  h.field().value = '2'; await h.get('manual-preview').click();
  assert.equal(h.get('apply').disabled, true);
  h.field().value = '4'; await h.get('manual-preview').click();
  assert.equal(h.get('plan').hidden, false); assert.equal(h.get('apply').disabled, false);
  assert.equal(h.requests.length, 0); assert.equal(h.applyCount, 0);
  await h.get('apply').click(); assert.equal(h.applyCount, 1);
});

test('动态内容仅为文本；密钥不写入存储、日志或页面文字', async () => {
  const h = fixture(); const markup = '<img src=x onerror="globalThis.injected=true">';
  h.context.label = markup; h.context.parameters[0].label = markup; h.assistant.refresh();
  const task = h.start(); h.requests[0].resolve(makePlan(h.context, 4, markup)); await task;
  assert.equal(h.get('summary').textContent, markup);
  assert.equal(h.get('target').textContent, markup);
  assert.equal(h.panel.querySelector('img'), null);
  assert.equal(h.htmlWrites.length, 1, 'only the static template is parsed as HTML');
  assert.equal(h.htmlWrites[0].includes(markup), false);
  assert.equal(h.document.body.textContent.includes(h.key.value), false);
  await h.get('apply').click(); await h.get('undo').click(); await h.window.dispatch('pagehide');
  assert.deepEqual(h.storageCalls, []); assert.deepEqual(h.logs, []); assert.equal(h.key.value, '');
});

test('请求、应用和撤销的任意异常不回显，已知错误只使用固定文案', async () => {
  const secret = 'test-error-must-stay-private';
  const leak = new Error(`<script>${secret}</script>`);
  for (const error of [leak, Object.assign(new AIEditError('AUTH_ERROR'), { message: secret })]) {
    const h = fixture({ requestPlan: async () => { throw error; } });
    await h.start();
    assert.equal(h.document.body.textContent.includes(secret), false);
    assert.equal(h.get('plan').hidden, true);
    assert.match(h.get('status').textContent, error instanceof AIEditError ? /密钥验证失败/ : /未能完成回答/);
  }
  const applyFailure = fixture({ applyPlan: () => { throw leak; } });
  let task = applyFailure.start(); applyFailure.requests[0].resolve(makePlan(applyFailure.context)); await task;
  await applyFailure.get('apply').click();
  assert.equal(applyFailure.document.body.textContent.includes(secret), false);
  assert.equal(applyFailure.get('apply').disabled, true);
  const undoFailure = fixture({ applyPlan: () => ({ restore() { throw leak; } }) });
  task = undoFailure.start(); undoFailure.requests[0].resolve(makePlan(undoFailure.context)); await task;
  await undoFailure.get('apply').click(); await undoFailure.get('undo').click();
  assert.equal(undoFailure.document.body.textContent.includes(secret), false);
  assert.equal(undoFailure.get('undo').disabled, false, 'unchanged state allows retry after a safe failure');
});

test('撤销失败回滚后的新版本可重试，保留原操作的 targetId getter', async () => {
  let h, recoveredTarget, attempts = 0;
  h = fixture({ applyPlan(plan) {
    const before = structuredClone(h.context);
    h.context = { ...h.context, targetId: 'model-a:applied:2', parameters: h.context.parameters.map(p => ({
      ...p, value: plan.changes.find(change => change.key === p.key)?.value ?? p.value
    })) };
    recoveredTarget = h.context.targetId;
    return {
      get targetId() { return recoveredTarget; },
      restore() {
        attempts++;
        if (attempts === 1) {
          h.context = { ...h.context, targetId: 'model-a:rollback:3' };
          recoveredTarget = h.context.targetId;
          throw new Error('Private rebuild details must not be shown');
        }
        h.context = before;
      }
    };
  } });
  const task = h.start(); h.requests[0].resolve(makePlan(h.context)); await task;
  await h.get('apply').click(); await h.get('undo').click();
  assert.equal(h.context.parameters[0].value, 4);
  assert.equal(h.get('undo').disabled, false);
  assert.equal(h.document.body.textContent.includes('Private rebuild'), false);
  await h.get('undo').click(); await h.get('undo').click();
  assert.equal(attempts, 2); assert.equal(h.context.parameters[0].value, 2);
  assert.equal(h.get('undo').disabled, true);
});

test('面板键盘事件不会触发模型快捷键，Escape 可取消并关闭', async () => {
  const h = fixture(); await h.launcher.click(); const task = h.start();
  let stopped = 0, prevented = 0;
  await h.panel.dispatch('keydown', { key: ' ', stopPropagation() { stopped++; }, preventDefault() { prevented++; } });
  assert.equal(stopped, 1); assert.equal(prevented, 0); assert.equal(h.panel.hidden, false);
  await h.panel.dispatch('keydown', { key: 'Escape', stopPropagation() { stopped++; }, preventDefault() { prevented++; } });
  assert.equal(stopped, 2); assert.equal(prevented, 1); assert.equal(h.panel.hidden, true);
  assert.equal(h.requests[0].args.signal.aborted, true); assert.equal(h.document.activeElement, h.launcher);
  h.requests[0].resolve(makePlan(h.context)); await task;
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const image = (label = '主视图', data = 'QUJD') => ({ label, dataUrl: `data:image/png;base64,${data}` });
const file = (name = '图纸.png', extra = {}) => ({ name, type: 'image/png', size: 1024, ...extra });
function respond(h, index, summary = '这是当前模型的结构讲解。', changes = []) {
  h.requests[index].resolve({ targetId: h.requests[index].args.context.targetId, summary, changes });
}
async function upload(h, files) { h.get('upload').files = files; return h.get('upload').dispatch('change'); }

test('普通问答支持只读模型，不展示空修改表，也不会改变实体', async () => {
  for (const parameters of [[], makeContext().parameters]) {
    const h = fixture({ context: { ...makeContext(), parameters } });
    const task = h.start('请解释当前三视图。');
    assert.deepEqual(h.requests[0].args.history, []);
    respond(h, 0, '主视图表示长度与高度，俯视图表示长度与宽度。'); await task;
    assert.equal(h.get('conversation').hidden, false);
    assert.match(h.get('messages').textContent, /请解释当前三视图/);
    assert.match(h.get('messages').textContent, /主视图表示长度与高度/);
    assert.equal(h.get('plan').hidden, true); assert.equal(h.get('changes').children.length, 0);
    assert.equal(h.get('apply').disabled, true); assert.equal(h.applyCount, 0);
    assert.equal(h.instruction.value, ''); assert.match(h.get('status').textContent, /继续追问/);
  }
});

test('多轮问答携带最近对话与当前事实；事实更新不清除有效撤销', async () => {
  const h = fixture({ context: { ...makeContext(), modelFacts: { summary: '原始桥面', selectedComponent: { label: '桥面板' } } } });
  let task = h.start(); respond(h, 0, '建议宽度改为 4 格。', [{ key: 'width', value: 4 }]); await task;
  await h.get('apply').click();
  assert.equal(h.get('undo').disabled, false);
  h.context.modelFacts = { summary: '当前桥面已修改', selectedComponent: { label: '索塔' } };
  assert.equal(h.assistant.refresh(), false, 'facts-only change is not a geometry revision');
  assert.equal(h.get('undo').disabled, false);
  task = h.start('现在选中的构件是什么？');
  const request = h.requests[1].args;
  assert.equal(request.context.modelFacts.selectedComponent.label, '索塔');
  assert.equal(request.context.parameters[0].value, 4);
  assert.equal(request.history.length, 3);
  assert.match(request.history[2].content, /已应用修改：宽度：2 → 4格/);
  h.context.modelFacts.selectedComponent.label = '横梁';
  h.assistant.refresh();
  assert.equal(request.context.modelFacts.selectedComponent.label, '索塔', 'request facts are an immutable snapshot');
  respond(h, 1, '请求时选中的是索塔。'); await task;
  assert.equal(h.get('undo').disabled, false);
  await h.get('undo').click();
  assert.equal(h.restoreCount, 1); assert.equal(h.context.parameters[0].value, 2);
  task = h.start('刚才的修改还在吗？');
  const history = h.requests[2].args.history;
  assert.match(history.at(-1).content, /修改已撤销/);
  assert.ok(history.some(item => /已应用修改/.test(item.content)));
  respond(h, 2, '已经撤销。'); await task;
});

test('新对话与模型切换清理历史，模型切换也清理附图和旧方案', async () => {
  const h = fixture(); let task = h.start('解释当前模型'); respond(h, 0); await task;
  await upload(h, [file()]); assert.equal(h.get('images').children.length, 1);
  await h.get('clear-history').click();
  assert.equal(h.get('conversation').hidden, true); assert.equal(h.get('images').children.length, 1);
  task = h.start('新对话'); assert.deepEqual(h.requests[1].args.history, []); respond(h, 1); await task;
  h.context = { ...makeContext(), targetId: 'model-b:1', conversationId: 'explore:model-b', label: '模型 B' };
  h.assistant.refresh();
  assert.equal(h.get('conversation').hidden, true); assert.equal(h.get('images').children.length, 0);
  assert.equal(h.get('plan').hidden, true);
  task = h.start('解释模型 B');
  assert.deepEqual(h.requests[2].args.history, []); assert.deepEqual(h.requests[2].args.images, []);
  respond(h, 2); await task;
});

test('历史按最近八条截断，连续问答不会积累无限上下文', async () => {
  const h = fixture();
  for (let i = 0; i < 7; i++) {
    const task = h.start(`问题 ${i}`);
    const history = h.requests[i].args.history;
    assert.ok(history.length <= 8);
    if (i >= 4) { assert.equal(history.length, 8); assert.equal(history[0].content, `问题 ${i - 4}`); }
    respond(h, i, `回答 ${i}`); await task;
  }
  assert.equal(h.get('messages').children.length, 8);
});

test('当前视图默认勾选；预览不发 API，发送时重新截取并使用新图', async () => {
  let captures = 0;
  const h = fixture({ captureImages: async () => [image(`截取 ${++captures}`, captures === 1 ? 'QUJD' : 'REVG')] });
  assert.equal(h.get('include-views').checked, true);
  assert.match(h.get('model-label').textContent, new RegExp(DEEPSEEK_MODEL_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await h.get('preview-images').click();
  assert.equal(captures, 1); assert.equal(h.requests.length, 0); assert.equal(h.applyCount, 0);
  assert.equal(h.get('images').querySelector('img').src, 'data:image/png;base64,QUJD');
  assert.match(h.get('status').textContent, /尚未发送/);
  const task = h.start('结合图片解释'); await flush();
  assert.equal(captures, 2); assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].args.images, [image('截取 2', 'REVG')]);
  assert.equal(h.get('images').querySelector('img').src, 'data:image/png;base64,REVG');
  respond(h, 0); await task;
  h.get('include-views').checked = false; await h.get('include-views').dispatch('change');
  assert.equal(h.get('images').children.length, 0); assert.equal(h.get('preview-images').disabled, true);
  const noImages = h.start('只依据模型资料');
  assert.equal(captures, 2); assert.deepEqual(h.requests[1].args.images, []);
  respond(h, 1); await noImages;
});

test('截图等待期间取消、关闭、清密钥、离页或切模型，不会发出旧图请求', async () => {
  for (const action of ['cancel', 'close', 'clear-key', 'pagehide', 'model-switch-without-poll', 'model-switch-with-poll']) {
    let finishCapture;
    const h = fixture({ captureImages: () => new Promise(resolve => { finishCapture = resolve; }) });
    await h.launcher.click();
    const task = h.start('看图说明');
    assert.equal(h.requests.length, 0); assert.equal(h.get('cancel').hidden, false);
    if (action.startsWith('model-switch')) {
      h.context = { ...makeContext(), targetId: 'model-b:1', conversationId: 'explore:model-b' };
      if (action.endsWith('with-poll')) h.assistant.refresh();
    } else if (action === 'pagehide') await h.window.dispatch('pagehide');
    else await h.get(action).click();
    finishCapture([image('旧模型图')]); await task;
    assert.equal(h.requests.length, 0, action);
    assert.equal(h.get('plan').hidden, true); assert.equal(h.get('images').children.length, 0);
    assert.equal(h.applyCount, 0);
  }
});

test('取消后新截图请求可继续，先前迟到截图不能覆盖新请求', async () => {
  const captures = [];
  const h = fixture({ captureImages: () => new Promise(resolve => captures.push(resolve)) });
  const first = h.start('第一次'); await h.get('cancel').click();
  const second = h.start('第二次');
  captures[0]([image('迟到旧图')]); await first;
  assert.equal(h.requests.length, 0); assert.equal(h.get('generate').disabled, true);
  captures[1]([image('当前图')]); await flush();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].args.instruction, '第二次');
  assert.equal(h.requests[0].args.images[0].label, '当前图');
  respond(h, 0); await second;
});

test('预览等待期间关闭或切换模型，迟到预览被丢弃且不会调用 API', async () => {
  for (const action of ['close', 'switch']) {
    let finishCapture;
    const h = fixture({ captureImages: () => new Promise(resolve => { finishCapture = resolve; }) });
    await h.launcher.click(); const task = h.get('preview-images').click();
    assert.equal(h.get('generate').disabled, true);
    if (action === 'close') await h.get('close').click();
    else { h.context = { ...makeContext(), targetId: 'model-b:1', conversationId: 'explore:model-b' }; h.assistant.refresh(); }
    finishCapture([image('旧预览')]); await task;
    assert.equal(h.get('images').children.length, 0); assert.equal(h.requests.length, 0);
    assert.equal(h.get('generate').disabled, false);
  }
});

test('附件支持两张且每张最多六 MB，拒绝错误格式、空文件和总数超限', async () => {
  const h = fixture();
  const invalid = [[file('空.png', { size: 0 })], [file('过大.png', { size: 6 * 1024 * 1024 + 1 })],
    [file('脚本.svg', { type: 'image/svg+xml' })], [file('a.png'), file('b.png'), file('c.png')]];
  for (const files of invalid) {
    await upload(h, files);
    assert.equal(h.readers.length, 0); assert.equal(h.get('images').children.length, 0);
    assert.match(h.get('status').textContent, /最多 2 张/); assert.equal(h.requests.length, 0);
  }
  await upload(h, [file('完整图.png', { size: 6 * 1024 * 1024 }), file('细节.jpg', { type: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,REVG' })]);
  assert.equal(h.readers.length, 2); assert.equal(h.get('images').children.length, 2);
  assert.equal(h.get('upload').value, ''); assert.equal(h.requests.length, 0);
  await upload(h, [file('第三张.png')]); assert.equal(h.readers.length, 2);
  await h.get('images').children[0].querySelector('button').click(); assert.equal(h.get('images').children.length, 1);
  await upload(h, [file('替换.webp', { type: 'image/webp', dataUrl: 'data:image/webp;base64,R0hJ' })]);
  const task = h.start('解释附图');
  assert.deepEqual(h.requests[0].args.images.map(item => item.label), ['附图：细节.jpg', '附图：替换.webp']);
  respond(h, 0); await task;
});

test('四张当前视图与两张上传图一起发送，图片预览和移除均不请求服务', async () => {
  const currentViews = ['三维模型', '主视图', '俯视图', '左视图'].map(label => image(label));
  const h = fixture({ captureImages: async () => currentViews });
  await upload(h, [file('a.png'), file('b.png')]);
  await h.get('preview-images').click();
  assert.equal(h.requests.length, 0); assert.equal(h.get('images').children.length, 6);
  const task = h.start('比较图纸和模型'); await flush();
  assert.equal(h.requests[0].args.images.length, 6);
  assert.deepEqual(h.requests[0].args.images.slice(0, 4), currentViews);
  assert.deepEqual(h.requests[0].args.images.slice(4).map(item => item.label), ['附图：a.png', '附图：b.png']);
  respond(h, 0); await task;
});

test('上传等待期间关闭或切模型，FileReader 迟到结果不能附到新模型', async () => {
  for (const action of ['close', 'switch', 'pagehide']) {
    const h = fixture(); await h.launcher.click();
    const task = upload(h, [file('旧模型图.png', { defer: true })]);
    assert.equal(h.get('generate').disabled, true);
    if (action === 'switch') { h.context = { ...makeContext(), targetId: 'model-b:1', conversationId: 'explore:model-b' }; h.assistant.refresh(); }
    else if (action === 'pagehide') await h.window.dispatch('pagehide');
    else await h.get('close').click();
    h.readers[0].finish(); await task;
    assert.equal(h.get('images').children.length, 0); assert.equal(h.requests.length, 0);
    assert.equal(h.get('generate').disabled, false);
  }
});

test('截图、预览和文件读取错误不显示原始异常，也不发送不完整图片', async () => {
  const secret = 'private-image-error-test-memory-only-key';
  const h = fixture({ captureImages: async () => { throw new Error(secret); } });
  await h.get('preview-images').click();
  assert.match(h.get('status').textContent, /当前视图暂未准备好/);
  await h.start('解释图片');
  assert.match(h.get('status').textContent, /未能完成回答/);
  assert.equal(h.requests.length, 0); assert.equal(h.document.body.textContent.includes(secret), false);
  await upload(h, [file('无法读取.png', { fail: true })]);
  assert.match(h.get('status').textContent, /图片未能读取/);
  assert.equal(h.get('images').children.length, 0); assert.equal(h.get('generate').disabled, false);
  assert.equal(h.document.body.textContent.includes('private file-reader'), false);
  assert.deepEqual(h.storageCalls, []); assert.deepEqual(h.logs, []);
});

test('真实桥梁 context 的 default 额外字段与属性顺序不能使有效回答恒为过期', async () => {
  const real = getStayedParameterContext('stayed_fan');
  const context = { ...real, targetId: 'explore:cableStayedFan:7', conversationId: 'explore:cableStayedFan' };
  assert.ok(context.parameters.every(parameter => Object.hasOwn(parameter, 'default')));
  // The production builder intentionally declares default before current value;
  // also reorder all primitive keys, as a different controller is allowed to do.
  context.parameters = context.parameters.map(parameter => ({
    default: parameter.default, unit: parameter.unit, max: parameter.max, step: parameter.step,
    value: parameter.value, min: parameter.min, label: parameter.label, key: parameter.key,
    description: '应用自己的参数说明，不参与编辑状态指纹'
  }));
  const h = fixture({ context }), task = h.start('桥面改为 12 米宽。');
  assert.equal(h.requests[0].args.context.parameters.find(parameter => parameter.key === 'deckWidth').value, 8);
  respond(h, 0, '把桥面总宽改为 12 米。', [{ key: 'deckWidth', value: 12 }]); await task;
  assert.equal(h.get('plan').hidden, false);
  assert.equal(h.get('apply').disabled, false);
  assert.match(h.get('changes').textContent, /桥面总宽8m12m/);
  assert.doesNotMatch(h.get('status').textContent, /已变化/);
  await h.get('apply').click();
  assert.equal(h.applyCount, 1); assert.equal(h.context.parameters.find(parameter => parameter.key === 'deckWidth').value, 12);
  assert.equal(h.get('undo').disabled, false);
  await h.get('undo').click();
  assert.equal(h.restoreCount, 1); assert.equal(h.context.parameters.find(parameter => parameter.key === 'deckWidth').value, 8);
});

test('参数对象重排或只增加非编辑元数据不会清理方案与撤销，真实值改变仍会失效', async () => {
  const h = fixture({ context: { ...getStayedParameterContext('stayed_harp'), conversationId: 'explore:cableStayedHarp' } });
  const widthField = h.get('parameters').querySelector('[aria-label="桥面总宽"]');
  widthField.value = '10'; await h.get('manual-preview').click();
  assert.equal(h.get('plan').hidden, false); assert.equal(h.requests.length, 0);
  h.context.parameters = h.context.parameters.map(parameter => Object.fromEntries([
    ['sourceNote', '教学构件'], ...Object.entries(parameter).reverse()
  ]));
  assert.equal(h.assistant.refresh(), false);
  assert.equal(h.get('apply').disabled, false);
  await h.get('apply').click(); assert.equal(h.get('undo').disabled, false);
  h.context.parameters = h.context.parameters.map(parameter => ({ extra: true, ...Object.fromEntries(Object.entries(parameter).reverse()) }));
  assert.equal(h.assistant.refresh(), false); assert.equal(h.get('undo').disabled, false);
  h.context.parameters.find(parameter => parameter.key === 'deckWidth').value = 11;
  assert.equal(h.assistant.refresh(), true); assert.equal(h.get('undo').disabled, true);
});
