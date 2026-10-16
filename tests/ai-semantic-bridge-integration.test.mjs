import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { BRIDGE_MODELS, buildTextbookBridge, bridgePointToThree } from '../bridge-models.js';
import { applyGeometryVariation, geometryVariationVector } from '../ai-geometry-variation.js';
import { createAiWorkbenchAdapter } from '../ai-workbench-adapter.js';
import { collectModelFacts } from '../ai-model-facts.js';
import { createDrawingStyle, centerlineSegments } from '../drawing-style.js';

const source = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');
function productionFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `production function ${name} exists`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `${name} has a top-level closing brace`);
  return source.slice(start, end + 2);
}
const viewStart = source.indexOf('const VIEW = {');
const views = new Function('THREE', `${source.slice(viewStart, source.indexOf('\n};', viewStart) + 3)}\nreturn VIEW;`)(THREE);
const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const vectorNear = (a, b, tolerance) => a.toArray().forEach((value, axis) => near(value, b.getComponent(axis), tolerance));
const box = root => new THREE.Box3().setFromObject(root, true);
const part = (root, id) => root.children.find(child => child.userData.component_id === id);
function dispose(root) {
  const resources = new Set();
  root.traverse(node => { if (node.geometry) resources.add(node.geometry); [].concat(node.material || []).forEach(material => resources.add(material)); });
  resources.forEach(resource => resource.dispose());
}

// Execute the production rebuild/clearance/projection-scene chain. Only browser
// UI, floor decoration and GPU rasterization are substituted. Actual Three.js
// meshes, world matrices, projection occluders and visible/hidden edges are used.
function harness(t, modelId = 'cableStayedFan', unfoldProgress = 0.63) {
  const state = {
    mode: 'explore', currentModel: modelId, importedGeometry: null, importedName: '',
    planeSize: 7, planeGap: 0.5, showProjLines: false, showHidden: true, showCenterLines: false,
    isTiled: false, isUnfolded: unfoldProgress > 0, unfoldProgress,
    transitionActive: true, transitionFrom: 0, transitionTo: 1, transparentModel: false
  };
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 100);
  const controls = { target: new THREE.Vector3(0.2, 0.7, -0.3) };
  camera.position.set(6, 4, 10); camera.zoom = 1.2; camera.lookAt(controls.target);
  let rasterCalls = 0, status = '';
  const deps = {
    THREE, LineMaterial, LineSegments2, LineSegmentsGeometry, createDrawingStyle, centerlineSegments, state, camera, controls,
    MODELS: BRIDGE_MODELS, TEXTBOOK_MECHANICAL_MODELS: {}, modelVariations: new Map(), modelRevision: 0,
    modelGroup: new THREE.Group(), focusGroup: new THREE.Group(), projectionGroup: new THREE.Group(), projLinesGroup: new THREE.Group(),
    projScene: new THREE.Scene(), projPlanes: {}, _projDisposables: [], selectedComponent: null,
    selectedComponentOriginalMaterial: null, focusBox: null, compoundController: null,
    PROJ_BG: 0xffffff, PROJ_RES: 1024, EDGE_THRESHOLD: 25, COL: { cyan: 0x64aabc },
    viewport: { dataset: {} }, applyGeometryVariation, geometryVariationVector,
    ensureProjResources() {}, buildFloorReference() {}, buildAxes() {},
    restoreComponentHighlight() {}, updateComponentInfo() {}, updateModelTransparency() {}, updateModelSource() {},
    makeProjectionMaterial: () => new THREE.MeshBasicMaterial(),
    setStatus(value) { status = value; },
    renderProjViews() { rasterCalls += 1; },
    fitModelCamera() { assert.fail('AI rebuild must not fit or reset the observer camera'); }
  };
  const names = ['clearGroup', 'makeSilhouetteMaterial', 'clearProjScene', 'getProjBounds', 'buildProjScene', 'drawProjections',
    'isVisibleInHierarchy', 'isProjectionMesh', 'getModelBounds', 'getPlaneLayout', 'createProjectionPlanes', 'updateUnfold', 'applyClearance', 'rebuildModel'];
  const production = new Function('deps', `with (deps) { ${names.map(productionFunction).join('\n')}\nreturn { rebuildModel, getModelBounds, getPlaneLayout, clearProjScene, buildProjScene }; }`)(deps);
  const writes = [];
  const adapter = createAiWorkbenchAdapter({
    getMode: () => state.mode, getModelId: () => state.currentModel,
    getModelLabel: () => BRIDGE_MODELS[state.currentModel]?.name || '当前模型',
    getRevision: () => deps.modelRevision, getCompound: () => null,
    getVariation: id => deps.modelVariations.get(id),
    setVariation: (id, values) => { writes.push({ id, values: { ...values } }); deps.modelVariations.set(id, { ...values }); },
    getEditContext: (id, values) => BRIDGE_MODELS[id]?.editContext?.(values),
    getFacts: () => collectModelFacts({ modelRoot: deps.modelGroup, modelId: state.currentModel, label: BRIDGE_MODELS[state.currentModel]?.name, mode: state.mode }),
    rebuild: production.rebuildModel
  });
  production.rebuildModel();
  t.after(() => {
    production.clearProjScene();
    [deps.modelGroup, deps.focusGroup, deps.projectionGroup, deps.projLinesGroup].forEach(dispose);
  });
  return { deps, state, camera, controls, adapter, production, writes,
    get root() { return deps.modelGroup.children[0]; }, get rasterCalls() { return rasterCalls; }, get status() { return status; } };
}

const plan = (h, changes) => ({ targetId: h.adapter.getContext().targetId, summary: '组合修改当前桥梁的具体构件。', changes });
const viewState = h => ({
  position: h.camera.position.toArray(), quaternion: h.camera.quaternion.toArray(), up: h.camera.up.toArray(), zoom: h.camera.zoom,
  target: h.controls.target.toArray(), isUnfolded: h.state.isUnfolded, unfoldProgress: h.state.unfoldProgress,
  transitionActive: h.state.transitionActive, transitionFrom: h.state.transitionFrom, transitionTo: h.state.transitionTo
});

function checkProductionProjection(h, ids) {
  const occluders = h.deps.projScene.children.filter(node => node.isMesh && node.renderOrder === 1);
  const visibleEdges = h.deps.projScene.children.filter(node => node.isLineSegments2 && node.renderOrder === 3);
  assert.equal(occluders.length, h.root.children.length);
  assert.equal(visibleEdges.length, h.root.children.length);
  const cameras = Object.fromEntries(Object.entries(views).map(([key, orientation]) => {
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.01, 400);
    camera.up.copy(orientation.up); camera.position.copy(orientation.eye).multiplyScalar(100); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
    return [key, camera];
  }));
  const samples = {};
  for (const id of ids) {
    const index = h.root.children.findIndex(node => node.userData.component_id === id);
    assert.ok(index >= 0, `actual source mesh ${id}`);
    const mesh = h.root.children[index], projected = occluders[index].geometry.attributes.position;
    const sourcePosition = mesh.geometry.attributes.position;
    assert.equal(projected.count, sourcePosition.count);
    for (const vertex of [0, Math.floor(sourcePosition.count / 2), sourcePosition.count - 1]) {
      const actual = new THREE.Vector3().fromBufferAttribute(projected, vertex);
      const expected = new THREE.Vector3().fromBufferAttribute(sourcePosition, vertex).applyMatrix4(mesh.matrixWorld);
      vectorNear(actual, expected);
      const front = actual.clone().project(cameras.front), top = actual.clone().project(cameras.top), side = actual.clone().project(cameras.side);
      near(front.x, top.x); near(front.y, side.y);
    }
    const edge = visibleEdges[index].geometry;
    const worldGeometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), expected = new THREE.EdgesGeometry(worldGeometry, 25);
    assert.equal(edge.attributes.instanceStart.count * 2, expected.attributes.position.count);
    for (let i = 0; i < edge.attributes.instanceStart.count; i++) {
      vectorNear(new THREE.Vector3().fromBufferAttribute(edge.attributes.instanceStart, i), new THREE.Vector3().fromBufferAttribute(expected.attributes.position, i * 2));
      vectorNear(new THREE.Vector3().fromBufferAttribute(edge.attributes.instanceEnd, i), new THREE.Vector3().fromBufferAttribute(expected.attributes.position, i * 2 + 1));
    }
    samples[id] = [...projected.array];
    expected.dispose(); worldGeometry.dispose();
  }
  return samples;
}

test('actual bridge roots retain one physical display scale, including a changed first build', () => {
  for (const id of ['stayed_fan', 'stayed_harp']) {
    const changed = buildTextbookBridge(id, { mainSpan: 144 });
    const original = buildTextbookBridge(id);
    const originalSize = box(original).getSize(new THREE.Vector3()), changedSize = box(changed).getSize(new THREE.Vector3());
    near(changed.scale.x, original.scale.x, 1e-12); near(changed.scale.y, changed.scale.z, 1e-12);
    near(changedSize.x - originalSize.x, 96 * original.scale.x);
    assert.ok(changedSize.x > originalSize.x * 1.4, 'new span is not normalized back to old visible length');
    near(changedSize.y, originalSize.y); near(changedSize.z, originalSize.z);
    near(part(changed, 'deck-000').geometry.parameters.height, 0.18, 1e-12);
    dispose(original); dispose(changed);
  }
});

for (const modelId of ['cableStayedFan', 'cableStayedHarp']) {
  test(`${modelId}: combined width, tower height and cable count reach real meshes and all projection edges`, t => {
    const h = harness(t, modelId), context = h.adapter.getContext();
    assert.deepEqual(context.parameters.map(parameter => parameter.key), ['mainSpan', 'deckWidth', 'towerHeight', 'cablesPerSide']);
    assert.ok(context.parameters.every(parameter => parameter.unit !== '%'));
    const originalScale = h.root.scale.x, originalSize = box(h.root).getSize(new THREE.Vector3()), originalView = viewState(h), calls = h.rasterCalls;
    const old = checkProductionProjection(h, ['deck-000', 'comparison-tower--1--1', 'stay-comparison--1--1--1-1']);
    h.adapter.applyPlan(plan(h, [{ key: 'deckWidth', value: 12 }, { key: 'towerHeight', value: 35 }, { key: 'cablesPerSide', value: 9 }]));
    const current = checkProductionProjection(h, ['deck-000', 'comparison-tower--1--1', 'stay-comparison--1--1--1-1', 'stay-comparison--1--1--1-9']);
    assert.equal(h.root.name, `textbook-bridge:${BRIDGE_MODELS[modelId].sourceId}`);
    assert.deepEqual(h.state.geometryVariationFactors, [1, 1, 1]);
    near(h.root.scale.x, originalScale, 1e-12);
    const size = box(h.root).getSize(new THREE.Vector3());
    near(size.x, originalSize.x); near(size.y - originalSize.y, 7 * originalScale); near(size.z - originalSize.z, 4 * originalScale);
    assert.equal(h.root.children.filter(mesh => mesh.name === 'stay_cable').length, 72);
    for (const id of Object.keys(old)) assert.notDeepEqual(current[id], old[id], `${id} projection vertices really change`);
    const tower = part(h.root, 'comparison-tower--1--1'), anchor = part(h.root, 'stay-comparison--1--1--1-9-tower-anchor');
    near(tower.geometry.parameters.radiusTop, 0.62, 1e-12); near(anchor.geometry.parameters.width, 0.4, 1e-12);
    assert.equal(h.rasterCalls, calls + 1); assert.deepEqual(viewState(h), originalView);
    assert.match(h.status, /三视图由当前构件重绘/);
    assert.ok(h.adapter.getContext().modelFacts.components.some(component => component.count === 72), 'AI facts reflect regenerated cable inventory');
  });
}

test('a real apply and undo preserve camera and folded, moving and unfolded plane states', t => {
  for (const progress of [0, 0.63, 1]) {
    const h = harness(t, 'cableStayedFan', progress), originalView = viewState(h), originalBox = box(h.root), originalContext = h.adapter.getContext();
    const planeRotations = Object.fromEntries(Object.entries(h.deps.projPlanes).map(([key, plane]) => [key, plane.rotation.toArray()]));
    const originalEdges = checkProductionProjection(h, ['deck-000', 'comparison-tower--1--1']);
    const handle = h.adapter.applyPlan(plan(h, [{ key: 'mainSpan', value: 120 }, { key: 'deckWidth', value: 14 }]));
    assert.deepEqual(viewState(h), originalView);
    for (const [key, plane] of Object.entries(h.deps.projPlanes)) assert.deepEqual(plane.rotation.toArray(), planeRotations[key]);
    const after = h.adapter.getContext(); assert.notEqual(after.targetId, originalContext.targetId);
    assert.equal(handle.targetId, after.targetId);
    handle.restore();
    vectorNear(box(h.root).min, originalBox.min); vectorNear(box(h.root).max, originalBox.max);
    assert.deepEqual(checkProductionProjection(h, ['deck-000', 'comparison-tower--1--1']), originalEdges);
    assert.deepEqual(viewState(h), originalView);
    assert.deepEqual(h.deps.modelVariations.get('cableStayedFan'), {});
    assert.throws(() => handle.restore(), /模型或步骤已变化/);
  }
});

test('stale plans and obsolete undo cannot modify a different bridge or a newer physical model', t => {
  const h = harness(t), stale = plan(h, [{ key: 'deckWidth', value: 12 }]);
  const handle = h.adapter.applyPlan(plan(h, [{ key: 'towerHeight', value: 35 }]));
  const calls = h.rasterCalls;
  assert.throws(() => h.adapter.applyPlan(stale)); assert.equal(h.rasterCalls, calls);
  h.adapter.applyPlan(plan(h, [{ key: 'cablesPerSide', value: 8 }]));
  assert.throws(() => handle.restore());
  const current = plan(h, [{ key: 'deckWidth', value: 14 }]);
  h.state.currentModel = 'cableStayedHarp'; h.production.rebuildModel();
  const writes = h.writes.length;
  assert.throws(() => h.adapter.applyPlan(current)); assert.equal(h.writes.length, writes);
  assert.equal(h.root.userData.sourceModel.parameters.deckWidth, 8);
  assert.equal(h.root.userData.sourceModel.parameters.cablesPerSide, 7);
});

test('mesh endpoints and regenerated source anchors share the complete Three.js world transform', t => {
  const h = harness(t, 'cableStayedHarp');
  h.adapter.applyPlan(plan(h, [{ key: 'mainSpan', value: 144 }, { key: 'deckWidth', value: 16 }, { key: 'towerHeight', value: 45 }, { key: 'cablesPerSide', value: 12 }]));
  for (const cable of h.root.children.filter(mesh => mesh.name === 'stay_cable')) {
    const [a, b] = cable.userData.sourcePart.points;
    const expectedA = bridgePointToThree(...a).applyMatrix4(h.root.matrixWorld), expectedB = bridgePointToThree(...b).applyMatrix4(h.root.matrixWorld);
    const halfLength = cable.geometry.parameters.height / 2;
    const endpointA = new THREE.Vector3(0, -halfLength, 0).applyMatrix4(cable.matrixWorld), endpointB = new THREE.Vector3(0, halfLength, 0).applyMatrix4(cable.matrixWorld);
    vectorNear(endpointA, expectedA); vectorNear(endpointB, expectedB);
    vectorNear(part(h.root, `${cable.userData.component_id}-deck-anchor`).getWorldPosition(new THREE.Vector3()), expectedA);
    vectorNear(part(h.root, `${cable.userData.component_id}-tower-anchor`).getWorldPosition(new THREE.Vector3()), expectedB);
  }
  checkProductionProjection(h, ['stay-comparison-1-1-1-12', 'deck-095', 'comparison-tower-1-1']);
});

test('exact visible outlines paint over coincident hidden edges in one render queue', t => {
  const h = harness(t);
  const segment = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)]);
  for (const style of ['visible', 'hidden']) {
    const guide = new THREE.LineSegments(segment.clone(), new THREE.LineBasicMaterial({ visible: false }));
    guide.userData = { projectionGuide: true, projectionViews: ['front'], projectionLineStyle: style };
    h.root.add(guide);
  }
  segment.dispose();
  h.production.buildProjScene();
  const visible = h.deps.projScene.children.find(node => node.renderOrder === 6);
  const hidden = h.deps.projScene.children.find(node => node.renderOrder === 5);
  assert.ok(visible && hidden);
  assert.equal(hidden.material.transparent, visible.material.transparent, 'both lines must sort in the same pass');
  assert.ok(visible.renderOrder > hidden.renderOrder, 'visible outlines take priority over coincident rear edges');
  assert.ok(visible.material.linewidth > hidden.material.linewidth);
  assert.equal(hidden.material.dashed, true, 'unoccluded internal hidden lines remain dashed');
});
