import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { makeBox } from 'replicad';
import { loadExactKernel } from './helpers/exact-kernel.mjs';
import {
  createExactSelectionCamera,
  createSelectionOverlayScene,
  isSelectionOccluder,
  renderSelectionOverlay
} from '../projection-selection-renderer.js';

function model() {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(0.3, 1.5, -0.2);
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, mesh };
}

function nearly(actual, expected, description) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${description}: ${actual} versus ${expected}`);
}

test('exact selection cameras map kernel points onto the SVG frame without mirroring', () => {
  const { root } = model();
  // Deliberately asymmetric frame and point reveal mirrored or swapped axes.
  const frames = { front: [-24, -36.7, 48, 38.7], side: [-18, -36.7, 36, 38.7], top: [-24, -12, 48, 36] };
  const kernelPoint = [12, -7, 23];
  const scenePoint = new THREE.Vector3(1.2, 2.3, 0.7);
  const svgPoint = { front: [12, -23], side: [7, -23], top: [12, 7] };
  for (const view of ['front', 'side', 'top']) {
    const frame = frames[view];
    const camera = createExactSelectionCamera({ view, frame, modelRoot: root });
    const point = scenePoint.clone().project(camera);
    const u = (point.x + 1) / 2;
    const v = (1 - point.y) / 2;
    nearly(u, (svgPoint[view][0] - frame[0]) / frame[2], `${view} horizontal`);
    nearly(v, (svgPoint[view][1] - frame[1]) / frame[3], `${view} vertical`);
    assert.ok(point.z > -1 && point.z < 1, `${view} has a valid depth for kernel point ${kernelPoint}`);
  }
});

test('exact cameras use correct front, left and top depth ordering', () => {
  const { root } = model();
  const pairs = {
    front: [new THREE.Vector3(0, 1, 1), new THREE.Vector3(0, 1, -1)],
    side: [new THREE.Vector3(-1, 1, 0), new THREE.Vector3(1, 1, 0)],
    top: [new THREE.Vector3(0, 3, 0), new THREE.Vector3(0, 0, 0)]
  };
  for (const view of ['front', 'side', 'top']) {
    const camera = createExactSelectionCamera({ view, frame: [-30, -40, 60, 50], modelRoot: root });
    const [near, far] = pairs[view].map(point => point.project(camera).z);
    assert.ok(near < far, `${view}: visible surfaces must win the depth test`);
  }
});

test('selection frame agrees with actual OpenCascade HLR for an asymmetrically placed solid', async () => {
  const kernel = await loadExactKernel();
  const shape = makeBox([10, -9, 20], [14, -5, 26]);
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.4), new THREE.MeshBasicMaterial());
  mesh.position.set(1.2, 2.3, 0.7);
  root.add(mesh);
  const corners = [];
  for (const x of [1, 1.4]) for (const y of [2, 2.6]) for (const z of [0.5, 0.9]) {
    corners.push(new THREE.Vector3(x, y, z));
  }
  for (const [view, sheetView, plane] of [['front', 'front', 'front'], ['side', 'right', 'right'], ['top', 'top', 'bottom']]) {
    const projection = kernel.projection(shape, sheetView, plane, 'example-5-1');
    const camera = createExactSelectionCamera({ view, frame: projection.frame, modelRoot: root });
    const svgPoints = projection.visiblePathData.flatMap(path => {
      const values = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi).map(Number);
      return Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]]);
    });
    const projected = corners.map(point => {
      const ndc = point.clone().project(camera);
      return [
        projection.frame[0] + (ndc.x + 1) * projection.frame[2] / 2,
        projection.frame[1] + (1 - ndc.y) * projection.frame[3] / 2
      ];
    });
    for (const axis of [0, 1]) {
      nearly(Math.min(...projected.map(point => point[axis])), Math.min(...svgPoints.map(point => point[axis])), `${view} minimum axis ${axis}`);
      nearly(Math.max(...projected.map(point => point[axis])), Math.max(...svgPoints.map(point => point[axis])), `${view} maximum axis ${axis}`);
    }
  }
});

test('depth buffer includes exact bodies but excludes cutters, helpers and invisible ancestors', () => {
  const { root, mesh } = model();
  mesh.userData.excludeFromProjection = true;
  mesh.userData.exactKernel = true;
  assert.equal(isSelectionOccluder(mesh), true);
  for (const flag of ['booleanTool', 'projectionSelectionOverlay', 'pickedPointMarker', 'projectionGuide']) {
    const helper = mesh.clone();
    helper.userData[flag] = true;
    root.add(helper);
    assert.equal(isSelectionOccluder(helper), false, flag);
  }
  const hiddenParent = new THREE.Group();
  hiddenParent.visible = false;
  const hiddenMesh = mesh.clone();
  hiddenParent.add(hiddenMesh);
  root.add(hiddenParent);
  assert.equal(isSelectionOccluder(hiddenMesh), false);
  const overlay = createSelectionOverlayScene({ modelRoot: root, selection: { object: mesh, geometry: mesh.geometry } });
  assert.equal(overlay.scene.children.filter(item => item.name === 'selection-occluder').length, 1);
  overlay.dispose();
});

test('selection preserves full-model occlusion and uses solid visible plus thin dashed hidden edges', () => {
  const { root, mesh } = model();
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  blocker.position.set(0, 1, 2);
  root.add(blocker);
  const overlay = createSelectionOverlayScene({ modelRoot: root, selection: { object: mesh, geometry: mesh.geometry }, width: 640, height: 480 });
  const named = name => overlay.scene.children.find(item => item.name === name);
  assert.equal(overlay.scene.children.filter(item => item.name === 'selection-occluder').length, 2);
  assert.equal(named('selection-occluder').material.colorWrite, false);
  assert.equal(named('selection-occluder').material.depthWrite, true);
  const visible = named('selection-visible-edges').material;
  const hidden = named('selection-hidden-edges').material;
  assert.equal(visible.depthTest, true);
  assert.equal(hidden.depthTest, true);
  assert.equal(visible.depthFunc, THREE.LessEqualDepth);
  assert.equal(hidden.depthFunc, THREE.GreaterDepth);
  assert.equal(visible.dashed, false);
  assert.equal(hidden.dashed, true);
  assert.equal(visible.linewidth, hidden.linewidth * 2);
  assert.deepEqual(visible.resolution.toArray(), [640, 480]);
  assert.equal(named('selection-visible-fill').material.depthWrite, false);
  assert.deepEqual(named('selection-visible-fill').matrix.toArray(), mesh.matrixWorld.toArray());
  overlay.dispose();
});

test('hidden-line toggle removes selected hidden edges without disposing caller geometry', () => {
  const { root, mesh } = model();
  const edges = new THREE.EdgesGeometry(mesh.geometry);
  let disposalCount = 0;
  mesh.geometry.addEventListener('dispose', () => disposalCount++);
  edges.addEventListener('dispose', () => disposalCount++);
  const overlay = createSelectionOverlayScene({
    modelRoot: root,
    selection: { object: mesh, geometry: mesh.geometry, edgeGeometry: edges },
    showHidden: false
  });
  assert.ok(!overlay.scene.children.some(item => item.name === 'selection-hidden-edges'));
  overlay.dispose();
  assert.equal(disposalCount, 0);
});

test('selection line weights and hidden pattern follow paper scale across image and model sizes', () => {
  const { root, mesh } = model();
  mesh.scale.set(3, 2, 0.5);
  const edges = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(2, 0, 0)]);
  for (const [resolution, span, bold] of [[512, 8, false], [1024, 16, false], [2048, 8, true]]) {
    const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2);
    const overlay = createSelectionOverlayScene({
      modelRoot: root, camera, selection: { object: mesh, geometry: mesh.geometry, edgeGeometry: edges },
      width: resolution, height: resolution, boldEdges: bold
    });
    const visible = overlay.scene.children.find(item => item.name === 'selection-visible-edges');
    const hidden = overlay.scene.children.find(item => item.name === 'selection-hidden-edges');
    nearly(visible.material.linewidth, (bold ? 0.7 : 0.5) * resolution / 160, 'paper-based line weight');
    nearly(hidden.material.linewidth, visible.material.linewidth / 2, 'hidden line is half width');
    nearly(hidden.material.dashSize, 3 * span / 160, '3 mm paper dash');
    nearly(hidden.material.gapSize, 1.5 * span / 160, '1.5 mm paper gap');
    const distances = hidden.geometry.getAttribute('instanceDistanceEnd');
    nearly(distances.getX(0), 6, 'nonuniform component scale is baked into line distances');
    assert.deepEqual(hidden.matrix.toArray(), new THREE.Matrix4().toArray());
    overlay.dispose();
  }
});

function fakeRenderer(pixelRatio = 1) {
  const state = {
    target: { name: 'original' }, viewport: new THREE.Vector4(9, 8, 700, 600),
    scissor: new THREE.Vector4(5, 4, 300, 200), scissorTest: true,
    clearColor: new THREE.Color(0x274265), clearAlpha: 0.8, clearCalls: [], depthClears: 0,
    currentViewport: new THREE.Vector4(0, 0, 700, 600),
    currentScissor: new THREE.Vector4(0, 0, 700, 600), currentScissorTest: false
  };
  return {
    state, autoClear: true, xr: { enabled: true },
    getPixelRatio: () => pixelRatio,
    getRenderTarget: () => state.target,
    getViewport: value => value.copy(state.viewport),
    getScissor: value => value.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    getClearColor: value => value.copy(state.clearColor),
    getClearAlpha: () => state.clearAlpha,
    setRenderTarget: target => {
      state.target = target;
      state.currentViewport.copy(target
        ? target.viewport || new THREE.Vector4(0, 0, target.width || 700, target.height || 600)
        : state.viewport.clone().multiplyScalar(pixelRatio).floor());
      state.currentScissor.copy(target
        ? target.scissor || state.currentViewport
        : state.scissor.clone().multiplyScalar(pixelRatio).floor());
      state.currentScissorTest = target ? Boolean(target.scissorTest) : state.scissorTest;
    },
    setViewport: (...args) => {
      state.viewport.copy(args[0]?.isVector4 ? args[0] : new THREE.Vector4(...args));
      state.currentViewport.copy(state.viewport).multiplyScalar(pixelRatio).floor();
    },
    setScissor: value => {
      state.scissor.copy(value);
      state.currentScissor.copy(value).multiplyScalar(pixelRatio).floor();
    },
    setScissorTest: value => { state.scissorTest = state.currentScissorTest = value; },
    setClearColor: (color, alpha) => { state.clearColor.set(color); state.clearAlpha = alpha; },
    clear: (...args) => state.clearCalls.push(args),
    clearDepth: () => { state.depthClears++; },
    render: () => {}
  };
}

test('overlay rendering preserves drawing color and restores renderer state even on failure', () => {
  const { root, mesh } = model();
  const renderer = fakeRenderer();
  const before = { target: renderer.state.target, viewport: renderer.state.viewport.clone(), scissor: renderer.state.scissor.clone(), color: renderer.state.clearColor.clone() };
  const camera = createExactSelectionCamera({ view: 'front', frame: [-24, -36, 48, 40], modelRoot: root });
  const cameraMatrix = camera.matrixWorld.clone();
  renderer.render = () => { throw new Error('Test render failure'); };
  assert.throws(() => renderSelectionOverlay({
    renderer, camera, target: { width: 1024, height: 1024 }, modelRoot: root,
    selection: { object: mesh, geometry: mesh.geometry }, clear: false
  }), /Test render failure/);
  assert.equal(renderer.state.target, before.target);
  assert.deepEqual(renderer.state.viewport, before.viewport);
  assert.deepEqual(renderer.state.scissor, before.scissor);
  assert.equal(renderer.state.scissorTest, true);
  assert.deepEqual(renderer.state.clearColor, before.color);
  assert.equal(renderer.state.clearAlpha, 0.8);
  assert.equal(renderer.autoClear, true);
  assert.equal(renderer.xr.enabled, true);
  assert.equal(renderer.state.depthClears, 1);
  assert.equal(renderer.state.clearCalls.length, 0, 'must retain the existing engineering drawing');
  assert.deepEqual(camera.matrixWorld, cameraMatrix, 'selection must never move the camera');
});

test('transparent mode clears only its overlay target and restores background settings', () => {
  const { root, mesh } = model();
  const renderer = fakeRenderer();
  const camera = createExactSelectionCamera({ view: 'top', frame: [-24, -18, 48, 36], modelRoot: root });
  renderer.render = () => {
    assert.equal(renderer.state.clearAlpha, 0);
    assert.equal(renderer.state.clearColor.getHex(), 0);
  };
  assert.equal(renderSelectionOverlay({
    renderer, camera, target: { width: 1024, height: 768 }, modelRoot: root,
    selection: { object: mesh, geometry: mesh.geometry }, clear: true
  }), true);
  assert.deepEqual(renderer.state.clearCalls, [[true, true, true]]);
  assert.equal(renderer.state.clearAlpha, 0.8);
});

test('offscreen selection uses target physical pixels at DPR 1.25 and 2 and restores the old target viewport', () => {
  const { root, mesh } = model();
  const camera = createExactSelectionCamera({ view: 'front', frame: [-24, -36, 48, 40], modelRoot: root });
  for (const pixelRatio of [1, 1.25, 2]) {
    const renderer = fakeRenderer(pixelRatio);
    const original = {
      viewport: new THREE.Vector4(4, 7, 320, 280),
      scissor: new THREE.Vector4(8, 9, 280, 240), scissorTest: true
    };
    renderer.setRenderTarget(original);
    const defaultViewport = renderer.state.viewport.clone();
    const defaultScissor = renderer.state.scissor.clone();
    const output = { width: 1024, height: 512, viewport: new THREE.Vector4(0, 0, 1024, 512) };
    renderer.render = () => {
      assert.deepEqual(renderer.state.currentViewport.toArray(), [0, 0, 1024, 512], `DPR ${pixelRatio} must not scale the texture viewport`);
      assert.equal(renderer.state.currentScissorTest, false);
    };
    renderSelectionOverlay({ renderer, camera, target: output, modelRoot: root,
      selection: { object: mesh, geometry: mesh.geometry } });
    assert.equal(renderer.state.target, original);
    assert.deepEqual(renderer.state.currentViewport, original.viewport, `DPR ${pixelRatio} restores target viewport after default viewport`);
    assert.deepEqual(renderer.state.currentScissor, original.scissor);
    assert.equal(renderer.state.currentScissorTest, true);
    assert.deepEqual(renderer.state.viewport, defaultViewport);
    assert.deepEqual(renderer.state.scissor, defaultScissor);
  }
});
