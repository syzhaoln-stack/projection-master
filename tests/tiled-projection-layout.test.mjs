import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { computeTiledProjectionLayout } from '../tiled-projection-layout.js';

const cardSizes = {
  front: { width: 400, height: 140 },
  top: { width: 400, height: 140 },
  side: { width: 260, height: 140 }
};
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const source = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');
const viewStart = source.indexOf('const VIEW = {');
const viewEnd = source.indexOf('\n};', viewStart) + 3;
const actualViews = new Function('THREE', `${source.slice(viewStart, viewEnd)}\nreturn VIEW;`)(THREE);
const project = (layout, sizes, view, point) => {
  const axes = { front: [0, 1], top: [0, 2], side: [2, 1] }[view];
  return {
    x: sizes[view].width / 2 + (point[axes[0]] - layout.center[axes[0]]) / layout.unitsPerPixel,
    y: sizes[view].height / 2 - (point[axes[1]] - layout.center[axes[1]]) / layout.unitsPerPixel
  };
};

test('wide bridge fills rectangular front card instead of fitting a short square', () => {
  const layout = computeTiledProjectionLayout({ min: [-2.5, 0, -0.15], max: [2.5, 1, 0.15] }, cardSizes);
  near(5 / layout.unitsPerPixel, 344);
  assert.ok(layout.frames.front.halfWidth > layout.frames.front.halfHeight);
  assert.equal(layout.frames.front.renderWidth, 400);
  assert.equal(layout.frames.front.renderHeight, 140);
});

test('front/top X and front/side height stay aligned for off-center geometry', () => {
  const layout = computeTiledProjectionLayout({ min: [20, 7, -4], max: [25, 8, -3] }, cardSizes);
  for (const point of [[20, 7, -4], [25, 8, -3], [21.2, 7.7, -3.4]]) {
    const front = project(layout, cardSizes, 'front', point);
    const top = project(layout, cardSizes, 'top', point);
    const side = project(layout, cardSizes, 'side', point);
    near(front.x, top.x);
    near(front.y, side.y);
  }
});

test('depth has identical pixel length in top and side views', () => {
  const layout = computeTiledProjectionLayout({ min: [-2, -1, -3], max: [2, 1, 3] }, cardSizes);
  const a = [0, 0, -2], b = [0, 0, 2];
  near(Math.abs(project(layout, cardSizes, 'top', a).y - project(layout, cardSizes, 'top', b).y),
    Math.abs(project(layout, cardSizes, 'side', a).x - project(layout, cardSizes, 'side', b).x));
});

test('every view fits using one common scale even when depth is the limiting dimension', () => {
  const bounds = { min: [-1, -2, -8], max: [1, 2, 8] };
  const layout = computeTiledProjectionLayout(bounds, cardSizes);
  for (const view of ['front', 'top', 'side']) {
    const frame = layout.frames[view];
    near(frame.halfWidth * 2 / cardSizes[view].width, layout.unitsPerPixel);
    near(frame.halfHeight * 2 / cardSizes[view].height, layout.unitsPerPixel);
    for (const point of [bounds.min, bounds.max]) {
      const projected = project(layout, cardSizes, view, point);
      assert.ok(projected.x >= 0 && projected.x <= cardSizes[view].width);
      assert.ok(projected.y >= 0 && projected.y <= cardSizes[view].height);
    }
  }
});

test('focus and resize recalculate the shared center and scale without depending on raster density', () => {
  const bounds = { min: [11, 4, 8], max: [11.2, 4.3, 8.1] };
  const normal = computeTiledProjectionLayout(bounds, cardSizes);
  const retina = computeTiledProjectionLayout(bounds, cardSizes, { pixelRatio: 2 });
  const larger = Object.fromEntries(Object.entries(cardSizes).map(([view, size]) => [view, { width: size.width * 2, height: size.height * 2 }]));
  const resized = computeTiledProjectionLayout(bounds, larger);
  assert.deepEqual(normal.center, [11.1, 4.15, 8.05]);
  near(normal.unitsPerPixel, retina.unitsPerPixel);
  near(normal.unitsPerPixel / 2, resized.unitsPerPixel);
  assert.equal(retina.frames.front.renderWidth, normal.frames.front.renderWidth * 2);
});

test('hidden cards defer fitting and raster dimensions remain bounded', () => {
  const bounds = { min: [0, 0, 0], max: [1, 1, 1] };
  assert.equal(computeTiledProjectionLayout(bounds, { ...cardSizes, top: { width: 0, height: 140 } }), null);
  const huge = Object.fromEntries(Object.keys(cardSizes).map(view => [view, { width: 4000, height: 2000 }]));
  const layout = computeTiledProjectionLayout(bounds, huge, { pixelRatio: 2, maxTargetSize: 2048 });
  assert.equal(layout.frames.front.renderWidth, 2048);
  assert.equal(layout.frames.front.renderHeight, 1024);
});

test('actual orthographic cameras and first-angle image flips preserve all three alignment rules', () => {
  const layout = computeTiledProjectionLayout({ min: [20, 7, -4], max: [25, 8, -3] }, cardSizes);
  const cameras = Object.fromEntries(Object.entries(actualViews).map(([view, orientation]) => {
    const frame = layout.frames[view];
    const camera = new THREE.OrthographicCamera(-frame.halfWidth, frame.halfWidth, frame.halfHeight, -frame.halfHeight, 0.01, 400);
    camera.up.copy(orientation.up);
    camera.position.fromArray(layout.center).addScaledVector(orientation.eye, 100);
    camera.lookAt(new THREE.Vector3(...layout.center));
    camera.updateMatrixWorld(true);
    return [view, camera];
  }));
  const imagePoint = (view, point) => {
    const projected = new THREE.Vector3(...point).project(cameras[view]);
    const x = (projected.x + 1) / 2;
    return { x: (actualViews[view].flipX ? 1 - x : x) * cardSizes[view].width, y: (1 - projected.y) / 2 * cardSizes[view].height };
  };
  for (const point of [[20, 7, -4], [25, 8, -3], [21.2, 7.7, -3.4]]) {
    near(imagePoint('front', point).x, imagePoint('top', point).x);
    near(imagePoint('front', point).y, imagePoint('side', point).y);
  }
  const a = [21, 7.5, -3.8], b = [21, 7.5, -3.2];
  near(imagePoint('top', b).y - imagePoint('top', a).y,
    imagePoint('side', b).x - imagePoint('side', a).x);
});

test('left-view camera sees the left near face and projection-plane U increases toward positive Z', () => {
  assert.deepEqual(actualViews.side.eye.toArray(), [-1, 0, 0]);
  assert.equal(actualViews.side.flipX, false);
  const geometry = new THREE.BoxGeometry(0.5, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  const leftObject = new THREE.Mesh(geometry, material);
  const rightObject = new THREE.Mesh(geometry, material);
  leftObject.position.x = -1;
  rightObject.position.x = 1;
  leftObject.updateMatrixWorld(true);
  rightObject.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(actualViews.side.eye.clone().multiplyScalar(10), actualViews.side.eye.clone().negate());
  assert.equal(raycaster.intersectObjects([rightObject, leftObject])[0].object, leftObject);
  const foldedPlaneU = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, -Math.PI / 2, 0));
  near(foldedPlaneU.z, 1);
  near(foldedPlaneU.x, 0);
  assert.match(source, /key: 'side', label: '左视图', direction: \[-1, 0, 0\]/);
  geometry.dispose();
  material.dispose();
});
