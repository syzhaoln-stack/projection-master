import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = resolve(root, '..');
const modelSource = resolve(projectRoot, '申报数字化教材/数字教材全书初稿/assets/bridge-lab/assets/models');
const contractSource = resolve(projectRoot, '申报数字化教材/三类桥梁_Blender_Godot_20260908/docs/dimension-contract.json');
const target = resolve(root, 'assets/drawing-bridges');
const nativeFetch = globalThis.fetch;
const requests = [];
globalThis.self = globalThis;
globalThis.document = { baseURI: pathToFileURL(resolve(root, 'index.html')).href };
globalThis.ProgressEvent ||= class ProgressEvent extends Event {
  constructor(type, values) { super(type); Object.assign(this, values); }
};
// Node has no image decoder. Geometry and metadata load normally; pixel rendering is not tested.
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
globalThis.fetch = async (input, options) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('file:')) {
    requests.push(url);
    return new Response(await readFile(fileURLToPath(url)), { status: 200 });
  }
  return nativeFetch(input, options);
};

const { DETAILED_BRIDGE_CATALOG, DETAILED_BRIDGE_MODELS } = await import('../detailed-bridges.js');
const hash = data => createHash('sha256').update(data).digest('hex');
const meshes = scene => {
  const result = [];
  scene.traverse(object => { if (object.isMesh) result.push(object); });
  return result;
};
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual}`);
const disposeInstance = scene => scene.traverse(object => {
  object.geometry?.dispose();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) material?.dispose();
});
const report = {
  scope: 'Three.js GLTF import, metadata, final-state filtering, display bounds and cache isolation; no pixel rendering',
  contract_sha256: '',
  bridges: []
};
const sourceContract = await readFile(contractSource);
const copiedContract = await readFile(resolve(target, 'dimension-contract.json'));
assert.equal(hash(copiedContract), hash(sourceContract), 'Dimension contract differs from source');
report.contract_sha256 = hash(copiedContract);
const contract = JSON.parse(copiedContract);

for (const entry of DETAILED_BRIDGE_CATALOG) {
  const filename = `${entry.sourceId}.glb`;
  const raw = await readFile(resolve(target, filename));
  const original = await readFile(resolve(modelSource, filename));
  assert.equal(hash(raw), hash(original), `${filename} differs from textbook source`);
  assert.equal(raw.toString('ascii', 0, 4), 'glTF');
  const jsonLength = raw.readUInt32LE(12);
  const gltf = JSON.parse(raw.toString('utf8', 20, 20 + jsonLength));
  const rawMeshes = gltf.nodes.filter(node => node.mesh !== undefined);
  assert.ok(rawMeshes.every(node => node.extras?.component_id && node.extras?.label), 'Missing source component metadata');
  assert.equal(new Set(rawMeshes.map(node => node.extras.component_id)).size, rawMeshes.length, 'Duplicate source component ID');
  assert.ok(contract.bridges.some(bridge => bridge.id === entry.sourceId), 'Missing dimension contract entry');
  const model = DETAILED_BRIDGE_MODELS[entry.id];
  const requestStart = requests.length;
  const [sourceA, sourceB] = await Promise.all([model.load(), model.load()]);
  assert.equal(sourceA, sourceB, 'Concurrent loads did not share cache');
  assert.equal(requests.length - requestStart, 1, 'Unexpected repeated GLB request');
  const sourceMeshes = meshes(sourceA);
  const sourcesById = new Map(sourceMeshes.map(object => [object.userData.component_id, object]));
  const sourceGeometries = new Set(sourceMeshes.map(object => object.geometry));
  const sourceMaterials = new Set(sourceMeshes.flatMap(object => Array.isArray(object.material) ? object.material : [object.material]));
  let cachedResourceDisposals = 0;
  for (const resource of [...sourceGeometries, ...sourceMaterials]) {
    resource.addEventListener('dispose', () => { cachedResourceDisposals++; });
  }

  const first = model.build();
  const firstMeshes = meshes(first);
  assert.ok(first instanceof THREE.Group);
  const expectedCount = rawMeshes.filter(node =>
    Number(node.extras.end_stage ?? 99) >= 99 && !/^08_Temporary$|^9\d_/i.test(node.extras.category)
  ).length;
  assert.equal(firstMeshes.length, expectedCount, 'Completed bridge has wrong component count');
  assert.equal(new Set(firstMeshes.map(object => object.userData.component_id)).size, firstMeshes.length);
  for (const object of firstMeshes) {
    assert.ok(!/^08_Temporary$|^9\d_/i.test(object.userData.category), 'Temporary/scenery component remains');
    const source = sourcesById.get(object.userData.component_id);
    assert.ok(source, 'Source component ID changed');
    assert.equal(object.userData.label, source.userData.label, 'Source label changed');
    assert.deepEqual(object.position.toArray(), source.position.toArray(), 'Physical position changed');
    assert.deepEqual(object.quaternion.toArray(), source.quaternion.toArray(), 'Source orientation changed');
    assert.deepEqual(object.scale.toArray(), source.scale.toArray(), 'Physical scale changed');
    assert.ok(!sourceGeometries.has(object.geometry), 'Instance uses cached geometry');
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    assert.ok(materials.every(material => !sourceMaterials.has(material)), 'Instance uses cached material');
  }
  const box = new THREE.Box3().setFromObject(first);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  near(Math.max(size.x, size.y, size.z), 5, 'Display extent');
  near(center.x, 0, 'X centering');
  near(center.z, 0, 'Z centering');
  near(box.min.y, 0, 'Floor alignment');
  assert.deepEqual(first.rotation.toArray().slice(0, 3), [0, 0, 0], 'Unexpected second axis rotation');
  const semantics = {};
  for (const object of firstMeshes) semantics[object.name] = (semantics[object.name] || 0) + 1;
  const required = entry.sourceId === 'cable_stayed' ? ['stay_cable', 'tower', 'girder']
    : entry.sourceId === 'suspension' ? ['main_cable', 'hanger', 'tower', 'girder'] : ['arch_rib', 'arch_brace', 'pier', 'deck'];
  for (const name of required) assert.ok(semantics[name] > 0, `Missing semantic part ${name}`);

  disposeInstance(first);
  assert.equal(cachedResourceDisposals, 0, 'Clearing instance disposed cached resources');
  const second = model.build();
  assert.equal(meshes(second).length, firstMeshes.length);
  assert.deepEqual(new THREE.Box3().setFromObject(second).min.toArray(), box.min.toArray(), 'Rebuild bounds drifted');
  assert.deepEqual(new THREE.Box3().setFromObject(second).max.toArray(), box.max.toArray(), 'Rebuild bounds drifted');
  assert.equal(await model.load(), sourceA);
  assert.equal(requests.length - requestStart, 1, 'Rebuild reloaded GLB');
  report.bridges.push({
    id: entry.id, file: filename, sha256: hash(raw), bytes: raw.length,
    source_mesh_instances: rawMeshes.length, retained_mesh_instances: firstMeshes.length,
    removed_mesh_instances: rawMeshes.length - firstMeshes.length,
    embedded_images: gltf.images?.length || 0,
    physical_bounds_m: first.userData.sourceBoundsM, display_scale: first.userData.displayScale,
    display_size: size.toArray(), semantic_counts: Object.fromEntries(required.map(name => [name, semantics[name]])),
    cache_isolation: 'PASS', final_state_filter: 'PASS', source_hash: 'PASS', dimensions: 'PASS'
  });
  disposeInstance(second);
}
const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.argv.includes('--write')) await writeFile(resolve(target, 'geometry-check.json'), output);
process.stdout.write(output);
