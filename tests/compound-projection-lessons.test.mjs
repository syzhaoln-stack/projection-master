import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  COMPOUND_LESSONS,
  clampStageIndex,
  createCompoundLessonState,
  evaluateCompoundAnswer,
  getCompoundLesson,
  validateCompoundLessons,
  visibleIdsForState
} from '../compound-projection-lessons.js';

test('chapter 5 platform is intentionally limited to three concrete operation examples', () => {
  assert.equal(COMPOUND_LESSONS.length, 3);
  assert.deepEqual(COMPOUND_LESSONS.map(lesson => lesson.label), ['例5-1', '例5-5', '例5-6']);
  assert.deepEqual(validateCompoundLessons(), []);
  COMPOUND_LESSONS.forEach(lesson => {
    assert.match(lesson.source, /第5章/);
    assert.ok(lesson.aiInput.length > 8);
    assert.ok(lesson.operations.length >= 3);
    assert.ok(lesson.cutters.length >= 3);
    assert.ok(lesson.stages.every(stage => stage.action && stage.visible.length));
  });
});

test('example 5-1 preserves the four textbook parts and three through-hole cutters', () => {
  const lesson = getCompoundLesson('example-5-1');
  const state = createCompoundLessonState(lesson);
  assert.deepEqual(state.parameters, {});
  assert.deepEqual(lesson.cutters.map(cutter => cutter.id), ['bore', 'base-hole-left', 'base-hole-right']);
  assert.equal(Object.keys(state.cutterValues).length, 3);
  assert.deepEqual(lesson.stages.at(-1).appliedCutters, ['bore', 'base-hole-left', 'base-hole-right']);
  assert.match(lesson.stages[2].note, /只与圆筒下缘相切/);
  assert.deepEqual(lesson.assembly.parts.map(part => part.id), ['base', 'upright', 'barrel', 'rib']);
  assert.equal(state.activeAssemblyId, 'upright');
  assert.deepEqual(state.detachedComponents, []);
  assert.deepEqual(state.assemblyOffsets.rib, { x: 0, y: 0, z: 0 });
  assert.equal(state.showCutter, false);
});

test('example 5-5 follows the textbook P, Q and III cutting order', () => {
  const lesson = getCompoundLesson('example-5-5');
  const state = createCompoundLessonState(lesson);
  assert.deepEqual(lesson.cutters.map(cutter => cutter.id), ['cut-p', 'cut-q', 'cut-slot']);
  assert.deepEqual(lesson.stages.map(stage => stage.label), [
    '完整四棱柱A', 'P面切除Ⅰ', 'Q面切除Ⅱ', '切除Ⅲ贯穿槽'
  ]);
  assert.deepEqual(lesson.stages.at(-1).appliedCutters, ['cut-p', 'cut-q', 'cut-slot']);
  assert.match(lesson.stages[2].note, /前、后两个对称立体Ⅱ/);
  assert.match(lesson.stages.at(-1).note, /全长/);
  assert.equal(state.parameters.slotLength, 5);
  assert.deepEqual(
    lesson.parameters.find(parameter => parameter.id === 'slotLength'),
    {
      id: 'slotLength',
      label: 'B3切槽长度',
      unit: '格',
      min: 1.4,
      max: 5.4,
      step: 0.1,
      default: 5,
      textbook: 5,
      referenceLabel: '默认：贯穿全长'
    }
  );
  assert.deepEqual(state.cutterValues['cut-slot'], { x: 0, z: 0 });
  lesson.cutters.forEach(cutter => {
    cutter.axes.forEach(axis => {
      const stepsFromMinimum = (cutter.defaults[axis.id] - axis.min) / axis.step;
      assert.ok(Math.abs(stepsFromMinimum - Math.round(stepsFromMinimum)) < 1e-8);
    });
  });
  assert.deepEqual(state.display, { shadows: false, boldEdges: true, transparent: false, showHidden: true });
  assert.equal(state.pointPickEnabled, false);
  assert.equal(state.pickedPoint, null);
});

test('stage visibility can be clamped and temporarily isolated', () => {
  const lesson = getCompoundLesson('example-5-6');
  const state = createCompoundLessonState(lesson);
  assert.equal(state.showCutter, false);
  assert.deepEqual(visibleIdsForState(lesson, state), ['body']);
  state.stageIndex = clampStageIndex(lesson, 99);
  state.showCutter = false;
  assert.equal(state.stageIndex, lesson.stages.length - 1);
  assert.deepEqual(visibleIdsForState(lesson, state), ['body']);
  state.isolatedComponent = 'cut-iv';
  assert.deepEqual(visibleIdsForState(lesson, state), ['cut-iv']);
  assert.equal(clampStageIndex(lesson, -10), 0);
});

test('example 5-6 models III, rounded-bottom IV and V as distinct subtraction tools', () => {
  const lesson = getCompoundLesson('example-5-6');
  assert.deepEqual(lesson.stages.map(stage => stage.label), [
    'Ⅰ+Ⅱ整体并集', '切除Ⅲ前方槽', '切除Ⅳ倒置拱形槽', '切除Ⅴ底板方槽', '整体重投影'
  ]);
  assert.deepEqual(lesson.components.map(component => component.id), ['body', 'cut-iii', 'cut-iv', 'cut-v']);
  assert.deepEqual(lesson.stages[1].appliedCutters, ['cut-iii']);
  assert.deepEqual(lesson.stages[2].appliedCutters, ['cut-iii', 'cut-iv']);
  assert.deepEqual(lesson.stages[3].appliedCutters, ['cut-iii', 'cut-iv', 'cut-v']);
  assert.match(lesson.stages[2].note, /上部为直边、底部为半圆弧/);
  assert.equal(lesson.cutters[0].toolType, '长方体刀具');
  assert.match(lesson.cutters[1].toolType, /半圆底/);
  assert.equal(lesson.stages.at(-1).showCutter, false);
});

test('each example question evaluates against textbook evidence', () => {
  COMPOUND_LESSONS.forEach(lesson => {
    const exact = evaluateCompoundAnswer(lesson, lesson.question.answer);
    assert.equal(exact.exact, true);
    const distractor = lesson.question.options.find(option => option.id !== lesson.question.answer);
    assert.equal(evaluateCompoundAnswer(lesson, distractor.id).exact, false);
    assert.ok(lesson.question.evidence.length > 15);
  });
});

test('chapter 5 shell exposes a real CSG workbench and draggable cutter wiring', async () => {
  const [html, main, controller, pkg] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../projection-master.js', import.meta.url), 'utf8'),
    readFile(new URL('../compound-projection-lab.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  assert.match(html, /data-mode="compound"/);
  assert.match(html, /id="compound-model-host"/);
  assert.match(html, /data-compound-image="front"/);
  assert.match(html, /id="compound-boolean-workbench"/);
  assert.match(html, /id="compound-assembly-workbench"/);
  assert.match(html, /id="compound-observation-tools"/);
  assert.match(html, /data-compound-point="front"/);
  assert.match(html, /"three-bvh-csg"\s*:/);
  assert.match(html, /"three-mesh-bvh"\s*:/);
  assert.match(html, /拖动黄色刀具/);
  assert.match(main, /rendererElement: renderer\.domElement/);
  assert.match(main, /!object\.userData\?\.excludeFromProjection/);
  assert.match(main, /projectionGuide/);
  assert.match(main, /projectionPointPositions/);
  assert.match(main, /LineSegments2/);
  assert.match(main, /analyticHiddenMat/);
  assert.match(main, /suppressCenterLines/);
  assert.match(controller, /from 'three-bvh-csg'/);
  assert.match(controller, /evaluator\.evaluate\(result, cutter, SUBTRACTION\)/);
  assert.match(controller, /evaluator\.evaluate\(result, addition, ADDITION\)/);
  assert.match(controller, /startCutterDrag/);
  assert.match(controller, /data-cutter-axis/);
  assert.match(controller, /roundedBottomSlotShape/);
  assert.match(controller, /frontRoundedBaseShape/);
  assert.match(controller, /archedUprightShape/);
  assert.match(controller, /data-assembly-axis/);
  assert.match(controller, /toggleAssemblyPart/);
  assert.match(controller, /addPreciseEdgeOverlay/);
  assert.match(controller, /startPointPick/);
  assert.match(controller, /data-display-action/);
  assert.match(controller, /slotLength/);
  assert.match(controller, /addExample55ProjectionGuides/);
  assert.match(controller, /addExample55PreciseEdges/);
  assert.match(controller, /hideWhenTransparent/);
  assert.match(main, /hidden-emphasis/);
  assert.match(controller, /projectionAnalyticOnly/);
  assert.match(controller, /projectionViews/);
  assert.match(controller, /slotOpenAtViewedEnd/);
  assert.match(pkg, /"three-bvh-csg"/);
});
