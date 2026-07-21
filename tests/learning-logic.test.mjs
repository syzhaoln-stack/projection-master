import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRIDGE_VIEW_TASK,
  evaluateQuizSelection,
  getComponentInfo,
  getQuizOptionState,
  isBridgeTaskTarget
} from '../learning-logic.js';

test('quiz options reveal no correctness before submission', () => {
  const state = getQuizOptionState('rect', new Set(['rect']), ['rect'], false);
  assert.deepEqual(state, {
    selected: true,
    correct: false,
    wrong: false,
    missed: false,
    disabled: false
  });
});

test('quiz evaluation reports exact, missing and unexpected choices', () => {
  assert.equal(evaluateQuizSelection(['rect'], ['rect']).exact, true);
  assert.deepEqual(evaluateQuizSelection(['rect'], ['rect', 'cylinder']).missing, ['cylinder']);
  assert.deepEqual(evaluateQuizSelection(['rect', 'sphere'], ['rect']).unexpected, ['sphere']);
});

test('bridge components have semantic teaching information', () => {
  assert.deepEqual(getComponentInfo('stay_cable'), {
    label: '斜拉索',
    role: '受拉，把主梁荷载直接传递给桥塔。'
  });
  assert.equal(isBridgeTaskTarget('stay_cable'), true);
  assert.equal(BRIDGE_VIEW_TASK.expectedView, 'front');
});

test('mechanical components expose student-facing projection notes', () => {
  assert.deepEqual(getComponentInfo('barrel'), {
    label: '轴承座圆筒',
    role: '容纳轴承；圆柱轴线决定圆形视图和非圆形视图的位置。'
  });
  assert.equal(getComponentInfo('front_rib').label, '前肋板');
});
