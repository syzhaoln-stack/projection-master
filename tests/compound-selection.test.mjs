import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

const controllerUrl = new URL('../compound-projection-lab.js', import.meta.url);
const source = (await readFile(controllerUrl, 'utf8')).replace(/from '([^']+)'/g, (_, specifier) => {
  const resolved = specifier === 'replicad-threejs-helper'
    ? new URL('../node_modules/replicad-threejs-helper/dist/es/replicad-threejs-helper.js', import.meta.url).href
    : specifier.startsWith('.') ? new URL(specifier, controllerUrl).href : import.meta.resolve(specifier);
  return `from '${resolved}'`;
});
const { createCompoundProjectionLab } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function element() {
  const handlers = new Map(), attrs = new Map();
  return { handlers, dataset: {}, style: {}, children: [], hidden: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    append(child) { this.children.push(child); child.parentElement = this; },
    remove() {}, setAttribute(key, value) { attrs.set(key, String(value)); }, getAttribute(key) { return attrs.get(key) ?? null; },
    set src(value) { attrs.set('src', value); }, get src() { return attrs.get('src'); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    clientWidth: 800, clientHeight: 600
  };
}

function boxAudit() {
  const geometry = new THREE.BoxGeometry(20, 20, 20).translate(0, 0, 10).toNonIndexed();
  const faces = { vertices: Array.from(geometry.attributes.position.array),
    normals: Array.from(geometry.attributes.normal.array),
    triangles: Array.from({ length: geometry.attributes.position.count }, (_, i) => i),
    faceGroups: geometry.groups.map((group, i) => ({ start: group.start, count: group.count, faceId: i + 11 })) };
  const edgeGeometry = new THREE.EdgesGeometry(geometry);
  const edges = { lines: Array.from(edgeGeometry.attributes.position.array), edgeGroups: [] };
  geometry.dispose(); edgeGeometry.dispose();
  const projection = frame => ({ frame, viewBox: frame.join(' '), visiblePathData: ['M0 0L1 1'], hiddenPathData: [], centerlinePathData: [] });
  return { facts: { passed: true }, renderMesh: { faces, edges }, projections: {
    front: projection([-12, -22, 24, 24]), side: projection([-12, -22, 24, 24]), top: projection([-12, -12, 24, 24])
  } };
}

test('a BRep face click overlays all three full drawings without rebuilding, reframing or changing original SVGs', async t => {
  const savedDocument = globalThis.document, savedRaf = globalThis.requestAnimationFrame;
  const shell = element(), rendererElement = element();
  const images = Object.fromEntries(['front', 'side', 'top'].map(view => {
    const image = element(); image.dataset.compoundImage = view; element().append(image); return [view, image];
  }));
  globalThis.document = {
    getElementById(id) { return id === 'compound-shell' ? shell : null; },
    querySelector(selector) { const match = selector.match(/^\[data-compound-image="(front|side|top)"\]$/); return match ? images[match[1]] : null; },
    querySelectorAll(selector) { return selector === '[data-compound-image]' ? Object.values(images) : []; },
    createElement() { return element(); }
  };
  globalThis.requestAnimationFrame = () => 1;
  const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.01, 100);
  const controls = { target: new THREE.Vector3(), update() {} };
  const modelGroup = new THREE.Group();
  let controller, root, builds = 0, audits = 0, projectionRefreshes = 0;
  const overlays = [];
  controller = createCompoundProjectionLab({ THREE, camera, controls, rendererElement, modelGroup,
    activateModel() { builds += 1; modelGroup.clear(); root = controller.buildCurrentModel(); modelGroup.add(root); },
    refreshProjections() { projectionRefreshes += 1; controller.syncProjectionImages(); },
    projectionImageProvider: view => `data:image/png;base64,preview-${view}`,
    auditKernel: async () => { audits += 1; return boxAudit(); },
    selectionProjectionProvider(payload) { overlays.push(payload); return `data:image/png;base64,selection-${payload.view}`; }
  });
  t.after(() => { controller.dispose(); globalThis.document = savedDocument; globalThis.requestAnimationFrame = savedRaf; });
  controller.enter();
  const auditTarget = { closest(selector) { return selector === '[data-kernel-action]' ? { dataset: { kernelAction: 'audit' } } : null; } };
  await shell.handlers.get('click')[0]({ target: auditTarget });
  camera.position.set(0, 1, 10); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true);
  const previousCamera = camera.matrixWorld.toArray();
  const previousState = controller.getState();
  const previousImages = Object.fromEntries(Object.entries(images).map(([view, image]) => [view, image.src]));
  const before = { builds, audits, projectionRefreshes };
  const click = (x, y) => {
    const event = { button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {} };
    for (const handler of rendererElement.handlers.get('pointerdown')) handler(event);
    for (const handler of rendererElement.handlers.get('pointerup')) handler(event);
  };
  click(400, 300);
  assert.equal(overlays.length, 3);
  assert.deepEqual(overlays.map(item => item.view), ['front', 'side', 'top']);
  assert.ok(overlays.every(item => item.selection.kind === 'face' && item.exact && item.modelRoot === root));
  assert.deepEqual(overlays[0].frame, [-12, -22, 24, 24]);
  assert.equal(root.getObjectByName('compound_selected_brep_face').material.depthWrite, false);
  assert.deepEqual({ builds, audits, projectionRefreshes }, before, 'selection is a display-only change');
  assert.deepEqual(controller.getState(), previousState);
  assert.deepEqual(camera.matrixWorld.toArray(), previousCamera);
  for (const [view, image] of Object.entries(images)) {
    assert.equal(image.src, previousImages[view], 'the exact black drawing remains untouched');
    assert.match(image.parentElement.children[1].style.cssText, /background:transparent/);
    assert.equal(image.parentElement.children[1].style.display, 'block');
  }
  controller.syncProjectionImages();
  assert.equal(overlays.length, 3, 'unchanged selection images are cached');
  click(400, 300);
  assert.equal(root.getObjectByName('compound_selected_brep_face'), undefined, 'a second click on the same face clears selection');
  assert.ok(Object.values(images).every(image => image.parentElement.children[1].style.display === 'none'));
  assert.deepEqual({ builds, audits, projectionRefreshes }, before);
  click(400, 300);
  const selectedOverlay = root.getObjectByName('compound_selected_brep_face');
  const displayTarget = { closest(selector) { return selector === '[data-display-action]' ? { dataset: { displayAction: 'hidden-lines' } } : null; } };
  shell.handlers.get('click')[0]({ target: displayTarget });
  assert.equal(selectedOverlay.material.depthWrite, false, 'display options must not turn the selection overlay into opaque geometry');
  assert.equal(selectedOverlay.material.opacity, 0.34);
  assert.ok(overlays.slice(-3).every(item => item.showHidden === false));
  click(5, 5);
  assert.equal(root.getObjectByName('compound_selected_brep_face'), undefined, 'empty-space click clears the selection');
});
