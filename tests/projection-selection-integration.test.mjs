import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { createFaceSelection, disposeFaceSelection } from '../projection-selection.js';

const source = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');
const productionFunction = name => {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};

function harness() {
  const group = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial());
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  a.name = 'base'; b.name = 'rib'; b.position.set(3, 2, 0); group.add(a, b); group.updateMatrixWorld(true);
  let redraws = 0;
  const deps = { THREE, createFaceSelection, disposeFaceSelection,
    selectedComponent: null, selectedComponentOriginalMaterial: null, projectionSelection: null, selectedFaceIndex: null,
    state: { transparentModel: false, unfoldProgress: 0.6, isUnfolded: true, transitionActive: true },
    camera: new THREE.PerspectiveCamera(), viewport: { dataset: {} },
    modelGroup: group, focusGroup: new THREE.Group(), EDGE_THRESHOLD: 24, COL: { amber: 0xf0b454 },
    clearGroup(root) { while (root.children.length) { const child = root.children[0]; child.geometry?.dispose(); child.material?.dispose(); root.remove(child); } },
    drawProjections() { redraws += 1; }, getModelBounds: () => new THREE.Box3().setFromObject(group),
    getComponentInfo: name => ({ label: name, role: '测试构件' }), updateComponentInfo() {}, setStatus() {}, handleBridgeTaskComponentSelection() {}
  };
  deps.camera.position.set(5, 3, 8);
  const names = ['updateFocusMarker', 'cloneHighlightMaterial', 'disposeMaterial', 'restoreComponentHighlight',
    'setFocusComponent', 'clearFocus', 'getProjBounds'];
  const api = new Function('deps', `with(deps){${names.map(productionFunction).join('\n')}\nreturn {setFocusComponent,clearFocus,getProjBounds};}`)(deps);
  return { deps, api, a, b, get redraws() { return redraws; } };
}

test('selecting a component keeps the full drawing bounds, original meshes, camera and unfolding progress', () => {
  const { deps, api, b } = harness();
  const before = api.getProjBounds().clone(), material = b.material;
  const camera = deps.camera.position.clone(), progress = structuredClone(deps.state);
  api.setFocusComponent(b);
  assert.equal(deps.viewport.dataset.selection, 'component');
  assert.deepEqual(api.getProjBounds(), before);
  assert.equal(deps.modelGroup.children.length, 2);
  assert.ok(deps.modelGroup.children.every(mesh => mesh.visible));
  assert.deepEqual(deps.camera.position, camera);
  assert.deepEqual(deps.state, progress);
  assert.notEqual(b.material, material);
  api.clearFocus(false);
  assert.equal(b.material, material);
  assert.equal(deps.projectionSelection, null);
  assert.deepEqual(api.getProjBounds(), before);
});

test('a fused body selects only the hit BRep face and cancelling never disposes the body geometry', () => {
  const { deps, api, a } = harness();
  a.geometry.userData.faceGroups = a.geometry.groups.map((g, i) => ({ start: g.start, count: g.count, faceId: i + 1 }));
  const material = a.material, before = api.getProjBounds().clone();
  let bodyDisposed = false;
  a.geometry.addEventListener('dispose', () => { bodyDisposed = true; });
  api.setFocusComponent(a, 4);
  assert.equal(deps.viewport.dataset.selection, 'face');
  assert.equal(deps.projectionSelection.faceId, 3);
  assert.equal(deps.projectionSelection.geometry.index.count, 6);
  assert.equal(a.material, material);
  assert.deepEqual(api.getProjBounds(), before);
  assert.equal(deps.focusGroup.children.length, 1);
  api.clearFocus(false);
  assert.equal(deps.focusGroup.children.length, 0);
  assert.equal(bodyDisposed, false);
});
