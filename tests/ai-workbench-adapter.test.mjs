import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BRIDGE_MODELS } from '../bridge-models.js';
import { applyGeometryVariation } from '../ai-geometry-variation.js';
import { createAiWorkbenchAdapter } from '../ai-workbench-adapter.js';

function compoundStub() {
  const snapshots = new Map();
  const controller = {
    active: true, value: 2, revision: 0, parametersEnabled: true,
    applied: [], restored: [], failApply: false,
    getAiContext() {
      return {
        active: this.active, targetId: `compound:example-5-6:${this.revision}`,
        contextKey: `state:${this.value}`, label: '例5-6 · 切除Ⅴ底板方槽',
        lesson: { id: 'example-5-6' },
        parameters: this.parametersEnabled ? [{ key: 'cutter:cut-v:x', label: '槽位置', value: this.value, min: 1, max: 3, step: 0.1, unit: '格' }] : []
      };
    },
    applyAiParameters(plan) {
      this.applied.push(plan);
      if (this.failApply) throw new Error('compound rebuild failed and rolled back');
      const snapshot = {};
      snapshots.set(snapshot, this.value);
      this.value = plan.changes[0].value;
      this.revision += 1;
      return { changed: true, snapshot };
    },
    restoreAiSnapshot(snapshot) {
      assert.ok(snapshots.has(snapshot));
      this.restored.push(snapshot);
      this.value = snapshots.get(snapshot);
      snapshots.delete(snapshot);
      this.revision += 1;
      return { restored: true };
    }
  };
  return controller;
}

function harness(t) {
  const state = {
    mode: 'explore', modelId: 'beamBridge', revision: 0,
    isUnfolded: true, unfoldProgress: 0.63, transitionActive: true,
    transitionFrom: 0, transitionTo: 1
  };
  const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 100);
  const target = new THREE.Vector3(0.3, 0.8, -0.5);
  camera.position.set(7, 4, 9);
  camera.zoom = 1.3;
  camera.lookAt(target);
  const variations = new Map();
  const roots = [];
  const failures = [];
  const writes = [];
  let root, calls = 0, compound = compoundStub();
  const rebuild = (...args) => {
    assert.equal(args.length, 0, 'rebuild receives no fit/reset request');
    calls += 1;
    root = applyGeometryVariation(BRIDGE_MODELS[state.modelId].build(), variations.get(state.modelId));
    roots.push(root);
    state.revision += 1;
    if (failures.shift()) throw new Error('test rebuild failure');
  };
  const adapter = createAiWorkbenchAdapter({
    getMode: () => state.mode, getModelId: () => state.modelId,
    getModelLabel: () => BRIDGE_MODELS[state.modelId]?.name || '不支持的模型',
    getRevision: () => state.revision, getCompound: () => compound,
    getVariation: id => variations.get(id),
    setVariation: (id, values) => { writes.push({ id, values: { ...values } }); variations.set(id, { ...values }); },
    rebuild
  });
  rebuild();
  t.after(() => {
    const resources = new Set();
    for (const item of roots) item.traverse(node => {
      if (node.geometry) resources.add(node.geometry);
      for (const material of [].concat(node.material || [])) resources.add(material);
    });
    resources.forEach(resource => resource.dispose());
  });
  return {
    state, adapter, variations, writes, camera, target, failures, rebuild,
    get root() { return root; }, get calls() { return calls; },
    get compound() { return compound; }, set compound(value) { compound = value; }
  };
}

const plan = (h, changes) => ({ targetId: h.adapter.getContext().targetId, summary: '调整当前允许参数。', changes });
const size = h => new THREE.Box3().setFromObject(h.root, true).getSize(new THREE.Vector3());
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const view = h => ({
  position: h.camera.position.toArray(), quaternion: h.camera.quaternion.toArray(),
  up: h.camera.up.toArray(), zoom: h.camera.zoom, target: h.target.toArray(),
  isUnfolded: h.state.isUnfolded, unfoldProgress: h.state.unfoldProgress,
  transitionActive: h.state.transitionActive, transitionFrom: h.state.transitionFrom, transitionTo: h.state.transitionTo
});

test('context exposes overall scaling, independent parameter copies and honest teaching units', t => {
  const h = harness(t);
  h.variations.set('beamBridge', { widthPercent: 115 });
  const context = h.adapter.getContext();
  assert.equal(context.label, BRIDGE_MODELS.beamBridge.name);
  assert.match(context.description, /会一起改变构件截面/);
  assert.match(context.description, /暂不支持单独改桥面、索塔/);
  assert.match(context.description, /原图纸尺寸仅供对照/);
  assert.equal(context.parameters.find(p => p.key === 'widthPercent').value, 115);
  context.parameters[0].min = -100;
  assert.equal(h.adapter.getContext().parameters[0].min, 50);
  assert.deepEqual(h.variations.get('beamBridge'), { widthPercent: 115 });
  h.state.mode = 'compound';
  assert.match(h.adapter.getContext().description, /教学模型坐标单位，不代表原图实际毫米尺寸/);
  assert.doesNotMatch(h.adapter.getContext().description, /1\s*格\s*=|10\s*mm/);
  h.compound.parametersEnabled = false;
  assert.match(h.adapter.getContext().description, /先选择含切割/);
});

test('applies to the current real bridge and redraws once without changing view/unfold', t => {
  const h = harness(t);
  h.variations.set('archBridge', { lengthPercent: 130 });
  const original = size(h), originalView = view(h), calls = h.calls;
  const handle = h.adapter.applyPlan(plan(h, [{ key: 'widthPercent', value: 125 }, { key: 'heightPercent', value: 80 }]));
  assert.equal(h.state.modelId, 'beamBridge');
  near(size(h).x, original.x); near(size(h).y, original.y * 0.8); near(size(h).z, original.z * 1.25);
  assert.equal(h.calls, calls + 1);
  assert.deepEqual(view(h), originalView);
  assert.deepEqual(h.variations.get('archBridge'), { lengthPercent: 130 });
  assert.equal(handle.targetId, h.adapter.getContext().targetId);
  handle.restore();
  size(h).toArray().forEach((value, axis) => near(value, original.getComponent(axis)));
  assert.deepEqual(view(h), originalView);
  assert.equal(h.calls, calls + 2);
  assert.throws(() => handle.restore(), /模型或步骤已变化/);
  assert.equal(h.calls, calls + 2, 'one-shot undo cannot rebuild again');
});

test('stale plans cannot edit a different model or a revised instance of the same model', t => {
  const h = harness(t);
  const stale = plan(h, [{ key: 'widthPercent', value: 120 }]);
  h.state.modelId = 'archBridge'; h.rebuild();
  const calls = h.calls;
  assert.throws(() => h.adapter.applyPlan(stale));
  assert.equal(h.calls, calls); assert.equal(h.writes.length, 0);
  h.state.modelId = 'beamBridge'; h.rebuild();
  assert.throws(() => h.adapter.applyPlan(stale));
  assert.equal(h.writes.length, 0);
});

test('the owner/target is rechecked at the mutation boundary', t => {
  const h = harness(t);
  const candidate = plan(h, [{ key: 'widthPercent', value: 120 }]);
  Object.defineProperty(candidate, 'summary', { enumerable: true, get() { h.state.mode = 'quiz'; return '调整允许参数'; } });
  assert.throws(() => h.adapter.applyPlan(candidate), /模型或步骤已变化/);
  assert.equal(h.writes.length, 0);
});

test('unsupported modes and imported/chapter5 placeholders have no explore editing context', t => {
  const h = harness(t);
  const candidate = plan(h, [{ key: 'widthPercent', value: 120 }]);
  for (const mode of ['lab', 'quiz', 'vice']) {
    h.state.mode = mode;
    assert.equal(h.adapter.getContext(), null);
    assert.throws(() => h.adapter.applyPlan(candidate));
  }
  h.state.mode = 'explore';
  for (const modelId of ['imported', 'chapter5']) {
    h.state.modelId = modelId;
    assert.equal(h.adapter.getContext(), null);
    assert.throws(() => h.adapter.applyPlan(candidate));
  }
  h.state.mode = 'compound'; h.compound.active = false;
  assert.equal(h.adapter.getContext(), null);
  assert.equal(h.writes.length, 0);
});

test('empty/no-effect plans and invalid batches perform no mutation', t => {
  const h = harness(t), calls = h.calls;
  for (const changes of [[], [{ key: 'lengthPercent', value: 100 }]]) {
    assert.throws(() => h.adapter.applyPlan(plan(h, changes)), /没有参数变化/);
  }
  for (const changes of [
    [{ key: 'lengthPercent', value: 110 }, { key: 'deckWidth', value: 120 }],
    [{ key: 'widthPercent', value: NaN }], [{ key: 'widthPercent', value: 151 }]
  ]) assert.throws(() => h.adapter.applyPlan(plan(h, changes)));
  assert.equal(h.calls, calls); assert.equal(h.writes.length, 0);
});

test('a failed apply rolls both parameters and real geometry back to their previous state', t => {
  const h = harness(t), original = size(h), originalView = view(h), calls = h.calls;
  h.failures.push(true, false);
  assert.throws(() => h.adapter.applyPlan(plan(h, [{ key: 'lengthPercent', value: 140 }])), /test rebuild failure/);
  assert.deepEqual(h.variations.get('beamBridge'), {});
  size(h).toArray().forEach((value, axis) => near(value, original.getComponent(axis)));
  assert.equal(h.calls, calls + 2);
  assert.deepEqual(view(h), originalView);
});

test('a failed rollback is reported instead of silently claiming a recovered scene', t => {
  const h = harness(t);
  h.failures.push(true, true);
  assert.throws(() => h.adapter.applyPlan(plan(h, [{ key: 'widthPercent', value: 120 }])), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.equal(error.rollbackFailed, true);
    assert.match(error.message, /恢复也未完成/);
    return true;
  });
});

test('undo failure with successful rollback retains exactly one retry at the new revision', t => {
  const h = harness(t), original = size(h);
  const handle = h.adapter.applyPlan(plan(h, [{ key: 'lengthPercent', value: 135 }]));
  const firstTarget = handle.targetId;
  h.failures.push(true, false);
  assert.throws(() => handle.restore(), /test rebuild failure/);
  near(size(h).x, original.x * 1.35);
  assert.deepEqual(h.variations.get('beamBridge'), { lengthPercent: 135 });
  assert.notEqual(handle.targetId, firstTarget);
  assert.equal(handle.targetId, h.adapter.getContext().targetId);
  handle.restore();
  near(size(h).x, original.x);
  assert.throws(() => handle.restore());
});

test('undo cannot be reused after double rebuild failure', t => {
  const h = harness(t);
  const handle = h.adapter.applyPlan(plan(h, [{ key: 'widthPercent', value: 120 }]));
  h.failures.push(true, true);
  assert.throws(() => handle.restore(), AggregateError);
  const calls = h.calls;
  assert.throws(() => handle.restore(), /模型或步骤已变化/);
  assert.equal(h.calls, calls);
});

test('undo does not cross model, mode or unreported parameter changes', t => {
  const h = harness(t);
  const handle = h.adapter.applyPlan(plan(h, [{ key: 'widthPercent', value: 120 }]));
  const calls = h.calls, writes = h.writes.length;
  h.state.mode = 'compound'; assert.throws(() => handle.restore());
  h.state.mode = 'explore'; h.state.modelId = 'archBridge'; assert.throws(() => handle.restore());
  h.state.modelId = 'beamBridge';
  h.variations.set('beamBridge', { widthPercent: 130 });
  assert.throws(() => handle.restore());
  assert.equal(h.calls, calls); assert.equal(h.writes.length, writes);
});

test('compound plans use the active controller snapshot and cannot leak into explore writes', t => {
  const h = harness(t), calls = h.calls;
  h.state.mode = 'compound';
  const captured = h.adapter.getContext();
  const handle = h.adapter.applyPlan(plan(h, [{ key: 'cutter:cut-v:x', value: 2.5 }]));
  assert.deepEqual(h.compound.applied[0], {
    contextKey: captured.contextKey, targetId: captured.targetId, lessonId: 'example-5-6',
    changes: [{ key: 'cutter:cut-v:x', value: 2.5 }]
  });
  assert.equal(h.compound.value, 2.5);
  assert.equal(handle.targetId, h.adapter.getContext().targetId);
  handle.restore();
  assert.equal(h.compound.value, 2);
  assert.equal(h.compound.restored.length, 1);
  assert.throws(() => handle.restore());
  assert.equal(h.calls, calls); assert.equal(h.writes.length, 0);
});

test('compound undo rejects a replacement controller even when its target id collides', t => {
  const h = harness(t);
  h.state.mode = 'compound';
  const oldController = h.compound;
  const handle = h.adapter.applyPlan(plan(h, [{ key: 'cutter:cut-v:x', value: 2.5 }]));
  h.compound = compoundStub(); h.compound.value = 2.5; h.compound.revision = 1;
  assert.equal(handle.targetId, h.adapter.getContext().targetId);
  assert.throws(() => handle.restore(), /模型或步骤已变化/);
  assert.equal(oldController.restored.length, 0);
  assert.equal(h.compound.restored.length, 0);
});

test('compound apply errors do not trigger explore rebuilds or variation writes', t => {
  const h = harness(t), calls = h.calls;
  h.state.mode = 'compound'; h.compound.failApply = true;
  assert.throws(() => h.adapter.applyPlan(plan(h, [{ key: 'cutter:cut-v:x', value: 2.5 }])), /compound rebuild failed/);
  assert.equal(h.compound.value, 2);
  assert.equal(h.calls, calls); assert.equal(h.writes.length, 0);
});
