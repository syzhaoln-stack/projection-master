import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGalleryRoom, makeDisplayCopy, disposeGalleryTree } from '../model-gallery-room.js';

const entries = [
  { id: 'mechanical', name: '机械实体', category: 'mechanical', figure: '例5-6' },
  { id: 'bridge', name: '桥梁实体', category: 'bridge', family: '梁桥' }
];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

function fixture({ definitions, reduced = false } = {}) {
  let clock = 0, nextFrame = 0;
  const frames = new Map(), renderers = [], observers = [], states = [], selected = [], errors = [], built = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.style = {}; this.dataset = {}; this.attributes = new Map(); this.listeners = new Map();
      this.classList = { toggle() {} }; this.clientWidth = 1200; this.clientHeight = 700;
    }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getContext() { return null; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  }
  const document = { createElement: tag => new Element(tag) };
  const window = new Element('window'); window.setTimeout = setTimeout;
  window.matchMedia = () => Object.assign(new Element(), { matches: reduced });
  const host = new Element(); host.ownerDocument = document;
  const sharedTexture = new THREE.Texture(); let textureDisposals = 0;
  sharedTexture.addEventListener('dispose', () => textureDisposals++);
  const makeModel = (id, size = [8, 2, 1]) => {
    const root = new THREE.Group(); root.position.set(13, -3, 8); root.scale.set(2, 1, 0.5);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ map: sharedTexture }));
    mesh.position.set(2, 4, -1); root.add(mesh);
    const item = { id, root, geometryDisposals: 0, materialDisposals: 0 };
    mesh.geometry.addEventListener('dispose', () => item.geometryDisposals++);
    mesh.material.addEventListener('dispose', () => item.materialDisposals++);
    built.push(item); return root;
  };
  const runtime = { document, window, now: () => clock,
    requestFrame(fn) { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelFrame(id) { frames.delete(id); },
    createRenderer() {
      const renderer = { domElement: new Element('canvas'), shadowMap: {}, disposals: 0, losses: 0, renders: 0,
        renderLists: { dispose() {} }, setPixelRatio() {}, setSize() {},
        render(scene, camera) { this.scene = scene; this.camera = camera; this.renders++; },
        dispose() { this.disposals++; }, forceContextLoss() { this.losses++; } };
      renderers.push(renderer); return renderer;
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
      observe() { this.connected = true; } disconnect() { this.connected = false; }
    }
  };
  const defaults = Object.fromEntries(entries.map(entry => [entry.id, { build: () => makeModel(entry.id) }]));
  const room = createGalleryRoom({ host, entries, definitions: definitions?.(makeModel) || defaults, runtime,
    onSelect: entry => selected.push(entry.id), onStateChange: state => states.push(state), onError: error => errors.push(error) });
  function advance(ms = 0) {
    clock += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(clock));
  }
  return { room, host, frames, renderers, observers, states, selected, errors, built, sharedTexture,
    advance, makeModel, get textureDisposals() { return textureDisposals; },
    mount: id => renderers.at(-1).scene.getObjectByName(`gallery-mount:${id}`) };
}

async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.fail('asynchronous model loading did not settle');
}

test('late load after close cannot build or notify the next open session', async () => {
  const waiting = deferred(); let loads = 0;
  const h = fixture({ definitions: make => ({ mechanical: { load: () => { loads++; return waiting.promise; }, build: () => make('mechanical') }, bridge: { build: () => make('bridge') } }) });
  h.room.open('mechanical'); await until(() => loads === 1);
  h.room.close(); const closedStates = h.states.length;
  assert.equal(h.frames.size, 0); assert.equal(h.host.children.length, 0);
  h.room.open('bridge'); const openStates = h.states.length;
  waiting.resolve(); await until(() => h.room.getState().readyCount === 2);
  assert.equal(loads, 2); assert.deepEqual(h.built.map(item => item.id), ['mechanical', 'bridge']);
  assert.equal(h.states.length, openStates + 2, 'the obsolete queue must not emit readiness into the new room');
  assert.ok(openStates > closedStates); assert.equal(h.room.getState().category, 'bridge');
  assert.equal(h.errors.length, 0); h.room.dispose();
});

test('a source build completing after close is disposed without attaching display geometry', async () => {
  const waiting = deferred(); let started = false;
  const h = fixture({ definitions: make => ({ mechanical: { build: () => { started = true; return waiting.promise; } }, bridge: { build: () => make('bridge') } }) });
  h.room.open(); await until(() => started);
  h.room.close(); const count = h.states.length;
  waiting.resolve(h.makeModel('late-source'));
  await until(() => h.built[0].geometryDisposals === 1);
  assert.equal(h.built[0].materialDisposals, 1); assert.equal(h.textureDisposals, 0);
  assert.equal(h.states.length, count); assert.equal(h.host.children.length, 0); assert.equal(h.frames.size, 0);
  h.room.dispose();
});

test('taking and returning use the same mount and restore its exact shelf pose', async () => {
  const h = fixture(); h.room.open('all'); await until(() => h.room.getState().readyCount === 2); h.advance();
  const mount = h.mount('mechanical'), home = { position: mount.position.clone(), scale: mount.scale.clone(), quaternion: mount.quaternion.clone() };
  const taking = h.room.take('mechanical'); assert.equal(h.room.getState().phase, 'taking');
  h.advance(410); assert.ok(mount.position.distanceTo(home.position) > 0.1); assert.deepEqual(h.selected, []);
  h.advance(410); assert.equal(await taking, true); assert.deepEqual(h.selected, ['mechanical']);
  assert.equal(h.mount('mechanical'), mount); assert.equal(h.room.getState().phase, 'holding');
  const heldScale = mount.scale.x; assert.equal(h.room.zoomHeld(1.5), true); assert.ok(mount.scale.x > heldScale);
  assert.equal(h.room.resetHeld(), true); assert.ok(Math.abs(mount.scale.x - heldScale) < 1e-10);
  const returning = h.room.putBack(); h.advance(820); assert.equal(await returning, true);
  assert.equal(h.room.getState().selectedId, null); assert.equal(h.room.getState().phase, 'wall');
  assert.ok(mount.position.distanceTo(home.position) < 1e-10); assert.ok(mount.scale.distanceTo(home.scale) < 1e-10);
  assert.ok(1 - Math.abs(mount.quaternion.dot(home.quaternion)) < 1e-10);
  assert.ok(h.built.every(item => item.geometryDisposals === 1 && item.materialDisposals === 1));
  assert.equal(h.textureDisposals, 0); h.room.dispose();
});

test('closing during either animation resolves it false and releases every owned renderer resource once', async () => {
  for (const phase of ['taking', 'returning']) {
    const h = fixture(); h.room.open(); await until(() => h.room.getState().readyCount === 2); h.advance();
    const renderer = h.renderers[0], disposals = new Map();
    renderer.scene.traverse(object => {
      for (const resource of [object.geometry, ...(Array.isArray(object.material) ? object.material : [object.material])]) {
        if (!resource || disposals.has(resource)) continue;
        disposals.set(resource, 0); resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
      }
    });
    let pending = h.room.take('mechanical');
    if (phase === 'returning') { h.advance(820); await pending; pending = h.room.putBack(); }
    h.advance(300); h.room.close(); assert.equal(await pending, false);
    assert.equal(h.room.getState().selectedId, null); assert.equal(h.frames.size, 0); assert.equal(h.host.children.length, 0);
    assert.equal(renderer.disposals, 1); assert.equal(renderer.losses, 1); assert.ok([...disposals.values()].every(count => count === 1));
    assert.ok(h.observers.every(observer => !observer.connected));
    assert.ok([...renderer.domElement.listeners.values()].every(listeners => listeners.size === 0));
    assert.equal(h.textureDisposals, 0); h.room.close(); h.room.dispose(); assert.equal(renderer.disposals, 1);
    assert.equal(h.room.open(), false);
  }
});

test('a fresh open after interrupted take can take and return again, including reduced motion', async () => {
  const h = fixture({ reduced: true }); h.room.open(); await until(() => h.room.getState().readyCount === 2); h.advance();
  const abandoned = h.room.take('mechanical'); h.room.close(); assert.equal(await abandoned, false);
  h.room.open('bridge'); await until(() => h.room.getState().readyCount === 2); h.advance();
  const taking = h.room.take('bridge'); h.advance(); assert.equal(await taking, true);
  const returning = h.room.putBack(); h.advance(); assert.equal(await returning, true);
  assert.deepEqual(h.selected, ['bridge']); assert.equal(h.renderers.length, 2); h.room.dispose();
  assert.ok(h.renderers.every(renderer => renderer.disposals === 1));
});

test('held model retains its finish and only nonvisual keyboard controls return after replacement', async () => {
  const h = fixture(); h.room.open('all'); await until(() => h.room.getState().readyCount === 2); h.advance();
  const labelHost = h.host.children.find(child => child.className === 'model-gallery-room-labels');
  const labels = labelHost.children;
  assert.equal(labelHost.style.clipPath, 'inset(50%)', 'keyboard equivalents must not create visible model plaques');
  assert.ok(labels.length > 0 && labels.every(label => !label.hidden));
  const heldMaterial = h.mount('mechanical').children[0].children[0].material;
  const backgroundMaterial = h.mount('bridge').children[0].children[0].material;
  const heldColor = heldMaterial.color.clone(), backgroundColor = backgroundMaterial.color.clone();
  const taking = h.room.take('mechanical'); h.advance(410);
  assert.ok(labels.every(label => label.hidden), 'DOM labels must not paint over the foreground model');
  assert.ok(heldMaterial.color.equals(heldColor)); assert.ok(!backgroundMaterial.color.equals(backgroundColor));
  h.advance(410); await taking;
  assert.ok(labels.every(label => label.hidden)); assert.ok(heldMaterial.color.equals(heldColor));
  const returning = h.room.putBack(); h.advance(410); assert.ok(labels.every(label => label.hidden));
  h.advance(410); await returning;
  assert.ok(labels.every(label => !label.hidden)); assert.ok(heldMaterial.color.equals(heldColor));
  assert.ok(backgroundMaterial.color.equals(backgroundColor)); h.room.dispose();
});

test('inspection hides the cabinet copy and pauses room interaction, then restores the same mount for return', async () => {
  const h = fixture({ reduced: true }); h.room.open(); await until(() => h.room.getState().readyCount === 2); h.advance();
  const mount = h.mount('mechanical'), home = mount.position.clone();
  const taking = h.room.take('mechanical'); h.advance(); await taking;
  const heldPosition = mount.position.clone(), heldScale = mount.scale.clone(), heldQuaternion = mount.quaternion.clone();
  assert.equal(h.room.setInspectionActive(true), true); h.advance();
  assert.equal(mount.visible, false); assert.equal(h.renderers[0].scene.visible, false);
  assert.equal(h.room.zoomHeld(1.5), false); assert.equal(h.room.resetHeld(), false);
  assert.deepEqual(mount.position, heldPosition); assert.deepEqual(mount.scale, heldScale); assert.deepEqual(mount.quaternion.toArray(), heldQuaternion.toArray());
  assert.equal(h.room.setInspectionActive(false), true); h.advance();
  assert.equal(mount.visible, true); assert.equal(h.renderers[0].scene.visible, true); assert.equal(h.mount('mechanical'), mount);
  const returning = h.room.putBack(); h.advance(); assert.equal(await returning, true);
  assert.ok(mount.position.distanceTo(home) < 1e-10); h.room.dispose();
});

test('display batching excludes hidden/guide geometry while preserving transforms, triangles and shared texture ownership', () => {
  const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture });
  const source = new THREE.Group(); source.position.set(4, 5, 6); source.rotation.y = 0.3;
  const a = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1), material), b = a.clone(); b.geometry = a.geometry.clone(); b.position.set(5, 1, 2); source.add(a, b);
  const hidden = new THREE.Group(); hidden.visible = false; hidden.add(new THREE.Mesh(new THREE.BoxGeometry(900, 900, 900), material)); source.add(hidden);
  const guide = new THREE.Mesh(new THREE.BoxGeometry(600, 600, 600), material); guide.userData.projectionGuide = true; source.add(guide);
  source.updateMatrixWorld(true);
  const expected = new THREE.Box3().setFromObject(a).union(new THREE.Box3().setFromObject(b));
  let sourceDisposals = 0, textureDisposals = 0;
  for (const resource of [a.geometry, b.geometry, material]) resource.addEventListener('dispose', () => sourceDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  const copy = makeDisplayCopy(source, 'actual');
  assert.equal(copy.children.length, 1); assert.equal(copy.children[0].geometry.attributes.position.count, 72);
  const actual = new THREE.Box3().setFromObject(copy);
  assert.ok(actual.min.distanceTo(expected.min) < 1e-5); assert.ok(actual.max.distanceTo(expected.max) < 1e-5);
  assert.notEqual(copy.children[0].material, material); assert.equal(copy.children[0].material.map, texture);
  disposeGalleryTree(copy); assert.equal(sourceDisposals, 0); assert.equal(textureDisposals, 0);
  disposeGalleryTree(source); texture.dispose();
});
