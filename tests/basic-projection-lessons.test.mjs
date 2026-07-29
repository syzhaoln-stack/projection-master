import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAB_LESSONS,
  LINE_PRESETS,
  PLANE_PRESETS,
  PROJECTION_TYPES,
  RELATION_PRESETS,
  createLabState,
  getLabQuestion,
  validateLabLessons
} from '../basic-projection-lessons.js';
import {
  classifyLineProjection,
  classifyPlaneProjection
} from '../basic-projection-math.js';

const VIEWS = ['front', 'top', 'side'];

test('basic projection lessons follow the textbook point-line-plane progression', () => {
  assert.deepEqual(LAB_LESSONS.map(lesson => lesson.id), [
    'projection',
    'point',
    'line',
    'plane',
    'relation'
  ]);
  assert.deepEqual(validateLabLessons(), []);
});

test('point task connects engineering height z with the vertical coordinate in front and side views', () => {
  const state = { ...createLabState(), lessonId: 'point' };
  const question = getLabQuestion(state);
  assert.equal(question.type, 'multiple');
  assert.deepEqual(question.answer, ['front', 'side']);
  assert.match(question.evidence, /高度 z/);
});

test('line task derives true length and accumulation from projection geometry', () => {
  const frontParallel = {
    a: { x: -1.6, y: 0.55, z: 0.1 },
    b: { x: 1.3, y: 0.55, z: 1.6 }
  };
  const frontParallelViews = Object.fromEntries(
    VIEWS.map(view => [view, classifyLineProjection(frontParallel.a, frontParallel.b, view)])
  );
  const trueLengthQuestion = getLabQuestion(
    { ...createLabState(), lessonId: 'line', linePreset: 'front-parallel' },
    { lineViews: frontParallelViews }
  );
  assert.deepEqual(trueLengthQuestion.answer, ['front']);

  const frontPerpendicular = {
    a: { x: 0.35, y: -1.2, z: 0.9 },
    b: { x: 0.35, y: 1.4, z: 0.9 }
  };
  const frontPerpendicularViews = Object.fromEntries(
    VIEWS.map(view => [view, classifyLineProjection(frontPerpendicular.a, frontPerpendicular.b, view)])
  );
  const accumulatedQuestion = getLabQuestion(
    { ...createLabState(), lessonId: 'line', linePreset: 'front-perpendicular' },
    { lineViews: frontPerpendicularViews }
  );
  assert.deepEqual(accumulatedQuestion.answer, ['front']);
  assert.match(accumulatedQuestion.prompt, /积聚为点/);
});

test('plane task derives true shape from a horizontal plane', () => {
  const triangle = [
    { x: -1.4, y: -0.8, z: 0.9 },
    { x: 1.3, y: -0.5, z: 0.9 },
    { x: -0.2, y: 1.25, z: 0.9 }
  ];
  const planeViews = Object.fromEntries(
    VIEWS.map(view => [view, classifyPlaneProjection(...triangle, view)])
  );
  const question = getLabQuestion(
    { ...createLabState(), lessonId: 'plane', planePreset: 'horizontal' },
    { planeViews }
  );
  assert.deepEqual(question.answer, ['top']);
  assert.match(question.prompt, /实形/);
});

test('projection and relation questions remain tied to the selected condition', () => {
  const central = getLabQuestion({ ...createLabState(), projectionType: 'central' });
  assert.deepEqual(central.answer, ['no']);
  assert.match(central.evidence, /投影中心/);

  const skew = getLabQuestion({
    ...createLabState(),
    lessonId: 'relation',
    relationPreset: 'skew-lines'
  });
  assert.deepEqual(skew.answer, ['skew']);
  assert.match(skew.evidence, /交叉直线/);
});

test('every lesson variant provides a complete answer contract', () => {
  const classification = (kind, label = kind) => ({ classification: kind, label });
  const allShortened = Object.fromEntries(VIEWS.map(view => [view, classification('foreshortened')]));
  const lineAnalyses = {
    general: { lineViews: allShortened },
    'front-parallel': {
      lineViews: {
        front: classification('true-length'),
        top: classification('foreshortened'),
        side: classification('foreshortened')
      }
    },
    'front-perpendicular': {
      lineViews: {
        front: classification('collapsed'),
        top: classification('true-length'),
        side: classification('true-length')
      }
    }
  };
  const planeAnalyses = {
    general: { planeViews: allShortened },
    horizontal: {
      planeViews: {
        front: classification('collapsed'),
        top: classification('true-shape'),
        side: classification('collapsed')
      }
    },
    'front-perpendicular': {
      planeViews: {
        front: classification('collapsed'),
        top: classification('foreshortened'),
        side: classification('foreshortened')
      }
    }
  };

  const questions = [
    ...PROJECTION_TYPES.map(({ id }) => getLabQuestion({ ...createLabState(), projectionType: id })),
    getLabQuestion({ ...createLabState(), lessonId: 'point' }),
    ...LINE_PRESETS.map(({ id }) => getLabQuestion(
      { ...createLabState(), lessonId: 'line', linePreset: id },
      lineAnalyses[id]
    )),
    ...PLANE_PRESETS.map(({ id }) => getLabQuestion(
      { ...createLabState(), lessonId: 'plane', planePreset: id },
      planeAnalyses[id]
    )),
    ...RELATION_PRESETS.map(({ id }) => getLabQuestion({
      ...createLabState(),
      lessonId: 'relation',
      relationPreset: id
    }))
  ];

  questions.forEach((question, index) => {
    assert.ok(question.prompt?.trim(), `question ${index + 1} needs a prompt`);
    assert.ok(question.evidence?.trim(), `question ${index + 1} needs evidence`);
    assert.ok(question.choices?.length >= 2, `question ${index + 1} needs answer choices`);
    assert.ok(question.answer?.length, `question ${index + 1} needs an answer`);
    const choiceIds = question.choices.map(choice => choice.id);
    assert.equal(new Set(choiceIds).size, choiceIds.length, `question ${index + 1} has duplicate choice ids`);
    question.answer.forEach(answer => {
      assert.ok(choiceIds.includes(answer), `question ${index + 1} answer ${answer} is not a choice`);
    });
  });
});
