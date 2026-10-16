import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { findFaceGroup, extractFaceGeometry, createFaceBoundaryGeometry, createFaceSelection, disposeFaceSelection, isVisibleModelMesh } from '../projection-selection.js';

function twoFaces() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0,
    0, 0, 1, 2, 0, 1, 2, 1, 1, 0, 1, 1
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.userData.faceGroups = [{ start: 0, count: 6, faceId: 73 }, { start: 6, count: 6, faceId: 91 }];
  return geometry;
}

test('raycast triangle index resolves exactly one current BRep face', () => {
  const geometry = twoFaces();
  assert.equal(findFaceGroup(geometry, 1).faceId, 73);
  assert.equal(findFaceGroup(geometry, 2).faceId, 91);
  for (const invalid of [-1, 4, 0.5, undefined]) assert.equal(findFaceGroup(geometry, invalid), null);
  const face = extractFaceGeometry(geometry, 2);
  assert.equal(face.index.count, 6);
  assert.equal(face.attributes.position.count, 4);
  assert.equal(face.boundingBox.min.z, 1);
  assert.equal(face.boundingBox.max.z, 1);
  face.attributes.position.setZ(0, 9);
  assert.equal(geometry.attributes.position.getZ(4), 1, 'the selection must own its attribute arrays');
  face.dispose(); geometry.dispose();
});

test('missing or corrupt BRep groups never fall back to highlighting the entire solid', () => {
  const geometry = twoFaces();
  delete geometry.userData.faceGroups;
  assert.equal(extractFaceGeometry(geometry, 0), null);
  geometry.userData.faceGroups = [{ start: 0, count: 99, faceId: 73 }];
  assert.equal(extractFaceGeometry(geometry, 0), null);
  geometry.userData.faceGroups = [{ start: 1, count: 6, faceId: 73 }];
  assert.equal(extractFaceGeometry(geometry, 1), null);
  geometry.dispose();
});

test('surface boundary excludes triangulation diagonals even with duplicated seam vertices', () => {
  const face = extractFaceGeometry(twoFaces(), 0).toNonIndexed();
  const boundary = createFaceBoundaryGeometry(face);
  assert.equal(boundary.attributes.position.count, 8, 'four perimeter segments, no shared diagonal');
  const p = boundary.attributes.position;
  for (let i = 0; i < p.count; i += 2) {
    assert.ok(p.getX(i) === p.getX(i + 1) || p.getY(i) === p.getY(i + 1));
  }
  boundary.dispose(); face.dispose();
});

test('selection preserves object transform and has independent disposable geometry', () => {
  const object = new THREE.Mesh(twoFaces(), new THREE.MeshBasicMaterial());
  object.position.set(4, 5, 6);
  const selection = createFaceSelection(object, 3);
  assert.equal(selection.faceId, 91);
  assert.equal(selection.label, '选中面');
  assert.equal(selection.object, object);
  assert.deepEqual(object.position.toArray(), [4, 5, 6]);
  assert.equal(selection.geometry.boundingBox.max.z, 1, 'coordinates remain mesh-local');
  disposeFaceSelection(selection);
  assert.equal(object.geometry.index.count, 12);
});

test('picking excludes hidden ancestors, Boolean cutters and selection overlays but includes exact BRep solids', () => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.userData.exactKernel = true;
  mesh.userData.excludeFromProjection = true;
  group.add(mesh);
  assert.equal(isVisibleModelMesh(mesh), true);
  group.visible = false; assert.equal(isVisibleModelMesh(mesh), false); group.visible = true;
  for (const marker of ['booleanTool', 'projectionSelectionOverlay', 'pickedPointMarker', 'projectionGuide']) {
    mesh.userData[marker] = true; assert.equal(isVisibleModelMesh(mesh), false); delete mesh.userData[marker];
  }
});
