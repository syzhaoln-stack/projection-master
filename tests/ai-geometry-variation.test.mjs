import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BRIDGE_CATALOG, BRIDGE_MODELS } from '../bridge-models.js';
import {
  GEOMETRY_VARIATION_PARAMETERS,
  applyGeometryVariation,
  geometryVariationVector
} from '../ai-geometry-variation.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(
  Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`
);
const vectorNear = (actual, expected) => actual.toArray().forEach((value, axis) => near(value, expected.getComponent(axis)));
const bounds = root => new THREE.Box3().setFromObject(root, true);
function dispose(root) {
  const resources = new Set();
  root.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    for (const material of [].concat(node.material || [])) resources.add(material);
  });
  for (const resource of resources) resource.dispose();
}

test('parameter contract uses whole-model percentages and immutable defaults', () => {
  assert.deepEqual(GEOMETRY_VARIATION_PARAMETERS, [
    { key: 'lengthPercent', label: '纵向整体比例', value: 100, min: 50, max: 150, step: 1, unit: '%' },
    { key: 'widthPercent', label: '横向整体比例', value: 100, min: 50, max: 150, step: 1, unit: '%' },
    { key: 'heightPercent', label: '竖向整体比例', value: 100, min: 50, max: 150, step: 1, unit: '%' }
  ]);
  assert.ok(Object.isFrozen(GEOMETRY_VARIATION_PARAMETERS));
  assert.ok(GEOMETRY_VARIATION_PARAMETERS.every(Object.isFrozen));
  assert.deepEqual(geometryVariationVector(), [1, 1, 1]);
  assert.deepEqual(geometryVariationVector({ widthPercent: 75 }), [1, 1, 0.75]);
  assert.deepEqual(geometryVariationVector({ lengthPercent: 150, widthPercent: 50, heightPercent: 125.5 }), [1.5, 1.255, 0.5]);
});

test('identity is the same model and does not reparent it or rewrite metadata', () => {
  const scene = new THREE.Scene();
  const model = BRIDGE_MODELS.beamBridge.build();
  scene.add(model);
  const metadata = JSON.stringify(model.userData);
  assert.equal(applyGeometryVariation(model), model);
  assert.equal(applyGeometryVariation(model, { lengthPercent: 100, widthPercent: 100, heightPercent: 100 }), model);
  assert.equal(model.parent, scene);
  assert.deepEqual(scene.children, [model]);
  assert.equal(JSON.stringify(model.userData), metadata);
  dispose(model);
});

for (const entry of BRIDGE_CATALOG) {
  test(`${entry.sourceId}: actual vertex bounds change on all three prescribed axes`, () => {
    const model = BRIDGE_MODELS[entry.id].build();
    const original = bounds(model);
    const values = { lengthPercent: 130, widthPercent: 75, heightPercent: 115 };
    const scale = new THREE.Vector3(...geometryVariationVector(values));
    const wrapper = applyGeometryVariation(model, values);
    const changed = bounds(wrapper);
    assert.ok(wrapper.isGroup);
    assert.deepEqual(wrapper.children, [model]);
    assert.equal(model.parent, wrapper);
    vectorNear(changed.min, original.min.clone().multiply(scale));
    vectorNear(changed.max, original.max.clone().multiply(scale));
    vectorNear(changed.getSize(new THREE.Vector3()), original.getSize(new THREE.Vector3()).multiply(scale));
    assert.equal(wrapper.userData.geometryVariation.sourceDimensions, 'reference-only');
    assert.equal(wrapper.userData.geometryVariation.structuralDesign, false);
    assert.match(wrapper.userData.geometryVariation.note, /不独立修改桥面宽或塔高/);
    dispose(wrapper);
  });
}

test('mesh nodes, actual vertices and three orthographic projections share the same transform', () => {
  const model = BRIDGE_MODELS.cableStayedFan.build();
  model.updateWorldMatrix(true, true);
  const meshes = model.children.filter(node => node.isMesh);
  const sampledMeshes = [meshes[0], meshes.find(mesh => mesh.name === 'tower'), meshes.find(mesh => mesh.name === 'stay_cable'), meshes.at(-1)];
  assert.ok(sampledMeshes.every(Boolean));
  const probes = sampledMeshes.map(mesh => ({
    mesh,
    node: mesh.getWorldPosition(new THREE.Vector3()),
    vertexIndices: [0, Math.floor(mesh.geometry.attributes.position.count / 2), mesh.geometry.attributes.position.count - 1]
  }));
  for (const probe of probes) {
    probe.vertices = probe.vertexIndices.map(index => new THREE.Vector3()
      .fromBufferAttribute(probe.mesh.geometry.attributes.position, index).applyMatrix4(probe.mesh.matrixWorld));
  }
  const cameras = [[0, 0, 20], [0, 20, 0], [20, 0, 0]].map((eye, index) => {
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
    if (index === 1) camera.up.set(0, 0, -1);
    camera.position.fromArray(eye);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return camera;
  });
  const cameraMatrices = cameras.map(camera => camera.matrixWorld.elements.slice());
  const values = { lengthPercent: 125, widthPercent: 65, heightPercent: 140 };
  const scale = new THREE.Vector3(...geometryVariationVector(values));
  const wrapper = applyGeometryVariation(model, values);
  for (const probe of probes) {
    vectorNear(probe.mesh.getWorldPosition(new THREE.Vector3()), probe.node.clone().multiply(scale));
    probe.vertexIndices.forEach((index, sample) => {
      const actual = new THREE.Vector3().fromBufferAttribute(probe.mesh.geometry.attributes.position, index)
        .applyMatrix4(probe.mesh.matrixWorld);
      const expected = probe.vertices[sample].clone().multiply(scale);
      vectorNear(actual, expected);
      for (const camera of cameras) vectorNear(actual.clone().project(camera), expected.clone().project(camera));
    });
  }
  cameras.forEach((camera, index) => assert.deepEqual(camera.matrixWorld.elements, cameraMatrices[index]));
  dispose(wrapper);
});

test('an attached model is wrapped at its existing parent and keeps all ancestor transforms', () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.set(2, 3, -4);
  parent.rotation.set(0.1, 0.4, -0.2);
  parent.scale.set(0.8, 1.2, 1.1);
  scene.add(parent);
  const before = new THREE.Group(), after = new THREE.Group();
  const model = BRIDGE_MODELS.archBridge.build();
  parent.add(before, model, after);
  scene.updateMatrixWorld(true);
  const mesh = model.children.find(node => node.isMesh);
  const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, 3);
  const parentLocal = point.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(parent.matrixWorld.clone().invert());
  const originalTransform = { position: model.position.clone(), quaternion: model.quaternion.clone(), scale: model.scale.clone() };
  const factors = geometryVariationVector({ lengthPercent: 135, widthPercent: 90, heightPercent: 70 });
  const expected = parentLocal.multiply(new THREE.Vector3(...factors)).applyMatrix4(parent.matrixWorld);
  const wrapper = applyGeometryVariation(model, { lengthPercent: 135, widthPercent: 90, heightPercent: 70 });
  assert.deepEqual(parent.children, [before, wrapper, after]);
  assert.equal(wrapper.parent, parent);
  vectorNear(point.applyMatrix4(mesh.matrixWorld), expected);
  vectorNear(model.position, originalTransform.position);
  vectorNear(model.scale, originalTransform.scale);
  assert.ok(model.quaternion.equals(originalTransform.quaternion));
  dispose(wrapper);
});

test('source geometry, dimensions and independent reconstruction are not polluted', () => {
  const model = BRIDGE_MODELS.suspension.build();
  const originalBounds = bounds(model);
  const originalMetadata = JSON.stringify(model.userData);
  const snapshots = model.children.map(mesh => ({
    mesh, geometry: mesh.geometry, position: mesh.geometry.attributes.position.array.slice(),
    normal: mesh.geometry.attributes.normal.array.slice(), matrix: mesh.matrix.elements.slice()
  }));
  const values = { lengthPercent: 150, widthPercent: 50, heightPercent: 125 };
  const wrapper = applyGeometryVariation(model, values);
  values.lengthPercent = 55;
  assert.equal(wrapper.userData.geometryVariation.parameters.lengthPercent, 150);
  assert.deepEqual(wrapper.scale.toArray(), [1.5, 1.25, 0.5]);
  assert.equal(JSON.stringify(model.userData), originalMetadata);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.mesh.geometry, snapshot.geometry);
    assert.deepEqual(snapshot.mesh.geometry.attributes.position.array, snapshot.position);
    assert.deepEqual(snapshot.mesh.geometry.attributes.normal.array, snapshot.normal);
    assert.deepEqual(snapshot.mesh.matrix.elements, snapshot.matrix);
  }
  const rebuilt = BRIDGE_MODELS.suspension.build();
  vectorNear(bounds(rebuilt).min, originalBounds.min);
  vectorNear(bounds(rebuilt).max, originalBounds.max);
  assert.equal(JSON.stringify(rebuilt.userData), originalMetadata);
  assert.notEqual(rebuilt.children[0].geometry, model.children[0].geometry);
  dispose(wrapper);
  dispose(rebuilt);
});

test('invalid values are rejected before changing model hierarchy', () => {
  const scene = new THREE.Scene(), model = new THREE.Group();
  scene.add(model);
  const invalid = [
    null, [], '100', 100, new Date(), Object.create({ lengthPercent: 100 }),
    { lengthPercent: -1 }, { widthPercent: 0 }, { heightPercent: 49.99 },
    { lengthPercent: 150.01 }, { widthPercent: NaN }, { heightPercent: Infinity },
    { heightPercent: -Infinity }, { lengthPercent: '125' }, { heightPercent: undefined },
    { towerHeight: 120 }, { deckWidth: 100 }, { lengthPercent: 100, arbitrary: 1 },
    { [Symbol('lengthPercent')]: 100 }, JSON.parse('{"__proto__":100}')
  ];
  for (const values of invalid) {
    assert.throws(() => geometryVariationVector(values));
    assert.throws(() => applyGeometryVariation(model, values));
    assert.deepEqual(scene.children, [model]);
    assert.equal(model.parent, scene);
  }
  let getterCalled = false;
  const accessor = { get lengthPercent() { getterCalled = true; return 120; } };
  assert.throws(() => geometryVariationVector(accessor), TypeError);
  assert.equal(getterCalled, false);
  assert.deepEqual(geometryVariationVector(Object.assign(Object.create(null), { heightPercent: 50 })), [1, 0.5, 1]);
  for (const invalidModel of [null, {}, new THREE.PerspectiveCamera()]) {
    assert.throws(() => applyGeometryVariation(invalidModel), TypeError);
  }
});
