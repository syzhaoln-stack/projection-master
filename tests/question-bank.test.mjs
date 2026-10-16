import test from 'node:test';
import assert from 'node:assert/strict';
import { QUESTION_BANK, getQuestionById, validateQuestion, validateQuestionBank } from '../question-bank.js';
import { BRIDGE_MODELS } from '../bridge-models.js';
import { CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG } from '../model-library-curation.js';
import contract from '../textbook-mechanical-contract.json' with { type: 'json' };
import { createPracticeRecord, directionAngleDegrees, evaluateInteractionAnswer, evaluateQuestionAnswer, isPointInHotspot, summarizePractice } from '../learning-logic.js';

const mechanicalIds = new Set(contract.models.map(model => model.id));
const allowedIds = new Set([...mechanicalIds, ...CURATED_BRIDGE_CATALOG.map(model => model.id), ...CURATED_DRAWING_CATALOG.map(model => model.id)]);
const model = id => contract.models.find(item => item.id === id);

test('sixteen source-linked questions use the latest model library, with all eight mechanical models before bridges', () => {
  assert.equal(QUESTION_BANK.length, 16);
  assert.deepEqual(validateQuestionBank(), []);
  assert.deepEqual(new Set(QUESTION_BANK.slice(0, 10).map(question => question.modelId)), mechanicalIds);
  assert.ok(QUESTION_BANK.slice(10).every(question => !mechanicalIds.has(question.modelId)));
  assert.equal(getQuestionById('unknown-question'), null);
  for (const question of QUESTION_BANK) {
    assert.ok(allowedIds.has(question.modelId), question.modelId);
    assert.ok(question.source && question.evidence && question.hint);
    assert.equal(Object.hasOwn(question, 'reflection'), false);
    assert.equal(Object.hasOwn(question, 'hotspots'), false, 'fixed UV regions cannot follow a reframed projection');
    assert.ok(['single', 'multiple', 'rotate-to-view', 'click-model'].includes(question.type));
    assert.doesNotMatch(question.prompt + question.hint, /你如何|你用.*确认|哪一个动作|作出.*判断/);
    if (mechanicalIds.has(question.modelId)) {
      assert.ok(['single', 'multiple'].includes(question.type), 'fused BRep bodies have no fabricated component targets');
      assert.equal(Object.hasOwn(question, 'focusComponent'), false);
    }
    if (question.options) {
      assert.equal(evaluateQuestionAnswer(question, question.answer).exact, true);
      const wrong = question.options.find(option => !question.answer.includes(option.id));
      assert.ok(wrong, 'each question needs an actual distractor');
      assert.equal(evaluateQuestionAnswer(question, [wrong.id]).exact, false);
    }
  }
});

test('first-angle projection puts the top view below and keeps the current left-view direction', () => {
  const question = getQuestionById('textbook-flange-first-angle');
  assert.deepEqual(question.answer, ['below']);
  assert.match(question.evidence, /俯视图位于主视图下方/);
  assert.match(question.evidence, /左视图位于主视图右侧/);
  const targets = { 'bridge-rotate-plan': [0, 1, 0], 'bridge-rotate-elevation': [0, 0, 1], 'bridge-rotate-section': [-1, 0, 0] };
  for (const [id, direction] of Object.entries(targets)) {
    const item = getQuestionById(id);
    assert.deepEqual(item.targetDirection, direction);
    assert.ok(item.toleranceDegrees <= 6);
    assert.equal(evaluateInteractionAnswer(item, { direction }).exact, true);
    assert.equal(evaluateInteractionAnswer(item, { direction: direction.map(value => -value) }).exact, false);
    assert.equal(directionAngleDegrees(direction, item.targetDirection), 0);
  }
  assert.equal(getQuestionById('bridge-rotate-section').targetView, 'side');
  assert.doesNotMatch(getQuestionById('bridge-rotate-section').prompt, /横断面|剖面/);
});

test('dimension and opening answers agree with the committed source contracts', () => {
  const flange = model('textbookFlange').parameters;
  assert.equal(flange.counterboreRadius * 2, 30);
  assert.equal(flange.counterboreDepth, 3);
  assert.ok(flange.counterboreRadius > flange.holeRadius);
  assert.deepEqual(getQuestionById('textbook-flange-counterbore').answer, ['counterbore']);
  const shaft = model('textbookKeyedShaft').parameters;
  assert.equal(shaft.slotLength, 14 + shaft.slotWidth);
  assert.equal(String(shaft.slotLength), getQuestionById('textbook-keyway-total-length').answer[0]);
  assert.ok(shaft.slotDepth < shaft.radius * 2 && shaft.slotLength < shaft.length);
  assert.deepEqual(getQuestionById('textbook-keyway-blind').answer, ['blind']);
  const valve = model('textbookValveAdapter').parameters;
  assert.deepEqual(getQuestionById('textbook-valve-stepped-bore').answer.map(Number), [valve.boreRadius * 2, valve.rearBoreRadius * 2]);
  assert.equal(valve.rearBoreDepth, 6);
  assert.equal(valve.neckRadius * 2, 38);
  assert.ok(model('textbookSlotCylinder').features.includes('底部等宽中央舌'));
  assert.ok(model('textbookObliqueCylinder').features.includes('正垂斜截面'));
  assert.ok(model('textbook51').features.includes('中心通孔'));
  assert.ok(model('textbook55').features.includes('底部全长贯穿槽'));
  assert.ok(model('textbook56').features.includes('前方槽') && model('textbook56').features.includes('后倒置拱形槽'));
});

test('every bridge click target exists as a real visible mesh in its current curated model', () => {
  const roots = new Map();
  try {
    for (const question of QUESTION_BANK.filter(item => item.type === 'click-model')) {
      if (!roots.has(question.modelId)) roots.set(question.modelId, BRIDGE_MODELS[question.modelId].build());
      const root = roots.get(question.modelId);
      for (const target of question.targetComponents) {
        const hits = [];
        root.traverse(object => { if (object.isMesh && object.visible && object.name === target) hits.push(object); });
        assert.ok(hits.length, `${question.modelId} must contain real ${target} meshes`);
        assert.ok(hits.every(mesh => mesh.geometry.attributes.position.count > 0));
        assert.equal(evaluateInteractionAnswer(question, { componentName: hits[0].name }).exact, true);
      }
      assert.equal(evaluateInteractionAnswer(question, { componentName: 'body' }).exact, false);
    }
  } finally {
    const geometries = new Set(), materials = new Set();
    for (const root of roots.values()) root.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) materials.add(material);
    });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
  }
});

test('practice records retain submitted answer, time and misconception without reflection content', () => {
  const question = getQuestionById('textbook51-cylinder-front');
  const record = createPracticeRecord(question, ['side'], 1000, { endedAt: 3400, attempts: 2, hintUsed: true });
  assert.equal(record.correct, false);
  assert.equal(record.responseTimeMs, 2400);
  assert.equal(record.attempts, 2);
  assert.equal(record.hintUsed, true);
  assert.equal(record.misconception, 'axis-orientation');
  assert.deepEqual(record.selectedAnswers, ['side']);
  assert.ok(!record.reflection);
  const click = createPracticeRecord(getQuestionById('bridge-click-tower'), { componentName: 'tower' }, 100, { endedAt: 400 });
  assert.equal(click.correct, true);
  assert.deepEqual(click.interaction, { componentName: 'tower' });
  assert.deepEqual(click.selectedAnswers, []);
});

test('practice summary aggregates direct answer accuracy, hints and misconceptions', () => {
  const first = createPracticeRecord(getQuestionById('textbook-flange-first-angle'), ['above'], 0, { endedAt: 100 });
  const second = createPracticeRecord(getQuestionById('textbook51-cylinder-front'), ['front'], 0, { endedAt: 100, hintUsed: true });
  assert.deepEqual(summarizePractice([first, second]), { completed: 2, correct: 1, accuracy: 0.5, hintsUsed: 1, misconceptions: { 'first-angle-layout': 1 } });
});

test('generic hotspot APIs still validate boundaries and reject the wrong view without publishing fixed hotspot questions', () => {
  const circle = { id: 'round', shape: 'circle', u: 0.5, v: 0.5, radius: 0.1 };
  const rectangle = { id: 'rect', shape: 'rect', u: 0.1, v: 0.1, width: 0.1, height: 0.2 };
  const synthetic = { ...QUESTION_BANK[0], id: 'api-boundary-fixture', type: 'click-projection', targetView: 'front', hotspots: [circle, rectangle], answer: ['round'] };
  assert.deepEqual(validateQuestion(synthetic), []);
  assert.equal(isPointInHotspot({ u: 0.5, v: 0.5 }, circle), true);
  assert.equal(isPointInHotspot({ u: 0.61, v: 0.5 }, circle), false);
  assert.equal(isPointInHotspot({ u: 0.2, v: 0.2 }, rectangle), true);
  assert.equal(isPointInHotspot({ u: 0.201, v: 0.2 }, rectangle), false);
  assert.equal(isPointInHotspot({ u: NaN, v: 0.5 }, circle), false);
  assert.equal(evaluateInteractionAnswer(synthetic, { view: 'front', u: 0.5, v: 0.5 }).exact, true);
  assert.equal(evaluateInteractionAnswer(synthetic, { view: 'top', u: 0.5, v: 0.5 }).exact, false);
  assert.equal(evaluateInteractionAnswer(synthetic, { view: 'front', u: 0.15, v: 0.2 }).exact, false);
  assert.ok(validateQuestion({ ...synthetic, answer: ['missing'] }).length);
  assert.ok(validateQuestion({ ...synthetic, hotspots: [{ ...circle, radius: 0 }] }).length);
  assert.ok(validateQuestion({ ...QUESTION_BANK[0], answer: ['missing'] }).length);
  assert.ok(validateQuestion({ ...getQuestionById('bridge-rotate-plan'), toleranceDegrees: 0 }).length);
  assert.ok(validateQuestionBank([QUESTION_BANK[0], QUESTION_BANK[0]]).length);
});
