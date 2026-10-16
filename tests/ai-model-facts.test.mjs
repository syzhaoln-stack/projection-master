import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { collectModelFacts } from '../ai-model-facts.js';
import { BRIDGE_CATALOG, buildTextbookBridge } from '../bridge-models.js';
import { applyGeometryVariation } from '../ai-geometry-variation.js';
import textbookContract from '../textbook-mechanical-contract.json' with { type: 'json' };

const component = (facts, label) => facts.components.find(item => item.label === label);
const dimension = (facts, label) => facts.dimensions.find(item => item.label === label);
const dispose = root => root.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });

test('textbook facts cite the actual figure and only its verified dimensions', () => {
  for (const entry of textbookContract.models) {
    const root = new THREE.Group();
    root.userData.textbookSource = { ...entry, book: '现代机械制图', description: entry.note };
    root.add(mesh('textbook_body', { label: entry.name }));
    const facts = collectModelFacts({ modelRoot: root, modelId: entry.id, label: entry.name, mode: 'explore' });
    assert.equal(facts.type, 'mechanical');
    assert.ok(facts.summary.includes(entry.figure));
    assert.deepEqual(facts.dimensions, entry.sourceDimensions);
    assert.ok(facts.projectionNotes.some(note => note.includes(entry.dimensionStatus)));
    assert.ok(!facts.projectionNotes.some(note => note.includes('未声明实际工程单位')));
    assertBounded(facts);
  }
});
function mesh(name, data = {}) {
  const object = new THREE.Mesh();
  object.name = name;
  object.userData = data;
  return object;
}
function assertBounded(facts) {
  assert.ok(facts.components.length <= 24);
  assert.ok(facts.dimensions.length <= 24);
  assert.ok(facts.projectionNotes.length <= 12);
  assert.ok(facts.components.every(item => Number.isInteger(item.count) && item.count > 0));
  assert.ok(facts.dimensions.every(item => typeof item.value === 'number' && Number.isFinite(item.value)));
  assert.doesNotThrow(() => JSON.stringify(facts));
}

test('every textbook bridge reports physical source dimensions and actual finished components', () => {
  for (const item of BRIDGE_CATALOG) {
    const root = buildTextbookBridge(item.sourceId);
    const facts = collectModelFacts({ modelRoot: root, modelId: item.id, label: item.name });
    assert.equal(facts.type, 'bridge', item.id);
    assert.equal(dimension(facts, '桥面宽度').value, root.userData.sourceModel.width, item.id);
    assert.equal(dimension(facts, '桥面总长').value, root.userData.sourceModel.length, item.id);
    assert.ok(facts.components.length > 0, item.id);
    assert.ok(!facts.components.some(item => /临时|人物|车辆/.test(item.label)), item.id);
    assert.ok(facts.projectionNotes.some(value => /未读取当前图纸截图/.test(value)));
    assertBounded(facts);
    dispose(root);
  }
});

test('fan and harp facts distinguish two tower groups, four columns and 56 actual stays', () => {
  for (const sourceId of ['stayed_fan', 'stayed_harp']) {
    const root = buildTextbookBridge(sourceId);
    const selected = root.children.find(child => child.name === 'stay_cable');
    const facts = collectModelFacts({ modelRoot: root, selectedComponent: selected });
    assert.equal(component(facts, '主塔组').count, 2);
    assert.equal(component(facts, '塔柱').count, 4);
    assert.equal(component(facts, '斜拉索').count, 56);
    assert.equal(dimension(facts, '桥面以上塔高').value, 28);
    assert.equal(dimension(facts, '主跨跨径').value, 96);
    assert.equal(dimension(facts, '索面数量').value, 2);
    assert.equal(facts.selectedComponent.label, '斜拉索');
    assert.equal(facts.selectedComponent.dimensions.find(item => item.label === '截面半径').value, 0.044);
    // Real hierarchy changes, rather than a static catalogue total, drive counts.
    root.remove(selected);
    const changed = collectModelFacts({ modelRoot: root, selectedComponent: selected });
    assert.equal(component(changed, '斜拉索').count, 55);
    assert.equal(dimension(changed, '斜拉索数量').value, 55);
    assert.equal(changed.selectedComponent, undefined);
    dispose(root); dispose(selected);
  }
});

test('current geometry contract takes precedence over preset parameters', () => {
  const root = buildTextbookBridge('stayed_fan');
  root.userData.sourceModel.geometryContract = {
    ...root.userData.sourceModel.geometryContract, mainSpan: 132, deckWidth: 14, towerHeight: 39
  };
  const facts = collectModelFacts({ modelRoot: root });
  assert.equal(dimension(facts, '主跨跨径').value, 132);
  assert.equal(dimension(facts, '桥面宽度').value, 14);
  assert.equal(dimension(facts, '桥面以上塔高').value, 39);
  dispose(root);
});

test('whole-model variation keeps prototype dimensions explicitly reference-only', () => {
  const root = buildTextbookBridge('stayed_fan');
  const selected = root.children.find(child => child.name === 'stay_cable');
  const wrapped = applyGeometryVariation(root, { lengthPercent: 120, widthPercent: 140, heightPercent: 80 });
  const facts = collectModelFacts({ modelRoot: wrapped, selectedComponent: selected });
  assert.match(facts.summary, /原型参考.*不是变体的精确工程尺寸/);
  assert.equal(dimension(facts, '原型参考·主跨跨径').value, 96);
  assert.equal(dimension(facts, '主跨跨径'), undefined);
  assert.equal(dimension(facts, '横向整体比例').value, 140);
  assert.equal(dimension(facts, '原型参考·桥面宽度').value, 8);
  assert.ok(facts.selectedComponent.dimensions.every(item => item.label.startsWith('原型参考·')));
  assert.equal(component(facts, '塔柱').count, 4);
  dispose(wrapped);
});

// Use the actual shipped GLB semantic hierarchy, without a browser, texture load,
// GPU or a synthetic assumption about how many tower sections the files contain.
async function detailedRoot(id) {
  const buffer = await readFile(new URL(`../assets/drawing-bridges/${id}.glb`, import.meta.url));
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString());
  const root = new THREE.Group();
  root.userData = { sourceBridgeId: id, sourceUnit: 'm', displayScale: 0.001 };
  for (const node of json.nodes.filter(node => node.mesh !== undefined)) {
    const data = node.extras || {};
    if (data.end_stage < 99 || /temporary|^9\d_/i.test(data.category || '')) continue;
    root.add(mesh(node.name, data));
  }
  return root;
}

test('three detailed GLBs use their dimension contracts and count structural instances', async () => {
  for (const [id, length, width] of [['cable_stayed', 448, 22.9], ['suspension', 1822, 36.026], ['arch', 598.16, 22.38]]) {
    const root = await detailedRoot(id);
    const facts = collectModelFacts({ modelRoot: root, modelId: `drawing_${id}` });
    assert.equal(facts.type, 'bridge');
    assert.equal(dimension(facts, '建模范围长度').value, length);
    assert.equal(dimension(facts, id === 'suspension' ? '桥面外缘宽度' : '桥面宽度').value, width);
    if (id === 'cable_stayed') {
      assert.equal(component(facts, '主塔组').count, 2);
      assert.equal(component(facts, '塔柱').count, 2);
      assert.equal(component(facts, '塔柱分节').count, 12);
      assert.equal(component(facts, '斜拉索').count, 40);
      assert.equal(dimension(facts, '桥面以上塔高').value, 58);
    }
    if (id === 'suspension') {
      assert.equal(component(facts, '主塔组').count, 2);
      assert.equal(component(facts, '塔柱').count, 4);
      assert.equal(component(facts, '塔柱分节').count, 40);
      assert.equal(dimension(facts, '桥面以上塔高'), undefined, 'absolute cable elevation must not become tower height');
    }
    if (id === 'arch') {
      assert.equal(component(facts, '主塔组'), undefined, 'arch members in the GLB tower category are not bridge towers');
      assert.equal(dimension(facts, '拱跨径').value, 518.16);
    }
    assertBounded(facts);
    dispose(root);
  }
});

test('mechanical components are semantic counts and normalized bounds are not physical sizes', () => {
  const root = new THREE.Group();
  root.userData = { displayExtent: 5, sourceBoundsM: { min: [0, 0, 0], max: [5, 5, 5] } };
  root.add(mesh('base'), mesh('bolt'), mesh('bolt'));
  const facts = collectModelFacts({ modelRoot: root, modelId: 'bearingSeat', label: '轴承座' });
  assert.equal(facts.type, 'mechanical');
  assert.equal(component(facts, '安装螺栓').count, 2);
  assert.deepEqual(facts.dimensions, []);
  assert.ok(facts.projectionNotes.some(value => /不能当作米或毫米/.test(value)));
  dispose(root);
});

test('compound facts deduplicate semantic groups, omit cutters and retain current applied parameters', () => {
  const root = new THREE.Group();
  root.userData.chapter5Lesson = 'example-5-6';
  const body = new THREE.Group();
  body.userData = { chapter5Id: 'body', label: '主体', operation: 'add' };
  const selected = mesh('face');
  body.add(selected, mesh('another-face'));
  root.add(body, mesh('tool', { booleanTool: true, label: '切割工具' }));
  const hidden = mesh('hidden', { label: '未加入构件' }); hidden.visible = false; root.add(hidden);
  const facts = collectModelFacts({ modelRoot: root, mode: 'compound', selectedComponent: selected, compoundContext: {
    lesson: { label: '组合体' }, stage: { label: '切出通孔', index: 2 },
    parameters: [{ label: '孔径', value: 1.2, unit: '格', applied: true }, { label: '未实施槽', value: 3, applied: false }],
    camera: { privateCamera: 'must not leak' }, contextKey: 'private-state'
  } });
  assert.equal(component(facts, '主体').count, 1);
  assert.equal(facts.components.length, 1);
  assert.equal(facts.currentStep.label, '切出通孔');
  assert.deepEqual(facts.dimensions, [{ label: '孔径', value: 1.2, unit: '格' }]);
  assert.equal(facts.selectedComponent.label, '主体');
  assert.doesNotMatch(JSON.stringify(facts), /privateCamera|private-state|未实施槽|切割工具/);
  dispose(root);
});

test('public facts stay bounded and do not serialize secrets, source paths or rendering state', () => {
  const root = new THREE.Group();
  root.userData = { apiKey: 'private-api-secret', account: 'private-account', sourcePath: 'C:/private/file', camera: { zoom: 999 } };
  const camera = new THREE.PerspectiveCamera(); camera.userData.label = 'private-camera'; root.add(camera);
  for (let i = 0; i < 35; i++) root.add(mesh(`part-${i}`, { label: `实体${i}`, secret: 'private-child-secret' }));
  const facts = collectModelFacts({ modelRoot: root, mode: 'compound', compoundContext: {
    stage: { label: '当前步骤' }, parameters: Array.from({ length: 35 }, (_, i) => ({ label: `尺寸${i}`, value: i, unit: '格' }))
  } });
  assertBounded(facts);
  assert.equal(facts.components.length, 24);
  assert.equal(facts.dimensions.length, 24);
  assert.doesNotMatch(JSON.stringify(facts), /private|sourcePath|camera|zoom|999/);
  dispose(root);
});

test('unknown units and invalid parameter values do not create invented measurements', () => {
  const root = new THREE.Group();
  root.userData.geometryContract = { mainSpan: 5, deckWidth: 2, towerHeight: 3 };
  assert.deepEqual(collectModelFacts({ modelRoot: root }).dimensions, []);
  const facts = collectModelFacts({ mode: 'compound', compoundContext: { parameters: [
    { label: '无穷', value: Infinity }, { label: '字符串', value: '5' }, { label: '正常', value: 2, unit: '格' }
  ] } });
  assert.deepEqual(facts.dimensions, [{ label: '正常', value: 2, unit: '格' }]);
  assertBounded(collectModelFacts());
});
