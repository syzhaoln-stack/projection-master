import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const DETAILED_BRIDGE_CATALOG = Object.freeze([
  Object.freeze({
    id: 'drawing_bago', name: 'Bago 河桥 · 斜拉桥', family: '斜拉桥',
    note: '教材图纸重构：中央单索面、独柱钢塔与三室钢箱梁；按原模型比例生成三视图。',
    sourceId: 'cable_stayed'
  }),
  Object.freeze({
    id: 'drawing_forth', name: 'Forth 公路桥 · 悬索桥', family: '悬索桥',
    note: '教材图纸重构：双主缆、成对吊杆与加劲桁架；局部锚固外形保留原教学简化。',
    sourceId: 'suspension'
  }),
  Object.freeze({
    id: 'drawing_nrg', name: '新河峡谷桥 · 上承式拱桥', family: '拱桥',
    note: '教材图纸重构：双拱肋、拱上立柱与桥面桁架；保持上承式体系和原始结构比例。',
    sourceId: 'arch'
  })
]);

const loader = new GLTFLoader();
const cachedScenes = new Map();
const pendingLoads = new Map();

function excludedFromFinishedBridge(object) {
  const metadata = object.userData || {};
  const category = String(metadata.category || object.name || '');
  const endStage = Number(metadata.end_stage ?? 99);
  // In this source project, 99 means retained in the completed bridge.
  if (Number.isFinite(endStage) && endStage < 99) return true;
  if (/^08_Temporary$/i.test(category) || /temporary|临时/i.test(category)) return true;
  if (/^9\d_/i.test(category)) return true;
  return /^(?:traffic|people|person|human|vehicles?|terrain|water|landscape|scenery)(?:_|$)/i.test(category);
}

function retainFinishedStructure(parent) {
  for (const child of [...parent.children]) {
    if (excludedFromFinishedBridge(child) || child.isCamera || child.isLight) {
      parent.remove(child);
    } else {
      retainFinishedStructure(child);
    }
  }
}

function semanticName(object, sourceId) {
  const id = String(object.userData.component_id || object.name || '');
  const category = String(object.userData.category || '');
  if (/^Stay_/i.test(id)) return 'stay_cable';
  if (/^Hanger_/i.test(id)) return 'hanger';
  if (/^MainCable/i.test(id)) return 'main_cable';
  if (/^(?:CableAnchorage|DeckAnchor|TowerAnchor|CableBand|Saddle)/i.test(id)) return 'anchor';
  if (/Gusset/i.test(id)) return 'gusset';
  if (/Stiffener/i.test(id)) return 'stiffener';
  if (/^Arch(?:Lower|Upper|Web|Post)/i.test(id)) return 'arch_rib';
  if (/^Arch(?:Crossframe|WindBrace)/i.test(id)) return 'arch_brace';
  if (/^Tower(?:Crossbeam|BearingBeam)/i.test(id)) return 'tower_beam';
  if (/^SpandrelCap|_cap$/i.test(id)) return 'pier_cap';
  if (/^(?:Pier|ApproachPier|Spandrel_)/i.test(id)) return 'pier';
  if (/^(?:FloorBeam|DeckFloorBeam|AnchorCrossbeam|SpandrelCross)/i.test(id)) return 'cross_beam';
  if (/^Deck_(?:\d+(?:_-?\d+)?|(?:Closure|Segment)_\d+)$/i.test(id)) return 'deck';
  if (category === '01_Foundations') return 'pier';
  if (category === '02_Towers') return sourceId === 'arch' ? 'arch_rib' : 'tower';
  if (category === '03_Deck') return 'girder';
  if (category === '04_Cables') return sourceId === 'cable_stayed' ? 'stay_cable' : 'main_cable';
  if (category === '05_Secondary') return /Bearing/i.test(id) ? 'pier_cap' : 'cross_beam';
  // Keep furniture and surfacing as separately selectable meshes with their source IDs.
  return id;
}

async function loadDetailedBridge(entry) {
  if (cachedScenes.has(entry.id)) return cachedScenes.get(entry.id);
  if (!pendingLoads.has(entry.id)) {
    const url = new URL(`assets/drawing-bridges/${entry.sourceId}.glb`, document.baseURI).href;
    const pending = loader.loadAsync(url).then(gltf => {
      cachedScenes.set(entry.id, gltf.scene);
      pendingLoads.delete(entry.id);
      return gltf.scene;
    }).catch(error => {
      pendingLoads.delete(entry.id);
      throw new Error(`${entry.name}加载失败：${error.message || error}`);
    });
    pendingLoads.set(entry.id, pending);
  }
  return pendingLoads.get(entry.id);
}

function buildDetailedBridge(entry) {
  const source = cachedScenes.get(entry.id);
  if (!source) throw new Error(`请先加载${entry.name}。`);
  const structure = source.clone(true);
  retainFinishedStructure(structure);
  const geometryCopies = new Map();
  const materialCopies = new Map();
  const cloneMaterial = material => {
    if (!materialCopies.has(material)) materialCopies.set(material, material.clone());
    return materialCopies.get(material);
  };

  structure.traverse(object => {
    object.visible = true;
    if (!object.isMesh) return;
    if (!geometryCopies.has(object.geometry)) {
      geometryCopies.set(object.geometry, object.geometry.clone());
    }
    object.geometry = geometryCopies.get(object.geometry);
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial) : cloneMaterial(object.material);
    object.userData.sourceNodeName = object.name;
    object.userData.sourceBridgeId = entry.sourceId;
    object.userData.component_id ||= object.name;
    object.userData.label ||= object.name;
    object.name = semanticName(object, entry.sourceId);
    object.castShadow = true;
    object.receiveShadow = true;
  });

  // Blender's GLB is already Y-up. Keep every source transform in meters unchanged.
  structure.updateMatrixWorld(true);
  const physicalBounds = new THREE.Box3().setFromObject(structure);
  const size = physicalBounds.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || longest <= 0) throw new Error(`${entry.name}没有有效几何。`);
  const center = physicalBounds.getCenter(new THREE.Vector3());
  const displayScale = 5 / longest;
  const wrapper = new THREE.Group();
  wrapper.name = entry.id;
  wrapper.userData = {
    sourceBridgeId: entry.sourceId,
    sourceUnit: 'm',
    sourceAxis: 'Y-up glTF; X longitudinal, Z transverse',
    sourceBoundsM: { min: physicalBounds.min.toArray(), max: physicalBounds.max.toArray() },
    displayScale,
    dimensionContract: 'assets/drawing-bridges/dimension-contract.json',
    representation: 'finished-bridge teaching reconstruction'
  };
  wrapper.scale.setScalar(displayScale);
  wrapper.position.set(-center.x * displayScale, -physicalBounds.min.y * displayScale, -center.z * displayScale);
  wrapper.add(structure);
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

export const DETAILED_BRIDGE_MODELS = Object.freeze(Object.fromEntries(
  DETAILED_BRIDGE_CATALOG.map(entry => [entry.id, Object.freeze({
    name: entry.name,
    note: entry.note,
    load: () => loadDetailedBridge(entry),
    build: () => buildDetailedBridge(entry)
  })])
));
