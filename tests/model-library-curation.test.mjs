import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BRIDGE_CATALOG, BRIDGE_MODELS } from '../bridge-models.js';
import { DETAILED_BRIDGE_CATALOG, DETAILED_BRIDGE_MODELS } from '../detailed-bridges.js';
import { CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG, ARCHIVED_BRIDGE_IDS } from '../model-library-curation.js';
import { TEXTBOOK_MECHANICAL_CATALOG, TEXTBOOK_MECHANICAL_MODELS } from '../textbook-mechanical-models.js';

const EXPECTED_BRIDGES = [
  'beamBridge', 'textbook_girder_tree', 'archBridge', 'textbook_arch_inclined',
  'textbook_hybrid_arch', 'cableStayedFan', 'cableStayedHarp', 'suspension', 'textbook_stayed_spatial'
];
const EXPECTED_DRAWINGS = ['drawing_bago', 'drawing_nrg', 'drawing_forth'];
const EXPECTED_MECHANICAL = [
  'textbookObliqueCylinder', 'textbookSlotCylinder', 'textbook51', 'textbook55',
  'textbook56', 'textbookKeyedShaft', 'textbookFlange', 'textbookValveAdapter'
];
const RETIRED_MECHANICAL = [
  'step', 'slottedBlock', 'throughHolePlate', 'ribBracket',
  'bearingSeat', 'dovetailSlide', 'vBlock', 'compoundSeat'
];
const fullBridgeCatalog = [...BRIDGE_CATALOG, ...DETAILED_BRIDGE_CATALOG];
const fullBridgeModels = { ...BRIDGE_MODELS, ...DETAILED_BRIDGE_MODELS };
const visibleCatalog = [...CURATED_BRIDGE_CATALOG, ...CURATED_DRAWING_CATALOG, ...TEXTBOOK_MECHANICAL_CATALOG];
const visibleModels = { ...fullBridgeModels, ...TEXTBOOK_MECHANICAL_MODELS };
const [html, application] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../projection-master.js', import.meta.url), 'utf8')
]);

test('the selected library contains the agreed 9 typical bridges and 3 drawing reconstructions', () => {
  assert.deepEqual(CURATED_BRIDGE_CATALOG.map(item => item.id), EXPECTED_BRIDGES);
  assert.deepEqual(CURATED_DRAWING_CATALOG.map(item => item.id), EXPECTED_DRAWINGS);
  for (const selected of [...CURATED_BRIDGE_CATALOG, ...CURATED_DRAWING_CATALOG]) {
    const original = fullBridgeCatalog.find(item => item.id === selected.id);
    assert.ok(original, `missing source: ${selected.id}`);
    assert.equal(selected.sourceId, original.sourceId);
    assert.equal(selected.family, original.family);
    assert.equal(selected.note, original.note, 'selection must not rewrite reconstruction limits');
    assert.equal(typeof fullBridgeModels[selected.id]?.build, 'function');
    assert.ok(selected.name.trim().length > 0);
    assert.ok(selected.focus.trim().length > 0, 'a curated item needs a drawing observation task');
  }
});

test('selection retains all 23 registered bridge routes and archives exactly the 11 unlisted textbook variants', () => {
  assert.equal(fullBridgeCatalog.length, 23);
  assert.equal(Object.keys(fullBridgeModels).length, 23);
  assert.equal(new Set(fullBridgeCatalog.map(item => item.id)).size, 23);
  assert.equal(ARCHIVED_BRIDGE_IDS.length, 11);
  assert.equal(new Set(ARCHIVED_BRIDGE_IDS).size, 11);
  const selected = new Set(CURATED_BRIDGE_CATALOG.map(item => item.id));
  assert.deepEqual(new Set(ARCHIVED_BRIDGE_IDS), new Set(BRIDGE_CATALOG.filter(item => !selected.has(item.id)).map(item => item.id)));
  for (const id of ARCHIVED_BRIDGE_IDS) assert.equal(typeof fullBridgeModels[id]?.build, 'function');
  assert.match(application, /Object\.assign\(MODELS,\s*BRIDGE_MODELS,\s*DETAILED_BRIDGE_MODELS,\s*TEXTBOOK_MECHANICAL_MODELS\)/);
  assert.match(application, /Object\.hasOwn\(MODELS,\s*entryModel\)/);
  assert.match(application, /selectLibraryModel\(\{\s*dataset:\s*\{\s*model:\s*entryModel\s*\}\s*\}\)/);
});

test('both members of the same-scale fan/harp comparison remain selected and editable', () => {
  for (const id of ['cableStayedFan', 'cableStayedHarp']) {
    assert.ok(CURATED_BRIDGE_CATALOG.some(item => item.id === id));
    assert.equal(typeof BRIDGE_MODELS[id].editContext, 'function');
    const context = BRIDGE_MODELS[id].editContext({});
    assert.ok(context.parameters.some(parameter => parameter.key === 'deckWidth'));
    assert.ok(context.parameters.some(parameter => parameter.key === 'towerHeight'));
    assert.ok(context.parameters.some(parameter => parameter.key === 'cablesPerSide'));
  }
});

test('all eight textbook mechanical entries have unique, loadable registrations and source locators', () => {
  assert.deepEqual(TEXTBOOK_MECHANICAL_CATALOG.map(item => item.id), EXPECTED_MECHANICAL);
  assert.equal(new Set(visibleCatalog.map(item => item.id)).size, 20);
  for (const item of TEXTBOOK_MECHANICAL_CATALOG) {
    assert.equal(typeof TEXTBOOK_MECHANICAL_MODELS[item.id]?.build, 'function');
    assert.equal(typeof TEXTBOOK_MECHANICAL_MODELS[item.id]?.load, 'function');
    assert.ok(Number.isInteger(item.chapter) && item.chapter > 0);
    assert.ok(Number.isInteger(item.page) && item.page > 0);
    assert.ok(item.figure.trim().length > 0);
    assert.ok(item.note.trim().length > 0);
    assert.ok(item.topics.length > 0);
  }
});

test('the static menu and shortcut buttons no longer advertise the retired samples', () => {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const shortcutIds = [...markup.matchAll(/\bdata-model="([^"]+)"/g)].map(match => match[1]);
  assert.ok(shortcutIds.length > 0);
  for (const id of shortcutIds) {
    assert.ok(visibleCatalog.some(item => item.id === id), `unlisted shortcut ${id}`);
    assert.equal(typeof visibleModels[id]?.build, 'function', `unregistered shortcut ${id}`);
  }
  for (const id of [...RETIRED_MECHANICAL, 'jointDetail']) {
    assert.ok(!shortcutIds.includes(id), `retired model still in the main menu: ${id}`);
  }
  assert.doesNotMatch(html, /\bdata-url="assets\/step_bearing_block\.step"/);
  assert.doesNotMatch(html, /data-group="engineering-joints"/);
  // Removing the bundled STEP sample must not remove users' own model import.
  assert.match(html, /id="obj-import-btn"/);
  assert.match(html, /id="obj-file"[^>]*accept="[^"]*\.step/);
  for (const target of ['bridge-library-list', 'drawing-bridge-list', 'textbook-mechanical-list']) {
    assert.equal([...html.matchAll(new RegExp(`id="${target}"`, 'g'))].length, 1);
  }
  const initialId = application.match(/\bcurrentModel:\s*'([^']+)'/)?.[1];
  assert.ok(CURATED_BRIDGE_CATALOG.some(item => item.id === initialId), 'initial scene must be a visible bridge');
});

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.textContent = '';
    this.hidden = false;
  }
  append(...children) { this.children.push(...children); }
}

function uiFixture() {
  const elements = new Map([
    'bridge-library-list', 'drawing-bridge-list', 'textbook-mechanical-list',
    'mechanical-model-count', 'model-source-card', 'model-source-title',
    'model-source-reference', 'model-source-focus'
  ].map(id => [id, new Element()]));
  return {
    elements,
    document: { getElementById: id => elements.get(id), createElement: tag => new Element(tag) }
  };
}

function productionFunction(name) {
  const matched = application.match(new RegExp(`function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(matched, `missing production function ${name}`);
  return matched[0];
}

test('the real dynamic menu renders only the selected items, with mechanical chapter headings and source captions', () => {
  const fixture = uiFixture();
  const populate = new Function('document', 'CURATED_BRIDGE_CATALOG', 'CURATED_DRAWING_CATALOG', 'TEXTBOOK_MECHANICAL_CATALOG',
    `${productionFunction('populateBridgeLibrary')}; return populateBridgeLibrary;`)(
    fixture.document, CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG, TEXTBOOK_MECHANICAL_CATALOG);
  populate();
  const groups = [
    ['bridge-library-list', EXPECTED_BRIDGES], ['drawing-bridge-list', EXPECTED_DRAWINGS],
    ['textbook-mechanical-list', EXPECTED_MECHANICAL]
  ];
  for (const [target, expected] of groups) {
    const buttons = fixture.elements.get(target).children.filter(element => element.tagName === 'BUTTON');
    assert.deepEqual(buttons.map(button => button.dataset.model), expected);
    for (const button of buttons) {
      assert.ok(button.title.length > 0);
      const [name, caption] = button.children[0].children;
      assert.ok(name.textContent.length > 0);
      assert.ok(caption.textContent.length > 0);
      assert.equal(typeof visibleModels[button.dataset.model]?.build, 'function');
    }
  }
  assert.equal(Number(fixture.elements.get('mechanical-model-count').textContent), 8);
  const chapterLabels = fixture.elements.get('textbook-mechanical-list').children
    .filter(element => element.className === 'library-chapter').map(element => element.textContent);
  assert.deepEqual(chapterLabels, [...new Set(TEXTBOOK_MECHANICAL_CATALOG.map(item => `第${item.chapter}章`))]);
});

test('the real source card follows the current selection and hides obsolete model details', () => {
  const fixture = uiFixture();
  const state = { currentModel: EXPECTED_MECHANICAL[0] };
  const update = new Function('document', 'state', 'CURATED_BRIDGE_CATALOG', 'CURATED_DRAWING_CATALOG', 'TEXTBOOK_MECHANICAL_CATALOG',
    `${productionFunction('updateModelSource')}; return updateModelSource;`)(
    fixture.document, state, CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG, TEXTBOOK_MECHANICAL_CATALOG);
  for (const item of TEXTBOOK_MECHANICAL_CATALOG) {
    state.currentModel = item.id;
    update();
    assert.equal(fixture.elements.get('model-source-card').hidden, false);
    const reference = fixture.elements.get('model-source-reference').textContent;
    assert.ok(reference.includes(item.figure));
    assert.ok(reference.includes(`第${item.page}页`));
    assert.ok(fixture.elements.get('model-source-focus').textContent.includes(item.note));
    assert.ok(fixture.elements.get('model-source-focus').textContent.includes(item.dimensionStatus));
  }
  state.currentModel = 'cableStayedFan';
  update();
  assert.equal(fixture.elements.get('model-source-title').textContent, '制图观察');
  assert.equal(fixture.elements.get('model-source-card').hidden, false);
  state.currentModel = 'jointDetail';
  update();
  assert.equal(fixture.elements.get('model-source-card').hidden, true);
});
