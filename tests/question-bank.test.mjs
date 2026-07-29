import test from 'node:test';
import assert from 'node:assert/strict';

import { QUESTION_BANK, getQuestionById, validateQuestion, validateQuestionBank } from '../question-bank.js';
import {
  createPracticeRecord,
  directionAngleDegrees,
  evaluateInteractionAnswer,
  isPointInHotspot,
  summarizePractice
} from '../learning-logic.js';

test('mechanical practice bank has valid and unique questions', () => {
  assert.equal(QUESTION_BANK.length, 10);
  assert.deepEqual(validateQuestionBank(), []);
  assert.equal(getQuestionById('slot-hidden-line').modelId, 'slottedBlock');
});

test('first-angle projection places the top view below the front view', () => {
  const question = getQuestionById('first-angle-step-top');
  assert.deepEqual(question.answer, ['bottom']);
  assert.match(question.evidence, /主视图下方/);
});

test('practice record retains evidence-relevant response data', () => {
  const question = getQuestionById('through-hole-axis');
  const record = createPracticeRecord(question, ['perpendicular-axis'], 1000, {
    endedAt: 3400,
    attempts: 2,
    hintUsed: true,
    reflection: '孔轴线'
  });
  assert.equal(record.correct, false);
  assert.equal(record.responseTimeMs, 2400);
  assert.equal(record.misconception, 'axis-orientation');
  assert.equal(record.reflection, '孔轴线');
});

test('practice summary aggregates accuracy, hints and misconceptions', () => {
  const first = createPracticeRecord(getQuestionById('first-angle-step-top'), ['top'], 0, { endedAt: 100 });
  const second = createPracticeRecord(getQuestionById('through-hole-axis'), ['along-axis'], 0, { endedAt: 100, hintUsed: true });
  assert.deepEqual(summarizePractice([first, second]), {
    completed: 2,
    correct: 1,
    accuracy: 0.5,
    hintsUsed: 1,
    misconceptions: { 'first-angle-layout': 1 }
  });
});

test('interactive questions define valid targets and are evaluated without browser dependencies', () => {
  const rotate = getQuestionById('rotate-to-front');
  const modelClick = getQuestionById('click-model-barrel');
  const drawingClick = getQuestionById('click-hidden-line');
  const dimension = getQuestionById('mark-hole-diameter');

  assert.equal(validateQuestion(rotate).length, 0);
  assert.equal(validateQuestion(modelClick).length, 0);
  assert.equal(validateQuestion(drawingClick).length, 0);
  assert.equal(validateQuestion(dimension).length, 0);
  assert.ok(directionAngleDegrees([0, 0, 1], rotate.targetDirection) < 0.001);
  assert.equal(evaluateInteractionAnswer(rotate, { direction: [0, 0, 1] }).exact, true);
  assert.equal(evaluateInteractionAnswer(modelClick, { componentName: 'barrel' }).exact, true);
  assert.equal(evaluateInteractionAnswer(modelClick, { componentName: 'base' }).exact, false);
  assert.equal(isPointInHotspot({ u: 0.48, v: 0.48 }, dimension.hotspots[0]), true);
  assert.equal(evaluateInteractionAnswer(drawingClick, { view: 'front', u: 0.5, v: 0.5 }).exact, true);
  assert.equal(evaluateInteractionAnswer(drawingClick, { view: 'top', u: 0.5, v: 0.5 }).exact, false);
});

test('interactive practice records preserve the submitted interaction', () => {
  const question = getQuestionById('click-model-barrel');
  const record = createPracticeRecord(question, { componentName: 'barrel' }, 100, { endedAt: 400 });
  assert.equal(record.correct, true);
  assert.deepEqual(record.interaction, { componentName: 'barrel' });
  assert.deepEqual(record.selectedAnswers, []);
});
