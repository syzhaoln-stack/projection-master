import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createFaceSelection, disposeFaceSelection, isVisibleModelMesh } from '../projection-selection.js';
import { createProjectionCameraTurn, sampleProjectionCameraTurn, isProjectionDrawingHit } from '../gallery-projection-camera.js';
import { captureGalleryHandoff, cameraFromGalleryHandoff } from '../model-gallery-room.js';

const source = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');
const names = ['captureProductState', 'applyProductState', 'setProductEnvironmentVisible', 'getRendererHost', 'mountRenderer',
  'onResize', 'inspectGalleryModel', 'leaveGalleryInspection', 'setGalleryView', 'zoomGalleryInspection',
  'fittedCameraFrame', 'fitModelCamera', 'setTiledMode', 'bindControls', 'animate',
  'bindFocusPicking', 'pointToSegmentDistance', 'findNearbyThinComponent', 'updateFocusMarker', 'cloneHighlightMaterial',
  'disposeMaterial', 'restoreComponentHighlight', 'setFocusComponent', 'clearFocus', 'isVisibleInHierarchy',
  'cancelGalleryProjectionTurn', 'startGalleryProjectionTurn', 'advanceGalleryProjectionTurn', 'pickGalleryProjectionPlane'];
function extract(name) {
  const expression = new RegExp(`(?:async )?function ${name}\\(`), match = expression.exec(source);
  assert.ok(match, `${name} must exist`);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
function fixture({ tiled = false, definitions = {}, failBuild = null } = {}) {
  let time = 0, dampingDelta = new THREE.Vector3();
  class Element {
    constructor(width = 1000, height = 650) {
      this.clientWidth = width; this.clientHeight = height; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.dataset = {};
      this.classList = { toggle() {}, add() {}, remove() {} };
    }
    prepend(child) { child.parentElement?.removeChild(child); this.children.unshift(child); child.parentElement = this; }
    insertBefore(child) { this.prepend(child); }
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentElement = null; }
    get firstChild() { return this.children[0] || null; }
    querySelector() { return null; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    click() { this.listeners.get('click')?.(); }
    getBoundingClientRect() { return this.rect || this.parentElement?.rect || { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  }
  const viewport = new Element(), pane = new Element(550, 650), inspectionHost = new Element(900, 700), canvas = new Element();
  inspectionHost.rect = { left: 230, top: 110, width: 900, height: 700 };
  (tiled ? pane : viewport).prepend(canvas);
  const unfold = new Element(), ids = new Map([['viewport', viewport], ['model-pane', pane], ['unfold-btn', unfold]]);
  const document = { getElementById: id => ids.get(id) || null, querySelectorAll: () => [], addEventListener() {} };
  const camera = new THREE.PerspectiveCamera(45, 1000 / 650, 0.05, 1000);
  camera.position.set(7.2, 8.4, -11.1); camera.up.set(0, 1, 0); camera.zoom = 1.3;
  const controls = { target: new THREE.Vector3(0.4, 1.3, -0.7), enabled: true, enableDamping: true, minDistance: 2.2, maxDistance: 120,
    update() {
      camera.position.addScaledVector(dampingDelta, this.enableDamping ? 0.07 : 1);
      if (this.enableDamping) dampingDelta.multiplyScalar(0.93); else dampingDelta.set(0, 0, 0);
      camera.lookAt(this.target);
    } };
  const renderer = { domElement: canvas, clearColor: new THREE.Color(0x123456), clearAlpha: 1,
    getClearColor(target) { return target.copy(this.clearColor); }, getClearAlpha() { return this.clearAlpha; },
    setClearColor(color, alpha) { this.clearColor.set(color); this.clearAlpha = alpha; }, setSize() {}, render() {} };
  const state = { currentModel: 'original', mode: 'explore', isTiled: tiled, showProjLines: true, showAxes: true, showHidden: false,
    showCenterLines: true, transparentModel: true, planeAlpha: 0.28, planeSize: 30, planeGap: 2.6, importedGeometry: null, importedName: '',
    isUnfolded: !tiled, unfoldProgress: tiled ? 0 : 1, transitionActive: false, transitionDuration: 760 };
  const groups = Object.fromEntries(['floorGroup', 'projectionGroup', 'modelGroup', 'axesGroup', 'projLinesGroup', 'focusGroup'].map(name => [name, new THREE.Group()]));
  groups.focusGroup.visible = false;
  if (tiled) { groups.projectionGroup.visible = false; groups.floorGroup.visible = false; groups.projLinesGroup.visible = false; }
  const originalBackground = new THREE.Color(0x354657), scene = new THREE.Scene(); scene.background = originalBackground;
  const observers = [], builds = [], updates = []; let projectionRedraws = 0;
  const env = { THREE, document, renderer, camera, controls, viewport, state, scene, ...groups, VIEWPORT_BG: 0xf3f6f9,
    modelLoadRequest: 0, galleryInspectionRequest: 0, galleryInspectionHost: null, galleryInspection: null, galleryProjectionTurn: null,
    createProjectionCameraTurn, sampleProjectionCameraTurn, isProjectionDrawingHit, cameraFromGalleryHandoff,
    VIEW: Object.fromEntries(['front', 'top', 'side'].map(view => [view, { flipX: false, flipY: false }])),
    projCams: Object.fromEntries(['front', 'top', 'side'].map(view => {
      const projectionCamera = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 100);
      projectionCamera.position.set(...(view === 'front' ? [0, 2, 30] : view === 'top' ? [0, 32, 0] : [-30, 2, 0]));
      if (view === 'top') projectionCamera.up.set(0, 0, -1);
      projectionCamera.lookAt(0, 2, 0); projectionCamera.updateMatrixWorld(true); return [view, projectionCamera];
    })),
    MODELS: { original: {}, a: {}, b: {}, ...definitions }, selectedComponent: null, selectedFaceIndex: null,
    selectedComponentOriginalMaterial: null, projectionSelection: null, createFaceSelection, disposeFaceSelection, isVisibleModelMesh,
    raycaster: new THREE.Raycaster(), EDGE_THRESHOLD: 24, COL: { amber: 0xf0b454 },
    getComponentInfo: name => ({ label: name, role: '实体面' }), updateComponentInfo() {}, handleBridgeTaskComponentSelection() {},
    clearGroup(group) { while (group.children.length) { const object = group.children[0]; object.geometry?.dispose(); object.material?.dispose(); group.remove(object); } },
    statusStrip: { textContent: '原工作台状态' }, bridgeTaskState: { active: true },
    projPlanes: { front: { visible: true }, top: { visible: true }, side: { visible: true } },
    getObjectPath: () => null, resolveObjectPath: () => null, captureBridgeTaskSnapshot: () => ({ active: true }),
    applyBridgeTaskSnapshot(snapshot) { env.bridgeTaskState.active = Boolean(snapshot.active); }, setFocusComponent() {},
    setStatus(value) { env.statusStrip.textContent = value; },
    rebuildModel() { if (env.state.currentModel === failBuild) throw new Error('scene construction failed'); builds.push(env.state.currentModel); },
    updateUnfold(value) { updates.push(value); },
    getModelBounds: () => new THREE.Box3(new THREE.Vector3(-2, 0, -1), new THREE.Vector3(2, 4, 1)),
    getPlaneLayout: () => ({ S: 30, front: { pos: new THREE.Vector3(0, 15, -4), rot: new THREE.Euler() },
      top: { pos: new THREE.Vector3(0, 0, 0), rot: new THREE.Euler(-Math.PI / 2, 0, 0) }, side: { pos: new THREE.Vector3(15, 15, 0), rot: new THREE.Euler(0, Math.PI / 2, 0) } }),
    drawProjections() { projectionRedraws++; }, updateViewMatchFeedback() {}, scheduleTiledProjectionRefresh() {}, setupToggle() {}, bindSlider() {},
    updateModelTransparency() {}, applyClearance() {}, performance: { now: () => time }, requestAnimationFrame() {},
    ResizeObserver: class { constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); } observe() { this.connected = true; } disconnect() { this.connected = false; } }
  };
  const api = new Function('env', `with(env){${names.map(extract).join('\n')};return {${names.join(',')}}}`)(env);
  // Supply the actual room's detached handoff contract, rather than masking the
  // inspection camera mapper with a replacement fit. Tests may override it.
  const inspect = api.inspectGalleryModel;
  api.inspectGalleryModel = args => {
    const handoffCamera = new THREE.PerspectiveCamera(45, args.host.clientWidth / args.host.clientHeight, 0.05, 1000);
    handoffCamera.position.set(9, 10, 14); handoffCamera.lookAt(0, 2, 0);
    const mount = new THREE.Group(); mount.position.set(0, 2, 0);
    const handoff = captureGalleryHandoff({ modelId: args.id, sourceCenter: new THREE.Vector3(0, 2, 0), sourceUnit: 1,
      mount, camera: handoffCamera, target: new THREE.Vector3(0, 2, 0), viewport: args.host.getBoundingClientRect() });
    return inspect({ handoff, ...args });
  };
  api.bindControls(); api.bindFocusPicking();
  return { api, env, camera, controls, state, renderer, viewport, pane, inspectionHost, canvas, builds, observers, updates, originalBackground,
    advance(ms) { time += ms; api.animate(); }, drift(vector) { dampingDelta.copy(vector); }, newHost: () => new Element(800, 700),
    get projectionRedraws() { return projectionRedraws; } };
}

test('taking a model reuses the main canvas and initially shows wrapped projections on a clean opaque background', async () => {
  const h = fixture();
  assert.deepEqual(await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost }), { viewMode: 'wrapped' });
  assert.equal(h.canvas.parentElement, h.inspectionHost); assert.deepEqual(h.inspectionHost.children, [h.canvas]); assert.equal(h.viewport.children.length, 0);
  assert.equal(h.env.projectionGroup.visible, true); assert.equal(h.env.floorGroup.visible, false);
  assert.equal(h.state.planeGap, 3, 'inspection spacing is temporary and does not change the saved workbench spacing');
  assert.equal(h.state.isUnfolded, false); assert.equal(h.state.currentModel, 'a'); assert.equal(h.renderer.clearAlpha, 1);
  assert.ok(h.env.scene.background?.isColor); assert.ok(h.camera.position.distanceTo(new THREE.Vector3(9, 10, 14)) < 1e-10, 'the first frame must retain the room handoff camera');
  assert.equal((source.match(/new THREE\.WebGLRenderer\(/g) || []).length, 1, 'inspection must reuse the workbench renderer');
  h.api.leaveGalleryInspection();
});

test('return restores model, pose, zoom, visibility and selection settings after orbit damping and zoom', async () => {
  const h = fixture(), original = h.api.captureProductState(), position = h.camera.position.clone(), target = h.controls.target.clone();
  const originalZoom = h.camera.zoom, visible = Object.values(h.env).filter(value => value?.isGroup).map(group => [group, group.visible]);
  await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  assert.equal(h.state.planeGap, 3); assert.notEqual(h.state.planeGap, original.planeGap);
  h.api.zoomGalleryInspection(1.5); h.camera.position.set(30, 15, 22); h.controls.target.set(3, 4, 5); h.drift(new THREE.Vector3(2, 3, 4));
  h.api.leaveGalleryInspection();
  assert.equal(h.state.currentModel, original.currentModel); assert.equal(h.state.isUnfolded, original.isUnfolded);
  for (const key of ['showProjLines', 'showAxes', 'showHidden', 'showCenterLines', 'transparentModel', 'planeAlpha', 'planeGap']) assert.equal(h.state[key], original[key], key);
  assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.ok(h.controls.target.distanceTo(target) < 1e-10); assert.equal(h.camera.zoom, originalZoom);
  assert.equal(h.env.scene.background, h.originalBackground); assert.equal(h.renderer.clearColor.getHex(), 0x123456); assert.equal(h.renderer.clearAlpha, 1);
  assert.ok(visible.every(([group, value]) => group.visible === value)); assert.ok(h.observers.every(observer => !observer.connected));
  assert.equal(h.canvas.parentElement, h.viewport); assert.equal(h.inspectionHost.children.length, 0);
  const count = h.builds.length; h.api.leaveGalleryInspection(); assert.equal(h.builds.length, count, 'leaving twice is harmless');
});

test('aborted pending load cannot replace or remount a newer workbench scene', async () => {
  const waiting = deferred(), controller = new AbortController();
  const h = fixture({ definitions: { a: { load: () => waiting.promise } } });
  const pending = h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost, signal: controller.signal });
  assert.equal(h.state.currentModel, 'original'); assert.equal(h.builds.length, 0);
  controller.abort(); h.api.leaveGalleryInspection(); h.state.currentModel = 'new-workbench'; h.env.modelLoadRequest++;
  waiting.resolve(); assert.equal(await pending, false);
  assert.equal(h.state.currentModel, 'new-workbench'); assert.equal(h.builds.length, 0); assert.equal(h.canvas.parentElement, h.viewport);
  assert.equal(h.env.galleryInspectionHost, null); assert.equal(h.env.galleryInspection, null);
});

test('a late earlier inspection cannot overwrite the current inspection or restore over it', async () => {
  const waiting = deferred(), h = fixture({ definitions: { a: { load: () => waiting.promise } } });
  const earlier = h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  const currentHost = h.newHost(); await h.api.inspectGalleryModel({ id: 'b', host: currentHost });
  waiting.resolve(); assert.equal(await earlier, false); assert.equal(h.state.currentModel, 'b'); assert.equal(h.canvas.parentElement, currentHost);
  assert.deepEqual(h.builds, ['b']); h.api.leaveGalleryInspection(); assert.equal(h.state.currentModel, 'original');
});

test('failed scene construction restores the previous workbench and leaves no active inspection observer', async () => {
  const h = fixture({ failBuild: 'a' }), position = h.camera.position.clone();
  await assert.rejects(h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost }), /scene construction failed/);
  assert.equal(h.state.currentModel, 'original'); assert.equal(h.env.galleryInspection, null); assert.equal(h.env.galleryInspectionHost, null);
  assert.equal(h.canvas.parentElement, h.viewport); assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.ok(h.observers.every(observer => !observer.connected));
});

test('solid, wrapped and unfolded states are explicit and every switch preserves the current camera', async () => {
  const h = fixture(); await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  const position = h.camera.position.clone(), target = h.controls.target.clone(), buildCount = h.builds.length;
  assert.equal(h.api.setGalleryView('unfolded'), 'unfolded'); assert.equal(h.env.projectionGroup.visible, true); assert.equal(h.state.transitionActive, true);
  h.advance(760); assert.equal(h.state.unfoldProgress, 1); assert.equal(h.state.transitionActive, false);
  assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.ok(h.controls.target.distanceTo(target) < 1e-10);
  assert.equal(h.api.setGalleryView('wrapped'), 'wrapped'); h.advance(380); assert.equal(h.env.projectionGroup.visible, true);
  h.advance(380); assert.equal(h.env.projectionGroup.visible, true, 'wrapped papers remain visible after merging'); assert.equal(h.state.unfoldProgress, 0);
  assert.equal(h.api.setGalleryView('solid'), 'solid'); assert.equal(h.env.projectionGroup.visible, false);
  assert.equal(h.api.setGalleryView('wrapped'), 'wrapped'); assert.equal(h.env.projectionGroup.visible, true); assert.equal(h.state.transitionActive, false);
  assert.equal(h.api.setGalleryView('unknown'), false); assert.equal(h.env.projectionGroup.visible, true);
  assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.equal(h.builds.length, buildCount); h.api.leaveGalleryInspection();
});

test('changing view during unfolding reaches the requested state without a late visibility change or camera reset', async () => {
  const h = fixture(); await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  const position = h.camera.position.clone(), target = h.controls.target.clone();
  h.api.setGalleryView('unfolded'); h.advance(300); assert.ok(h.state.unfoldProgress > 0 && h.state.unfoldProgress < 1);
  h.api.setGalleryView('solid'); h.advance(760); assert.equal(h.env.projectionGroup.visible, false);
  h.api.setGalleryView('wrapped'); h.advance(760); assert.equal(h.env.projectionGroup.visible, true); assert.equal(h.state.unfoldProgress, 0);
  assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.ok(h.controls.target.distanceTo(target) < 1e-10);
  h.api.leaveGalleryInspection();
});

test('the relocated canvas picks a real face using its own bounds and redraws highlights without reframing', async () => {
  const h = fixture(); await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  geometry.userData.faceGroups = geometry.groups.map((group, index) => ({ start: group.start, count: group.count, faceId: index + 1 }));
  const material = new THREE.MeshStandardMaterial(), body = new THREE.Mesh(geometry, material);
  body.name = 'textbook-body'; body.position.set(0, 2, 0); h.env.modelGroup.add(body); h.env.modelGroup.updateMatrixWorld(true); h.camera.updateMatrixWorld(true);
  const projected = body.position.clone().project(h.camera), rect = h.inspectionHost.rect;
  const point = { clientX: rect.left + (projected.x + 1) * rect.width / 2, clientY: rect.top + (1 - projected.y) * rect.height / 2 };
  const down = h.canvas.listeners.get('pointerdown'), up = h.canvas.listeners.get('pointerup');
  down(point); up({ ...point, clientX: point.clientX + 20 }); assert.equal(h.env.selectedComponent, null, 'orbit dragging must not select a face');
  const position = h.camera.position.clone(), target = h.controls.target.clone(), before = h.projectionRedraws;
  down(point); up(point);
  assert.equal(h.env.selectedComponent, body); assert.equal(h.env.projectionSelection.kind, 'face');
  assert.equal(h.env.projectionSelection.geometry.index.count, 6); assert.equal(h.env.focusGroup.children.length, 1);
  assert.equal(body.material, material); assert.equal(h.projectionRedraws, before + 1); assert.equal(h.env.modelGroup.children.length, 1);
  assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.ok(h.controls.target.distanceTo(target) < 1e-10);
  const blank = { clientX: rect.left + 2, clientY: rect.top + 2 }; down(blank); up(blank);
  assert.equal(h.env.selectedComponent, null); assert.equal(h.env.projectionSelection, null); assert.equal(h.env.focusGroup.children.length, 0);
  assert.equal(h.projectionRedraws, before + 2); h.api.leaveGalleryInspection(); geometry.dispose(); material.dispose();
});

test('return from inspection restores the original tiled canvas host with the same camera pose', async () => {
  const h = fixture({ tiled: true }), position = h.camera.position.clone();
  await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost }); assert.equal(h.state.isTiled, false);
  h.api.leaveGalleryInspection(); assert.equal(h.state.isTiled, true); assert.equal(h.canvas.parentElement, h.pane);
  assert.deepEqual(h.pane.children, [h.canvas]); assert.equal(h.inspectionHost.children.length, 0);
  assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.equal(h.env.projectionGroup.visible, false);
});

function addPaper(h, view) {
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  paper.position.set(0, 2, 0); paper.quaternion.copy(h.camera.quaternion);
  h.env.projPlanes[view] = paper; h.env.projectionGroup.add(paper); h.env.projectionGroup.updateMatrixWorld(true);
  return paper;
}

function pointerAt(h, object) {
  h.camera.updateMatrixWorld(true); object.updateWorldMatrix(true, false);
  const projected = object.getWorldPosition(new THREE.Vector3()).project(h.camera), rect = h.canvas.getBoundingClientRect();
  return { clientX: rect.left + (projected.x + 1) * rect.width / 2, clientY: rect.top + (1 - projected.y) * rect.height / 2, button: 0 };
}

function clickObject(h, object) {
  const point = pointerAt(h, object); h.canvas.listeners.get('pointerdown')(point); h.canvas.listeners.get('pointerup')(point);
}

for (const [view, direction] of [['front', [0, 0, 1]], ['top', [0, 1, 0.0001]], ['side', [-1, 0, 0]]]) {
  test(`clicking the ${view} paper uses the relocated canvas and turns smoothly toward the model`, async () => {
    const h = fixture(); await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
    const paper = addPaper(h, view), initial = h.camera.position.clone(), radius = h.camera.position.distanceTo(h.controls.target);
    clickObject(h, paper); assert.equal(h.env.galleryProjectionTurn?.turn.view, view);
    assert.ok(h.camera.position.distanceTo(initial) < 1e-10, 'the click itself cannot jump the camera');
    h.advance(225); assert.ok(h.camera.position.distanceTo(initial) > 0.01); assert.ok(h.env.galleryProjectionTurn);
    assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target) - radius) < 1e-10);
    h.advance(225); assert.equal(h.env.galleryProjectionTurn, null);
    assert.ok(h.controls.target.distanceTo(new THREE.Vector3(0, 2, 0)) < 1e-10);
    assert.ok(h.camera.position.clone().sub(h.controls.target).normalize().distanceTo(new THREE.Vector3(...direction).normalize()) < 1e-10);
    assert.ok(Math.abs(h.camera.position.distanceTo(h.controls.target) - radius) < 1e-10);
    assert.equal(h.state.isUnfolded, false, 'looking at a paper does not alter its wrapped state');
    h.api.leaveGalleryInspection(); paper.geometry.dispose(); paper.material.dispose();
  });
}

test('a mesh face wins over its overlapping projection paper and preserves face highlighting', async () => {
  const h = fixture(); await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  const paper = addPaper(h, 'side'), geometry = new THREE.BoxGeometry(2, 2, 2);
  geometry.userData.faceGroups = geometry.groups.map((group, index) => ({ start: group.start, count: group.count, faceId: index + 1 }));
  const body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); body.position.set(0, 2, 0); body.name = 'textbook-body';
  h.env.modelGroup.add(body); h.env.modelGroup.updateMatrixWorld(true);
  // Put the paper in front of the body: entity picking still deliberately wins.
  paper.position.lerp(h.camera.position, 0.12); paper.updateMatrixWorld(true);
  clickObject(h, body);
  assert.equal(h.env.selectedComponent, body); assert.equal(h.env.projectionSelection.kind, 'face'); assert.equal(h.env.galleryProjectionTurn, null);
  h.api.leaveGalleryInspection(); geometry.dispose(); body.material.dispose(); paper.geometry.dispose(); paper.material.dispose();
});

test('clicking blank paper outside the projected model clears the selected face without moving the camera', async () => {
  const h = fixture(); await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  const paper = addPaper(h, 'side'), geometry = new THREE.BoxGeometry(2, 2, 2);
  geometry.userData.faceGroups = geometry.groups.map((group, index) => ({ start: group.start, count: group.count, faceId: index + 1 }));
  const body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); body.position.set(0, 2, 0); body.name = 'textbook-body';
  h.env.modelGroup.add(body); h.env.modelGroup.updateMatrixWorld(true); h.api.setFocusComponent(body, 0);
  assert.equal(h.env.projectionSelection.kind, 'face');
  const blank = new THREE.Object3D(); blank.position.set(1.8, 1.8, 0); paper.add(blank);
  const position = h.camera.position.clone(), target = h.controls.target.clone(); clickObject(h, blank);
  assert.equal(h.env.galleryProjectionTurn, null); assert.equal(h.env.selectedComponent, null); assert.equal(h.env.projectionSelection, null);
  h.advance(500); assert.ok(h.camera.position.distanceTo(position) < 1e-10); assert.ok(h.controls.target.distanceTo(target) < 1e-10);
  h.api.leaveGalleryInspection(); geometry.dispose(); body.material.dispose(); paper.geometry.dispose(); paper.material.dispose();
});

test('dragging, wheel input, hidden papers and inspection changes cancel the camera turn', async () => {
  const h = fixture(); await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost });
  const paper = addPaper(h, 'side');
  for (const event of ['pointerdown', 'pointercancel', 'wheel']) {
    assert.equal(h.api.startGalleryProjectionTurn('side'), true); h.advance(90);
    const position = h.camera.position.clone();
    h.canvas.listeners.get(event)({ clientX: 50, clientY: 50 }); assert.equal(h.env.galleryProjectionTurn, null);
    h.advance(500); assert.ok(h.camera.position.distanceTo(position) < 1e-10, event);
  }
  const point = pointerAt(h, paper); h.canvas.listeners.get('pointerdown')(point);
  h.canvas.listeners.get('pointerup')({ ...point, clientX: point.clientX + 20 });
  assert.equal(h.env.galleryProjectionTurn, null, 'dragging across a paper must not snap into a view');
  assert.equal(h.api.startGalleryProjectionTurn('side'), true); h.api.setGalleryView('solid'); h.advance(10);
  assert.equal(h.env.galleryProjectionTurn, null); assert.equal(h.api.startGalleryProjectionTurn('front'), false);
  h.api.setGalleryView('wrapped'); assert.equal(h.api.startGalleryProjectionTurn('side'), true);
  h.api.leaveGalleryInspection(); const restored = h.camera.position.clone(); h.advance(500);
  assert.equal(h.env.galleryProjectionTurn, null); assert.ok(h.camera.position.distanceTo(restored) < 1e-10);
  await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost }); h.api.startGalleryProjectionTurn('front');
  await h.api.inspectGalleryModel({ id: 'b', host: h.inspectionHost }); const next = h.camera.position.clone(); h.advance(500);
  assert.equal(h.env.galleryProjectionTurn, null); assert.ok(h.camera.position.distanceTo(next) < 1e-10, 'a late turn cannot move a new model session');
  h.api.leaveGalleryInspection(); paper.geometry.dispose(); paper.material.dispose();
});

test('projection turning is gallery-only, ignores right clicks and yields to zoom/reset changes', async () => {
  const h = fixture(); assert.equal(h.api.startGalleryProjectionTurn('front'), false);
  await h.api.inspectGalleryModel({ id: 'a', host: h.inspectionHost }); const paper = addPaper(h, 'front');
  const point = { ...pointerAt(h, paper), button: 2 };
  h.canvas.listeners.get('pointerdown')(point); h.canvas.listeners.get('pointerup')(point); assert.equal(h.env.galleryProjectionTurn, null);
  h.api.startGalleryProjectionTurn('side'); h.advance(100); h.api.zoomGalleryInspection(1.25);
  const zoomed = h.camera.position.clone(); h.advance(500); assert.ok(h.camera.position.distanceTo(zoomed) < 1e-10); assert.equal(h.env.galleryProjectionTurn, null);
  h.api.startGalleryProjectionTurn('side'); h.controls.target.add(new THREE.Vector3(1, 0, 0));
  const manualTarget = h.controls.target.clone(); h.advance(500); assert.ok(h.controls.target.equals(manualTarget)); assert.equal(h.env.galleryProjectionTurn, null);
  h.api.leaveGalleryInspection(); paper.geometry.dispose(); paper.material.dispose();
});
