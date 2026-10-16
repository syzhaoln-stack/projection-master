import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG } from '../model-library-curation.js';
import { TEXTBOOK_MECHANICAL_CATALOG } from '../textbook-mechanical-models.js';
const source = await readFile(new URL('../model-gallery.js', import.meta.url), 'utf8');
const { createGalleryEntries, createModelGallery } = new Function('createGalleryRoom',
  `${source.replace(/^import .*;\r?$/gm, '').replace(/export function /g, 'function ')}\nreturn {createGalleryEntries,createModelGallery};`)(
  () => { throw new Error('Tests must supply the isolated room factory'); });
const entries = createGalleryEntries(TEXTBOOK_MECHANICAL_CATALOG, CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG);
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function domFixture() {
  let document;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attributes = new Map();
      this.listeners = new Map(); this.style = {}; this.hidden = false; this.disabled = false; this.value = ''; this._classes = new Set();
      this.classList = { add: name => this._classes.add(name), remove: name => this._classes.delete(name),
        contains: name => this._classes.has(name), toggle: (name, active) => active ? this._classes.add(name) : this._classes.delete(name) };
    }
    set className(value) { this._classes = new Set(value.split(/\s+/)); }
    get className() { return [...this._classes].join(' '); }
    append(...children) { children.forEach(child => { child.parentElement = this; this.children.push(child); }); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    set innerHTML(value) {
      this.children = []; const stack = [this];
      for (const match of value.matchAll(/<(\/?)([\w-]+)([^>]*)>/g)) {
        if (match[1]) { stack.pop(); continue; }
        const element = new Element(match[2]);
        for (const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) element.setAttribute(attr[1], attr[2] ?? '');
        stack.at(-1).append(element);
        if (!['input', 'img', 'br', 'hr'].includes(match[2])) stack.push(element);
      }
    }
    setAttribute(key, value) {
      this.attributes.set(key, String(value));
      if (key === 'class') this.className = value;
      if (key === 'hidden') this.hidden = true;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(key) { return this.attributes.get(key); }
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
      if (selector === '[hidden]') return this.hidden;
      const compound = selector.match(/^(\.[\w-]+)(\[.+\])$/);
      if (compound) return this.matches(compound[1]) && this.matches(compound[2]);
      if (selector.startsWith('.')) return this._classes.has(selector.slice(1));
      const attr = selector.match(/^\[([^=]+)(?:="([^"]*)")?\]$/);
      if (attr) return attr[2] === undefined ? this.attributes.has(attr[1]) : this.getAttribute(attr[1]) === attr[2];
      return this.tagName.toLowerCase() === selector;
    }
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(item => item.trim()), found = [];
      const walk = parent => parent.children.forEach(child => { if (selectors.some(item => child.matches(item))) found.push(child); walk(child); });
      walk(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    scrollIntoView(options) { this.lastScroll = options; }
    focus() { document.activeElement = this; }
    click() { return this.dispatch('click'); }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    async dispatch(type, overrides = {}) {
      const event = { target: this, currentTarget: this, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; }, ...overrides };
      if (type !== 'click' || !this.disabled) await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
      return event;
    }
  }
  document = new Element('document'); document.createElement = tag => new Element(tag); document.body = new Element('body'); document.append(document.body);
  document.getElementById = id => document.querySelector(`[id="${id}"]`);
  const opener = document.createElement('button'); opener.setAttribute('data-open-model-gallery', 'all'); document.body.append(opener);
  const mechanicalOpener = document.createElement('button'); mechanicalOpener.className = 'quick-more'; mechanicalOpener.dataset.cat = 'solids'; document.body.append(mechanicalOpener);
  const bridgeOpener = document.createElement('button'); bridgeOpener.className = 'quick-more'; bridgeOpener.dataset.cat = 'bridge'; document.body.append(bridgeOpener);
  const tree = document.createElement('aside'); tree.setAttribute('id', 'tree-panel');
  const props = document.createElement('aside'); props.setAttribute('id', 'props-panel'); props.classList.add('open');
  const bridgeGroup = document.createElement('div'), bridgeHeading = document.createElement('button'), bridgeList = document.createElement('div');
  bridgeHeading.className = 'tree-group-head'; bridgeHeading.setAttribute('data-group', 'bridge'); bridgeList.setAttribute('id', 'bridge-library-list');
  bridgeGroup.append(bridgeHeading, bridgeList); tree.append(bridgeGroup); document.body.append(tree, props);
  const calls = [], inspectCalls = [], leaves = [], zooms = [], views = [], labels = new Map();
  let callbacks, state, handoff, selectionResult, inspectImpl = () => ({ viewMode: 'wrapped' }), leaveImpl = () => {}, viewImpl = mode => mode, resetCount = 0;
  const emit = updates => { state = { ...state, ...updates }; labels.forEach(label => { label.hidden = ['taking', 'holding', 'returning'].includes(state.phase); }); callbacks.onStateChange(state); };
  const roomFactory = options => {
    calls.push(['create', options.entries.map(entry => entry.id)]); callbacks = options;
    for (const entry of options.entries) { const label = document.createElement('button'); label.dataset.modelId = entry.id; options.host.append(label); labels.set(entry.id, label); }
    return {
      open(category) { calls.push(['open', category]); emit({ phase: 'wall', selectedId: null, readyCount: options.entries.length }); },
      close() { calls.push(['close']); },
      async take(id) { calls.push(['take', id]); emit({ phase: 'taking', selectedId: id }); await Promise.resolve(); emit({ phase: 'holding' }); selectionResult = callbacks.onSelect(options.entries.find(entry => entry.id === id), handoff); return true; },
      async putBack() { calls.push(['putBack', state.selectedId]); emit({ phase: 'returning' }); await Promise.resolve(); emit({ phase: 'wall', selectedId: null }); return true; },
      setInspectionActive(value) { calls.push(['inspectionActive', value]); }, dispose() { calls.push(['dispose']); }
    };
  };
  const gallery = createModelGallery({ entries, definitions: {}, document, roomFactory,
    onInspect: options => { inspectCalls.push(options); calls.push(['inspect', options.id]); return inspectImpl(options); },
    onLeaveInspect: options => { leaves.push(options); calls.push(['leave']); return leaveImpl(options); },
    onSetView: mode => { views.push(mode); return viewImpl(mode); },
    onZoom: factor => zooms.push(factor), onReset: () => resetCount++ });
  const root = document.querySelector('.model-gallery');
  return { document, root, opener, mechanicalOpener, bridgeOpener, tree, props, bridgeGroup, bridgeList, gallery, calls, labels, emit, inspectCalls, leaves, zooms, views,
    get state() { return state; }, get resetCount() { return resetCount; }, get selectionResult() { return selectionResult; },
    setInspect: fn => { inspectImpl = fn; }, setLeave: fn => { leaveImpl = fn; }, setView: fn => { viewImpl = fn; }, setHandoff: value => { handoff = value; },
    get: key => root.querySelector(`[data-gallery="${key}"]`) };
}

test('cabinet only receives eight mechanical entries and keeps the workbench bridge catalog intact', async () => {
  const h = domFixture(); assert.equal(entries.length, 20); assert.equal(entries.filter(entry => entry.category === 'bridge').length, 12);
  assert.deepEqual(h.calls, []); await h.opener.click();
  assert.deepEqual(h.calls[0], ['create', TEXTBOOK_MECHANICAL_CATALOG.map(entry => entry.id)]);
  assert.deepEqual(h.calls[1], ['open', 'mechanical']); assert.equal(h.get('controls').hidden, true);
  assert.equal(await h.gallery.take('drawing_bago'), false); assert.equal(h.inspectCalls.length, 0);
  assert.equal(h.root.querySelector('.model-gallery-inspector'), null); assert.equal(h.root.querySelector('input'), null);
  await h.gallery.destroy();
});

test('taking automatically opens the clean inspect host with real layout dimensions and no extra Enter step', async () => {
  const h = domFixture(); h.gallery.open('all', h.opener);
  h.setInspect(({ host, signal }) => { assert.equal(host.hidden, false); assert.equal(host.style.visibility, 'hidden'); assert.equal(signal.aborted, false); return { viewMode: 'wrapped' }; });
  await h.gallery.take('textbook56'); await settle();
  assert.equal(h.inspectCalls.length, 1); assert.equal(h.inspectCalls[0].id, 'textbook56');
  assert.equal(h.get('display-host').hidden, false); assert.equal(h.get('display-host').style.visibility, '');
  assert.equal(h.get('title').textContent, entries.find(entry => entry.id === 'textbook56').name);
  assert.equal(h.get('view-wrapped').getAttribute('aria-pressed'), 'true');
  assert.equal(h.get('view-solid').getAttribute('aria-pressed'), 'false'); assert.equal(h.get('view-unfolded').getAttribute('aria-pressed'), 'false');
  assert.ok(h.calls.some(call => call[0] === 'inspectionActive' && call[1] === true));
  assert.equal(h.get('put-back').disabled, false); assert.equal(h.document.activeElement, h.get('display-host'));
  assert.equal(h.get('display-host').getAttribute('tabindex'), '-1');
  await h.gallery.destroy();
});

test('three explicit view modes, zoom and fit control the adapter only while a model is held', async () => {
  const h = domFixture(); h.gallery.open('mechanical', h.opener);
  for (const mode of ['solid', 'wrapped', 'unfolded']) await h.get(`view-${mode}`).click();
  assert.deepEqual(h.views, []);
  await h.gallery.take('textbook56'); await settle();
  for (const mode of ['solid', 'unfolded', 'wrapped']) {
    await h.get(`view-${mode}`).click();
    for (const option of ['solid', 'wrapped', 'unfolded']) assert.equal(h.get(`view-${option}`).getAttribute('aria-pressed'), String(mode === option));
  }
  assert.deepEqual(h.views, ['solid', 'unfolded', 'wrapped']);
  await h.get('zoom-out').click(); await h.get('zoom-in').click(); await h.get('reset').click();
  assert.deepEqual(h.zooms, [0.84, 1.19]); assert.equal(h.resetCount, 1);
  await h.gallery.putBack(); await h.get('zoom-in').click(); await h.get('view-unfolded').click(); assert.equal(h.zooms.length, 2); assert.equal(h.views.length, 3);
  await h.gallery.destroy();
});

test('the exact final room pose is handed to inspection, and the room stays visible until the matched frame is ready', async () => {
  const h = domFixture();
  const handoff = Object.freeze({ version: 1, modelId: 'textbook56', sourceCenter: Object.freeze([1, 2, 3]), sourceUnit: 4,
    displayPose: Object.freeze({ position: Object.freeze([2, 3, 4]), quaternion: Object.freeze([0, 0, 0, 1]), scale: 0.8 }),
    camera: Object.freeze({ position: Object.freeze([6, 5, 8]), quaternion: Object.freeze([0, 0, 0, 1]), up: Object.freeze([0, 1, 0]),
      target: Object.freeze([0, 2, 0]), fov: 40, zoom: 1, near: 0.1, far: 100 }),
    viewport: Object.freeze({ left: 0, top: 60, width: 1280, height: 592 }) });
  h.setHandoff(handoff); let finish;
  h.setInspect(options => { assert.equal(options.handoff, handoff); return new Promise(resolve => { finish = resolve; }); });
  h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook56'); await settle();
  assert.equal(typeof h.selectionResult?.then, 'function', 'the room can freeze the sampled pose until the inspection Promise completes');
  assert.equal(h.get('display-host').hidden, false); assert.equal(h.get('display-host').style.visibility, 'hidden');
  assert.equal(h.get('stage').classList.contains('is-inspecting'), false);
  assert.equal(h.calls.some(call => call[0] === 'inspectionActive' && call[1]), false);
  finish({ viewMode: 'wrapped' }); await settle();
  assert.equal(await h.selectionResult, true);
  assert.equal(h.get('stage').classList.contains('is-inspecting'), true);
  assert.equal(h.get('display-host').style.visibility, '');
  assert.deepEqual(h.calls.filter(call => call[0] === 'inspectionActive'), [['inspectionActive', true]]);
  await h.gallery.destroy();
});

test('Space switches wrapped and unfolded views, unfolds solid mode, and preserves native button Space', async () => {
  const h = domFixture(); h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook56'); await settle();
  assert.equal(h.document.activeElement, h.get('display-host'), 'taking leaves keyboard focus on the model rather than the return button');
  const event = await h.document.dispatch('keydown', { key: ' ', code: 'Space', target: h.document.activeElement }); await settle();
  assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true); assert.deepEqual(h.views, ['unfolded']);
  assert.equal(h.calls.some(call => call[0] === 'putBack'), false, 'the first Space expands views without putting the model back');
  await h.document.dispatch('keydown', { key: ' ', code: 'Space', target: h.get('display-host') }); await settle();
  assert.deepEqual(h.views, ['unfolded', 'wrapped']);
  await h.get('view-solid').click();
  await h.document.dispatch('keydown', { key: ' ', code: 'Space', target: h.get('display-host') }); await settle();
  assert.deepEqual(h.views, ['unfolded', 'wrapped', 'solid', 'unfolded']);
  const buttonEvent = await h.document.dispatch('keydown', { key: ' ', code: 'Space', target: h.get('put-back') });
  assert.equal(buttonEvent.defaultPrevented, false); assert.equal(h.views.length, 4);
  await h.gallery.destroy();
});

test('return restores the previous workbench before revealing and animating the room model', async () => {
  const h = domFixture(); h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook56'); await settle();
  let finishRestore; h.setLeave(() => new Promise(resolve => { finishRestore = resolve; }));
  const returning = h.gallery.putBack(); await settle();
  assert.equal(h.get('display-host').hidden, true); assert.equal(h.inspectCalls[0].signal.aborted, true);
  assert.equal(h.calls.some(call => call[0] === 'putBack'), false, 'return animation must wait for canvas restoration');
  finishRestore(); assert.equal(await returning, true);
  assert.ok(h.calls.findIndex(call => call[0] === 'leave') < h.calls.findIndex(call => call[0] === 'putBack'));
  assert.equal(h.get('controls').hidden, true); assert.equal(h.document.activeElement, h.labels.get('textbook56'));
  assert.deepEqual(h.leaves, [{ apply: false }]); await h.gallery.destroy(); assert.equal(h.leaves.length, 1);
});

test('Escape returns a held model before closing the room and restoring the trigger focus', async () => {
  const h = domFixture(); h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook56'); await settle();
  await h.document.dispatch('keydown', { key: 'Escape' }); await settle();
  assert.equal(h.root.hidden, false); assert.equal(h.state.phase, 'wall'); assert.equal(h.leaves.length, 1);
  await h.document.dispatch('keydown', { key: 'Escape' }); await settle();
  assert.equal(h.root.hidden, true); assert.equal(h.document.activeElement, h.opener); await h.gallery.destroy();
});

test('close cancels pending inspection and a late completion cannot replace the reopened room', async () => {
  const h = domFixture(); let finishOld; h.setInspect(() => new Promise(resolve => { finishOld = resolve; }));
  h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook56'); await settle();
  const pendingSignal = h.inspectCalls[0].signal; await h.gallery.close(); assert.equal(pendingSignal.aborted, true);
  h.gallery.open('mechanical', h.mechanicalOpener); h.setInspect(() => ({ viewMode: 'wrapped' }));
  await h.gallery.take('textbook51'); await settle(); finishOld({ viewMode: 'unfolded' }); await settle();
  assert.equal(h.root.hidden, false); assert.equal(h.get('title').textContent, entries.find(entry => entry.id === 'textbook51').name);
  assert.equal(h.get('view-wrapped').getAttribute('aria-pressed'), 'true'); assert.equal(h.get('view-unfolded').getAttribute('aria-pressed'), 'false');
  assert.equal(h.calls.filter(call => call[0] === 'inspectionActive' && call[1] === true).length, 1);
  await h.gallery.destroy();
});

test('a new inspection waits for the prior asynchronous workbench restoration', async () => {
  const h = domFixture(); h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook56'); await settle();
  let finishRestore; h.setLeave(() => new Promise(resolve => { finishRestore = resolve; }));
  const closing = h.gallery.close(); await settle(); h.gallery.open('mechanical', h.opener);
  await h.gallery.take('textbook51'); await settle(); assert.equal(h.inspectCalls.length, 1);
  finishRestore(); await closing; await settle(); assert.equal(h.inspectCalls.length, 2);
  assert.equal(h.inspectCalls[1].id, 'textbook51'); h.setLeave(() => {}); await h.gallery.destroy();
});

test('failed inspection restores the workbench once and still offers a clear return action', async () => {
  const h = domFixture(); h.setInspect(() => { throw new Error('model failed'); }); h.gallery.open('mechanical', h.opener);
  await h.gallery.take('textbook56'); await settle();
  assert.equal(h.leaves.length, 1); assert.equal(h.get('display-host').hidden, true);
  assert.match(h.get('status').textContent, /暂时未能载入/); assert.equal(h.get('status').hidden, false);
  assert.equal(h.get('put-back').disabled, false); assert.equal(h.get('view-wrapped').disabled, true);
  await h.gallery.putBack(); assert.equal(h.leaves.length, 1); await h.gallery.destroy();
});

test('Tab loops through available room and inspection controls; closing removes all listeners', async () => {
  const h = domFixture(); h.gallery.open('mechanical', h.opener); h.get('close').focus();
  await h.document.dispatch('keydown', { key: 'Tab', shiftKey: true }); assert.equal(h.document.activeElement, [...h.labels.values()].at(-1));
  await h.document.dispatch('keydown', { key: 'Tab' }); assert.equal(h.document.activeElement, h.get('close'));
  await h.gallery.take('textbook56'); await settle(); h.get('close').focus();
  await h.document.dispatch('keydown', { key: 'Tab', shiftKey: true }); assert.equal(h.document.activeElement, h.get('reset'));
  await h.gallery.destroy(); const count = h.calls.length; await h.opener.click(); assert.equal(h.calls.length, count);
});

test('bridge directory shortcut opens and scrolls the workbench bridge group without entering the mechanical cabinet', async () => {
  const h = domFixture(); assert.equal(h.bridgeOpener.textContent, '桥梁目录 ▾');
  await h.bridgeOpener.click();
  assert.equal(h.root.hidden, true); assert.deepEqual(h.calls, []);
  assert.equal(h.tree.classList.contains('open'), true); assert.equal(h.props.classList.contains('open'), false);
  assert.equal(h.bridgeGroup.classList.contains('open'), true);
  assert.deepEqual(h.bridgeList.lastScroll, { behavior: 'smooth', block: 'start' });
  await h.gallery.destroy(); h.tree.classList.remove('open'); await h.bridgeOpener.click();
  assert.equal(h.tree.classList.contains('open'), false);
});

test('a late view result cannot change a newly opened model or replace a more recent view choice', async () => {
  const h = domFixture(); h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook56'); await settle();
  let finishOld; h.setView(() => new Promise(resolve => { finishOld = resolve; }));
  const oldClick = h.get('view-unfolded').click(); await settle();
  h.setView(mode => mode); await h.get('view-solid').click(); finishOld('unfolded'); await oldClick;
  assert.equal(h.get('view-solid').getAttribute('aria-pressed'), 'true');
  let finishClosing; h.setView(() => new Promise(resolve => { finishClosing = resolve; }));
  const closingClick = h.get('view-unfolded').click(); await settle();
  await h.gallery.close(); h.gallery.open('mechanical', h.opener); await h.gallery.take('textbook51'); await settle();
  finishClosing('unfolded'); await closingClick;
  assert.equal(h.get('view-wrapped').getAttribute('aria-pressed'), 'true');
  assert.equal(h.get('view-unfolded').getAttribute('aria-pressed'), 'false'); await h.gallery.destroy();
});
