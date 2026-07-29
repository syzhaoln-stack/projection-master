import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyLineLine,
  classifyLinePlane,
  classifyLineProjection,
  classifyPlanePlane,
  classifyPlaneProjection,
  engineeringToWorld,
  lineLength,
  pointInPlane,
  pointOnLine,
  projectPoint,
  projectPointFirstAngle,
  triangleArea3D
} from '../basic-projection-math.js';

const closeTo = (actual, expected, tolerance = 1e-10) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
};

test('engineering coordinates keep width Y distinct from height Z in the 3D world', () => {
  assert.deepEqual(engineeringToWorld({ x: 2, y: 3, z: 4 }), [2, 4, 3]);
  assert.deepEqual(engineeringToWorld([-.5, 1.25, 2.75]), [-.5, 2.75, 1.25]);
});

test('point projections preserve the three principal coordinate correspondences', () => {
  const point = { x: 2, y: 3, z: 4 };

  assert.deepEqual(projectPoint(point, 'front'), [2, 4]);
  assert.deepEqual(projectPoint(point, 'top'), [2, 3]);
  assert.deepEqual(projectPoint(point, 'side'), [3, 4]);

  const [frontX, frontZ] = projectPoint(point, 'front');
  const [topX, topY] = projectPoint(point, 'top');
  const [sideY, sideZ] = projectPoint(point, 'side');
  assert.equal(frontX, topX, 'front and top views must align in x');
  assert.equal(frontZ, sideZ, 'front and side views must align in height z');
  assert.equal(topY, sideY, 'top and side views must carry the same width y');
});

test('first-angle sheet orientation places positive depth downward in the top view', () => {
  const point = { x: 2, y: 3, z: 4 };
  assert.deepEqual(projectPointFirstAngle(point, 'front'), [2, 4]);
  assert.deepEqual(projectPointFirstAngle(point, 'top'), [2, -3]);
  assert.deepEqual(projectPointFirstAngle(point, 'side'), [3, 4]);
});

test('line projection distinguishes true length, foreshortening and accumulation', () => {
  const start = [0, 0, 0];
  const end = [3, 0, 4];
  closeTo(lineLength(start, end), 5);

  const front = classifyLineProjection(start, end, 'front');
  const top = classifyLineProjection(start, end, 'top');
  const side = classifyLineProjection(start, end, 'side');

  assert.equal(front.classification, 'true-length');
  assert.equal(front.label, '实长');
  closeTo(front.projectedLength, 5);
  assert.equal(top.classification, 'foreshortened');
  assert.equal(top.label, '缩短');
  closeTo(top.projectedLength, 3);
  assert.equal(side.classification, 'foreshortened');
  closeTo(side.projectedLength, 4);

  const depthLine = classifyLineProjection([1, 0, 2], [1, 5, 2], 'front');
  assert.equal(depthLine.classification, 'collapsed');
  assert.equal(depthLine.label, '积聚');
  closeTo(depthLine.projectedLength, 0);
});

test('plane projection distinguishes true shape, similar shape and accumulation', () => {
  const xzA = [0, 0, 0];
  const xzB = [2, 0, 0];
  const xzC = [0, 0, 3];
  closeTo(triangleArea3D(xzA, xzB, xzC), 3);

  const trueShape = classifyPlaneProjection(xzA, xzB, xzC, 'front');
  const collapsed = classifyPlaneProjection(xzA, xzB, xzC, 'top');
  assert.equal(trueShape.classification, 'true-shape');
  assert.equal(trueShape.label, '实形');
  closeTo(trueShape.projectedArea, 3);
  assert.equal(collapsed.classification, 'collapsed');
  assert.equal(collapsed.label, '积聚');

  const obliqueA = [0, 0, 0];
  const obliqueB = [1, 0, 1];
  const obliqueC = [0, 1, 1];
  const oblique = classifyPlaneProjection(obliqueA, obliqueB, obliqueC, 'front');
  assert.equal(oblique.classification, 'foreshortened');
  assert.equal(oblique.label, '类似');
  closeTo(oblique.trueArea, Math.sqrt(3) / 2);
  closeTo(oblique.projectedArea, 0.5);
  assert.ok(oblique.ratio > 0 && oblique.ratio < 1);
});

test('point membership works for infinite lines and planes', () => {
  assert.equal(pointOnLine([2, 2, 2], [0, 0, 0], [1, 1, 1]), true);
  assert.equal(pointOnLine([2, 2, 3], [0, 0, 0], [1, 1, 1]), false);

  const plane = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  assert.equal(pointInPlane([0.25, 0.5, 0], ...plane), true);
  assert.equal(pointInPlane([0.25, 0.5, 0.1], ...plane), false);
});

test('line-line classification covers coincident, parallel, intersecting and skew lines', () => {
  assert.equal(
    classifyLineLine([0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]),
    'coincident'
  );
  assert.equal(
    classifyLineLine([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]),
    'parallel'
  );
  assert.equal(
    classifyLineLine([-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0]),
    'intersecting'
  );
  assert.equal(
    classifyLineLine([0, 0, 0], [1, 0, 0], [0, 1, 1], [0, 2, 1]),
    'skew'
  );
});

test('line-plane classification covers contained, parallel, perpendicular and oblique intersection', () => {
  const plane = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];

  assert.equal(classifyLinePlane([0, 0, 0], [1, 1, 0], ...plane), 'contained');
  assert.equal(classifyLinePlane([0, 0, 1], [1, 0, 1], ...plane), 'parallel');
  assert.equal(classifyLinePlane([0, 0, -1], [0, 0, 1], ...plane), 'perpendicular');
  assert.equal(classifyLinePlane([0, 0, -1], [1, 0, 1], ...plane), 'intersecting');
});

test('plane-plane classification covers coincident, parallel, perpendicular and general intersection', () => {
  const xy = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const xySame = [[1, 1, 0], [2, 1, 0], [1, 2, 0]];
  const xyRaised = [[0, 0, 1], [1, 0, 1], [0, 1, 1]];
  const xz = [[0, 0, 0], [1, 0, 0], [0, 0, 1]];
  const oblique = [[0, 0, 0], [1, 0, 1], [0, 1, 0]];

  assert.equal(classifyPlanePlane(...xy, ...xySame), 'coincident');
  assert.equal(classifyPlanePlane(...xy, ...xyRaised), 'parallel');
  assert.equal(classifyPlanePlane(...xy, ...xz), 'perpendicular');
  assert.equal(classifyPlanePlane(...xy, ...oblique), 'intersecting');
});
