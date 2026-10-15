import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { getComponentInfo, isBridgeTaskTarget } from '../learning-logic.js';
import { presets, buildModel } from '../assets/textbook-bridges/model.js';
import {
  BRIDGE_MODELS, BRIDGE_CATALOG, BRIDGE_DISPLAY_EXTENT,
  buildTextbookBridge, bridgePointToThree
} from '../bridge-models.js';

const close = (actual, expected, tolerance = 1e-5) => assert.ok(
  Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`
);
const closeVector = (actual, expected, tolerance = 1e-5) => actual.toArray().forEach((v, i) => close(v, expected[i], tolerance));
const dispose = root => root.traverse(mesh => {
  mesh.geometry?.dispose();
  mesh.material?.dispose();
});

test('all twenty catalogue entries are distinct and preserve the five existing routes', () => {
  assert.equal(BRIDGE_CATALOG.length, 20);
  assert.equal(new Set(BRIDGE_CATALOG.map(item => item.id)).size, 20);
  assert.deepEqual(new Set(BRIDGE_CATALOG.map(item => item.sourceId)), new Set(presets.map(item => item.id)));
  for (const [id, sourceId] of Object.entries({
    beamBridge: 'girder_reference', archBridge: 'arch_basket',
    cableStayedFan: 'stayed_fan', cableStayedHarp: 'stayed_harp', suspension: 'suspension_ground'
  })) assert.equal(BRIDGE_CATALOG.find(item => item.id === id)?.sourceId, sourceId);
  for (const item of BRIDGE_CATALOG) {
    assert.ok(item.name && item.family && item.note && item.sourceId);
    assert.equal(typeof BRIDGE_MODELS[item.id].build, 'function');
  }
});

test('asymmetric coordinate probe maps longitudinal, transverse and up exactly once', () => {
  assert.deepEqual(bridgePointToThree(1, 2, 3).toArray(), [1, 3, -2]);
});

for (const item of BRIDGE_CATALOG) {
  test(`${item.sourceId}: actual geometry, component identities and uniform display scale`, () => {
    const source = buildModel(item.sourceId);
    const snapshot = JSON.stringify(source);
    const finished = source.parts.filter(part =>
      part.category !== 'temporary' && part.category !== 'road-furniture'
      && part.stage <= source.stages.length - 1
      && (part.temporaryUntil == null || part.temporaryUntil >= source.stages.length - 1)
    );
    const root = BRIDGE_MODELS[item.id].build();
    assert.ok(root.isGroup);
    assert.equal(root.children.length, finished.length);
    assert.equal(new Set(root.children.map(mesh => mesh.userData.component_id)).size, finished.length);
    close(root.scale.x, root.scale.y);
    close(root.scale.y, root.scale.z);
    assert.ok(root.scale.x > 0);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    close(Math.max(...size.toArray()), BRIDGE_DISPLAY_EXTENT);
    close(bounds.min.y, 0);
    close((bounds.min.x + bounds.max.x) / 2, 0);
    close((bounds.min.z + bounds.max.z) / 2, 0);
    const physical = root.userData.physicalBoundsThree_m;
    for (let axis = 0; axis < 3; axis++) {
      close(size.getComponent(axis), (physical.max[axis] - physical.min[axis]) * root.scale.x);
    }
    const sourceById = new Map(finished.map(part => [part.id, part]));
    let triangles = 0;
    for (const mesh of root.children) {
      assert.ok(mesh.isMesh);
      assert.ok(mesh.visible);
      const part = sourceById.get(mesh.userData.component_id);
      assert.ok(part, `unexpected rendered component ${mesh.userData.component_id}`);
      assert.equal(mesh.userData.label, part.label);
      assert.equal(mesh.userData.category, part.category);
      assert.deepEqual(mesh.userData.sourcePart, part);
      assert.ok(/[\u3400-\u9fff]/.test(mesh.userData.label));
      assert.equal(mesh.userData.units, 'm');
      assert.deepEqual(mesh.scale.toArray(), [1, 1, 1]);
      const position = mesh.geometry.attributes.position;
      assert.ok(position.count > 0);
      for (const value of position.array) assert.ok(Number.isFinite(value));
      for (const value of mesh.geometry.attributes.normal.array) assert.ok(Number.isFinite(value));
      triangles += (mesh.geometry.index?.count || position.count) / 3;
      // Compare source endpoints with the rendered mesh's unscaled local transform.
      if (part.points?.length === 2) {
        const length = Math.hypot(...part.points[1].map((v, i) => v - part.points[0][i]));
        close(mesh.geometry.parameters.height, length);
        close(mesh.geometry.parameters.radiusTop, part.radius);
        const first = new THREE.Vector3(0, -length / 2, 0).applyQuaternion(mesh.quaternion).add(mesh.position);
        const last = new THREE.Vector3(0, length / 2, 0).applyQuaternion(mesh.quaternion).add(mesh.position);
        closeVector(first, [part.points[0][0], part.points[0][2], -part.points[0][1]]);
        closeVector(last, [part.points[1][0], part.points[1][2], -part.points[1][1]]);
      } else if (part.points?.length > 2) {
        // Six vertices per ring; their centroid must equal every original station.
        assert.equal(position.count, part.points.length * 6);
        for (let i = 0; i < part.points.length; i++) {
          const average = new THREE.Vector3();
          for (let j = 0; j < 6; j++) average.add(new THREE.Vector3().fromBufferAttribute(position, i * 6 + j));
          average.multiplyScalar(1 / 6);
          closeVector(average, [part.points[i][0], part.points[i][2], -part.points[i][1]], 2e-5);
        }
      } else if (part.shape === 'box') {
        closeVector(mesh.position, [part.center[0], part.center[2], -part.center[1]]);
        const { width, height, depth } = mesh.geometry.parameters;
        assert.deepEqual([width, depth, height], part.size);
        if (part.axis) {
          const expected = new THREE.Vector3(part.axis[0], part.axis[2], -part.axis[1]).normalize();
          closeVector(new THREE.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion), expected.toArray());
        }
      }
    }
    assert.ok(triangles < 100000, `${item.sourceId}: ${triangles} triangles exceeds the projection budget`);
    assert.ok(root.children.some(mesh => mesh.name === 'deck'), 'bridge deck is missing');
    if (source.family === '拱桥') {
      assert.ok(root.children.some(mesh => mesh.name === 'arch_rib'));
      assert.ok(root.children.some(mesh => mesh.name === 'hanger'));
    }
    if (source.family === '斜拉桥') {
      assert.ok(root.children.some(mesh => mesh.name === 'tower'));
      assert.ok(root.children.some(mesh => mesh.name === 'stay_cable'));
    }
    assert.equal(JSON.stringify(source), snapshot, 'reference builder data changed');
    assert.deepEqual(root.userData.sourceModel, source, 'adapter changed source physical geometry');
    dispose(root);
  });
}

test('the existing fan-bridge stay selection task recognizes real independent stay meshes', () => {
  const root = BRIDGE_MODELS.cableStayedFan.build();
  const stays = root.children.filter(mesh => mesh.name === 'stay_cable');
  assert.ok(stays.length >= 20);
  assert.equal(new Set(stays.map(mesh => mesh.userData.component_id)).size, stays.length);
  assert.ok(stays.every(mesh => isBridgeTaskTarget(mesh.name)));
  assert.ok(stays.every(mesh => mesh.geometry.parameters.height > 0), 'thin-component picker needs local cylinder height');
  assert.equal(getComponentInfo(stays[0].name).label, '斜拉索');
  dispose(root);
});

test('steel ribbons and underslung compression struts do not acquire misleading quiz roles', () => {
  const ribbon = buildTextbookBridge('stress_ribbon');
  assert.ok(ribbon.children.filter(mesh => mesh.userData.component_id.startsWith('band-')).every(mesh => mesh.name === '连续受拉钢带'));
  const underslung = buildTextbookBridge('underslung_suspension');
  const struts = underslung.children.filter(mesh => mesh.userData.component_id.startsWith('underslung-strut-'));
  assert.ok(struts.length > 0);
  assert.ok(struts.every(mesh => mesh.name !== 'hanger'));
  dispose(ribbon); dispose(underslung);
});

test('repeat builds have independent presentation state and unchanged physical defaults', () => {
  const first = buildTextbookBridge('stayed_spatial');
  const second = buildTextbookBridge('stayed_spatial');
  first.children[0].visible = false;
  first.children[0].position.set(800, 900, 1000);
  first.children[0].material.color.set('#ff0000');
  assert.equal(second.children[0].visible, true);
  assert.notDeepEqual(first.children[0].position.toArray(), second.children[0].position.toArray());
  assert.notEqual(first.children[0].material, second.children[0].material);
  assert.deepEqual(second.userData.sourceModel, buildModel('stayed_spatial'));
  dispose(first); dispose(second);
});

test('vendored geometry files match their recorded source fingerprints', async () => {
  const manifest = JSON.parse(await readFile(new URL('../assets/textbook-bridges/source-manifest.json', import.meta.url), 'utf8'));
  for (const entry of manifest.copiedFiles) {
    const bytes = await readFile(new URL(`../assets/textbook-bridges/${entry.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});
