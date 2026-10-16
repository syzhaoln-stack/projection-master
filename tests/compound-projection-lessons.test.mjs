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
    '完整四棱柱A', 'P面切除Ⅰ', 'Q面切除Ⅱ', '切除Ⅲ贯穿槽', '整体重投影'
  ]);
  assert.deepEqual(lesson.stages.at(-1).appliedCutters, ['cut-p', 'cut-q', 'cut-slot']);
  assert.match(lesson.stages[2].note, /前、后两个对称立体Ⅱ/);
  assert.match(lesson.stages[3].note, /黄色刀具/);
  assert.match(lesson.stages.at(-1).note, /U形洞口相通/);
  assert.equal(lesson.stages.at(-1).showCutter, false);
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
      const stepsToMaximum = (axis.max - axis.min) / axis.step;
      assert.ok(Math.abs(stepsToMaximum - Math.round(stepsToMaximum)) < 1e-8);
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
  const state = createCompoundLessonState(lesson);
  assert.deepEqual(lesson.stages.map(stage => stage.label), [
    'Ⅰ+Ⅱ整体并集', '切除Ⅴ底板方槽', '切除Ⅲ前方槽', '切除Ⅳ倒置拱形槽', '整体重投影'
  ]);
  assert.deepEqual(lesson.components.map(component => component.id), ['body', 'cut-v', 'cut-iii', 'cut-iv']);
  assert.deepEqual(lesson.stages[1].appliedCutters, ['cut-v']);
  assert.deepEqual(lesson.stages[2].appliedCutters, ['cut-v', 'cut-iii']);
  assert.deepEqual(lesson.stages[3].appliedCutters, ['cut-v', 'cut-iii', 'cut-iv']);
  assert.match(lesson.stages[3].note, /上部为直边、底部为半圆弧/);
  assert.equal(lesson.cutters[0].toolType, '长方体刀具');
  assert.match(lesson.cutters[1].toolType, /半圆底/);
  assert.equal(lesson.cutters[1].axes[1].label, '圆弧中心 Y');
  assert.ok(
    lesson.cutters[1].defaults.y - 0.35 < lesson.cutters[0].defaults.y - 0.525,
    'the rear rounded slot must extend below the front flat-bottomed slot'
  );
  assert.deepEqual(lesson.displayDefaults, {
    shadows: false,
    boldEdges: true,
    transparent: false,
    showHidden: true
  });
  assert.deepEqual(state.display, lesson.displayDefaults);

  const baseSlot = lesson.cutters[2];
  assert.equal(baseSlot.id, 'cut-v');
  baseSlot.axes.forEach(axis => {
    const defaultSteps = (baseSlot.defaults[axis.id] - axis.min) / axis.step;
    const maximumSteps = (axis.max - axis.min) / axis.step;
    assert.ok(Math.abs(defaultSteps - Math.round(defaultSteps)) < 1e-8, `${axis.id} default must lie on the slider grid`);
    assert.ok(Math.abs(maximumSteps - Math.round(maximumSteps)) < 1e-8, `${axis.id} maximum must lie on the slider grid`);
  });
  assert.match(baseSlot.toolType, /底板左端.*横向贯穿.*长方体/);
  assert.deepEqual(baseSlot.defaults, { x: -1.4, y: 0.475, height: 0.36 });
  assert.deepEqual(baseSlot.axes.map(axis => axis.label), ['槽止端 X', '槽中心 Y', '槽高 H']);
  assert.match(lesson.stages[1].note, /止端为粗实线/);
  assert.match(lesson.stages[1].note, /俯视图.*止端虚线/);
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
  const [html, main, controller, pkg, exactWorker, exactClient, css] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../projection-master.js', import.meta.url), 'utf8'),
    readFile(new URL('../compound-projection-lab.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../replicad-kernel-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../replicad-kernel-client.js', import.meta.url), 'utf8'),
    readFile(new URL('../compound-projection-lab.css', import.meta.url), 'utf8')
  ]);
  assert.match(html, /data-mode="compound"/);
  assert.match(html, /id="compound-model-host"/);
  assert.match(html, /data-compound-image="front"/);
  assert.match(html, /id="compound-boolean-workbench"/);
  assert.match(html, /id="compound-assembly-workbench"/);
  assert.match(html, /id="compound-observation-tools"/);
  assert.match(html, /data-compound-point="front"/);
  assert.match(html, /data-compound-view-tab="front"/);
  assert.match(html, /AI 如何把题图变成 CAD/);
  assert.match(html, /"three-bvh-csg"\s*:/);
  assert.match(html, /"three-mesh-bvh"\s*:/);
  assert.match(html, /拖动黄色刀具/);
  assert.match(main, /rendererElement: renderer\.domElement/);
  assert.match(main, /if \(state\.mode === 'compound'\)[\s\S]*axesGroup\.visible = false/);
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
  assert.match(controller, /ivStraightHeight = cutterTop - iv\.y/);
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
  assert.match(controller, /example56BaseSlotConstruction/);
  assert.match(controller, /basePlanShape\(\)[\s\S]*shape\.absarc\(r\.x, 0, r\.outer, lowerAngle, upperAngle, true\)/);
  assert.doesNotMatch(controller, /\[b\.tangentX, -b\.tangentHalfDepth\],[\s\S]*\[b\.xMax, 0\]/);
  assert.match(controller, /material:\s*\{\s*flatShading:\s*false/);
  assert.match(controller, /addExample56ProjectionGuides/);
  assert.match(controller, /addExample56PreciseEdges/);
  assert.match(controller, /example56_top_hidden/);
  assert.match(controller, /hidden-emphasis/);
  assert.match(controller, /displayToolsActive/);
  assert.match(controller, /hideWhenTransparent/);
  assert.match(controller, /slotLength: Number\(state\.parameters\.slotLength \|\| 5\) \* 10/);
  assert.match(controller, /kernelProjectionDataUrl/);
  assert.doesNotMatch(controller, /kernelProjectionMarkup/);
  assert.match(controller, /from 'replicad-threejs-helper'/);
  assert.match(controller, /syncFaces\(facesGeometry, renderMesh\.faces\)/);
  assert.match(controller, /syncLines\(edgesGeometry, renderMesh\.edges\)/);
  assert.match(controller, /exact_kernel_result/);
  assert.match(controller, /image\.dataset\.projectionSource = exactProjection \? 'exact-brep'/);
  assert.match(main, /hidden-emphasis/);
  assert.match(controller, /projectionAnalyticOnly/);
  assert.match(controller, /projectionViews/);
  assert.match(controller, /slotOpenAtViewedEnd/);
  assert.match(pkg, /"three-bvh-csg"/);
  assert.match(pkg, /"replicad"\s*:/);
  assert.match(exactWorker, /measureVolume\(shape\.intersect\(centerProbe\)\)/);
  assert.match(exactWorker, /drawProjection\(shape, cameraPlane\)/);
  assert.match(exactWorker, /iterTopo\(shape\.wrapped, 'solid'\)/);
  assert.match(exactWorker, /TEXTBOOK_PROJECTION_CAMERAS/);
  assert.match(exactWorker, /front:\s*'front'/);
  assert.match(exactWorker, /top:\s*'bottom'/);
  assert.match(exactWorker, /TEXTBOOK_PROJECTION_HORIZONTAL_MIRRORS/);
  assert.match(exactWorker, /visible = visible\.mirror\(\[0, 1\], \[0, 0\], 'plane'\)/);
  assert.match(exactWorker, /hidden = hidden\.mirror\(\[0, 1\], \[0, 0\], 'plane'\)/);
  assert.match(exactWorker, /top:\s*projection\(shape, 'top', TEXTBOOK_PROJECTION_CAMERAS\.top, lessonId, centerlines\.top\)/);
  assert.doesNotMatch(exactWorker, /top:\s*projection\(shape, 'top',\s*lessonId/);
  assert.match(exactWorker, /viewDirectionsValid/);
  assert.match(exactWorker, /TEXTBOOK_ENVELOPES/);
  assert.match(exactWorker, /projectionAlignmentValid/);
  assert.match(exactWorker, /centerlinePathData/);
  assert.match(exactWorker, /unifyEngineeringShape/);
  assert.match(exactWorker, /RING56\.x - RING56\.outer/);
  assert.match(exactWorker, /SLOT56_INNER_DEPTH/);
  assert.match(exactWorker, /RING56 = Object\.freeze\(\{ x: 5\.5, outer: 10\.5, inner: 7\.6, bottom: 0, top: 24\.8 \}\)/);
  assert.match(exactWorker, /lowerBoreProbe/);
  assert.match(exactWorker, /lowerRingWallProbe/);
  assert.match(exactWorker, /lowerRingWallCoverage/);
  assert.match(exactWorker, /lowerRingWallComplete/);
  assert.match(exactWorker, /baseTangencyIntrusion/);
  assert.match(exactWorker, /baseTangencyClear/);
  assert.match(exactWorker, /frontWallStateMatches/);
  assert.match(exactWorker, /vSlotStateMatches/);
  assert.match(exactWorker, /shape\.mesh\(/);
  assert.match(exactWorker, /shape\.meshEdges\(/);
  assert.match(exactWorker, /'example-5-1': buildExample51/);
  assert.match(exactWorker, /'example-5-5': buildExample55/);
  assert.match(exactWorker, /'example-5-6': buildExample56/);
  assert.match(exactClient, /new Worker\(new URL\('\.\/replicad-kernel-worker\.js'/);
  assert.match(exactClient, /action: 'audit-lesson'/);
  assert.match(controller, /syncAlignedProjectionLayout/);
  assert.match(controller, /--compound-front-track/);
  assert.match(controller, /const drawing = createDrawingStyle\(/);
  assert.match(controller, /stroke-width="\$\{drawing\.visibleWidth\}"/);
  assert.match(controller, /centerlineSvgPath\(path, \{ longDash, gap, dot \}\)/);
  assert.match(css, /--compound-front-track/);
  assert.match(css, /--compound-elevation-track/);
  assert.match(css, /is-scale-aligned \.compound-view-card\{[^}]*border:0/);
  assert.match(css, /compound-mobile-view-tabs/);
  assert.match(css, /compound-step-card/);
  assert.match(css, /\.compound-control-rail\{display:contents/);
});
