import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRoomLayout, frameRoomWall, sampleTakePose, fitHeldModelScale, makeDisplayCopy, disposeGalleryTree } from '../model-gallery-room.js';
import { CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG } from '../model-library-curation.js';
import { TEXTBOOK_MECHANICAL_CATALOG } from '../textbook-mechanical-models.js';
import { BRIDGE_MODELS } from '../bridge-models.js';

const entries = [...TEXTBOOK_MECHANICAL_CATALOG.map(entry => ({ ...entry, category: 'mechanical' })),
  ...[...CURATED_BRIDGE_CATALOG, ...CURATED_DRAWING_CATALOG].map(entry => ({ ...entry, category: 'bridge' }))];
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function sameBounds(a, b) { a.min.toArray().forEach((value, i) => near(value, b.min.getComponent(i))); a.max.toArray().forEach((value, i) => near(value, b.max.getComponent(i))); }
function triangles(root) { let total = 0; root.traverse(object => { if (object.isMesh) total += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3; }); return total; }
function box(color = 0x456789) { return new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), new THREE.MeshStandardMaterial({ color })); }

test('mechanical and bridge cabinets have distinct fixed 4x2 and 4x3 homes', () => {
  const layout = createRoomLayout(entries);
  assert.deepEqual(layout.map(wall => [wall.category, wall.columns, wall.rows, wall.slots.length]), [['mechanical', 4, 2, 8], ['bridge', 4, 3, 12]]);
  assert.ok(layout[0].position.x < 0 && layout[1].position.x > 0);
  assert.ok(layout[0].quaternion.y > 0 && layout[1].quaternion.y < 0);
  for (const wall of layout) {
    assert.equal(new Set(wall.slots.map(slot => `${slot.row}:${slot.column}`)).size, wall.slots.length);
    assert.ok(wall.slots.every(slot => slot.column >= 0 && slot.column < 4 && slot.row < wall.rows));
  }
  assert.throws(() => createRoomLayout([entries[0], entries[0]]), /清单无效/);
});

test('mechanical-only collection creates one centered eight-model cabinet, without an empty bridge wall', () => {
  const layout = createRoomLayout(entries.filter(entry => entry.category === 'mechanical'));
  assert.equal(layout.length, 1); assert.equal(layout[0].category, 'mechanical'); assert.equal(layout[0].slots.length, 8);
  assert.equal(layout[0].position.x, 0); assert.equal(layout[0].quaternion.y, 0);
  const overview = frameRoomWall(layout, 'all', 1.5), focus = frameRoomWall(layout, 'mechanical', 1.5);
  assert.ok(overview.position.distanceTo(focus.position) < 1e-9);
  const missingWall = frameRoomWall(layout, 'bridge', 1.5);
  assert.ok(missingWall.position.distanceTo(focus.position) < 1e-9);
  assert.throws(() => createRoomLayout([]), /清单为空/);
});

test('both angled cabinets and each focused cabinet fit narrow and wide viewports', () => {
  const layout = createRoomLayout(entries);
  for (const aspect of [1280 / 520, 897 / 650, 0.65]) for (const category of ['all', 'mechanical', 'bridge']) {
    const frame = frameRoomWall(layout, category, aspect), camera = new THREE.PerspectiveCamera(frame.fov, aspect, frame.near, frame.far);
    camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld(true);
    for (const wall of layout.filter(wall => category === 'all' || wall.category === category)) {
      for (const x of [wall.bounds.min.x, wall.bounds.max.x]) for (const y of [wall.bounds.min.y, wall.bounds.max.y]) for (const z of [wall.bounds.min.z, wall.bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(wall.matrix).project(camera);
        assert.ok(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1, `${category} ${aspect}: ${point.toArray()}`);
      }
    }
  }
});

test('take and return arcs preserve exact homes and form the same reversible path', () => {
  const from = { position: new THREE.Vector3(-8, 2, -3), scale: 3, quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.2, 0)) };
  const to = { position: new THREE.Vector3(2, 4, 12), scale: 8, quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.4, 0)) };
  const before = from.position.toArray();
  for (const t of [0, 0.2, 0.5, 0.8, 1]) {
    const forward = sampleTakePose(from, to, t), reverse = sampleTakePose(to, from, 1 - t);
    near(forward.position.distanceTo(reverse.position), 0); near(forward.scale, reverse.scale);
    near(forward.quaternion.angleTo(reverse.quaternion), 0, 1e-7);
  }
  assert.deepEqual(sampleTakePose(from, to, 0).position.toArray(), before);
  near(sampleTakePose(from, to, 1).position.distanceTo(to.position), 0);
  assert.ok(sampleTakePose(from, to, 0.5).position.y > (from.position.y + to.position.y) / 2);
  assert.deepEqual(from.position.toArray(), before);
});

test('held models keep their shelf orientation and fit the entire depth within 42% width and 48% height', () => {
  const layout = createRoomLayout(entries.filter(entry => entry.category === 'mechanical'));
  const homeQuaternion = layout[0].quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, -0.26, 0, 'YXZ')));
  // Actual wide and portrait stage dimensions, plus a short mobile viewport.
  for (const [width, height] of [[1280, 578], [897, 814], [390, 590]]) {
    const frame = frameRoomWall(layout, 'mechanical', width / height);
    const camera = new THREE.PerspectiveCamera(frame.fov, width / height, frame.near, frame.far);
    camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld(true);
    const distance = THREE.MathUtils.clamp(camera.position.distanceTo(frame.target) * 0.43, 5, 16);
    const position = camera.position.clone().addScaledVector(frame.target.clone().sub(camera.position).normalize(), distance);
    // Wide flange, upright support, deep shaft and a near-cubic solid.
    for (const dimensions of [[1, 0.16, 1], [0.65, 1, 0.6], [0.22, 0.2, 1], [1, 0.9, 0.8]]) {
      const half = new THREE.Vector3(...dimensions).multiplyScalar(0.5), bounds = new THREE.Box3(half.clone().negate(), half);
      const scale = fitHeldModelScale({ bounds, quaternion: homeQuaternion, camera, distance });
      const pose = { position, quaternion: homeQuaternion.clone(), scale };
      const from = { position: new THREE.Vector3(-4, 3, 0), quaternion: homeQuaternion.clone(), scale: 2.5 };
      for (const t of [0, 0.25, 0.5, 0.75, 1]) near(sampleTakePose(from, pose, t).quaternion.angleTo(homeQuaternion), 0, 1e-7);
      const matrix = new THREE.Matrix4().compose(position, homeQuaternion, new THREE.Vector3(scale, scale, scale));
      let maxX = 0, maxY = 0;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(matrix).project(camera);
        assert.ok(Math.abs(point.x) <= 0.42000001, `${width}x${height}: x=${point.x}`);
        assert.ok(Math.abs(point.y) <= 0.48000001, `${width}x${height}: y=${point.y}`);
        assert.ok(point.z > -1 && point.z < 1);
        maxX = Math.max(maxX, Math.abs(point.x)); maxY = Math.max(maxY, Math.abs(point.y));
      }
      assert.ok(Math.abs(maxX - 0.42) < 1e-7 || Math.abs(maxY - 0.48) < 1e-7, 'fit should fill one limit without shrinking unnecessarily');
    }
  }
});

test('display copy preserves transformed triangles, batches equal finishes, and excludes guides from bounds', () => {
  const root = new THREE.Group(); root.position.set(10, 5, -3); root.rotation.y = 0.4; root.scale.setScalar(0.7);
  const first = box(), second = box(); second.position.set(5, 0, 0); second.rotation.z = 0.2;
  root.add(first, second); root.updateMatrixWorld(true);
  const expected = new THREE.Box3().setFromObject(root), expectedTriangles = triangles(root);
  const guide = box(); guide.position.set(1000, 1000, 1000); guide.userData.projectionGuide = true; root.add(guide);
  const hidden = new THREE.Group(); hidden.visible = false; hidden.add(box()); hidden.position.x = -1000; root.add(hidden);
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(first.geometry), new THREE.LineBasicMaterial()); root.add(edge);
  const originalPositions = first.geometry.attributes.position.array.slice(); let originalDisposed = 0;
  first.geometry.addEventListener('dispose', () => originalDisposed++); first.material.addEventListener('dispose', () => originalDisposed++);
  const copy = makeDisplayCopy(root, 'example');
  try {
    assert.equal(copy.children.length, 1); assert.equal(triangles(copy), expectedTriangles);
    sameBounds(new THREE.Box3().setFromObject(copy), expected);
    assert.ok(copy.children.every(child => child.userData.galleryModelId === 'example'));
    assert.deepEqual(first.geometry.attributes.position.array, originalPositions);
    assert.notEqual(copy.children[0].material, first.material);
    disposeGalleryTree(copy); assert.equal(originalDisposed, 0);
  } finally { disposeGalleryTree(root); }
});

test('multi-material groups, draw ranges, reflected transforms and texture ownership survive batching', () => {
  const texture = new THREE.Texture(), red = new THREE.MeshStandardMaterial({ color: 0xaa5533, map: texture }), blue = new THREE.MeshStandardMaterial({ color: 0x3355aa });
  const geometry = new THREE.BoxGeometry(2, 3, 4);
  geometry.groups.forEach((group, index) => group.materialIndex = index % 2); geometry.setDrawRange(0, 24);
  const source = new THREE.Mesh(geometry, [red, blue]); source.scale.x = -1;
  let textureDisposals = 0; texture.addEventListener('dispose', () => textureDisposals++);
  const copy = makeDisplayCopy(source, 'groups');
  assert.equal(copy.children.length, 2); assert.equal(triangles(copy), 8);
  assert.equal(copy.children.find(mesh => mesh.material.map).material.map, texture);
  const normals = copy.children[0].geometry.attributes.normal, positions = copy.children[0].geometry.attributes.position;
  const a = new THREE.Vector3().fromBufferAttribute(positions, 0), b = new THREE.Vector3().fromBufferAttribute(positions, 1), c = new THREE.Vector3().fromBufferAttribute(positions, 2);
  assert.ok(b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3().fromBufferAttribute(normals, 0)) > 0);
  disposeGalleryTree(copy); disposeGalleryTree(source); assert.equal(textureDisposals, 0); texture.dispose();
});

test('instanced display geometry keeps every instance transform and finite geometry is required', () => {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-3, 1, 0)); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 2, 0));
  const copy = makeDisplayCopy(mesh); assert.equal(triangles(copy), 24);
  const bounds = new THREE.Box3().setFromObject(copy); near(bounds.min.x, -3.5); near(bounds.max.x, 3.5); near(bounds.max.y, 2.5);
  disposeGalleryTree(copy); disposeGalleryTree(mesh);
  assert.throws(() => makeDisplayCopy(new THREE.Group()), /有效实体/);
});

test('nine actual bridge displays retain every triangle while reducing thousands of draw calls', () => {
  let before = 0, after = 0;
  for (const entry of CURATED_BRIDGE_CATALOG) {
    const source = BRIDGE_MODELS[entry.id].build(), expectedBounds = new THREE.Box3().setFromObject(source), count = triangles(source);
    const copy = makeDisplayCopy(source, entry.id);
    try {
      source.traverse(object => { if (object.isMesh) before++; }); after += copy.children.length;
      assert.equal(triangles(copy), count, entry.id); sameBounds(new THREE.Box3().setFromObject(copy), expectedBounds);
      assert.ok(copy.children.length < 20, entry.id);
    } finally { disposeGalleryTree(source); disposeGalleryTree(copy); }
  }
  assert.ok(before > 3000); assert.ok(after < 150); assert.ok(after < before / 30);
});
