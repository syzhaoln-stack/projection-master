import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createProjectionCameraTurn, sampleProjectionCameraTurn, GALLERY_VIEW_DIRECTIONS, isProjectionDrawingHit } from '../gallery-projection-camera.js';

function args(view = 'side') {
  return { view, position: new THREE.Vector3(8, 9, 14), target: new THREE.Vector3(1, 3, -2),
    up: new THREE.Vector3(0, 1, 0), center: new THREE.Vector3(-1, 2, 4), startedAt: 100 };
}

for (const view of ['front', 'top', 'side']) {
  test(`${view} camera turn ends at the engineering view and retains orbit distance throughout`, () => {
    const input = args(view), turn = createProjectionCameraTurn(input), distance = input.position.distanceTo(input.target);
    const first = sampleProjectionCameraTurn(turn, 100);
    assert.ok(first.position.distanceTo(input.position) < 1e-10); assert.ok(first.target.equals(input.target)); assert.equal(first.done, false);
    for (let ms = 100; ms <= 550; ms += 15) {
      const pose = sampleProjectionCameraTurn(turn, ms);
      assert.ok(Math.abs(pose.position.distanceTo(pose.target) - distance) < 1e-10);
      assert.ok(pose.position.toArray().every(Number.isFinite));
    }
    const end = sampleProjectionCameraTurn(turn, 550);
    const direction = end.position.clone().sub(end.target).normalize();
    assert.ok(direction.distanceTo(new THREE.Vector3(...GALLERY_VIEW_DIRECTIONS[view]).normalize()) < 1e-10);
    assert.ok(end.target.equals(input.center)); assert.equal(end.done, true);
    if (view === 'top') assert.ok(direction.y > 0.999999 && direction.z > 0, 'near-polar top view stays valid for OrbitControls');
    if (view === 'side') assert.ok(direction.x < -0.999999, 'the current side projection is the left view');
  });
}

test('the turn snapshots caller vectors and safely handles a full 180 degree rotation', () => {
  const input = args('front'); input.position.set(0, 0, -10); input.target.set(0, 0, 0); input.center.set(0, 0, 0);
  const turn = createProjectionCameraTurn(input);
  input.position.set(999, 999, 999); input.target.set(500, 0, 0); input.center.set(200, 0, 0); input.up.set(1, 0, 0);
  for (const time of [100, 150, 325, 550]) {
    const pose = sampleProjectionCameraTurn(turn, time);
    assert.ok(Math.abs(pose.position.length() - 10) < 1e-10); assert.ok(pose.target.equals(new THREE.Vector3()));
  }
  assert.ok(sampleProjectionCameraTurn(turn, 550).position.distanceTo(new THREE.Vector3(0, 0, 10)) < 1e-10);
});

test('invalid views, collapsed cameras and nonfinite inputs cannot start an animation', () => {
  assert.equal(createProjectionCameraTurn(args('rear')), null);
  const collapsed = args(); collapsed.position.copy(collapsed.target); assert.equal(createProjectionCameraTurn(collapsed), null);
  assert.equal(createProjectionCameraTurn({ ...args(), center: new THREE.Vector3(NaN, 0, 0) }), null);
  assert.equal(createProjectionCameraTurn({ ...args(), duration: -1 }), null);
  assert.equal(createProjectionCameraTurn({ ...args(), startedAt: Infinity }), null);
});

test('the real damped OrbitControls preserves all sampled directions, including near-polar top view', () => {
  for (const view of ['front', 'top', 'side']) {
    const camera = new THREE.PerspectiveCamera(45, 1.4, 0.05, 1000);
    camera.position.set(8, 9, 14);
    const domElement = { style: {}, addEventListener() {}, removeEventListener() {} };
    const controls = new OrbitControls(camera, domElement); controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.target.set(1, 3, -2); controls.update();
    // Inspection inherits the room's camera-local up rather than resetting its
    // roll. The turn gradually returns to engineering Y-up explicitly.
    camera.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const turn = createProjectionCameraTurn({ ...args(view), position: camera.position, target: controls.target, up: camera.up });
    for (let time = 100; time <= 550; time += 10) {
      const pose = sampleProjectionCameraTurn(turn, time);
      camera.position.copy(pose.position); camera.up.copy(pose.up); controls.target.copy(pose.target); camera.lookAt(controls.target);
      controls.update();
      assert.ok(camera.position.distanceToSquared(pose.position) < 1e-12, `${view} at ${time} must not trip the external-change cancellation guard`);
      assert.ok(controls.target.distanceToSquared(pose.target) < 1e-12);
    }
    controls.dispose();
  }
});

test('projection clicking follows the current model bounds and render texture flips, leaving blank paper inactive', () => {
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
  camera.position.set(0, 0, 30); camera.lookAt(0, 0, 0);
  const bounds = new THREE.Box3(new THREE.Vector3(2, 4, -1), new THREE.Vector3(4, 6, 1));
  const hit = (x, y, options = {}) => isProjectionDrawingHit({ bounds, camera, uv: new THREE.Vector2(x, y), ...options });
  assert.equal(hit(0.65, 0.75), true); assert.equal(hit(0.5, 0.5), false);
  assert.equal(hit(0.58, 0.75), true, 'a small margin helps hit thin projected boundaries'); assert.equal(hit(0.57, 0.75), false);
  assert.equal(hit(0.35, 0.75, { flipX: true }), true); assert.equal(hit(0.65, 0.75, { flipX: true }), false);
  assert.equal(hit(0.65, 0.25, { flipY: true }), true); assert.equal(hit(0.35, 0.25, { flipX: true, flipY: true }), true);
  bounds.translate(new THREE.Vector3(-4, -4, 0)); assert.equal(hit(0.65, 0.75), false); assert.equal(hit(0.45, 0.55), true);
  assert.equal(isProjectionDrawingHit({ bounds, camera, uv: null }), false);
  assert.equal(isProjectionDrawingHit({ bounds: new THREE.Box3(), camera, uv: new THREE.Vector2(0.5, 0.5) }), false);
});
