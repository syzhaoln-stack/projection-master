import * as THREE from 'three';
import { presets, buildModel } from './assets/textbook-bridges/model.js';

// Source geometry remains in metres (X longitudinal, Y transverse, Z up).
// Only this mapping and the returned root's uniform display transform are applied.
export const bridgePointToThree = (x, y, z) => new THREE.Vector3(x, z, -y);
export const BRIDGE_DISPLAY_EXTENT = 5;
const LEGACY_IDS = Object.freeze({
  girder_reference: 'beamBridge',
  arch_basket: 'archBridge',
  stayed_fan: 'cableStayedFan',
  stayed_harp: 'cableStayedHarp',
  suspension_ground: 'suspension'
});

const EXCLUDED_CATEGORIES = new Set(['temporary', 'person', 'people', 'vehicle', 'environment', 'road-furniture']);
const FINISHES = {
  concrete: { color: '#b6b7ab', roughness: 0.86, metalness: 0 },
  steel: { color: '#7d969c', roughness: 0.47, metalness: 0.24 },
  deck: { color: '#bfc7c9', roughness: 0.8, metalness: 0.03 },
  cable: { color: '#456474', roughness: 0.42, metalness: 0.32 },
  hanger: { color: '#617d87', roughness: 0.48, metalness: 0.24 },
  railing: { color: '#829699', roughness: 0.6, metalness: 0.16 },
  wood: { color: '#b4966d', roughness: 0.85, metalness: 0 }
};

/** Finished structural inventory, independent of the source viewer's visibility. */
export function isFinishedBridgePart(part, model) {
  const lastStage = model.stages.length - 1;
  return !EXCLUDED_CATEGORIES.has(part.category)
    && part.stage <= lastStage
    && (part.temporaryUntil == null || part.temporaryUntil >= lastStage);
}

/** Keep existing quiz keys where the engineering meaning matches the old role. */
export function bridgeComponentName(part) {
  const label = part.label || part.id;
  if (part.category === 'cable') {
    if (/斜拉索|背索/.test(label)) return 'stay_cable';
    if (/主缆|主索|悬索|边缆/.test(label)) return 'main_cable';
    return label; // Steel ribbons and Fink ties are not ordinary stay cables.
  }
  if (part.category === 'bracing') {
    if (/拱间|拱肋.*横/.test(label)) return 'arch_brace';
    if (/塔.*横梁/.test(label)) return 'tower_beam';
    if (/横梁|横隔/.test(label)) return 'cross_beam';
    return label; // In particular, underslung compression struts are not hangers.
  }
  if (part.category === 'tower') return /横梁/.test(label) ? 'tower_beam' : 'tower';
  if (part.category === 'girder') return /系梁/.test(label) ? 'tie_girder' : 'girder';
  return ({ deck: 'deck', pier: 'pier', anchor: 'anchor', arch: 'arch_rib', hanger: 'hanger' })[part.category] || label;
}

// Six-sided circular sections reduce projection cost without changing sampled
// centreline stations, radii or member placement. Every source point is retained.
function polylineTube(points, radius, radialSegments = 6) {
  const vertices = points.map(p => bridgePointToThree(...p));
  const count = vertices.length;
  const positions = [], normals = [], indices = [];
  let previousNormal;
  for (let i = 0; i < count; i++) {
    const before = vertices[Math.max(0, i - 1)];
    const after = vertices[Math.min(count - 1, i + 1)];
    const tangent = after.clone().sub(before).normalize();
    let normal;
    if (previousNormal) normal = previousNormal.clone().addScaledVector(tangent, -previousNormal.dot(tangent));
    if (!normal || normal.lengthSq() < 1e-12) {
      const reference = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      normal = reference.addScaledVector(tangent, -reference.dot(tangent));
    }
    normal.normalize();
    previousNormal = normal;
    const binormal = tangent.clone().cross(normal).normalize();
    for (let j = 0; j < radialSegments; j++) {
      const angle = j * Math.PI * 2 / radialSegments;
      const direction = normal.clone().multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle));
      positions.push(...vertices[i].clone().addScaledVector(direction, radius).toArray());
      normals.push(...direction.toArray());
      if (i < count - 1) {
        const a = i * radialSegments + j;
        const b = i * radialSegments + (j + 1) % radialSegments;
        indices.push(a, b, a + radialSegments, b, b + radialSegments, a + radialSegments);
      }
    }
  }
  // Close only the two physical ends; do not add internal segment caps.
  for (const [ring, reverse] of [[0, true], [count - 1, false]]) {
    for (let j = 1; j < radialSegments - 1; j++) {
      const a = ring * radialSegments;
      indices.push(a, a + (reverse ? j + 1 : j), a + (reverse ? j : j + 1));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createPartMesh(part, material, model) {
  let geometry;
  const mesh = new THREE.Mesh(undefined, material);
  if (part.shape === 'box') {
    geometry = new THREE.BoxGeometry(part.size[0], part.size[2], part.size[1]);
    mesh.position.copy(bridgePointToThree(...part.center));
    if (part.axis) {
      const x = new THREE.Vector3(...part.axis).normalize();
      const y = new THREE.Vector3(-x.y, x.x, 0).normalize();
      const z = x.clone().cross(y).normalize();
      mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
        bridgePointToThree(...x.toArray()), bridgePointToThree(...z.toArray()), bridgePointToThree(...y.negate().toArray())
      ));
    }
  } else if (part.shape === 'sphere') {
    geometry = new THREE.SphereGeometry(part.radius, 8, 6);
    mesh.position.copy(bridgePointToThree(...part.center));
  } else if (part.points?.length === 2) {
    const a = bridgePointToThree(...part.points[0]);
    const b = bridgePointToThree(...part.points[1]);
    const delta = b.clone().sub(a);
    geometry = new THREE.CylinderGeometry(part.radius, part.radius, delta.length(), 6, 1, false);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  } else if (part.points?.length > 2) {
    geometry = polylineTube(part.points, part.radius);
  } else {
    throw new Error(`桥梁构件没有支持的几何：${model.id}/${part.id}`);
  }
  mesh.geometry = geometry;
  mesh.name = bridgeComponentName(part);
  mesh.castShadow = !['cable', 'hanger', 'railing'].includes(part.category);
  mesh.receiveShadow = true;
  mesh.userData = {
    component_id: part.id,
    label: part.label,
    category: part.category,
    materialKey: part.material,
    sourceModelId: model.id,
    geometryRevision: model.revision,
    sourceIds: [...model.sourceIds],
    stage: part.stage,
    sourcePart: part,
    units: 'm'
  };
  return mesh;
}

export function buildTextbookBridge(sourceId, options = {}) {
  const model = buildModel(sourceId, options);
  const root = new THREE.Group();
  root.name = `textbook-bridge:${sourceId}`;
  const materials = new Map();
  for (const part of model.parts.filter(part => isFinishedBridgePart(part, model))) {
    const key = FINISHES[part.material] ? part.material : 'steel';
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial(FINISHES[key]));
    root.add(createPartMesh(part, materials.get(key), model));
  }
  root.updateMatrixWorld(true);
  const physicalBounds = new THREE.Box3().setFromObject(root);
  const size = physicalBounds.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) throw new Error(`桥梁模型尺寸无效：${sourceId}`);
  const scale = BRIDGE_DISPLAY_EXTENT / maxDimension;
  const center = physicalBounds.getCenter(new THREE.Vector3());
  root.scale.setScalar(scale);
  root.position.set(-center.x * scale, -physicalBounds.min.y * scale, -center.z * scale);
  root.userData = {
    sourceModelId: sourceId,
    label: model.title,
    units: 'm',
    canonicalAxes: { x: 'longitudinal', y: 'transverse', z: 'up' },
    coordinateMapping: '(x,y,z) -> (x,z,-y)',
    displayScale: scale,
    displayExtent: BRIDGE_DISPLAY_EXTENT,
    physicalBoundsThree_m: { min: physicalBounds.min.toArray(), max: physicalBounds.max.toArray() },
    geometrySignature: model.geometrySignature,
    sourceIds: [...model.sourceIds],
    sourceModel: model,
    includedScope: 'finished bridge structure; original dimensions and member radii',
    excludedScope: 'people, vehicles, environment, road furniture and temporary works',
    evidenceType: 'teaching reconstruction; no structural analysis'
  };
  root.updateMatrixWorld(true);
  return root;
}

export const BRIDGE_CATALOG = Object.freeze(presets.map(preset => Object.freeze({
  id: LEGACY_IDS[preset.id] || `textbook_${preset.id}`,
  name: preset.title,
  family: preset.family,
  note: `${preset.subtitle}。${preset.loadPath}。教材米制教学模型，显示时整体等比缩放。`,
  sourceId: preset.id
})));

export const BRIDGE_MODELS = Object.freeze(Object.fromEntries(BRIDGE_CATALOG.map(item => [item.id, {
  name: item.name,
  note: item.note,
  build: () => buildTextbookBridge(item.sourceId)
}])));
