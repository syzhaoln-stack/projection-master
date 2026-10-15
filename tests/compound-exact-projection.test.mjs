import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { makeBox, measureVolume } from 'replicad';
import { loadExactKernel } from './helpers/exact-kernel.mjs';

const kernel = await loadExactKernel();
const controllerUrl = new URL('../compound-projection-lab.js', import.meta.url);
const controllerSource = (await readFile(controllerUrl, 'utf8')).replace(/from '([^']+)'/g, (_, specifier) => {
  const resolved = specifier === 'replicad-threejs-helper'
    ? new URL('../node_modules/replicad-threejs-helper/dist/es/replicad-threejs-helper.js', import.meta.url).href
    : specifier.startsWith('.') ? new URL(specifier, controllerUrl).href : import.meta.resolve(specifier);
  return `from '${resolved}'`;
});
const { createCompoundProjectionLab } = await import(`data:text/javascript;base64,${Buffer.from(controllerSource).toString('base64')}`);
// Production's rotateX(-PI/2) maps kernel (X,Y,Z) to scene (X,Z,-Y).
function materialAtScene(shape, [x, y, z], half = 0.015) {
  const p = [10 * x, -10 * z, 10 * y];
  const h = half * 10;
  const probe = makeBox(p.map(v => v - h), p.map(v => v + h));
  return measureVolume(shape.intersect(probe));
}

test('example 5-6 exact front rectangular cut stays in front of the rear rounded cut', () => {
  const original = kernel.buildExample56();
  const iii = kernel.buildExample56({ appliedCutters: ['cut-iii'] });
  const iv = kernel.buildExample56({ appliedCutters: ['cut-iv'] });
  const front = [0.55, 2.2, 0.9];
  const rear = [0.55, 2.2, -0.9];
  assert.ok(materialAtScene(original, front) > 0.02);
  assert.ok(materialAtScene(original, rear) > 0.02);
  assert.ok(materialAtScene(iii, front) < 1e-7, 'III must remove +Z front wall after installing the exact mesh');
  assert.ok(materialAtScene(iii, rear) > 0.02, 'III must leave the rear wall');
  assert.ok(materialAtScene(iv, rear) < 1e-7, 'IV must remove -Z rear wall');
  assert.ok(materialAtScene(iv, front) > 0.02, 'IV must leave the front wall');
});

test('example 5-5 exact slot follows the same positive depth slider as its preview', () => {
  const shifted = kernel.buildExample55({ appliedCutters: ['cut-slot'], cutterValues: { 'cut-slot': { x: 0, z: 0.4 } } });
  assert.ok(materialAtScene(shifted, [0, 0.5, 1]) < 1e-7, '+Z displacement must cut the +Z leg');
  assert.ok(materialAtScene(shifted, [0, 0.5, -1]) > 0.02, '+Z displacement must retain the -Z leg');
});

test('example 5-6 offset ring tools still reach the bore across their full width', () => {
  for (const x of [0.25, 0.85]) {
    const nearEdgeX = x + (x < 0.55 ? -0.3 : 0.3);
    for (const [id, sceneZ, y] of [['cut-iii', 0.56, 2.4], ['cut-iv', -0.56, 1.9]]) {
      const shape = kernel.buildExample56({ appliedCutters: [id], cutterValues: { [id]: { x, y } } });
      assert.ok(materialAtScene(shape, [nearEdgeX, 2.3, sceneZ]) < 1e-7, `${id} must not leave a shelf at offset ${x}`);
    }
  }
});

test('example 5-1 exact base holes and rounded front corners agree with the interactive scene', () => {
  const base = kernel.buildExample51({ visibleComponents: ['base'] });
  const cut = kernel.buildExample51({ visibleComponents: ['base'], appliedCutters: ['base-hole-left'] });
  assert.ok(materialAtScene(base, [-1.55, 0.16, 1.05]) > 0.02);
  assert.ok(materialAtScene(cut, [-1.55, 0.16, 1.05]) < 1e-7, 'base hole must be at positive scene Z');
  assert.ok(materialAtScene(cut, [-1.55, 0.16, -1.05]) > 0.02, 'back of base must remain intact');
  assert.ok(materialAtScene(base, [2.17, 0.16, 1.57]) < 1e-7, 'front outer corner is rounded');
  assert.ok(materialAtScene(base, [2.17, 0.16, -1.57]) > 0.02, 'rear outer corner is square');
  const full = kernel.buildExample51({ visibleComponents: ['base', 'upright', 'barrel', 'rib'] });
  assert.ok(materialAtScene(full, [0, 3.3, -1.28]) > 0.02, 'upright must stay behind the barrel');
  assert.ok(materialAtScene(full, [0, 3.3, 1.28]) < 1e-7, 'upright must not flip to the front');
});

function pathCoordinates(paths) {
  return paths.flatMap(path => [...path.matchAll(/[ML] (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
    .map(match => [Number(match[1]), Number(match[2])]));
}

test('actual HLR camera projects an asymmetric box to the scene front, top and left axes', () => {
  // Kernel x=2..5, y=-9..-4, z=3..8 => scene x=.2...5, y=.3...8, z=.4...9.
  const shape = makeBox([2, -9, 3], [5, -4, 8]);
  const expected = { front: [2, 5, -8, -3], side: [4, 9, -8, -3], top: [2, 5, 4, 9] };
  for (const [view, camera] of Object.entries(kernel.TEXTBOOK_PROJECTION_CAMERAS)) {
    const result = kernel.projection(shape, view === 'side' ? 'right' : view, camera, 'example-5-6');
    const points = pathCoordinates(result.visiblePathData);
    const bounds = [Math.min(...points.map(p => p[0])), Math.max(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[1]))];
    assert.deepEqual(bounds, expected[view], `${view}: HLR must share the mesh's axis signs`);
  }
});

test('example 5-6 HLR front sees the flat front floor and hides the lower rear arc', () => {
  const shape = kernel.buildExample56({ appliedCutters: ['cut-iii', 'cut-iv', 'cut-v'] });
  const result = kernel.projection(shape, 'front', kernel.TEXTBOOK_PROJECTION_CAMERAS.front, 'example-5-6');
  const visible = pathCoordinates(result.visiblePathData);
  assert.ok(visible.some(([x, y]) => Math.abs(x - 2) < 1e-5 && Math.abs(y + 18.75) < 1e-5));
  assert.ok(visible.some(([x, y]) => Math.abs(x - 9) < 1e-5 && Math.abs(y + 18.75) < 1e-5));
  assert.ok(result.hiddenPathData.some(path => /5\.5 -15\.5\b/.test(path)), 'lower centre of rear arc must be hidden');
  assert.ok(!result.visiblePathData.some(path => /5\.5 -15\.5\b/.test(path)), 'rear arc must not replace the front notch');
});

test('complete exact audits retain topology, scale alignment and stage semantics for all chapter 5 lessons', () => {
  for (const payload of [
    { lessonId: 'example-5-1', visibleComponents: ['base', 'upright', 'barrel', 'rib'], appliedCutters: ['bore', 'base-hole-left', 'base-hole-right'] },
    { lessonId: 'example-5-5', appliedCutters: ['cut-p', 'cut-q', 'cut-slot'], slotLength: 50 },
    { lessonId: 'example-5-6', appliedCutters: ['cut-iii', 'cut-iv', 'cut-v'] }
  ]) {
    const result = kernel.auditLesson(payload);
    assert.equal(result.facts.passed, true, JSON.stringify(result.facts));
    const { front, side, top } = result.projections;
    assert.equal(front.frame[0], top.frame[0], 'front and plan X share origin');
    assert.equal(front.frame[1], side.frame[1], 'front and side share height origin');
    assert.equal(front.frame[2], top.frame[2], 'front and plan X share scale');
    assert.equal(front.frame[3], side.frame[3], 'front and side height share scale');
    assert.equal(side.frame[2], top.frame[3], 'depth stays identical');
    if (payload.lessonId === 'example-5-1') {
      for (const x of [-15.5, 15.5]) {
        // Hole rim and centre cross both use SVG y=+10.5, even though the
        // kernel's hole axis is at Y=-10.5. The SVG projection flips that Y.
        assert.ok(top.centerlinePathData.includes(`M ${x - 3.2} 10.5 L ${x + 3.2} 10.5`));
        const rim = pathCoordinates(top.visiblePathData);
        assert.ok(rim.some(([px, py]) => Math.abs(Math.abs(px - x) - 1.8) < 1e-5 && Math.abs(py - 10.5) < 1e-5), 'hole rim and cross must coincide');
      }
    }
  }
});

test('live 5-5 and 5-6 views use the actual current Boolean mesh, without independent outline guides', () => {
  const controller = createCompoundProjectionLab({
    THREE, camera: new THREE.PerspectiveCamera(), controls: { target: new THREE.Vector3() },
    modelGroup: new THREE.Group(), activateModel() {}, refreshProjections() {}
  });
  for (const id of ['example-5-5', 'example-5-6']) {
    controller.selectLesson(id);
    for (const stage of [0, 1, 2, 3, 4]) {
      controller.selectStage(stage);
      const root = controller.buildCurrentModel();
      const bodies = [];
      const guides = [];
      root.traverse(object => {
        if (object.isMesh && !object.userData.excludeFromProjection && !object.userData.booleanTool) bodies.push(object);
        if (object.userData.projectionGuide) guides.push(object);
      });
      assert.equal(bodies.length, 1, `${id} stage ${stage}: only one cut solid`);
      assert.equal(bodies[0].geometry.userData.projectionAnalyticOnly, undefined, 'the displayed solid must also render into live views');
      assert.equal(guides.length, 0, 'separate outlines must not overwrite the actual current silhouette');
      root.traverse(object => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material?.dispose());
      });
    }
  }
  controller.dispose();
});
