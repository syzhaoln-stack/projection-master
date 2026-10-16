import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { readFile } from 'node:fs/promises';
import { captureGalleryHandoff, cameraFromGalleryHandoff } from '../model-gallery-room.js';

const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
function sample({ width = 1280, height = 530, roll = 0.13 } = {}) {
  const viewport = { left: 17, top: 65, width, height };
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 150);
  camera.position.set(-1.5, 6.3, 24); const target = new THREE.Vector3(0, 3.5, -1);
  camera.lookAt(target); camera.updateMatrixWorld(true);
  const mount = new THREE.Group();
  mount.position.copy(camera.position).addScaledVector(target.clone().sub(camera.position).normalize(), 10);
  mount.quaternion.copy(camera.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.14, -0.32, roll, 'YXZ')));
  mount.scale.setScalar(4.7); mount.updateMatrixWorld(true);
  const sourceCenter = new THREE.Vector3(0.7, 2.5, -0.3), sourceUnit = 0.2;
  const handoff = captureGalleryHandoff({ modelId: 'fixture', sourceCenter, sourceUnit, mount, camera, target, viewport });
  const modelMatrix = mount.matrixWorld.clone().multiply(new THREE.Matrix4().makeScale(sourceUnit, sourceUnit, sourceUnit))
    .multiply(new THREE.Matrix4().makeTranslation(...sourceCenter.clone().negate().toArray()));
  return { camera, mount, handoff, viewport, modelMatrix, sourceCenter };
}
function pixel(point, camera, viewport) {
  const ndc = point.clone().project(camera);
  return [viewport.left + (ndc.x + 1) * viewport.width / 2, viewport.top + (1 - ndc.y) * viewport.height / 2, ndc.z];
}
function comparePoints(s, camera, viewport) {
  // Multiple real mesh surfaces at different depths catch the perspective
  // mismatch that moving a 45-degree camera farther away cannot fix.
  const geometries = [new THREE.BoxGeometry(4.2, 3.1, 2.5, 2, 2, 2), new THREE.CylinderGeometry(0.7, 1, 4, 24)];
  try {
    for (const geometry of geometries) {
      const attribute = geometry.attributes.position;
      for (let index = 0; index < attribute.count; index++) {
        const source = new THREE.Vector3().fromBufferAttribute(attribute, index).add(s.sourceCenter);
        const before = pixel(source.clone().applyMatrix4(s.modelMatrix), s.camera, s.viewport);
        const after = pixel(source, camera, viewport);
        before.forEach((value, axis) => close(value, after[axis]));
      }
    }
  } finally { geometries.forEach(geometry => geometry.dispose()); }
}

test('handoff preserves every sampled 3D point in screen pixels, including nonzero roll and changed canvas rectangles', () => {
  for (const [width, height] of [[1280, 530], [897, 760]]) for (const roll of [0, 0.31, -0.47]) {
    const s = sample({ width, height, roll });
    for (const viewport of [s.viewport,
      { ...s.viewport, height: height - 110 },
      { left: 61, top: 83, width: width - 90, height: height - 147 }]) {
      const matched = cameraFromGalleryHandoff(s.handoff, viewport);
      comparePoints(s, matched.camera, viewport);
      close(matched.target.distanceTo(s.sourceCenter), 0);
    }
  }
});

test('the installed OrbitControls keeps the matched roll and pixel positions on subsequent updates', () => {
  const domElement = { style: {}, addEventListener() {}, removeEventListener() {}, getRootNode: () => ({ addEventListener() {}, removeEventListener() {} }) };
  for (const roll of [0, 0.27, -0.41]) {
    const s = sample({ width: 897, height: 760, roll });
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
    camera.position.set(8.6, 6.8, 10.4);
    // Construct with the application's initial Y-up, before copying the new up.
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = false; controls.update();
    const viewport = { ...s.viewport, height: 650 };
    const matched = cameraFromGalleryHandoff(s.handoff, viewport);
    camera.copy(matched.camera); controls.target.copy(matched.target);
    controls.minDistance = 2.2; controls.maxDistance = 120;
    controls.update(); controls.enableDamping = true;
    for (let frame = 0; frame < 30; frame++) { controls.update(); camera.updateMatrixWorld(true); }
    comparePoints(s, camera, viewport);
    close(camera.quaternion.angleTo(matched.camera.quaternion), 0, 1e-7);
    controls.dispose();
  }
});

test('handoff snapshots are detached from disposable room objects and reject invalid camera transforms', () => {
  const s = sample(), before = JSON.stringify(s.handoff);
  s.mount.position.set(999, 2, 3); s.camera.position.set(0, 0, 1);
  assert.equal(JSON.stringify(s.handoff), before);
  for (const mutate of [h => h.sourceUnit = 0, h => h.displayPose.scale = NaN,
    h => h.camera.fov = 180, h => h.camera.position[0] = Infinity, h => h.viewport.height = 0]) {
    const invalid = structuredClone(s.handoff); mutate(invalid);
    assert.throws(() => cameraFromGalleryHandoff(invalid, s.viewport), /视角无效/);
  }
});

test('fractional CSS rectangles preserve the renderer\'s independent horizontal and vertical focal lengths', () => {
  const s = sample({ width: 897, height: 760 });
  s.viewport.width += 0.4375; s.viewport.height += 0.3125;
  Object.assign(s.handoff.viewport, s.viewport);
  const viewport = { left: 17, top: 65, width: 896.8125, height: 650.5 };
  comparePoints(s, cameraFromGalleryHandoff(s.handoff, viewport).camera, viewport);
});

test('main inspection hands off the camera and renders its first frame before revealing the canvas', async () => {
  const source = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');
  const inspect = source.slice(source.indexOf('async function inspectGalleryModel('), source.indexOf('\nfunction leaveGalleryInspection('));
  assert.match(inspect, /cameraFromGalleryHandoff\(handoff, host\.getBoundingClientRect\(\)\)/);
  assert.doesNotMatch(inspect, /fitModelCamera\(/);
  assert.ok(inspect.indexOf('renderer.render(scene, camera)') > inspect.indexOf('camera.copy(matched.camera)'));
  assert.ok(inspect.indexOf('renderer.render(scene, camera)') < inspect.indexOf("return { viewMode: 'wrapped' }"));
});
