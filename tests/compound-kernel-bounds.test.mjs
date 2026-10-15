import assert from 'node:assert/strict';
import test from 'node:test';
import { getCompoundLesson } from '../compound-projection-lessons.js';
import { loadExactKernel } from './helpers/exact-kernel.mjs';

const kernel = await loadExactKernel();

function payloadFor(id) {
  const lesson = getCompoundLesson(id);
  const stage = lesson.stages.at(-1);
  return {
    lessonId: id, slotLength: 50,
    appliedCutters: [...stage.appliedCutters], visibleComponents: [...stage.visible],
    cutterValues: Object.fromEntries(lesson.cutters.map(cutter => [cutter.id, { ...cutter.defaults }]))
  };
}

function semanticFacts(shape, payload) {
  // HLR camera integration is tested separately. Keep real geometric bounds,
  // tessellation and all production material probes for exhaustive bounds tests.
  const camera = kernel.TEXTBOOK_PROJECTION_CAMERAS;
  const projections = {
    front: { cameraPlane: camera.front, horizontalMirrored: false, visiblePaths: 1, frame: [0, 0, 10, 8] },
    side: { cameraPlane: camera.side, horizontalMirrored: false, visiblePaths: 1, frame: [0, 0, 6, 8] },
    top: { cameraPlane: camera.top, horizontalMirrored: false, visiblePaths: 1, frame: [0, 0, 10, 6] }
  };
  const { facts } = kernel.commonFacts(shape, payload.lessonId, projections);
  kernel.addLessonChecks(shape, facts, payload);
  return facts;
}

test('example 5-6 exact audit accepts both legal rear-slot X limits', () => {
  for (const x of [0.25, 0.85]) {
    const payload = payloadFor('example-5-6');
    payload.cutterValues['cut-iv'].x = x;
    const result = kernel.auditLesson(payload);
    assert.equal(result.facts.passed, true, JSON.stringify({ x, ...result.facts }));
  }
});

test('all current lesson parameter boundaries retain the exact semantic audit', () => {
  for (const id of ['example-5-1', 'example-5-5', 'example-5-6']) {
    const lesson = getCompoundLesson(id);
    const build = kernel[{ 'example-5-1': 'buildExample51', 'example-5-5': 'buildExample55', 'example-5-6': 'buildExample56' }[id]];
    const variants = [{ name: 'default', payload: payloadFor(id) }];
    for (const cutter of lesson.cutters) for (const axis of cutter.axes) for (const value of [axis.min, axis.max]) {
      const payload = payloadFor(id);
      payload.cutterValues[cutter.id][axis.id] = value;
      variants.push({ name: `${cutter.id}.${axis.id}=${value}`, payload });
    }
    for (const parameter of lesson.parameters || []) for (const value of [parameter.min, parameter.max]) {
      const payload = payloadFor(id);
      if (parameter.id === 'slotLength') payload.slotLength = value * 10;
      variants.push({ name: `${parameter.id}=${value}`, payload });
    }
    for (const { name, payload } of variants) {
      const shape = build(payload);
      const facts = semanticFacts(shape, payload);
      shape.delete();
      assert.equal(facts.passed, true, JSON.stringify({ id, name, ...facts }));
    }
  }
});

test('example 5-6 semantic probes reject front and rear cuts swapped onto the wrong wall', () => {
  for (const cutter of ['cut-iii', 'cut-iv']) for (const x of [0.25, 0.55, 0.85]) {
    const payload = payloadFor('example-5-6');
    payload.appliedCutters = [cutter];
    payload.cutterValues[cutter].x = x;
    const shape = kernel.buildExample56(payload);
    const correct = semanticFacts(shape, payload);
    assert.equal(correct.passed, true, JSON.stringify({ cutter, x, ...correct }));
    const swapped = shape.clone().mirror('XZ');
    const wrong = semanticFacts(swapped, payload);
    assert.equal(wrong.semanticValid, false, `swapped ${cutter} at ${x} must fail`);
    assert.equal(cutter === 'cut-iii' ? wrong.frontWallStateMatches : wrong.rearWallStateMatches, false);
    shape.delete(); swapped.delete();
  }
});

test('all 128 simultaneous example 5-6 parameter-limit combinations pass material and strict bounds checks', () => {
  const lesson = getCompoundLesson('example-5-6');
  const axes = lesson.cutters.flatMap(cutter => cutter.axes.map(axis => ({ cutterId: cutter.id, ...axis })));
  assert.equal(axes.length, 7);
  for (let mask = 0; mask < 2 ** axes.length; mask += 1) {
    const payload = payloadFor(lesson.id);
    axes.forEach((axis, index) => { payload.cutterValues[axis.cutterId][axis.id] = mask & (1 << index) ? axis.max : axis.min; });
    const shape = kernel.buildExample56(payload);
    const facts = semanticFacts(shape, payload);
    shape.delete();
    assert.equal(facts.passed, true, JSON.stringify({ mask, cutters: payload.cutterValues, ...facts }));
  }
});

test('both slots swapped together and actual dimension errors still fail the strengthened audit', () => {
  const payload = payloadFor('example-5-6');
  const shape = kernel.buildExample56(payload);
  const swapped = shape.clone().mirror('XZ');
  const wrongDirection = semanticFacts(swapped, payload);
  assert.equal(wrongDirection.frontFloorSupportValid, false, 'rounded rear cut must not remove support below the flat front floor');
  assert.equal(wrongDirection.rearArcStateMatches, false, 'rectangular front cut must not replace the lower rear arc');
  assert.equal(wrongDirection.passed, false);
  const enlarged = shape.clone().scale(1.001);
  const wrongSize = semanticFacts(enlarged, payload);
  assert.equal(wrongSize.boundsValid, false, 'a true 0.1% geometric size error must not be hidden by curve tolerance');
  assert.equal(wrongSize.passed, false);
  shape.delete(); swapped.delete(); enlarged.delete();
});
