import assert from 'node:assert/strict';
import test from 'node:test';
import { createDrawingStyle, centerlineSegments, centerlineSvgPath, DRAWING_PAPER_STYLE } from '../drawing-style.js';

const near = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} != ${expected}`);
const pattern = { longDash: 8, gap: 1.5, dot: 0.35 };
const intervals = positions => Array.from({ length: positions.length / 6 }, (_, index) => [positions[index * 6], positions[index * 6 + 3]]);

test('both paper line families keep every thin line at half the visible contour weight', () => {
  for (const boldEdges of [false, true]) {
    const style = createDrawingStyle({ boldEdges, pixelsPerPaperMm: 1024 / 160, drawingUnitsPerPaperMm: 5 / 160 });
    near(style.paper.visibleWidthMm, boldEdges ? 0.7 : 0.5);
    for (const key of ['hiddenWidth', 'centerWidth', 'dimensionWidth', 'hiddenEmphasisWidth']) {
      near(style.visibleWidth / style[key], 2, key);
    }
    assert.equal(style.color, '#000000');
  }
});

test('paper style changes with output resolution and projection scale independently', () => {
  const base = createDrawingStyle({ pixelsPerPaperMm: 2, drawingUnitsPerPaperMm: 0.1 });
  const pixels = createDrawingStyle({ pixelsPerPaperMm: 4, drawingUnitsPerPaperMm: 0.1 });
  const units = createDrawingStyle({ pixelsPerPaperMm: 2, drawingUnitsPerPaperMm: 0.2 });
  near(pixels.visibleWidth, 2 * base.visibleWidth);
  assert.deepEqual(pixels.hiddenDash, base.hiddenDash, 'resampling pixels must not alter drawing geometry');
  near(units.visibleWidth, base.visibleWidth);
  base.centerDash.forEach((value, index) => near(units.centerDash[index], value * 2));
  near(units.centerExtension, 2 * base.centerExtension);
  assert.deepEqual(base.hiddenDashPixels, [6, 3]);
  assert.equal(DRAWING_PAPER_STYLE.centerExtensionMm, 3);
});

test('center axes use distinct long and dot strokes with solid endpoints and a solid intersection', () => {
  const strokes = intervals(centerlineSegments([[[0, 0, 0], [100, 0, 0]]], pattern));
  near(strokes[0][0], 0);
  near(strokes.at(-1)[1], 100);
  assert.ok(strokes[0][1] > pattern.dot * 5, 'an endpoint must not be a dot');
  assert.ok(100 - strokes.at(-1)[0] > pattern.dot * 5);
  const middle = strokes.find(([start, end]) => start < 50 && end > 50);
  assert.ok(middle && middle[1] - middle[0] > pattern.dot * 5, 'crosshair centre must be inside a long stroke');
  assert.ok(strokes.some(([start, end]) => Math.abs(end - start - pattern.dot) < 1e-10), 'a plain dashed line is not a centerline');
  for (let index = 1; index < strokes.length; index++) near(strokes[index][0] - strokes[index - 1][1], pattern.gap);
  strokes.forEach(([start, end], index) => {
    const mirrored = strokes[strokes.length - index - 1];
    near(start, 100 - mirrored[1]);
    near(end, 100 - mirrored[0]);
  });
});

test('independent axes do not inherit each other’s dash phase and cross at long strokes', () => {
  const x = [[-50, 0, 0], [50, 0, 0]], y = [[0, -50, 0], [0, 50, 0]];
  const horizontal = centerlineSegments([x], pattern), vertical = centerlineSegments([y], pattern);
  assert.deepEqual(centerlineSegments([x, y], pattern), [...horizontal, ...vertical]);
  assert.ok(intervals(horizontal).some(([start, end]) => start < 0 && end > 0));
  assert.ok(Array.from({ length: vertical.length / 6 }, (_, i) => [vertical[i * 6 + 1], vertical[i * 6 + 4]])
    .some(([start, end]) => start < 0 && end > 0));
});

test('3D direction and input geometry survive splitting, including Vector3-shaped inputs', () => {
  const source = [[{ x: -20, y: -40, z: -60 }, { x: 20, y: 40, z: 60 }]];
  const original = structuredClone(source);
  const positions = centerlineSegments(source, pattern);
  assert.deepEqual(source, original);
  for (let index = 0; index < positions.length; index += 3) {
    near(positions[index + 1], positions[index] * 2);
    near(positions[index + 2], positions[index] * 3);
  }
  assert.deepEqual(positions.slice(0, 3), [-20, -40, -60]);
  assert.deepEqual(positions.slice(-3), [20, 40, 60]);
});

test('short axes are thin solid segments; zero-length axes produce no geometry', () => {
  assert.deepEqual(centerlineSegments([[[0, 0, 0], [5, 0, 0]]], pattern), [0, 0, 0, 5, 0, 0]);
  assert.deepEqual(centerlineSegments([[[2, 3, 4], [2, 3, 4]]], pattern), []);
});

test('SVG centre axes and WebGL centre axes share the same geometric phase', () => {
  const svg = centerlineSvgPath('M -50 0 L 50 0', pattern);
  const expected = centerlineSegments([[[-50, 0, 0], [50, 0, 0]]], pattern);
  const actual = [...svg.matchAll(/M (\S+) (\S+) L (\S+) (\S+)/g)].flatMap(match => [Number(match[1]), Number(match[2]), 0, Number(match[3]), Number(match[4]), 0]);
  assert.deepEqual(actual, expected);
  assert.ok(centerlineSvgPath('M 1e1, 2e1 L 3e1, 4e1', pattern));
  assert.equal(centerlineSvgPath('M 0 0 A 1 1 0 0 0 2 2', pattern), null, 'unknown curves must not be guessed as straight lines');
});

test('invalid coordinate and conversion contracts fail before generating unusable geometry', () => {
  for (const invalid of [0, -1, Infinity, NaN]) {
    assert.throws(() => createDrawingStyle({ pixelsPerPaperMm: invalid }), RangeError);
    assert.throws(() => createDrawingStyle({ drawingUnitsPerPaperMm: invalid }), RangeError);
  }
  assert.throws(() => centerlineSegments([[[0, 0, NaN], [1, 0, 0]]], pattern), TypeError);
  assert.throws(() => centerlineSegments([[[0, 0, 0], [1, 0, 0]]], { ...pattern, dot: 8 }), RangeError);
});
