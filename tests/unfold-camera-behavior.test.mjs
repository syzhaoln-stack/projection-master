import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import { BRIDGE_MODELS } from '../bridge-models.js';
import { DETAILED_BRIDGE_MODELS } from '../detailed-bridges.js';

const SOURCE = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');

// Run the shipped handlers and animation functions without a WebGL context.
// These top-level declarations end at an unindented closing brace. The test
// executes their bodies; source extraction is not the behavioral assertion.
function functionSource(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  const end = SOURCE.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `production function ${name} is missing`);
  return SOURCE.slice(start, end + 2);
}

function initialState() {
  const start = SOURCE.indexOf('const state = {');
  const end = SOURCE.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'production state declaration is missing');
  return vm.runInNewContext(`${SOURCE.slice(start, end + 3)}\nstate;`);
}

function element(id) {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  const label = { textContent: '' };
  return {
    id, dataset: {}, clientWidth: 1200, clientHeight: 800, textContent: '',
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      remove(...names) { names.forEach(name => classes.delete(name)); }
    },
    querySelector: selector => selector === 'span' || selector === '.cap' ? label : null,
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    dispatch(type, event = {}) { (listeners.get(type) || []).forEach(handler => handler(event)); },
    label
  };
}

function harness() {
  let now = 0;
  let nextFrame;
  const elements = Object.fromEntries([
    'viewport', 'model-pane', 'tile-btn', 'unfold-btn', 'unfold-btn-mobile', 'mobile-unfold-fab',
    'tog-centers', 'tog-centers-m', 'tog-hidden', 'tog-hidden-m',
    'tog-projlines', 'tog-projlines-m', 'tog-axes', 'tog-axes-m'
  ].map(id => [id, element(id)]));
  elements['model-pane'].clientWidth = 640;
  const documentEvents = element('document');
  const camera = new THREE.PerspectiveCamera(43, 1.5, 0.05, 1000);
  camera.position.set(-11.25, 7.8, 18.4);
  camera.up.set(0.2, 0.94, -0.27).normalize();
  camera.zoom = 1.7;
  camera.updateProjectionMatrix();
  const controls = {
    target: new THREE.Vector3(1.35, -0.6, 2.2),
    // No user pointer input or residual damping is present in this fixture.
    update() { counters.controlUpdates++; }
  };
  camera.lookAt(controls.target);
  const state = {
    ...initialState(), planeSize: 12, planeGap: 3.5
  };
  const counters = { renders: 0, controlUpdates: 0, fits: 0, frameFits: 0, mounts: 0, refreshes: 0, projections: 0 };
  const projPlanes = Object.fromEntries(['front', 'top', 'side'].map(view => [view, new THREE.Object3D()]));
  const renderer = {
    size: null,
    setSize(w, h) { this.size = [w, h]; },
    render() { counters.renders++; }
  };
  const context = vm.createContext({
    THREE, state, camera, controls, renderer, projPlanes,
    viewport: elements.viewport, scene: new THREE.Scene(),
    projectionGroup: new THREE.Group(), floorGroup: new THREE.Group(),
    projLinesGroup: new THREE.Group(), axesGroup: new THREE.Group(),
    document: {
      getElementById: id => elements[id] || null,
      querySelectorAll: () => [],
      addEventListener: (...args) => documentEvents.addEventListener(...args)
    },
    performance: { now: () => now },
    requestAnimationFrame: callback => { nextFrame = callback; },
    bindSlider() {}, updateModelTransparency() {}, applyClearance() {},
    drawProjections() { counters.projections++; },
    drawProjectionLines() {
      context.projLinesGroup.clear();
      context.projLinesGroup.add(new THREE.Object3D());
    },
    clearGroup: group => group.clear(),
    updateViewMatchFeedback() {}, setStatus() {},
    mountRenderer() { counters.mounts++; },
    scheduleTiledProjectionRefresh() { counters.refreshes++; },
    compoundController: null,
    // If automatic fitting is accidentally reintroduced, execute a disruptive
    // fit rather than masking it. Camera preservation must then fail.
    fitModelCamera() {
      counters.fits++;
      camera.position.set(31, 42, 53);
      controls.target.set(0, 0, 0);
      camera.up.set(0, 1, 0);
      camera.zoom = 1;
      camera.lookAt(controls.target);
    },
    fittedCameraFrame() {
      counters.frameFits++;
      return { position: new THREE.Vector3(31, 42, 53), target: new THREE.Vector3(0, 0, 0) };
    },
    unfoldCameraTransition: null
  });
  vm.runInContext([
    'getPlaneLayout', 'updateUnfold', 'getRendererHost', 'onResize',
    'setTiledMode', 'setupToggle', 'bindControls', 'animate'
  ].map(functionSource).join('\n\n'), context);
  context.updateUnfold(0);
  context.bindControls();

  const cameraState = () => ({
    position: camera.position.toArray(), target: controls.target.toArray(),
    up: camera.up.toArray(), zoom: camera.zoom,
    quaternion: camera.quaternion.toArray(), fov: camera.fov
  });
  const planeState = () => Object.fromEntries(Object.entries(projPlanes).map(([view, plane]) => [view, {
    position: plane.position.toArray(), rotation: plane.rotation.toArray()
  }]));
  const click = (id = 'unfold-btn') => elements[id].dispatch('click');
  const space = () => {
    let prevented = false;
    documentEvents.dispatch('keydown', { code: 'Space', preventDefault() { prevented = true; } });
    return prevented;
  };
  const frameAt = time => {
    now = time;
    const callback = nextFrame || context.animate;
    nextFrame = undefined;
    callback();
    assert.equal(typeof nextFrame, 'function', 'the real animation loop must schedule its next frame');
  };
  return { context, state, camera, controls, counters, elements, renderer, cameraState, planeState, click, space, frameAt };
}

function assertCameraUnchanged(h, expected) {
  assert.deepEqual(h.cameraState(), expected, 'folding or resizing must preserve the observer camera');
  assert.equal(h.counters.fits, 0, 'no automatic camera fit is allowed');
  assert.equal(h.counters.frameFits, 0, 'no unfolded camera destination is allowed');
}

test('desktop click unfolds and Space folds the real projection planes without moving the camera', () => {
  const h = harness();
  const observer = h.cameraState();
  const wrapped = h.planeState();
  h.click();
  assert.equal(h.state.isUnfolded, true);
  assertCameraUnchanged(h, observer);
  for (const time of [0, 190, 380, 570, 760]) {
    h.frameAt(time);
    assertCameraUnchanged(h, observer);
  }
  assert.equal(h.state.unfoldProgress, 1);
  assert.equal(h.state.transitionActive, false);
  assert.equal(h.elements.viewport.dataset.projectionState, 'unfolded');
  const opened = h.planeState();
  assert.deepEqual(opened.front, wrapped.front, 'the front plane remains fixed');
  assert.notDeepEqual(opened.top, wrapped.top, 'the top plane must actually unfold');
  assert.notDeepEqual(opened.side, wrapped.side, 'the side plane must actually unfold');
  for (const id of ['unfold-btn', 'unfold-btn-mobile', 'mobile-unfold-fab']) {
    assert.equal(h.elements[id].getAttribute('aria-pressed'), 'true');
  }

  assert.equal(h.space(), true);
  assert.equal(h.state.isUnfolded, false);
  for (const time of [760, 950, 1140, 1330, 1520]) {
    h.frameAt(time);
    assertCameraUnchanged(h, observer);
  }
  assert.equal(h.state.unfoldProgress, 0);
  assert.deepEqual(h.planeState(), wrapped);
  assert.equal(h.elements.viewport.dataset.projectionState, 'wrapped');
  assert.equal(h.counters.renders, 10);
});

test('mobile controls can reverse an unfolding animation continuously and preserve a custom view', () => {
  const h = harness();
  const observer = h.cameraState();
  const wrapped = h.planeState();
  h.click('unfold-btn-mobile');
  h.frameAt(304);
  const progressBeforeReverse = h.state.unfoldProgress;
  const planesBeforeReverse = h.planeState();
  assert.ok(progressBeforeReverse > 0 && progressBeforeReverse < 1);
  assertCameraUnchanged(h, observer);

  h.click('mobile-unfold-fab');
  assert.equal(h.state.transitionFrom, progressBeforeReverse);
  assert.equal(h.state.transitionTo, 0);
  assert.deepEqual(h.planeState(), planesBeforeReverse, 'reversing must not jump the planes');
  h.frameAt(304);
  assert.equal(h.state.unfoldProgress, progressBeforeReverse);
  h.frameAt(684);
  assert.ok(h.state.unfoldProgress > 0 && h.state.unfoldProgress < progressBeforeReverse);
  assertCameraUnchanged(h, observer);
  h.frameAt(1064);
  assert.equal(h.state.unfoldProgress, 0);
  assert.deepEqual(h.planeState(), wrapped);
  assertCameraUnchanged(h, observer);
});

test('resize changes the viewport aspect but preserves position, target, up, zoom and orientation', () => {
  const h = harness();
  const observer = h.cameraState();
  for (const [width, height] of [[900, 900], [1600, 700]]) {
    h.elements.viewport.clientWidth = width;
    h.elements.viewport.clientHeight = height;
    h.context.onResize();
    assert.equal(h.camera.aspect, width / height);
    assert.deepEqual(h.renderer.size, [width, height]);
    assertCameraUnchanged(h, observer);
  }
  h.click();
  h.frameAt(380);
  const intermediatePlanes = h.planeState();
  h.elements.viewport.clientWidth = 820;
  h.elements.viewport.clientHeight = 600;
  h.context.onResize();
  assert.deepEqual(h.planeState(), intermediatePlanes);
  assertCameraUnchanged(h, observer);
  h.frameAt(760);
  h.context.onResize();
  assert.equal(h.state.unfoldProgress, 1);
  assertCameraUnchanged(h, observer);
});

test('entering or leaving tiled mode and unfolding from it preserve the observer camera', () => {
  const h = harness();
  const observer = h.cameraState();
  h.context.setTiledMode(true);
  assert.equal(h.state.isTiled, true);
  assert.deepEqual(h.renderer.size, [640, 800]);
  assertCameraUnchanged(h, observer);
  h.context.setTiledMode(false);
  assert.equal(h.state.isTiled, false);
  assertCameraUnchanged(h, observer);

  h.context.setTiledMode(true);
  h.click();
  assert.equal(h.state.isTiled, false);
  assert.equal(h.state.transitionTo, 1);
  for (const time of [380, 760]) {
    h.frameAt(time);
    assertCameraUnchanged(h, observer);
  }
  assert.equal(h.state.unfoldProgress, 1);
  assert.equal(h.elements.viewport.dataset.projectionState, 'unfolded');
  assert.ok(h.counters.mounts >= 4);
});

test('the executed initial state hides axes, projection guides and center lines independently of hidden edges', () => {
  const h = harness();
  assert.equal(h.state.showAxes, false);
  assert.equal(h.state.showProjLines, false);
  assert.equal(h.state.showCenterLines, false);
  assert.equal(h.state.showHidden, true);
  assert.equal(h.context.projLinesGroup.visible, false);
  for (const id of ['tog-axes', 'tog-projlines', 'tog-centers']) {
    assert.equal(h.elements[id].getAttribute('aria-pressed'), 'false');
  }
  assert.equal(h.elements['tog-hidden'].getAttribute('aria-pressed'), 'true');
});

test('real desktop/mobile center-line and hidden-edge controls update only their own state', () => {
  const h = harness();
  h.click('tog-centers');
  assert.equal(h.state.showCenterLines, true);
  assert.equal(h.state.showHidden, true);
  assert.equal(h.elements['tog-centers-m'].getAttribute('aria-pressed'), 'true');
  h.click('tog-hidden-m');
  assert.equal(h.state.showHidden, false);
  assert.equal(h.state.showCenterLines, true);
  assert.equal(h.elements['tog-hidden'].getAttribute('aria-pressed'), 'false');
  h.click('tog-centers-m');
  assert.equal(h.state.showCenterLines, false);
  assert.equal(h.state.showHidden, false);
  h.click('tog-hidden');
  assert.equal(h.state.showHidden, true);
  assert.equal(h.state.showCenterLines, false);
  assert.equal(h.counters.projections, 4, 'each independent setting must redraw projections');
});

test('projection-guide control restores actual group visibility after its default-off state', () => {
  const h = harness();
  assert.equal(h.context.projLinesGroup.visible, false);
  h.click('tog-projlines');
  assert.equal(h.state.showProjLines, true);
  assert.equal(h.context.projLinesGroup.visible, true);
  assert.ok(h.context.projLinesGroup.children.length > 0, 'enabled guides are generated');
  h.click('tog-projlines-m');
  assert.equal(h.state.showProjLines, false);
  assert.equal(h.context.projLinesGroup.visible, false);
  assert.equal(h.context.projLinesGroup.children.length, 0);
  h.click('tog-projlines-m');
  assert.equal(h.context.projLinesGroup.visible, true);
  h.context.setTiledMode(true);
  assert.equal(h.context.projLinesGroup.visible, false);
  h.context.setTiledMode(false);
  h.context.updateUnfold(0);
  assert.equal(h.context.projLinesGroup.visible, true);
  h.state.mode = 'compound';
  h.context.updateUnfold(0);
  assert.equal(h.context.projLinesGroup.visible, false, 'exploration guides do not leak into other teaching modes');
});

function geometryHarness() {
  const h = harness();
  const bounds = new THREE.Box3(new THREE.Vector3(5, 2, -3), new THREE.Vector3(9, 8, 1));
  h.context.MODELS = { ...BRIDGE_MODELS, ...DETAILED_BRIDGE_MODELS };
  h.context.BRIDGE_MODELS = BRIDGE_MODELS;
  h.context.DETAILED_BRIDGE_MODELS = DETAILED_BRIDGE_MODELS;
  h.context.selectedComponent = null;
  h.context.getModelBounds = () => bounds.clone();
  h.context.axisLabels = [];
  h.context.addAxisLabel = (label, color, position) => h.context.axisLabels.push({ label, color, position });
  vm.runInContext(['computeCenterLines', 'buildAxes'].map(functionSource).join('\n\n'), h.context);
  return { ...h, bounds };
}

function approximatelyEqualVector(actual, expected, message) {
  assert.ok(actual.distanceTo(new THREE.Vector3(...expected)) < 1e-10,
    `${message}: got ${actual.toArray()}, expected ${expected}`);
}

test('all current bridge definitions and unannotated selected parts produce no guessed center line', () => {
  const h = geometryHarness();
  assert.ok(Object.keys(h.context.MODELS).length >= 23);
  for (const modelId of Object.keys(h.context.MODELS)) {
    h.state.currentModel = modelId;
    assert.equal(h.context.computeCenterLines(h.bounds).length, 0, modelId);
  }
  h.state.currentModel = 'imported';
  assert.equal(h.context.computeCenterLines(h.bounds).length, 0);
  h.context.MODELS.fixture = { centerAxes: [{ from: [0, 0, 0], to: [0, 2, 0] }] };
  h.state.currentModel = 'fixture';
  h.context.selectedComponent = new THREE.Object3D();
  h.context.selectedComponent.position.set(20, 3, -8);
  assert.equal(h.context.computeCenterLines(h.bounds).length, 0,
    'a selected part without feature metadata must not inherit the assembly axis');
});

test('explicit selected-part axes follow both component and parent translation, rotation and scale', () => {
  const h = geometryHarness();
  const parent = new THREE.Group();
  parent.position.set(10, 4, -3);
  parent.rotation.z = Math.PI / 2;
  parent.scale.set(2, 3, 1);
  const part = new THREE.Object3D();
  part.position.set(2, 1, 5);
  part.rotation.z = Math.PI / 2;
  part.scale.set(2, 1, 1);
  part.userData.centerAxes = [{ from: [-1, 0, 0], to: [1, 0, 0] }];
  parent.add(part);
  h.context.selectedComponent = part;
  const segments = h.context.computeCenterLines(h.bounds);
  assert.equal(segments.length, 1);
  // The transformed feature runs from (13,8,2) to (1,8,2), with 0.48
  // world-unit extensions from the six-unit bounding extent.
  approximatelyEqualVector(segments[0][0], [13.48, 8, 2], 'transformed first endpoint');
  approximatelyEqualVector(segments[0][1], [0.52, 8, 2], 'transformed second endpoint');
});

test('bridge axis arrows use engineering X longitudinal, Y transverse and Z up after mapping', () => {
  const h = geometryHarness();
  const cases = [
    ['beamBridge', [[1, 0, 0], [0, 0, -1], [0, 1, 0]]],
    ['drawing_bago', [[1, 0, 0], [0, 0, -1], [0, 1, 0]]],
    ['step', [[1, 0, 0], [0, 1, 0], [0, 0, 1]]]
  ];
  for (const [modelId, directions] of cases) {
    h.state.currentModel = modelId;
    h.context.axisLabels.length = 0;
    h.context.buildAxes();
    const arrows = h.context.axesGroup.children;
    assert.equal(arrows.length, 3);
    assert.deepEqual(h.context.axisLabels.map(entry => entry.label), ['X', 'Y', 'Z']);
    arrows.forEach((arrow, index) => {
      const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(arrow.quaternion);
      approximatelyEqualVector(direction, directions[index], `${modelId} ${'XYZ'[index]} direction`);
      assert.ok(arrow.position.x < h.bounds.min.x, 'axis origin is outside the model in X');
      assert.ok(arrow.position.z > h.bounds.max.z, 'axis origin is outside the model in depth');
    });
    assert.equal(h.context.axesGroup.visible, false, 'axes remain opt-in after rebuilding');
  }
});
