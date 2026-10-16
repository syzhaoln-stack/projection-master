import * as THREE from 'three';

// A tiny frontward offset avoids OrbitControls' polar singularity while the
// top direction remains indistinguishable from +Y at teaching scale.
export const GALLERY_VIEW_DIRECTIONS = Object.freeze({
  front: Object.freeze([0, 0, 1]),
  top: Object.freeze([0, 1, 0.0001]),
  side: Object.freeze([-1, 0, 0])
});

export function createProjectionCameraTurn({ view, position, target, up, center, startedAt, duration = 450 }) {
  const components = [position, target, up, center];
  if (!GALLERY_VIEW_DIRECTIONS[view] || components.some(value => !value?.isVector3 || !value.toArray().every(Number.isFinite))) return null;
  const offset = position.clone().sub(target), distance = offset.length();
  if (distance <= 1e-8 || !Number.isFinite(startedAt) || !Number.isFinite(duration) || duration < 0) return null;
  const fromDirection = offset.normalize(), direction = new THREE.Vector3(...GALLERY_VIEW_DIRECTIONS[view]).normalize();
  return { view, fromDirection, rotation: new THREE.Quaternion().setFromUnitVectors(fromDirection, direction),
    fromTarget: target.clone(), center: center.clone(), fromUp: up.clone().normalize(), distance, startedAt, duration };
}

export function sampleProjectionCameraTurn(turn, time) {
  const t = turn.duration ? THREE.MathUtils.clamp((time - turn.startedAt) / turn.duration, 0, 1) : 1;
  const eased = t * t * (3 - 2 * t);
  const target = turn.fromTarget.clone().lerp(turn.center, eased);
  const rotation = new THREE.Quaternion().slerp(turn.rotation, eased);
  const direction = turn.fromDirection.clone().applyQuaternion(rotation).normalize();
  const up = turn.fromUp.clone().lerp(new THREE.Vector3(0, 1, 0), eased);
  if (up.lengthSq() < 1e-10) up.set(0, 1, 0);
  else up.normalize();
  return { position: target.clone().addScaledVector(direction, turn.distance), target, up, done: t === 1 };
}

// PlaneGeometry UVs and the render-target texture both use bottom-to-top Y.
// Keep only the projected model rectangle clickable; the large blank paper is
// still available for clearing a selected face.
export function isProjectionDrawingHit({ bounds, camera, uv, flipX = false, flipY = false, padding = 0.025 }) {
  if (!bounds?.isBox3 || bounds.isEmpty() || !camera?.isCamera || !uv
    || ![uv.x, uv.y].every(Number.isFinite) || uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) return false;
  camera.updateMatrixWorld(true);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    const u = flipX ? (1 - point.x) / 2 : (point.x + 1) / 2;
    const v = flipY ? (1 - point.y) / 2 : (point.y + 1) / 2;
    if (![u, v].every(Number.isFinite)) return false;
    minX = Math.min(minX, u); minY = Math.min(minY, v); maxX = Math.max(maxX, u); maxY = Math.max(maxY, v);
  }
  return uv.x >= minX - padding && uv.x <= maxX + padding && uv.y >= minY - padding && uv.y <= maxY + padding;
}
