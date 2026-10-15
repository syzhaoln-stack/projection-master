import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { validateEditPlan } from '../ai-edit-protocol.js';

// Resolve the same ES helper build as Vite; its package main is a UMD file.
const controllerUrl = new URL('../compound-projection-lab.js', import.meta.url);
const source = (await readFile(controllerUrl, 'utf8')).replace(/from '([^']+)'/g, (_, specifier) => {
  const resolved = specifier === 'replicad-threejs-helper'
    ? new URL('../node_modules/replicad-threejs-helper/dist/es/replicad-threejs-helper.js', import.meta.url).href
    : specifier.startsWith('.') ? new URL(specifier, controllerUrl).href : import.meta.resolve(specifier);
  return `from '${resolved}'`;
});
const { createCompoundProjectionLab } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function meshVolume(root) {
  const mesh = root.getObjectByName('example56_watertight_body');
  if (!mesh) return null;
  const geometry = mesh.geometry;
  const positions = geometry.attributes.position;
  const indices = geometry.index;
  const count = indices?.count ?? positions.count;
  let volume = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(positions, indices ? indices.getX(i) : i);
    b.fromBufferAttribute(positions, indices ? indices.getX(i + 1) : i + 1);
    c.fromBufferAttribute(positions, indices ? indices.getX(i + 2) : i + 2);
    volume += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(volume);
}

function harness(t, lessonId = 'example-5-6', stage = 4) {
  const handlers = {};
  const explodeInput = {};
  const rootElement = { addEventListener(type, listener) { handlers[type] = listener; } };
  const originalDocument = globalThis.document;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  globalThis.document = {
    getElementById(id) { return id === 'compound-shell' ? rootElement : id === 'compound-explode' ? explodeInput : null; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const camera = new THREE.PerspectiveCamera();
  const controls = { target: new THREE.Vector3(), update() {} };
  let controller;
  let root;
  let rebuilds = 0;
  let projections = 0;
  let projectedVolume;
  let failNextBuild = false;
  let alterViewDuringBuild = false;
  const roots = [];
  controller = createCompoundProjectionLab({
    THREE, camera, controls, modelGroup: new THREE.Group(),
    activateModel() {
      rebuilds += 1;
      if (failNextBuild) { failNextBuild = false; throw new Error('test rebuild failed'); }
      root = controller.buildCurrentModel();
      roots.push(root);
      if (alterViewDuringBuild) {
        camera.position.set(99, 99, 99);
        camera.zoom = 9;
        controls.target.set(9, 9, 9);
      }
    },
    refreshProjections() { projections += 1; projectedVolume = meshVolume(root); }
  });
  controller.selectLesson(lessonId);
  controller.selectStage(stage);
  controller.enter();
  camera.position.set(6, 5, 11);
  camera.up.set(0, 1, 0);
  camera.zoom = 1.25;
  controls.target.set(0.25, 1.5, -0.3);
  camera.lookAt(controls.target);
  t.after(() => {
    controller.dispose();
    roots.forEach(item => item.traverse(object => {
      object.geometry?.dispose();
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material?.dispose());
    }));
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });
  return {
    controller, camera, controls,
    get root() { return root; },
    get counts() { return { rebuilds, projections }; },
    get projectedVolume() { return projectedVolume; },
    failNextBuild() { failNextBuild = true; },
    alterViewDuringBuild() { alterViewDuringBuild = true; },
    input(target) { handlers.input({ target }); },
    explode(value) { explodeInput.value = value; handlers.input({ target: explodeInput }); }
  };
}

function plan(controller, changes) {
  const context = controller.getAiContext();
  return { contextKey: context.contextKey, lessonId: context.lesson.id, changes };
}

function viewOf(h) {
  return { position: h.camera.position.toArray(), quaternion: h.camera.quaternion.toArray(), up: h.camera.up.toArray(), zoom: h.camera.zoom, target: h.controls.target.toArray() };
}

test('context advertises only numeric parameters which affect the current solid', t => {
  const h = harness(t, 'example-5-6', 0);
  let context = h.controller.getAiContext();
  assert.equal(context.parameters.length, 0, 'uncut starting body has no editable cut dimensions');
  assert.notEqual(context.targetId, context.contextKey);
  assert.match(context.targetId, /^compound:example-5-6:\d+$/);
  assert.ok(context.targetId.length <= 160);
  assert.equal(context.lesson.id, 'example-5-6');
  assert.equal(context.stage.index, 0);
  assert.ok(context.label.includes('例5-6'));
  h.controller.selectStage(1);
  context = h.controller.getAiContext();
  assert.deepEqual(context.parameters.map(p => p.key), ['cutter:cut-v:x', 'cutter:cut-v:y', 'cutter:cut-v:height']);
  context.parameters.forEach(parameter => {
    assert.equal(parameter.applied, true);
    for (const key of ['value', 'min', 'max', 'step']) assert.ok(Number.isFinite(parameter[key]));
  });
  context.parameters[0].max = 999;
  assert.equal(h.controller.getAiContext().parameters[0].max, -1.05, 'context does not expose live definitions');
  h.controller.selectLesson('example-5-5');
  assert.equal(h.controller.getAiContext().parameters.length, 0);
  h.controller.selectStage(3);
  assert.ok(h.controller.getAiContext().parameters.some(p => p.key === 'parameter:slotLength'));
});

test('a valid batch changes the real solid and refreshes its projections once while preserving the view', t => {
  const h = harness(t);
  const beforeState = h.controller.getState();
  const beforeVolume = meshVolume(h.root);
  const beforeView = viewOf(h);
  const beforeCounts = h.counts;
  h.alterViewDuringBuild();
  const result = h.controller.applyAiParameters(plan(h.controller, [
    { key: 'cutter:cut-v:height', value: 0.5 },
    { key: 'cutter:cut-v:x', value: -1.3 }
  ]));
  assert.equal(result.changed, true);
  assert.equal(result.changes.length, 2);
  assert.ok(meshVolume(h.root) < beforeVolume - 0.05, 'larger slot must remove more actual material');
  assert.equal(h.projectedVolume, meshVolume(h.root), 'projection callback sees the rebuilt solid');
  assert.equal(h.counts.rebuilds, beforeCounts.rebuilds + 1);
  assert.equal(h.counts.projections, beforeCounts.projections + 1);
  assert.deepEqual(viewOf(h), beforeView);
  assert.deepEqual(h.controller.getState().appliedCutters, beforeState.appliedCutters);
  assert.equal(h.controller.getState().stageIndex, beforeState.stageIndex);
  const restored = h.controller.restoreAiSnapshot(result.snapshot);
  assert.equal(restored.restored, true);
  assert.deepEqual(h.controller.getState(), beforeState);
  assert.ok(Math.abs(meshVolume(h.root) - beforeVolume) < 1e-6);
  assert.deepEqual(viewOf(h), beforeView);
  assert.throws(() => h.controller.restoreAiSnapshot(result.snapshot), /已经使用/);
});

test('invalid batches are atomic and cannot address code, unlisted state, inactive cuts or non-finite values', t => {
  const h = harness(t, 'example-5-6', 1);
  const invalidChanges = [
    [{ key: 'cutter:cut-v:x', value: -1.2 }, { key: 'cutter:cut-v:height', value: 99 }],
    [{ key: 'cutter:cut-iii:x', value: 0.65 }],
    [{ key: '__proto__', value: 1 }],
    [{ key: 'state.stageIndex', value: 4 }],
    [{ key: 'cutter:cut-v:x', value: -1.2, code: 'throw new Error()' }],
    [{ key: 'cutter:cut-v:x', value: '-1.2' }],
    [{ key: 'cutter:cut-v:x', value: NaN }],
    [{ key: 'cutter:cut-v:x', value: Infinity }],
    [{ key: 'cutter:cut-v:x', value: null }],
    [{ key: 'cutter:cut-v:x', value: -1.2 }, { key: 'cutter:cut-v:x', value: -1.3 }]
  ];
  const before = h.controller.getState();
  const counts = h.counts;
  for (const changes of invalidChanges) {
    assert.throws(() => h.controller.applyAiParameters(plan(h.controller, changes)));
    assert.deepEqual(h.controller.getState(), before);
    assert.deepEqual(h.counts, counts);
  }
  assert.throws(() => h.controller.applyAiParameters({ ...plan(h.controller, []), script: 'alert(1)' }));
  assert.throws(() => h.controller.restoreAiSnapshot({ schemaVersion: 1, lessonId: 'example-5-6' }));
});

test('stale plans and responses arriving outside the active lesson are rejected', t => {
  const h = harness(t);
  const stale = plan(h.controller, [{ key: 'cutter:cut-v:x', value: -1.2 }]);
  h.controller.selectStage(1);
  assert.throws(() => h.controller.applyAiParameters(stale), /已经变化/);
  const current = plan(h.controller, [{ key: 'cutter:cut-v:x', value: -1.2 }]);
  h.controller.applyAiParameters(current);
  assert.throws(() => h.controller.applyAiParameters(current), /已经变化/);
  const outside = plan(h.controller, [{ key: 'cutter:cut-v:x', value: -1.3 }]);
  h.controller.leave();
  assert.throws(() => h.controller.applyAiParameters(outside), /先回到第5章/);
});

test('slider steps are normalized and unchanged plans do not rebuild or create undo records', t => {
  const h = harness(t);
  const emptyCounts = h.counts;
  const noChange = h.controller.applyAiParameters(plan(h.controller, [{ key: 'cutter:cut-v:height', value: 0.36 }]));
  assert.equal(noChange.changed, false);
  assert.equal(noChange.snapshot, null);
  assert.deepEqual(h.counts, emptyCounts);
  const context = h.controller.getAiContext();
  const result = h.controller.applyAiParameters({ lessonId: context.lesson.id, targetId: context.targetId, changes: [{ key: 'cutter:cut-v:height', value: 0.411 }] });
  assert.equal(result.changes[0].value, 0.42);
  assert.equal(h.controller.getState().cutterValues['cut-v'].height, 0.42);
});

test('AI edits and undo retain the existing explode and independent assembly displacement', t => {
  const h = harness(t, 'example-5-1', 3);
  h.explode('55');
  h.input({
    matches: selector => selector === '[data-assembly-axis]',
    dataset: { assemblyId: 'barrel', assemblyAxis: 'x' }, value: '0.6'
  });
  h.controller.update();
  const before = h.controller.getState();
  const barrelPosition = h.root.getObjectByName('chapter5_barrel').position.toArray();
  const result = h.controller.applyAiParameters(plan(h.controller, [{ key: 'cutter:bore:x', value: 0.2 }]));
  assert.equal(h.controller.getState().explode, 0.55);
  assert.deepEqual(h.controller.getState().assemblyOffsets, before.assemblyOffsets);
  assert.deepEqual(h.root.getObjectByName('chapter5_barrel').position.toArray(), barrelPosition);
  h.controller.restoreAiSnapshot(result.snapshot);
  assert.deepEqual(h.controller.getState(), before);
  assert.deepEqual(h.root.getObjectByName('chapter5_barrel').position.toArray(), barrelPosition);
});

test('a rebuild failure rolls back the entire numeric batch and retains the view', t => {
  const h = harness(t);
  const before = h.controller.getState();
  const beforeView = viewOf(h);
  const beforeVolume = meshVolume(h.root);
  h.failNextBuild();
  assert.throws(() => h.controller.applyAiParameters(plan(h.controller, [
    { key: 'cutter:cut-v:height', value: 0.5 },
    { key: 'cutter:cut-v:x', value: -1.2 }
  ])), /test rebuild failed/);
  assert.deepEqual(h.controller.getState(), before);
  assert.deepEqual(viewOf(h), beforeView);
  assert.ok(Math.abs(meshVolume(h.root) - beforeVolume) < 1e-6);
});

test('short target versions remain stable until model state changes and validate independently of full fingerprints', t => {
  const h = harness(t);
  const original = h.controller.getAiContext();
  assert.equal(h.controller.getAiContext().targetId, original.targetId);
  h.camera.position.x += 2;
  assert.equal(h.controller.getAiContext().targetId, original.targetId, 'camera changes do not obsolete numeric plans');
  const result = h.controller.applyAiParameters({
    lessonId: original.lesson.id, targetId: original.targetId, contextKey: original.contextKey,
    changes: [{ key: 'cutter:cut-v:height', value: 0.42 }]
  });
  assert.notEqual(result.context.targetId, original.targetId);
  assert.notEqual(result.context.contextKey, original.contextKey);
  assert.throws(() => h.controller.applyAiParameters({
    lessonId: original.lesson.id, targetId: original.targetId, contextKey: result.context.contextKey, changes: []
  }), /已经变化/);
  assert.throws(() => h.controller.applyAiParameters({
    lessonId: original.lesson.id, targetId: result.context.targetId, contextKey: original.contextKey, changes: []
  }), /已经变化/);
  assert.throws(() => h.controller.applyAiParameters({ lessonId: original.lesson.id, changes: [] }), /已经变化/);
  const restored = h.controller.restoreAiSnapshot(result.snapshot).context;
  assert.equal(restored.contextKey, original.contextKey, 'undo restores the same exact numeric state');
  assert.notEqual(restored.targetId, original.targetId, 'undo creates a new version rather than reusing an old request target');
});

test('real controller contexts satisfy the API protocol across all editable lessons and stages', t => {
  const h = harness(t);
  for (const id of ['example-5-1', 'example-5-5', 'example-5-6']) {
    h.controller.selectLesson(id);
    for (let stage = 0; stage < h.controller.getLesson().stages.length; stage += 1) {
      h.controller.selectStage(stage);
      const context = h.controller.getAiContext();
      assert.ok(context.targetId.length <= 160);
      assert.ok(context.label.length <= 160);
      if (!context.parameters.length) continue; // UI explains that no cut is yet editable.
      assert.doesNotThrow(() => validateEditPlan({ targetId: context.targetId, summary: '保持当前模型。', changes: [] }, context));
      for (const parameter of context.parameters) {
        assert.ok(parameter.key.length <= 80);
        assert.ok(parameter.label.length <= 160);
        assert.ok(parameter.unit.length <= 40);
        assert.ok(parameter.step > 0);
        const lastStep = Number((parameter.min + Math.floor((parameter.max - parameter.min) / parameter.step + 1e-8) * parameter.step).toFixed(8));
        for (const value of [parameter.min, lastStep]) {
          assert.doesNotThrow(() => validateEditPlan({ targetId: context.targetId, summary: '检查允许步长。', changes: [{ key: parameter.key, value }] }, context));
        }
      }
    }
  }
  const context = h.controller.getAiContext();
  const validated = validateEditPlan({
    targetId: context.targetId, summary: '将底板槽高调整为 0.42 格。',
    changes: [{ key: 'cutter:cut-v:height', value: 0.42 }]
  }, context);
  const result = h.controller.applyAiParameters({
    lessonId: context.lesson.id, targetId: validated.targetId, changes: validated.changes
  });
  assert.equal(result.changed, true);
  assert.equal(h.controller.getState().cutterValues['cut-v'].height, 0.42);
  assert.throws(() => validateEditPlan(validated, h.controller.getAiContext()), /修改方案不符合/);
});
