import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AIEditError, validateEditPlan } from '../ai-edit-protocol.js';

const source = await readFile(new URL('../ai-model-assistant.js', import.meta.url), 'utf8');
// Execute the production drawer and its real validator. Only browser surfaces,
// timers and the network boundary are substituted; no browser/API is contacted.
const loadAssistant = new Function('document', 'window', 'setInterval', 'clearInterval',
  'AIEditError', 'requestEditPlan', 'validateEditPlan', 'localStorage', 'sessionStorage', 'console',
  `${source.replace(/^import .*;\r?$/gm, '').replace('export function ', 'function ')}\nreturn createAiModelAssistant;`);

function fakeDom() {
  const htmlWrites = [], storageCalls = [], logs = [], intervals = new Map();
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
  const create = loadAssistant(document, window,
    callback => { const id = ++timerId; intervals.set(id, callback); return id; },
    id => intervals.delete(id), AIEditError,
    () => { throw new Error('Real API calls are forbidden in this test'); }, validateEditPlan,
    storage, storage, new Proxy({}, { get: () => (...args) => logs.push(args) }));
  return { document, window, create, htmlWrites, storageCalls, logs, intervals };
}

function makeContext() {
  return { targetId: 'model-a:1', label: '模型 A', description: '尺寸参数', example: '宽度改为 4',
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
  const assistant = dom.create({ getContext: () => context, applyPlan, requestPlan });
  const panel = dom.document.getElementById('ai-edit-panel');
  const get = name => panel.querySelector(`[data-ai="${name}"]`);
  const key = panel.querySelector('#ai-edit-key');
  const instruction = panel.querySelector('#ai-edit-instruction');
  const launcher = dom.document.getElementById('ai-edit-launcher');
  return { ...dom, assistant, panel, get, key, instruction, launcher, requests,
    get context() { return context; }, set context(value) { context = value; },
    get applyCount() { return applyCount; }, get restoreCount() { return restoreCount; },
    start() { key.value = 'test-memory-only-key'; instruction.value = '宽度改为 4'; return get('generate').click(); },
    field() { return get('parameters').querySelector('input'); }
  };
}

test('首次无参数页面和页面切换都会禁用修改按钮', async () => {
  const h = fixture({ context: null });
  for (const button of ['generate', 'manual-preview', 'apply', 'undo']) assert.equal(h.get(button).disabled, true);
  await h.launcher.click();
  assert.match(h.get('target').textContent, /暂不支持/);
  h.context = makeContext(); h.assistant.refresh();
  assert.equal(h.get('generate').disabled, false);
  assert.equal(h.get('manual-preview').disabled, false);
  h.context = { ...makeContext(), parameters: [] }; h.assistant.refresh();
  for (const button of ['generate', 'manual-preview', 'apply', 'undo']) assert.equal(h.get(button).disabled, true);
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
    assert.match(h.get('status').textContent, error instanceof AIEditError ? /密钥验证失败/ : /未能生成方案/);
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
