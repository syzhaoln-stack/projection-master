import * as THREE from 'three';

// Face IDs identify the current BRep tessellation only. They must not be used
// as persistent feature names after a Boolean operation rebuilds the solid.
export function findFaceGroup(geometry, faceIndex) {
  if (!geometry?.getAttribute?.('position') || !Number.isInteger(faceIndex) || faceIndex < 0) return null;
  const count = geometry.index?.count ?? geometry.getAttribute('position').count;
  const offset = faceIndex * 3;
  if (offset + 2 >= count) return null;
  const group = geometry.userData?.faceGroups?.find(item => (
    Number.isInteger(item.start) && Number.isInteger(item.count)
    && item.start >= 0 && item.count > 0 && item.start % 3 === 0 && item.count % 3 === 0
    && item.start + item.count <= count && Number.isFinite(item.faceId)
    && offset >= item.start && offset < item.start + item.count
  ));
  return group ? { start: group.start, count: group.count, faceId: group.faceId } : null;
}

export function extractFaceGeometry(geometry, faceIndex) {
  const group = findFaceGroup(geometry, faceIndex);
  if (!group) return null;
  const sourcePosition = geometry.getAttribute('position');
  const sourceNormal = geometry.getAttribute('normal');
  const positions = [], normals = [], indices = [], remap = new Map();
  for (let i = group.start; i < group.start + group.count; i += 1) {
    const vertex = geometry.index ? geometry.index.getX(i) : i;
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= sourcePosition.count) return null;
    if (!remap.has(vertex)) {
      remap.set(vertex, remap.size);
      positions.push(sourcePosition.getX(vertex), sourcePosition.getY(vertex), sourcePosition.getZ(vertex));
      if (sourceNormal) normals.push(sourceNormal.getX(vertex), sourceNormal.getY(vertex), sourceNormal.getZ(vertex));
    }
    indices.push(remap.get(vertex));
  }
  if (!positions.every(Number.isFinite)) return null;
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(indices);
  if (normals.length && normals.every(Number.isFinite)) result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  else result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();
  result.userData = { selectedFaceId: group.faceId };
  return result;
}

// Only the boundary of the selected surface is an engineering edge. Weld
// duplicated seam vertices before counting edges so tessellation diagonals
// and the seam of a periodic cylindrical face do not become highlighted lines.
export function createFaceBoundaryGeometry(geometry) {
  const position = geometry?.getAttribute?.('position');
  const result = new THREE.BufferGeometry();
  if (!position) return result.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const epsilon = Math.max(size.length() * 1e-7, 1e-9);
  const key = index => [position.getX(index), position.getY(index), position.getZ(index)]
    .map(value => Math.round(value / epsilon)).join(',');
  const edgeMap = new Map();
  const count = geometry.index?.count ?? position.count;
  const vertexAt = index => geometry.index ? geometry.index.getX(index) : index;
  for (let i = 0; i + 2 < count; i += 3) {
    const triangle = [vertexAt(i), vertexAt(i + 1), vertexAt(i + 2)];
    for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
      const ka = key(a), kb = key(b);
      if (ka === kb) continue;
      const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const edge = edgeMap.get(edgeKey);
      if (edge) edge.count += 1;
      else edgeMap.set(edgeKey, { a, b, count: 1 });
    }
  }
  const lines = [];
  for (const { a, b, count: uses } of edgeMap.values()) {
    if (uses !== 1) continue;
    lines.push(position.getX(a), position.getY(a), position.getZ(a), position.getX(b), position.getY(b), position.getZ(b));
  }
  result.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  result.computeBoundingBox();
  return result;
}

export function createFaceSelection(object, faceIndex) {
  const faceGroup = findFaceGroup(object?.geometry, faceIndex);
  if (!faceGroup) return null;
  const geometry = extractFaceGeometry(object.geometry, faceIndex);
  if (!geometry) return null;
  return { object, faceId: faceGroup.faceId, faceGroup, geometry,
    edgeGeometry: createFaceBoundaryGeometry(geometry), label: '选中面', kind: 'face' };
}

export function disposeFaceSelection(selection) {
  selection?.geometry?.dispose();
  selection?.edgeGeometry?.dispose();
}

export function isVisibleModelMesh(object) {
  if (!object?.isMesh || !object.geometry) return false;
  for (let current = object; current; current = current.parent) {
    if (!current.visible || current.userData?.projectionSelectionOverlay
      || current.userData?.pickedPointMarker || current.userData?.booleanTool
      || current.userData?.projectionGuide || current.userData?.compoundEdgeOverlay) return false;
  }
  return true;
}
