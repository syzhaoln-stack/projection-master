import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
  getModelExtension,
  isStepExtension,
  occtResultToTriangleSoup,
  STEP_IMPORT_OPTIONS,
  SUPPORTED_MODEL_EXTENSIONS
} from './model-import.js';
import {
  BRIDGE_VIEW_TASK,
  createPracticeRecord,
  directionAngleDegrees,
  evaluateQuestionAnswer,
  getComponentInfo,
  getHotspotHit,
  getQuizOptionState,
  isBridgeTaskTarget,
  summarizePractice
} from './learning-logic.js';
import { QUESTION_BANK } from './question-bank.js?v=7.0.1';
import { createBasicProjectionLab } from './basic-projection-lab.js?v=8.0.0';
import { createCompoundProjectionLab } from './compound-projection-lab.js?v=8.3.1';
import { BRIDGE_MODELS } from './bridge-models.js';
import { DETAILED_BRIDGE_MODELS } from './detailed-bridges.js';
import { CURATED_BRIDGE_CATALOG, CURATED_DRAWING_CATALOG } from './model-library-curation.js';
import { TEXTBOOK_MECHANICAL_MODELS, TEXTBOOK_MECHANICAL_CATALOG } from './textbook-mechanical-models.js';
import { createViceLab } from './vice-lab.js';
import { computeTiledProjectionLayout } from './tiled-projection-layout.js';
import { applyGeometryVariation, geometryVariationVector } from './ai-geometry-variation.js';
import { createAiWorkbenchAdapter } from './ai-workbench-adapter.js';
import { createAiModelAssistant } from './ai-model-assistant.js';
import { collectModelFacts } from './ai-model-facts.js';

// ===== 基础设置 =====
const viewport = document.getElementById('viewport');
const statusStrip = document.getElementById('status-strip');
const hudMode = document.getElementById('hud-mode');

const VIEWPORT_BG = 0xf3f6f9;
const scene = new THREE.Scene();
scene.background = new THREE.Color(VIEWPORT_BG);
scene.fog = null; // 工程模型拉远时仍保持原色和线条对比，不使用距离雾化

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
camera.position.set(8.6, 6.8, 10.4);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(VIEWPORT_BG, 1);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 1.45, 0);
controls.minDistance = 2.2;
controls.maxDistance = 120;

// 光照
scene.add(new THREE.HemisphereLight(0xffffff, 0xc6d0da, 1.18));
scene.add(new THREE.AmbientLight(0xffffff, 0.34));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.18);
keyLight.position.set(6, 10, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -9;
keyLight.shadow.camera.right = 9;
keyLight.shadow.camera.top = 9;
keyLight.shadow.camera.bottom = -9;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xb7d8f3, 0.46);
rimLight.position.set(-7, 5, -5);
scene.add(rimLight);

// ===== 状态 =====
const state = {
  currentModel: 'cableStayedFan',
  geometryVariationFactors: [1, 1, 1],
  unfoldProgress: 0,
  isUnfolded: false,
  transitionActive: false,
  transitionFrom: 0,
  transitionTo: 0,
  transitionStart: 0,
  transitionDuration: 760,
  showProjLines: false,
  showHidden: true,
  showCenterLines: false,
  showAxes: false,
  transparentModel: false,
  planeAlpha: 0.16,
  planeSize: 7.5,
  planeGap: 3.5,
  importedGeometry: null,
  importedName: '',
  mode: 'explore',
  isTiled: false,
  activeMatchedView: null,
  matchedViewEnteredAt: 0
};

const bridgeTaskState = {
  active: false,
  stage: 'idle'
};

const modelGroup = new THREE.Group();
const projectionGroup = new THREE.Group();
const axesGroup = new THREE.Group();
const projLinesGroup = new THREE.Group();
const floorGroup = new THREE.Group();
const focusGroup = new THREE.Group();   // 局部三视图聚焦框标记
scene.add(floorGroup, projectionGroup, modelGroup, axesGroup, projLinesGroup, focusGroup);

let labController = null;
let compoundController = null;
const viceController = createViceLab();
let modelLoadRequest = 0;
let exploreRestoreState = null;
const modelVariations = new Map();
let modelRevision = 0;

// 语义构件选择：真实构件包围盒（null=整体）
let focusBox = null;
let selectedComponent = null;
let selectedComponentOriginalMaterial = null;
const raycaster = new THREE.Raycaster();

const COL = {
  cyan: 0x5ed0e6,
  amber: 0xf0b454,
  green: 0x8bd07c,
  coral: 0xee7a66,
  violet: 0xa78bfa,
  blue: 0x5db7f0,
  steel: 0x8fa9b8,
  dark: 0x172233
};

// ===== 几何工具 =====
function makeMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.46,
    metalness: 0.04,
    ...opts
  });
}
function addBox(group, name, x, y, z, sx, sy, sz, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), makeMat(color));
  mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function addCylinder(group, name, x, y, z, radius, height, color, segments = 48) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), makeMat(color));
  mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh); return mesh;
}
function addCylinderX(group, name, x, y, z, radius, length, color, segments = 48) {
  const mesh = addCylinder(group, name, x, y, z, radius, length, color, segments);
  mesh.rotation.z = Math.PI / 2; return mesh;
}
function addTorusX(group, name, x, y, z, radius, tube, color) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 18, 72), makeMat(color, { roughness: 0.42 }));
  mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = Math.PI / 2; mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh); return mesh;
}
function addTriPrism(group, name, color, points, depth, x = 0, y = 0, z = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(p => shape.lineTo(p[0], p[1]));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.center();
  const mesh = new THREE.Mesh(geo, makeMat(color));
  mesh.name = name; mesh.position.set(x, y, z); mesh.rotation.y = -Math.PI / 2; mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh); return mesh;
}
function addProfilePrism(group, name, color, outer, depth, opts = {}) {
  const { holes = [], x = 0, y = 0, z = 0, rotX = 0, rotY = 0 } = opts;
  const shape = new THREE.Shape();
  shape.moveTo(outer[0][0], outer[0][1]);
  outer.slice(1).forEach(p => shape.lineTo(p[0], p[1]));
  shape.closePath();
  holes.forEach(h => {
    const path = new THREE.Path();
    if (h.circle) { path.absellipse(h.circle[0], h.circle[1], h.circle[2], h.circle[2], 0, Math.PI * 2, true); }
    else { path.moveTo(h[0][0], h[0][1]); h.slice(1).forEach(p => path.lineTo(p[0], p[1])); path.closePath(); }
    shape.holes.push(path);
  });
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 48 });
  geo.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(geo, makeMat(color));
  mesh.position.set(x, y, z); mesh.rotation.set(rotX, rotY, 0); mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh); return mesh;
}

// 两点之间的圆柱（桥梁索/吊杆/塔腿/拱肋分段通用），y-up 坐标系
const _cbUp = new THREE.Vector3(0, 1, 0);
function addCylinderBetween(group, name, a, b, radius, color, seg = 12) {
  const av = new THREE.Vector3(a[0], a[1], a[2]);
  const bv = new THREE.Vector3(b[0], b[1], b[2]);
  const dir = new THREE.Vector3().subVectors(bv, av);
  const len = dir.length();
  if (len < 1e-6) return null;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, seg), makeMat(color));
  mesh.name = name;
  mesh.quaternion.setFromUnitVectors(_cbUp, dir.clone().normalize());
  mesh.position.copy(av).addScaledVector(dir, 0.5);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    if (child.children?.length) clearGroup(child);
    if (child.geometry) child.geometry.dispose();
    if (child.userData?.ownedTexture) {
      child.userData.ownedTexture.dispose();
      child.userData.ownedTexture = null;
    }
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
    group.remove(child);
  }
}
function setStatus(text) {
  if (statusStrip) statusStrip.textContent = text;
}

// ===== 模型库（工程制图典型）=====
const MODELS = {
  step: {
    name: '叠加台阶块',
    note: '由长方体逐层叠加，训练长对正、宽相等、高平齐。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'lower_block', 0, 0.35, 0, 4.4, 0.7, 2.8, COL.blue);
      addBox(g, 'middle_block', -0.55, 1.05, 0, 3.25, 0.7, 2.8, 0x40aee6);
      addBox(g, 'top_block', -1.15, 1.75, 0, 2.05, 0.7, 2.8, 0x2389c8);
      return g;
    }
  },
  slottedBlock: {
    name: '开槽导块',
    note: '顶面切出矩形通槽，俯视图可见槽口，正视/侧视可见槽底虚线。',
    build() {
      const g = new THREE.Group();
      const outer = [[-2.2, 0], [2.2, 0], [2.2, 1.5], [0.85, 1.5], [0.85, 0.7], [-0.85, 0.7], [-0.85, 1.5], [-2.2, 1.5]];
      addProfilePrism(g, 'slotted', 0x5fbf86, outer, 2.8, { y: 0 });
      return g;
    }
  },
  throughHolePlate: {
    name: '通孔板',
    note: '矩形板含中央大孔与两个螺栓孔，圆的中心线可见，孔的投影在其他视图为虚线。',
    centerAxes: [
      { from: [0, 0, 0], to: [0, 0.7, 0] },
      { from: [-1.45, 0, -0.85], to: [-1.45, 0.7, -0.85] },
      { from: [1.45, 0, 0.85], to: [1.45, 0.7, 0.85] }
    ],
    build() {
      const g = new THREE.Group();
      const outer = [[-2.2, -1.4], [2.2, -1.4], [2.2, 1.4], [-2.2, 1.4]];
      addProfilePrism(g, 'plate', 0x4fb0cf, outer, 0.7, { rotX: -Math.PI / 2, y: 0.35, holes: [
        { circle: [0, 0, 0.75] },
        { circle: [-1.45, 0.85, 0.32] },
        { circle: [1.45, -0.85, 0.32] }
      ] });
      return g;
    }
  },
  ribBracket: {
    name: '肋板支架',
    note: '底板、立板与三角肋板，组合体形体分析训练。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'base', 0, 0.25, 0, 4.5, 0.5, 2.8, COL.steel);
      addBox(g, 'vertical', -1.25, 1.25, 0, 0.55, 2.0, 2.45, 0x7897aa);
      addBox(g, 'top_boss', -1.25, 2.42, 0, 1.2, 0.38, 1.45, 0x66869b);
      addTriPrism(g, 'front_rib', 0x8eaabc, [[-0.95, -0.9], [0.95, -0.9], [-0.95, 0.95]], 0.28, -0.4, 0.98, 0.82);
      addTriPrism(g, 'back_rib', 0x8eaabc, [[-0.95, -0.9], [0.95, -0.9], [-0.95, 0.95]], 0.28, -0.4, 0.98, -0.82);
      return g;
    }
  },
  bearingSeat: {
    name: '轴承座',
    note: '经典组合体：底板、支承板、圆柱筒与肋板，训练曲面与平面的投影关系。',
    centerAxes: [{ from: [-1.225, 1.92, 0], to: [1.225, 1.92, 0] }],
    build() {
      const g = new THREE.Group();
      addBox(g, 'base', 0, 0.25, 0, 4.8, 0.5, 2.9, 0x8197a5);
      addBox(g, 'left_support', -0.95, 1.05, 0, 0.45, 1.6, 2.2, 0x6f8998);
      addBox(g, 'right_support', 0.95, 1.05, 0, 0.45, 1.6, 2.2, 0x6f8998);
      addCylinderX(g, 'barrel', 0, 1.92, 0, 0.82, 2.45, COL.amber, 64);
      addTorusX(g, 'hole_rim', 0, 1.92, 0, 0.45, 0.055, 0x273646);
      addTriPrism(g, 'front_rib', 0x95aab8, [[-0.75, -0.8], [0.75, -0.8], [0, 0.8]], 0.26, 0, 0.92, 0.9);
      addTriPrism(g, 'back_rib', 0x95aab8, [[-0.75, -0.8], [0.75, -0.8], [0, 0.8]], 0.26, 0, 0.92, -0.9);
      [-1.75, 1.75].forEach(x => addCylinder(g, 'bolt', x, 0.62, 0.92, 0.28, 0.24, 0x9fb0ba, 32));
      [-1.75, 1.75].forEach(x => addCylinder(g, 'bolt', x, 0.62, -0.92, 0.28, 0.24, 0x9fb0ba, 32));
      return g;
    }
  },
  dovetailSlide: {
    name: '燕尾槽滑块',
    note: '斜面槽口，训练斜线与斜面的投影，第一角视图中的实虚关系。',
    build() {
      const g = new THREE.Group();
      const outer = [[-2.2, 0], [2.2, 0], [2.2, 1.3], [0.75, 1.3], [0.5, 0.6], [-0.5, 0.6], [-0.75, 1.3], [-2.2, 1.3]];
      addProfilePrism(g, 'slide', 0x9279e0, outer, 2.7, { y: 0 });
      return g;
    }
  },
  vBlock: {
    name: 'V形定位块',
    note: 'V槽用于圆柱定位，对称中心线与斜面投影是训练重点。',
    centerAxes: [{ from: [-1.225, 1.58, 0], to: [1.225, 1.58, 0] }],
    build() {
      const g = new THREE.Group();
      addBox(g, 'base', 0, 0.35, 0, 4.2, 0.7, 2.8, 0x4fb0cf);
      addTriPrism(g, 'left_v', 0x5ed0e6, [[-0.95, -0.48], [0.55, -0.48], [-0.95, 0.48]], 2.8, -0.45, 1.05, 0);
      addTriPrism(g, 'right_v', 0x3aa8c7, [[-0.55, -0.48], [0.95, -0.48], [0.95, 0.48]], 2.8, 0.45, 1.05, 0);
      addCylinderX(g, 'ref', 0, 1.58, 0, 0.34, 2.45, 0xf0b454, 48);
      return g;
    }
  },
  compoundSeat: {
    name: '综合支座',
    note: '底板、凸台、立柱、槽口、圆柱混合，综合读图与形体分析训练。',
    centerAxes: [{ from: [0.85, 1.335, 0.55], to: [0.85, 1.985, 0.55] }],
    build() {
      const g = new THREE.Group();
      addBox(g, 'base', 0, 0.25, 0, 4.7, 0.5, 2.9, 0x78a079);
      addBox(g, 'rear_wall', -1.35, 1.05, -0.55, 0.65, 1.6, 1.8, 0x608d63);
      addBox(g, 'side_pad', 0.85, 0.92, 0.55, 1.7, 0.84, 1.55, 0x6fa871);
      addCylinder(g, 'boss', 0.85, 1.66, 0.55, 0.58, 0.65, 0x8fcf88, 48);
      addBox(g, 'slot_left', -0.2, 0.92, -0.88, 1.4, 0.84, 0.38, 0x78b179);
      addBox(g, 'slot_right', -0.2, 0.92, -0.2, 1.4, 0.84, 0.38, 0x78b179);
      addTriPrism(g, 'compound_rib', 0x9bc49a, [[-0.7, -0.65], [0.7, -0.65], [-0.7, 0.65]], 0.36, -0.55, 0.9, 0.55);
      return g;
    }
  },
  chapter5: {
    name: '第5章组合体例题',
    note: '按教材例题的组成、切除和检验顺序生成三维模型与三视图。',
    get centerAxes() {
      return compoundController?.getCenterAxes() || [];
    },
    build() {
      return compoundController?.buildCurrentModel() || new THREE.Group();
    }
  }
};

// ===== 桥梁模型（参数化，y-up；x=跨向 y=高 z=横向）=====
function buildCableStayed(kind) {
  const g = new THREE.Group();
  const L = 7.0, W = 1.4, yd = 1.0, ytop = yd + 2.3;
  addBox(g, 'girder', 0, yd, 0, L, 0.22, W, COL.steel);
  addBox(g, 'deck', 0, yd + 0.16, 0, L, 0.07, W * 0.94, 0x9fb4c2);
  [-W / 2 + 0.08, W / 2 - 0.08].forEach(z => addBox(g, 'edge_girder', 0, yd + 0.03, z, L, 0.16, 0.1, 0x70889a));
  const towerX = [-L / 4, L / 4];
  towerX.forEach(tx => {
    [-1, 1].forEach(s => {
      const zc = s * (W / 2 + 0.06);
      addCylinderBetween(g, 'tower', [tx, 0, zc], [tx, ytop, zc * 0.32], 0.1, 0x7c8c98, 14);
    });
    addCylinderBetween(g, 'tower_beam', [tx, ytop - 0.25, (W / 2 + 0.06) * 0.32], [tx, ytop - 0.25, -(W / 2 + 0.06) * 0.32], 0.07, 0x6f8998, 10);
    addBox(g, 'pier', tx, yd / 2 - 0.05, 0, 0.6, yd - 0.1, W * 0.9, 0x8a9aa6);
  });
  const nCables = 6;
  towerX.forEach(tx => {
    [-1, 1].forEach(dir => {
      [-1, 1].forEach(s => {
        const z = s * (W / 2 - 0.05);
        for (let i = 1; i <= nCables; i++) {
          const d = (L / 4 * 0.86) * i / nCables;
          const deckX = tx + dir * d;
          const topY = kind === 'harp' ? yd + 0.7 + (ytop - yd - 0.85) * i / nCables : ytop - 0.18;
          addCylinderBetween(g, 'stay_cable', [tx, topY, z * 0.32], [deckX, yd + 0.14, z], 0.022, COL.amber, 6);
          addBox(g, 'anchor', deckX, yd + 0.12, z, 0.18, 0.12, 0.12, 0x9fb0ba);
        }
      });
    });
  });
  return g;
}

Object.assign(MODELS, {
  beamBridge: {
    name: '梁桥（简支/连续）',
    note: '桥墩+主梁+桥面板，入门级：识别墩、梁、桥面的位置关系。',
    centerAxes: [{ from: [0, 0, 0], to: [0, 1.9, 0] }],
    build() {
      const g = new THREE.Group();
      const L = 6.6, W = 1.5, yd = 1.1;
      addBox(g, 'girder', 0, yd, 0, L, 0.34, W, COL.steel);
      addBox(g, 'deck', 0, yd + 0.22, 0, L, 0.1, W * 0.96, 0x9fb4c2);
      [-W / 2 + 0.1, W / 2 - 0.1].forEach(z => addBox(g, 'edge_girder', 0, yd + 0.02, z, L, 0.18, 0.12, 0x70889a));
      [-2.1, 0, 2.1].forEach(x => {
        addBox(g, 'pier', x, yd / 2 - 0.05, 0, 0.5, yd - 0.1, W * 0.8, 0x8a9aa6);
        addBox(g, 'pier_cap', x, yd - 0.05, 0, 0.82, 0.16, W * 0.96, 0x7c8c98);
      });
      return g;
    }
  },
  archBridge: {
    name: '拱桥（提篮/系杆拱）',
    note: '拱肋+吊杆+系梁+桥面：识别拱肋、吊杆、主梁的空间位置（构件空间识别）。',
    centerAxes: [{ from: [0, 0, 0], to: [0, 2.9, 0] }],
    build() {
      const g = new THREE.Group();
      const L = 6.6, W = 1.5, yd = 1.0, rise = 1.7, a = L / 2 - 0.2;
      addBox(g, 'tie_girder', 0, yd, 0, L, 0.26, W, COL.steel);
      addBox(g, 'deck', 0, yd + 0.18, 0, L, 0.08, W * 0.94, 0x9fb4c2);
      const archY = x => yd + 0.12 + rise * (1 - (x / a) * (x / a));
      const lean = y => 1 - (y - yd) / rise * 0.5;
      const N = 16;
      [-1, 1].forEach(side => {
        const zB = side * (W / 2 - 0.04);
        for (let i = 0; i < N; i++) {
          const x0 = -a + 2 * a * i / N, x1 = -a + 2 * a * (i + 1) / N;
          const y0 = archY(x0), y1 = archY(x1);
          addCylinderBetween(g, 'arch_rib', [x0, y0, zB * lean(y0)], [x1, y1, zB * lean(y1)], 0.07, COL.blue, 10);
        }
      });
      [-0.85, 0.85].forEach(x => {
        const y = archY(x), zt = (W / 2 - 0.04) * lean(y);
        addCylinderBetween(g, 'arch_brace', [x, y, zt], [x, y, -zt], 0.05, 0x6f8998, 8);
      });
      const H = 7;
      [-1, 1].forEach(side => {
        const zB = side * (W / 2 - 0.04);
        for (let i = 1; i <= H; i++) {
          const x = -a * 0.82 + 2 * a * 0.82 * i / (H + 1);
          const y = archY(x);
          addCylinderBetween(g, 'hanger', [x, y, zB * lean(y)], [x, yd + 0.14, zB], 0.025, COL.cyan, 6);
        }
      });
      [-a + 0.1, a - 0.1].forEach(x => addBox(g, 'pier', x, yd / 2 - 0.05, 0, 0.5, yd - 0.1, W * 0.8, 0x8a9aa6));
      return g;
    }
  },
  cableStayedFan: {
    name: '斜拉桥（扇形）',
    note: '塔+拉索+主梁，扇形索面：判断荷载经主梁→拉索→塔的传递（传力路径）。',
    centerAxes: [{ from: [0, 0, 0], to: [0, 3.4, 0] }],
    build() { return buildCableStayed('fan'); }
  },
  cableStayedHarp: {
    name: '斜拉桥（竖琴）',
    note: '塔+平行拉索+主梁，竖琴式索面：对比扇形与竖琴的索-塔几何关系。',
    centerAxes: [{ from: [0, 0, 0], to: [0, 3.4, 0] }],
    build() { return buildCableStayed('harp'); }
  },
  suspension: {
    name: '悬索桥（主缆/吊杆）',
    note: '主缆抛物线+吊杆+桥塔+加劲梁：结构体系心理旋转与传力路径训练。',
    centerAxes: [{ from: [0, 0, 0], to: [0, 3.3, 0] }],
    build() {
      const g = new THREE.Group();
      const L = 7.0, W = 1.4, yd = 1.0, ytop = yd + 2.2, sag = 1.5;
      const tx = L * 0.28;
      addBox(g, 'girder', 0, yd, 0, L, 0.2, W, COL.steel);
      addBox(g, 'deck', 0, yd + 0.15, 0, L, 0.07, W * 0.94, 0x9fb4c2);
      [-tx, tx].forEach(x => {
        [-1, 1].forEach(s => { const zc = s * (W / 2 + 0.03); addCylinderBetween(g, 'tower', [x, 0, zc], [x, ytop, zc], 0.1, 0x7c8c98, 14); });
        addCylinderBetween(g, 'tower_beam', [x, ytop - 0.18, W / 2 + 0.03], [x, ytop - 0.18, -(W / 2 + 0.03)], 0.07, 0x6f8998, 10);
        addBox(g, 'pier', x, yd / 2 - 0.05, 0, 0.6, yd - 0.1, W * 0.95, 0x8a9aa6);
      });
      const cableY = u => ytop - sag * (1 - u * u);
      [-1, 1].forEach(s => {
        const z = s * (W / 2 + 0.03);
        const N = 18; let prev = null;
        for (let i = 0; i <= N; i++) {
          const x = -tx + 2 * tx * i / N, u = x / tx, p = [x, cableY(u), z];
          if (prev) addCylinderBetween(g, 'main_cable', prev, p, 0.035, COL.amber, 6);
          prev = p;
        }
        addCylinderBetween(g, 'main_cable', [-tx, ytop, z], [-L / 2, yd + 0.1, z], 0.035, COL.amber, 6);
        addCylinderBetween(g, 'main_cable', [tx, ytop, z], [L / 2, yd + 0.1, z], 0.035, COL.amber, 6);
      });
      const H = 9;
      [-1, 1].forEach(s => {
        const z = s * (W / 2 + 0.03);
        for (let i = 1; i <= H; i++) {
          const x = -tx + 2 * tx * i / (H + 1), u = x / tx;
          addCylinderBetween(g, 'hanger', [x, cableY(u), z], [x, yd + 0.13, z], 0.02, COL.cyan, 6);
        }
      });
      return g;
    }
  },
  jointDetail: {
    name: '节点构造（吊杆-横梁-主梁）',
    note: '局部节点：主梁、横梁、吊杆与节点板的空间连接（节点构造空间重构）。',
    centerAxes: [{ from: [0, 0.1, 0], to: [0, 2.9, 0] }, { from: [-2.1, 0.6, 0], to: [2.1, 0.6, 0] }],
    build() {
      const g = new THREE.Group();
      addBox(g, 'main_girder', 0, 0.6, 0, 4.0, 0.5, 0.5, COL.steel);
      addBox(g, 'cross_beam', 0, 0.6, 0, 0.5, 0.45, 2.6, 0x6f8998);
      addBox(g, 'gusset', 0, 1.04, 0, 0.7, 0.52, 0.08, 0x95aab8);
      addCylinder(g, 'hanger', 0, 1.95, 0, 0.07, 1.7, COL.cyan, 18);
      addTriPrism(g, 'stiffener', 0x8eaabc, [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3]], 0.1, 0, 0.98, 0.45);
      addTriPrism(g, 'stiffener', 0x8eaabc, [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3]], 0.1, 0, 0.98, -0.45);
      return g;
    }
  }
});

Object.assign(MODELS, BRIDGE_MODELS, DETAILED_BRIDGE_MODELS, TEXTBOOK_MECHANICAL_MODELS);

// ===== 投影核心 =====
const projPlanes = { front: null, top: null, side: null };
const projTextures = { front: null, top: null, side: null };
const projCanvases = { front: null, top: null, side: null };
// ===== 三视图：正交相机渲染到贴图（稳定正确，支持任意复杂度） =====
const PROJ_RES = 1024;           // 每个视图渲染分辨率
const PROJ_BG = 0xf8fafc;        // 浅色工程图底色
const EDGE_THRESHOLD = 24;       // 特征边阈值（度）：低于此夹角的面间边不画
const projTargets = { front: null, top: null, side: null };
const projCams = { front: null, top: null, side: null };
let projScene = null;            // 离屏线框场景（只含当前模型的线/遮挡体/中心线）
let projResourcesReady = false;

// 第一角投影：左视图从 -X 侧观察，直接获得正确深度遮挡，不以后期镜像代替。
const VIEW = {
  front: { eye: new THREE.Vector3(0, 0, 1),  up: new THREE.Vector3(0, 1, 0),  flipX: false, flipY: false },
  top:   { eye: new THREE.Vector3(0, 1, 0),  up: new THREE.Vector3(0, 0, -1), flipX: false, flipY: false },
  side:  { eye: new THREE.Vector3(-1, 0, 0), up: new THREE.Vector3(0, 1, 0),  flipX: false, flipY: false }
};

function ensureProjResources() {
  if (projResourcesReady) return;
  projScene = new THREE.Scene();
  ['front', 'top', 'side'].forEach(v => {
    const rt = new THREE.WebGLRenderTarget(PROJ_RES, PROJ_RES, { samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    projTargets[v] = rt;
    projCams[v] = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 400);
  });
  projResourcesReady = true;
}

function getPlaneLayout(t = state.unfoldProgress) {
  const S = state.planeSize;
  const gap = state.planeGap;
  const backZ = -S / 2;
  const frontCenter = new THREE.Vector3(0, S / 2 - gap, backZ);

  // H 面：绕 V/H 下铰链翻下
  const topHingeY = -gap;
  const topPos = new THREE.Vector3(0, topHingeY - Math.sin(t * Math.PI / 2) * (S / 2), backZ + Math.cos(t * Math.PI / 2) * (S / 2));
  const topRot = new THREE.Euler(-Math.PI / 2 + t * (Math.PI / 2), 0, 0);

  // W 面：绕 V/W 右铰链外翻
  const sideHingeX = S / 2;
  const sideAngle = t * Math.PI / 2;
  const sidePos = new THREE.Vector3(sideHingeX + Math.sin(sideAngle) * (S / 2), S / 2 - gap, backZ + Math.cos(sideAngle) * (S / 2));
  const sideRot = new THREE.Euler(0, -Math.PI / 2 + sideAngle, 0);

  return {
    S, gap, backZ,
    front: { pos: frontCenter, rot: new THREE.Euler(0, 0, 0) },
    top: { pos: topPos, rot: topRot },
    side: { pos: sidePos, rot: sideRot }
  };
}

function createCanvasTexture(view) {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 768;
  projCanvases[view] = canvas;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  projTextures[view] = texture;
  return texture;
}

function createProjectionPlanes() {
  clearGroup(projectionGroup);
  clearGroup(projLinesGroup);

  const S = state.planeSize;
  const layout = getPlaneLayout();

  const makePlane = (name, viewKey, mat) => {
    const g = new THREE.PlaneGeometry(S, S);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(layout[viewKey].pos);
    m.rotation.copy(layout[viewKey].rot);
    m.name = name;
    m.renderOrder = 1;
    projectionGroup.add(m);

    const border = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.6 }));
    m.add(border);
    return m;
  };

  projPlanes.front = makePlane('proj_front', 'front', makeProjectionMaterial('front'));
  projPlanes.top = makePlane('proj_top', 'top', makeProjectionMaterial('top'));
  projPlanes.side = makePlane('proj_side', 'side', makeProjectionMaterial('side'));

  drawProjections();
  updateUnfold(state.unfoldProgress);
}

function makeProjectionMaterial(view) {
  ensureProjResources();
  const tex = projTargets[view].texture;
  const cfg = VIEW[view];
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(cfg.flipX ? -1 : 1, cfg.flipY ? -1 : 1);
  tex.offset.set(cfg.flipX ? 1 : 0, cfg.flipY ? 1 : 0);
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthWrite: false
  });
}

// 反向外壳剪影材质：为光滑曲面（圆柱/桥索/塔）补外轮廓线，任意几何通用
function makeSilhouetteMaterial(thickness) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0x24394d) }, uT: { value: thickness } },
    vertexShader: `
      uniform float uT;
      void main(){
        vec3 p = position + normalize(normal) * uT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      void main(){ gl_FragColor = vec4(uColor, 1.0); }`
  });
}

const _projDisposables = [];
function clearProjScene() {
  if (!projScene) return;
  while (projScene.children.length) projScene.remove(projScene.children[0]);
  _projDisposables.forEach(d => { try { d.dispose && d.dispose(); } catch (e) {} });
  _projDisposables.length = 0;
}

// 构建离屏线框场景：剪影 + 遮挡体 + 可见实线 + 隐藏虚线 + 中心线
// 三视图取景边界：局部聚焦时用 focusBox，否则整体
function getProjBounds() {
  return focusBox ? focusBox.clone() : getModelBounds();
}

function buildProjScene() {
  ensureProjResources();
  clearProjScene();
  const projectionRoot = selectedComponent || modelGroup;
  projectionRoot.updateMatrixWorld(true);

  const box = getProjBounds();
  const size = new THREE.Vector3(); box.getSize(size);
  const ext = Math.max(size.x, size.y, size.z) || 1;
  const dash = ext * 0.02;
  const compoundProjectionStyle = state.mode === 'compound' ? compoundController?.getProjectionStyle?.() : null;
  const boldEdges = Boolean(compoundProjectionStyle?.boldEdges || TEXTBOOK_MECHANICAL_MODELS[state.currentModel]);

  // 收集每个 mesh 的世界空间几何
  const worldGeos = [];
  const projectionGuides = [];
  projectionRoot.traverse(child => {
    if (child.userData?.projectionGuide && isVisibleInHierarchy(child) && child.geometry) {
      const guide = child.geometry.clone();
      guide.applyMatrix4(child.matrixWorld);
      projectionGuides.push({
        geometry: guide,
        views: Array.isArray(child.userData.projectionViews) ? [...child.userData.projectionViews] : [],
        style: child.userData.projectionLineStyle || 'auto'
      });
      return;
    }
    if (!isProjectionMesh(child)) return;
    const g = child.geometry.clone();
    g.applyMatrix4(child.matrixWorld);
    worldGeos.push(g);
  });
  if (!worldGeos.length) return;

  // 遮挡体（底色实绘：盖住剪影内部、只留外轮廓白边；并写深度供消隐）
  // polygonOffset 推后，让边线压在前不闪烁
  const occMat = new THREE.MeshBasicMaterial({ color: PROJ_BG, side: THREE.DoubleSide });
  occMat.polygonOffset = true; occMat.polygonOffsetFactor = 1; occMat.polygonOffsetUnits = 1;
  _projDisposables.push(occMat);
  // 剪影（外轮廓）
  const silMat = makeSilhouetteMaterial(ext * (boldEdges ? 0.0055 : 0.0038));
  _projDisposables.push(silMat);
  // 可见实线
  const visMat = new LineMaterial({
    color: 0x20364a,
    linewidth: boldEdges ? 4.2 : 2.4,
    depthTest: true,
    depthWrite: false,
    alphaToCoverage: true
  });
  visMat.resolution.set(PROJ_RES, PROJ_RES);
  _projDisposables.push(visMat);
  // 隐藏虚线（仅在被遮挡处绘制）
  const hidMat = new LineMaterial({
    color: 0x718293,
    linewidth: boldEdges ? 3 : 2,
    dashed: true,
    dashSize: dash * 1.55,
    gapSize: dash * 1.05,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
    depthWrite: false,
    alphaToCoverage: true
  });
  hidMat.resolution.set(PROJ_RES, PROJ_RES);
  hidMat.depthFunc = THREE.GreaterDepth;
  _projDisposables.push(hidMat);
  const analyticVisMat = new LineMaterial({
    color: 0x20364a,
    linewidth: boldEdges ? 4.2 : 2.4,
    depthTest: false,
    depthWrite: false,
    alphaToCoverage: true
  });
  analyticVisMat.resolution.set(PROJ_RES, PROJ_RES);
  _projDisposables.push(analyticVisMat);
  const analyticHiddenMat = new LineMaterial({
    color: 0x718293,
    linewidth: boldEdges ? 3 : 2,
    dashed: true,
    dashSize: dash * 1.55,
    gapSize: dash * 1.05,
    // Keep exact hidden and visible lines in the same render queue: a rear
    // edge coincident with a front outline must not paint dashes over it.
    transparent: false,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    alphaToCoverage: true
  });
  analyticHiddenMat.resolution.set(PROJ_RES, PROJ_RES);
  _projDisposables.push(analyticHiddenMat);
  // 教材中需要特别辨认的隐藏轮廓（例5-5的B3贯穿槽）使用更深、更宽的虚线，
  // 避免1024px离屏图缩放到卡片尺寸后只剩下不到一个像素。
  const analyticEmphasisHiddenMat = new LineMaterial({
    color: 0x52687c,
    linewidth: boldEdges ? 7.2 : 4.4,
    dashed: true,
    dashSize: dash * 1.8,
    gapSize: dash * 0.95,
    transparent: false,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    alphaToCoverage: true
  });
  analyticEmphasisHiddenMat.resolution.set(PROJ_RES, PROJ_RES);
  _projDisposables.push(analyticEmphasisHiddenMat);

  const makeProjectedSegments = (sourceGeometry, lineMaterial, renderOrder, dashed = false, metadata = {}) => {
    const lineGeometry = new LineSegmentsGeometry();
    lineGeometry.setPositions(sourceGeometry.attributes.position.array);
    _projDisposables.push(lineGeometry);
    const lines = new LineSegments2(lineGeometry, lineMaterial);
    lines.renderOrder = renderOrder;
    lines.frustumCulled = false;
    lines.userData.projectionViews = metadata.views || [];
    if (dashed) lines.computeLineDistances();
    projScene.add(lines);
    return lines;
  };

  worldGeos.forEach(g => {
    _projDisposables.push(g);
    if (g.userData?.projectionAnalyticOnly) return;
    const sil = new THREE.Mesh(g, silMat); sil.renderOrder = 0; projScene.add(sil);
    const occ = new THREE.Mesh(g, occMat); occ.renderOrder = 1; projScene.add(occ);
    if (g.userData?.projectionSilhouetteOnly) return;
    const eg = new THREE.EdgesGeometry(g, g.userData?.projectionEdgeThreshold || EDGE_THRESHOLD);
    _projDisposables.push(eg);
    if (state.showHidden) {
      makeProjectedSegments(eg, hidMat, 2, true);
    }
    makeProjectedSegments(eg, visMat, 3);
  });

  projectionGuides.forEach(guide => {
    const { geometry: g, views, style } = guide;
    _projDisposables.push(g);
    if (style === 'hidden') {
      if (state.showHidden) makeProjectedSegments(g, analyticHiddenMat, 5, true, { views });
      return;
    }
    if (style === 'hidden-emphasis') {
      if (state.showHidden) makeProjectedSegments(g, analyticEmphasisHiddenMat, 7, true, { views });
      return;
    }
    if (style === 'visible') {
      makeProjectedSegments(g, analyticVisMat, 6, false, { views });
      return;
    }
    if (state.showHidden) makeProjectedSegments(g, hidMat, 2, true, { views });
    makeProjectedSegments(g, visMat, 3, false, { views });
  });

  // 中心线（链式点划线，置顶不消隐）
  const centerSegs = !state.showCenterLines || compoundProjectionStyle?.suppressCenterLines ? [] : computeCenterLines(box);
  if (centerSegs.length) {
    const cMat = new LineMaterial({
      color: 0xa86200,
      linewidth: boldEdges ? 2.6 : 1.8,
      dashed: true,
      dashSize: ext * 0.05,
      gapSize: ext * 0.022,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
      depthWrite: false,
      alphaToCoverage: true
    });
    cMat.resolution.set(PROJ_RES, PROJ_RES);
    _projDisposables.push(cMat);
    const positions = [];
    centerSegs.forEach(([a, b]) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z));
    const cGeo = new LineSegmentsGeometry();
    cGeo.setPositions(positions);
    _projDisposables.push(cGeo);
    const cLines = new LineSegments2(cGeo, cMat); cLines.renderOrder = 4;
    cLines.frustumCulled = false;
    cLines.computeLineDistances();
    projScene.add(cLines);
  }
}

// 只使用明确的特征轴。未定义轴的桥梁/导入模型不猜测世界原点处的对称线。
function computeCenterLines(box) {
  const segs = [];
  const size = new THREE.Vector3(); box.getSize(size);
  const pad = Math.max(size.x, size.y, size.z) * 0.08;

  const def = MODELS[state.currentModel];
  const axes = selectedComponent ? selectedComponent.userData?.centerAxes : def?.centerAxes;
  if (axes && axes.length) {
    axes.forEach(ax => {
      const a = new THREE.Vector3(ax.from[0], ax.from[1], ax.from[2]);
      const b = new THREE.Vector3(ax.to[0], ax.to[1], ax.to[2]);
      if (selectedComponent) {
        selectedComponent.updateWorldMatrix(true, false);
        a.applyMatrix4(selectedComponent.matrixWorld);
        b.applyMatrix4(selectedComponent.matrixWorld);
      } else if (state.geometryVariationFactors) {
        const factors = new THREE.Vector3(...state.geometryVariationFactors);
        a.multiply(factors);
        b.multiply(factors);
      }
      const d = new THREE.Vector3().subVectors(b, a).normalize().multiplyScalar(pad);
      segs.push([a.clone().sub(d), b.clone().add(d)]);
    });
    return segs;
  }
  return segs;
}

function getTiledProjectionLayout(bounds) {
  const cardSizes = Object.fromEntries(['front', 'top', 'side'].map(view => {
    const image = document.querySelector(`[data-tiled-image="${view}"]`);
    const rect = image?.getBoundingClientRect();
    return [view, { width: rect?.width || 0, height: rect?.height || 0 }];
  }));
  return computeTiledProjectionLayout({ min: bounds.min.toArray(), max: bounds.max.toArray() }, cardSizes, {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    maxTargetSize: Math.min(renderer.capabilities.maxTextureSize, 2048)
  });
}

// 三正交相机渲染到 RenderTarget
// 整体模式：与投影面 1:1（世界坐标 ↔ 平面），三视图与三维模型、彼此严格对齐
// 局部模式：聚焦放大到 focusBox（细部用，不要求与整体同比例）
function renderProjViews() {
  ensureProjResources();
  const S = state.planeSize;
  const half = S / 2;
  const fcY = S / 2 - state.planeGap;            // 与 getPlaneLayout 的 V/W 面竖直中心一致

  const fullBox = getModelBounds();
  const fullSize = new THREE.Vector3(); fullBox.getSize(fullSize);
  const fc = new THREE.Vector3(); fullBox.getCenter(fc);
  const fitProjectionToModel = state.mode === 'compound' || state.isTiled;
  const fittedHalf = fitProjectionToModel
    ? (Math.max(fullSize.x, fullSize.y, fullSize.z) || 1) * 0.62
    : half;
  const dist = Math.max(fullSize.x, fullSize.y, fullSize.z, S) * 2 + 4;  // 仅影响裁剪

  const tiledLayout = state.isTiled ? getTiledProjectionLayout(focusBox || fullBox) : null;

  // 平铺卡片采用矩形取景，但三图共用中心与世界/屏幕比例。
  let frames;
  if (tiledLayout) {
    frames = Object.fromEntries(['front', 'top', 'side'].map(view => [view, {
      ...tiledLayout.frames[view],
      look: new THREE.Vector3(...tiledLayout.center)
    }]));
  } else if (focusBox && (state.isTiled || state.mode === 'compound')) {
    const c = new THREE.Vector3(); focusBox.getCenter(c);
    const sz = new THREE.Vector3(); focusBox.getSize(sz);
    const h = (Math.max(sz.x, sz.y, sz.z) || 1) * 0.62;
    frames = {
      front: { half: h, look: new THREE.Vector3(c.x, c.y, fc.z) },
      top:   { half: h, look: new THREE.Vector3(c.x, fc.y, c.z) },
      side:  { half: h, look: new THREE.Vector3(fc.x, c.y, c.z) }
    };
  } else {
    frames = {
      front: { half: fittedHalf, look: fitProjectionToModel ? fc.clone() : new THREE.Vector3(0, fcY, fc.z) },
      top:   { half: fittedHalf, look: fitProjectionToModel ? fc.clone() : new THREE.Vector3(0, fc.y, 0) },
      side:  { half: fittedHalf, look: fitProjectionToModel ? fc.clone() : new THREE.Vector3(fc.x, fcY, 0) }
    };
  }

  const prevTarget = renderer.getRenderTarget();
  const prevClear = new THREE.Color(); renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(PROJ_BG, 1);

  ['front', 'top', 'side'].forEach(view => {
    const cfg = VIEW[view];
    const cam = projCams[view];
    const f = frames[view];
    const target = projTargets[view];
    const targetWidth = f.renderWidth || PROJ_RES;
    const targetHeight = f.renderHeight || PROJ_RES;
    if (target.width !== targetWidth || target.height !== targetHeight) target.setSize(targetWidth, targetHeight);
    projScene.traverse(object => {
      const projectionViews = object.userData?.projectionViews;
      if (Array.isArray(projectionViews) && projectionViews.length) {
        object.visible = projectionViews.includes(view);
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (material?.isLineMaterial) material.resolution.set(targetWidth, targetHeight);
      });
    });
    const halfWidth = f.halfWidth ?? f.half;
    const halfHeight = f.halfHeight ?? f.half;
    cam.left = -halfWidth; cam.right = halfWidth; cam.top = halfHeight; cam.bottom = -halfHeight;
    cam.near = 0.01; cam.far = dist * 2;
    cam.up.copy(cfg.up);
    cam.position.copy(f.look).addScaledVector(cfg.eye, dist);
    cam.lookAt(f.look);
    cam.updateProjectionMatrix();

    renderer.setRenderTarget(target);
    renderer.render(projScene, cam);
  });

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
}

function drawProjections() {
  buildProjScene();
  renderProjViews();
  if (state.isTiled) updateTiledProjectionCards();
  if (state.mode === 'compound') compoundController?.syncProjectionImages();
}

// ===== 语义构件选择：高亮真实构件，并单独生成其三视图 =====
function updateFocusMarker() {
  clearGroup(focusGroup);
  if (!focusBox) return;
  const helper = new THREE.Box3Helper(focusBox, new THREE.Color(0xf0b454));
  if (helper.material) { helper.material.transparent = true; helper.material.opacity = 0.9; helper.material.depthTest = false; }
  helper.renderOrder = 5;
  focusGroup.add(helper);
}

function cloneHighlightMaterial(material) {
  const cloneOne = source => {
    const clone = source.clone();
    if (clone.emissive) {
      clone.emissive.setHex(COL.amber);
      clone.emissiveIntensity = 0.72;
    } else if (clone.color) {
      clone.color.setHex(COL.amber);
    }
    clone.needsUpdate = true;
    return clone;
  };
  return Array.isArray(material) ? material.map(cloneOne) : cloneOne(material);
}

function disposeMaterial(material) {
  if (Array.isArray(material)) material.forEach(item => item.dispose());
  else material?.dispose();
}

function restoreComponentHighlight() {
  if (!selectedComponent || !selectedComponentOriginalMaterial) return;
  const highlightedMaterial = selectedComponent.material;
  selectedComponent.material = selectedComponentOriginalMaterial;
  const restoredMaterials = Array.isArray(selectedComponent.material) ? selectedComponent.material : [selectedComponent.material];
  restoredMaterials.forEach(material => {
    material.transparent = state.transparentModel;
    material.opacity = state.transparentModel ? 0.54 : 1;
    material.depthWrite = !state.transparentModel;
  });
  selectedComponentOriginalMaterial = null;
  disposeMaterial(highlightedMaterial);
}

function updateComponentInfo(info) {
  const card = document.getElementById('component-info');
  if (!card) return;
  card.hidden = !info;
  if (!info) return;
  const name = document.getElementById('component-info-name');
  const role = document.getElementById('component-info-role');
  if (name) name.textContent = info.label;
  if (role) role.textContent = info.role;
}

function setFocusComponent(object) {
  restoreComponentHighlight();
  selectedComponent = object;
  selectedComponentOriginalMaterial = object.material;
  object.material = cloneHighlightMaterial(object.material);

  focusBox = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3(); focusBox.getSize(size);
  const pad = Math.max(Math.max(size.x, size.y, size.z) * 0.08, 0.04);
  focusBox.expandByScalar(pad);
  updateFocusMarker();
  drawProjections();

  const semantic = getComponentInfo(object.name);
  const info = { ...semantic, label: object.userData.label || object.userData.componentLabel || semantic.label };
  updateComponentInfo(info);
  setStatus(`已选择${info.label}：${info.role} 三个投影面已切换为该构件的对应视图。`);
  handleBridgeTaskComponentSelection(object);
}

function clearFocus(announce) {
  if (!focusBox && !selectedComponent && !announce) return;
  restoreComponentHighlight();
  selectedComponent = null;
  focusBox = null;
  updateFocusMarker();
  updateComponentInfo(null);
  if (modelGroup.children.length) drawProjections();
  if (announce) setStatus('已恢复整体三视图。提示：点击模型构件，可高亮并查看该构件的三个对应视图。');
}

function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function findNearbyThinComponent(clientX, clientY, rect) {
  const thinNames = new Set(['stay_cable', 'main_cable', 'hanger']);
  let nearest = null;
  let nearestDistance = bridgeTaskState.active && bridgeTaskState.stage === 'pick' ? 12 : 8;
  modelGroup.updateMatrixWorld(true);

  modelGroup.traverse(object => {
    if (!object.isMesh || !thinNames.has(object.name)) return;
    const height = object.geometry?.parameters?.height;
    if (!Number.isFinite(height)) return;
    const a = new THREE.Vector3(0, -height / 2, 0).applyMatrix4(object.matrixWorld).project(camera);
    const b = new THREE.Vector3(0, height / 2, 0).applyMatrix4(object.matrixWorld).project(camera);
    const ax = rect.left + (a.x + 1) * rect.width / 2;
    const ay = rect.top + (1 - a.y) * rect.height / 2;
    const bx = rect.left + (b.x + 1) * rect.width / 2;
    const by = rect.top + (1 - b.y) * rect.height / 2;
    const distance = pointToSegmentDistance(clientX, clientY, ax, ay, bx, by);
    if (distance <= nearestDistance) {
      nearest = object;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function bindFocusPicking() {
  const dom = renderer.domElement;
  let down = null;
  dom.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  dom.addEventListener('pointerup', e => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const dt = performance.now() - down.t;
    down = null;
    if (moved > 6 || dt > 450) return;      // 拖拽/长按 → 视为轨道操作，不聚焦
    if (state.mode === 'lab' || state.mode === 'compound') return;
    const rect = dom.getBoundingClientRect();
    if (state.mode === 'quiz' && handlePracticePointerHit(e, rect)) return;
    if (state.mode === 'quiz') return;
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const nearbyThinComponent = findNearbyThinComponent(e.clientX, e.clientY, rect);
    const hits = raycaster.intersectObjects(modelGroup.children, true);
    if (nearbyThinComponent) setFocusComponent(nearbyThinComponent);
    else if (hits.length) setFocusComponent(hits[0].object);
    else clearFocus(true);
  });
}

function isVisibleInHierarchy(object) {
  let current = object;
  while (current) {
    if (current.visible === false) return false;
    current = current.parent;
  }
  return true;
}

function isProjectionMesh(object) {
  return Boolean(
    object?.isMesh
    && object.geometry
    && isVisibleInHierarchy(object)
    && !object.userData?.excludeFromProjection
  );
}

function getModelBounds() {
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  modelGroup.updateMatrixWorld(true);
  modelGroup.traverse(child => {
    if (!isProjectionMesh(child)) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) return;
    meshBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
    box.union(meshBox);
  });
  if (!Number.isFinite(box.min.x)) box.set(new THREE.Vector3(-2, 0, -1.5), new THREE.Vector3(2, 2, 1.5));
  return box;
}

function updateUnfold(t) {
  viewport.dataset.projectionState = t <= 0.001 ? 'wrapped' : t >= 0.999 ? 'unfolded' : 'turning';
  projLinesGroup.visible = state.showProjLines && !state.isTiled && state.mode === 'explore';
  const layout = getPlaneLayout(t);
  projPlanes.front?.position.copy(layout.front.pos);
  projPlanes.front?.rotation.copy(layout.front.rot);
  projPlanes.top?.position.copy(layout.top.pos);
  projPlanes.top?.rotation.copy(layout.top.rot);
  projPlanes.side?.position.copy(layout.side.pos);
  projPlanes.side?.rotation.copy(layout.side.rot);

  if (state.showProjLines && t < 0.92) drawProjectionLines(t, layout);
  else clearGroup(projLinesGroup);
}

function drawProjectionLines(t, layout) {
  clearGroup(projLinesGroup);
  const edges = collectTopEdgesSimple();
  const points = edges.pts.slice(0, 18);
  const lineMat = new THREE.LineDashedMaterial({
    color: COL.amber, transparent: true, opacity: 0.45 * (1 - t * 0.65), dashSize: 0.1, gapSize: 0.08
  });
  const centerY = layout.S / 2 - layout.gap;
  points.forEach(p => {
    const localPoints = {
      front: new THREE.Vector3(p.x, p.y - centerY, 0),
      top: new THREE.Vector3(p.x, -p.z, 0),
      side: new THREE.Vector3(p.z, p.y - centerY, 0)
    };
    for (const view of ['front', 'top', 'side']) {
      const endpoint = localPoints[view].applyEuler(layout[view].rot).add(layout[view].pos);
      addDashedLine(p, endpoint, lineMat);
    }
  });
  lineMat.dispose();
}

function addDashedLine(from, to, mat) {
  const g = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(g, mat.clone());
  line.computeLineDistances();
  projLinesGroup.add(line);
}

function collectTopEdgesSimple() {
  modelGroup.updateMatrixWorld(true);
  const pts = [];
  const seen = new Set();
  modelGroup.traverse(child => {
    if (!child.isMesh) return;
    const g = child.geometry;
    const pos = g.attributes.position;
    for (let i = 0; i < Math.min(pos.count, 80); i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      const k = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
      if (!seen.has(k)) { seen.add(k); pts.push(p); }
    }
  });
  return { pts };
}

function buildFloorReference() {
  clearGroup(floorGroup);
  const grid = new THREE.GridHelper(9.5, 19, 0xaab8c4, 0xd5dde5);
  grid.position.y = -state.planeGap;
  grid.material.transparent = true; grid.material.opacity = 0.72;
  floorGroup.add(grid);

  const borderMat = new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.6 });
  const S = state.planeSize; const z = -S / 2;

  const hingeV = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-S / 2, -state.planeGap, z),
    new THREE.Vector3(S / 2, -state.planeGap, z)
  ]);
  floorGroup.add(new THREE.Line(hingeV, borderMat));

  const hingeW = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(S / 2, -state.planeGap, z),
    new THREE.Vector3(S / 2, S - state.planeGap, z)
  ]);
  floorGroup.add(new THREE.Line(hingeW, borderMat.clone()));
}

function buildAxes() {
  clearGroup(axesGroup);
  const isBridge = Boolean(BRIDGE_MODELS[state.currentModel] || DETAILED_BRIDGE_MODELS[state.currentModel]);
  const axes = isBridge ? [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xd55050, label: 'X' },
    { dir: new THREE.Vector3(0, 0, -1), color: 0x398958, label: 'Y' },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x4275c6, label: 'Z' }
  ] : [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xff5f5f, label: 'X' },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x76e090, label: 'Y' },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x5d9cff, label: 'Z' }
  ];
  const bounds = getModelBounds();
  const size = bounds.getSize(new THREE.Vector3());
  const length = THREE.MathUtils.clamp(Math.max(size.x, size.y, size.z) * 0.22, 0.8, 1.5);
  const origin = new THREE.Vector3(bounds.min.x - length * 0.65, -state.planeGap, bounds.max.z + length * 0.65);
  axes.forEach(a => {
    const arrow = new THREE.ArrowHelper(a.dir, origin, length, a.color, length * 0.13, length * 0.065);
    axesGroup.add(arrow);
    addAxisLabel(a.label, a.color, origin.clone().addScaledVector(a.dir, length * 1.16));
  });
  const axisButton = document.getElementById('tog-axes');
  if (axisButton) axisButton.title = isBridge
    ? '桥梁工程坐标：X 纵桥向、Y 横桥向、Z 竖直向上；按需显示'
    : '模型坐标：X 长度、Y 高度、Z 深度；按需显示';
  axesGroup.visible = state.showAxes;
}

function addAxisLabel(text, color, position) {
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 54px Arial';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 48, 52);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.userData.ownedTexture = texture;
  sprite.position.copy(position);
  sprite.scale.set(0.35, 0.35, 0.35);
  axesGroup.add(sprite);
}

// ===== 导入（OBJ/STL通用）=====
function extractGeometryFromParsed(parsed) {
  // OBJ返回Group，STL返回BufferGeometry
  if (parsed.isBufferGeometry) return parsed.clone();
  const geos = [];
  parsed.updateMatrixWorld(true);
  parsed.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const g = child.geometry.clone();
    g.applyMatrix4(child.matrixWorld);
    const pure = new THREE.BufferGeometry();
    pure.setAttribute('position', g.attributes.position.clone());
    if (g.index) pure.setIndex(g.index.clone());
    geos.push(pure.toNonIndexed());
    g.dispose();
  });
  if (!geos.length) return null;
  let total = 0; geos.forEach(g => total += g.attributes.position.count);
  const merged = new Float32Array(total * 3);
  let offset = 0; geos.forEach(g => { merged.set(g.attributes.position.array, offset); offset += g.attributes.position.array.length; g.dispose(); });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(merged, 3));
  out.computeVertexNormals();
  return out;
}

function buildImportedModel() {
  if (!state.importedGeometry) return null;
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(state.importedGeometry.clone(), makeMat(0x80c7e8, { roughness: 0.5, metalness: 0.04 }));
  mesh.castShadow = true; mesh.receiveShadow = true;
  g.add(mesh);
  normalizeModelInPlace(g);
  return g;
}

function normalizeModelInPlace(group) {
  group.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(group);
  if (!Number.isFinite(box.min.x)) throw new Error('模型没有可显示的几何。');
  const size = new THREE.Vector3(); box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim < 1e-6) throw new Error('模型尺寸过小或无效。');
  const target = Math.min(state.planeSize * 0.56, 4.6);
  const s = target / maxDim;
  group.scale.multiplyScalar(s);
  group.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(group);
  const c = new THREE.Vector3(); box.getCenter(c);
  group.position.x -= c.x; group.position.z -= c.z; group.position.y -= box.min.y;
  group.updateMatrixWorld(true);
}

function rebuildModel() {
  restoreComponentHighlight();
  selectedComponent = null;
  selectedComponentOriginalMaterial = null;
  updateComponentInfo(null);
  clearGroup(modelGroup);
  focusBox = null; clearGroup(focusGroup);   // 换模型时复位局部聚焦
  const isImported = state.currentModel === 'imported' && state.importedGeometry;
  const def = isImported ? null : (MODELS[state.currentModel] || MODELS.step);
  let model, statusText;

  if (isImported) {
    model = buildImportedModel();
    statusText = `已导入 ${state.importedName || '模型'}：自动居中缩放，三视图投影（含消隐虚线）已就绪。`;
  } else {
    model = def.build(state.mode === 'explore' && def.editContext ? modelVariations.get(state.currentModel) : undefined);
    statusText = `${def.name}：${def.note}`;
  }

  const variation = state.mode === 'explore' && !def?.editContext ? modelVariations.get(state.currentModel) : undefined;
  state.geometryVariationFactors = geometryVariationVector(variation || {});
  model = applyGeometryVariation(model, variation || {});
  if (variation && Object.values(variation).some(value => value !== 100)) {
    statusText = `${def?.name || state.importedName} · 教学几何变体：纵向 ${variation.lengthPercent ?? 100}% / 横向 ${variation.widthPercent ?? 100}% / 竖向 ${variation.heightPercent ?? 100}%。原图尺寸仅供对照。`;
  }
  if (state.mode === 'explore' && def?.editContext && modelVariations.has(state.currentModel)) {
    const parameters = def.editContext(modelVariations.get(state.currentModel)).parameters;
    statusText = `${def.name} · ${parameters.map(p => `${p.label} ${p.value}${p.unit}`).join(' / ')}。三视图由当前构件重绘。`;
  }
  modelGroup.add(model);
  updateModelSource();
  modelRevision += 1;
  updateModelTransparency();
  modelGroup.updateMatrixWorld(true);
  applyClearance();   // 据模型尺寸 + 统一距离设定投影面，并重建投影面/地面/坐标轴
  setStatus(statusText);
}

// 投影面尺寸 = 模型最大尺寸 + 2×距离 → 三个投影面与模型间距一起随 planeGap 调整
function applyClearance() {
  const b = getModelBounds(); const s = new THREE.Vector3(); b.getSize(s);
  const ext = Math.max(s.x, s.y, s.z) || 1;
  state.planeSize = ext + 2 * state.planeGap;
  buildFloorReference();
  buildAxes();
  createProjectionPlanes();
}

function updateModelTransparency() {
  modelGroup.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(item => {
      const preserveOpacity = child.userData.preserveMaterialOpacity && !state.transparentModel;
      item.transparent = state.transparentModel || preserveOpacity;
      item.opacity = state.transparentModel ? 0.54 : preserveOpacity ? child.userData.baseOpacity : 1;
      item.depthWrite = state.transparentModel ? false : !preserveOpacity;
    });
  });
}

// ===== UI绑定（手机/PC共享状态）=====
let modelButtons = [];

function populateBridgeLibrary() {
  const groups = [[CURATED_BRIDGE_CATALOG, 'bridge-library-list'], [CURATED_DRAWING_CATALOG, 'drawing-bridge-list'],
    [TEXTBOOK_MECHANICAL_CATALOG, 'textbook-mechanical-list']];
  for (const [catalog, targetId] of groups) {
    const host = document.getElementById(targetId);
    let lastChapter;
    for (const item of catalog) {
      if (item.chapter && item.chapter !== lastChapter) {
        const heading = document.createElement('div');
        heading.className = 'library-chapter';
        heading.textContent = `第${item.chapter}章`;
        host.append(heading);
        lastChapter = item.chapter;
      }
      const button = document.createElement('button');
      button.className = 'model-btn';
      button.dataset.model = item.id;
      button.title = item.note;
      const text = document.createElement('span');
      const name = document.createElement('span');
      name.className = 'name'; name.textContent = item.name;
      const description = document.createElement('span');
      description.className = 'desc';
      description.textContent = item.figure ? `${item.figure} · ${item.topics?.join(' / ') || item.note}` : item.focus;
      text.append(name, description); button.append(text); host.append(button);
    }
  }
  document.getElementById('mechanical-model-count').textContent = TEXTBOOK_MECHANICAL_CATALOG.length;
}

function updateModelSource() {
  const card = document.getElementById('model-source-card');
  if (!card) return;
  const mechanical = TEXTBOOK_MECHANICAL_CATALOG.find(item => item.id === state.currentModel);
  const bridge = [...CURATED_BRIDGE_CATALOG, ...CURATED_DRAWING_CATALOG].find(item => item.id === state.currentModel);
  card.hidden = !mechanical && !bridge;
  if (card.hidden) return;
  document.getElementById('model-source-title').textContent = mechanical ? '教材对应' : '制图观察';
  document.getElementById('model-source-reference').textContent = mechanical
    ? `《现代机械制图》第${mechanical.chapter}章 · ${mechanical.figure} · 第${mechanical.page}页`
    : bridge.name;
  document.getElementById('model-source-focus').textContent = mechanical
    ? `${mechanical.note} 尺寸依据：${mechanical.dimensionStatus}。` : bridge.focus;
}

function fittedCameraFrame(unfold = state.unfoldProgress) {
  const bounds = getModelBounds();
  if (state.mode === 'explore' && !state.isTiled) {
    const layout = getPlaneLayout(unfold);
    const half = layout.S / 2;
    for (const view of ['front', 'top', 'side']) {
      for (const x of [-half, half]) for (const y of [-half, half]) {
        bounds.expandByPoint(new THREE.Vector3(x, y, 0).applyEuler(layout[view].rot).add(layout[view].pos));
      }
    }
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(camera.aspect, 0.1));
  // 初次载入从三面投影的敞口观察；展开/合并不调用此取景函数。
  const direction = new THREE.Vector3(-.85, .65, 1.15).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  let distance = 0.1;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new THREE.Vector3(x, y, z).sub(center);
        distance = Math.max(distance, corner.dot(direction) + Math.max(
          Math.abs(corner.dot(right)) / Math.tan(horizontalHalfFov),
          Math.abs(corner.dot(up)) / Math.tan(verticalHalfFov)));
      }
    }
  }
  return { target: center, position: center.clone().addScaledVector(direction, distance * 1.08) };
}

function fitModelCamera() {
  const frame = fittedCameraFrame();
  controls.target.copy(frame.target);
  camera.up.set(0, 1, 0);
  camera.position.copy(frame.position);
  camera.lookAt(frame.target); controls.update();
}

async function selectLibraryModel(btn) {
  if (state.mode !== 'explore') {
    if (state.mode === 'quiz') exitPractice('explore');
    else setAppMode('explore');
  }
  const requestId = ++modelLoadRequest;
  resetBridgeTask();
  try {
    const definition = MODELS[btn.dataset.model];
    if (definition?.load) {
      setStatus(`正在准备 ${definition.name} 的实体与三视图…`);
      await definition.load();
      if (requestId !== modelLoadRequest || state.mode !== 'explore') return;
    }
    modelButtons.forEach(b => b.classList.toggle('active', b === btn));
    if (btn.dataset.url) {
      await loadAssetFromUrl(btn.dataset.url, btn.dataset.name || btn.textContent.trim(), btn.dataset.zup === '1');
    } else {
      state.currentModel = btn.dataset.model;
      rebuildModel();
    }
    if (requestId !== modelLoadRequest || state.mode !== 'explore') return;
    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.model === state.currentModel);
    });
    fitModelCamera();
    if (window.innerWidth <= 960) document.getElementById('tree-panel')?.classList.remove('open');
  } catch (error) {
    if (requestId === modelLoadRequest) setStatus(`模型未能加载：${error.message}。可重新选择重试。`);
    console.error(error);
  }
}

function bindModelButtons() {
  modelButtons = Array.from(document.querySelectorAll('.model-btn'));
  modelButtons.forEach(btn => btn.addEventListener('click', () => selectLibraryModel(btn)));
}

function setBridgeTaskFeedback(message, tone = 'info') {
  const feedback = document.getElementById('bridge-task-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.dataset.tone = tone;
}

function resetBridgeTask() {
  bridgeTaskState.active = false;
  bridgeTaskState.stage = 'idle';
  const prompt = document.getElementById('bridge-task-prompt');
  const viewActions = document.getElementById('bridge-task-view-actions');
  const start = document.getElementById('bridge-task-start');
  if (prompt) prompt.textContent = '从三维模型中识别目标构件，再判断哪个正交视图最能表达其空间特征。';
  if (viewActions) viewActions.hidden = true;
  if (start) start.textContent = '开始斜拉桥任务';
  document.querySelectorAll('[data-task-view]').forEach(button => {
    button.classList.remove('correct', 'wrong');
    button.disabled = false;
  });
  setBridgeTaskFeedback('任务尚未开始。', 'info');
}

function startBridgeTask() {
  modelLoadRequest += 1;
  if (state.mode !== 'explore') document.querySelector('.mode-tab[data-mode="explore"]')?.click();

  bridgeTaskState.active = true;
  bridgeTaskState.stage = 'pick';
  state.currentModel = BRIDGE_VIEW_TASK.model;
  modelButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.model === BRIDGE_VIEW_TASK.model);
  });
  rebuildModel();

  const prompt = document.getElementById('bridge-task-prompt');
  const viewActions = document.getElementById('bridge-task-view-actions');
  const start = document.getElementById('bridge-task-start');
  if (prompt) prompt.textContent = '第一步：请在三维斜拉桥上点击“把主梁荷载直接传给桥塔”的受拉构件。';
  if (viewActions) viewActions.hidden = true;
  if (start) start.textContent = '重新开始';
  setBridgeTaskFeedback('先在三维模型中作出判断；系统不会提前标出目标构件。', 'info');
  setStatus('主动任务已开始：请在三维斜拉桥中点击目标受拉构件。');
}

function handleBridgeTaskComponentSelection(object) {
  if (!bridgeTaskState.active || bridgeTaskState.stage !== 'pick') return;
  const semantic = getComponentInfo(object.name);
  const info = { ...semantic, label: object.userData.label || object.userData.componentLabel || semantic.label };
  if (!isBridgeTaskTarget(object.name)) {
    setBridgeTaskFeedback(`你选择了${info.label}。它的作用是：${info.role} 请继续寻找直接连接主梁与桥塔的受拉构件。`, 'error');
    return;
  }

  bridgeTaskState.stage = 'view';
  const prompt = document.getElementById('bridge-task-prompt');
  const viewActions = document.getElementById('bridge-task-view-actions');
  if (prompt) prompt.textContent = '第二步：三视图已切换为所选斜拉索。哪个视图最能直接看出“索随高度发生倾斜”？';
  if (viewActions) viewActions.hidden = false;
  setBridgeTaskFeedback('构件判断正确：斜拉索受拉并连接主梁与桥塔。现在根据三个真实投影继续判断。', 'success');
  if (!state.isUnfolded) document.getElementById('unfold-btn')?.click();
}

function answerBridgeTaskView(view, button) {
  if (!bridgeTaskState.active || bridgeTaskState.stage !== 'view') return;
  document.querySelectorAll('[data-task-view]').forEach(item => item.classList.remove('correct', 'wrong'));
  if (view === BRIDGE_VIEW_TASK.expectedView) {
    button.classList.add('correct');
    bridgeTaskState.stage = 'complete';
    document.querySelectorAll('[data-task-view]').forEach(item => { item.disabled = true; });
    setBridgeTaskFeedback('判断正确。正面图保留了桥跨方向与高度方向，因此能直接显示斜拉索的斜率；俯视图会丢失高度信息。', 'success');
    setStatus('主动任务完成：已从三维构件识别推进到三视图特征判断。');
  } else {
    button.classList.add('wrong');
    setBridgeTaskFeedback(view === 'top'
      ? '俯视图主要表达桥跨与横向位置，高度被压缩，不能直接显示拉索的竖向倾斜。请再判断。'
      : '侧面图沿桥跨方向观察，拉索的跨向斜率被压缩。请比较正面图。', 'error');
  }
}

function bindBridgeTaskUI() {
  document.getElementById('bridge-task-start')?.addEventListener('click', startBridgeTask);
  document.querySelectorAll('[data-task-view]').forEach(button => {
    button.addEventListener('click', () => answerBridgeTaskView(button.dataset.taskView, button));
  });
  resetBridgeTask();
}

const objLoader = new OBJLoader();
const stlLoader = new STLLoader();
const gltfLoader = new GLTFLoader();
const OCCT_DIST_URL = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/';
let occtRuntimePromise = null;

function loadOcctScript() {
  if (typeof globalThis.occtimportjs === 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-occt-import-js]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('STEP 解析组件加载失败。')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `${OCCT_DIST_URL}occt-import-js.js`;
    script.async = true;
    script.dataset.occtImportJs = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => script.remove(), { once: true });
    script.addEventListener('error', () => reject(new Error('STEP 解析组件加载失败，请检查网络连接。')), { once: true });
    document.head.appendChild(script);
  });
}

async function getOcctRuntime() {
  if (!occtRuntimePromise) {
    occtRuntimePromise = loadOcctScript()
      .then(() => {
        if (typeof globalThis.occtimportjs !== 'function') {
          throw new Error('STEP 解析组件未正确初始化。');
        }
        return globalThis.occtimportjs({
          locateFile: file => new URL(file, OCCT_DIST_URL).href
        });
      })
      .catch(error => {
        occtRuntimePromise = null;
        throw error;
      });
  }
  return occtRuntimePromise;
}

async function parseStepGeometry(data) {
  setStatus('正在载入 STEP 解析组件并三角化实体，首次使用可能需要数秒…');
  const occt = await getOcctRuntime();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const result = occt.ReadStepFile(bytes, { ...STEP_IMPORT_OPTIONS });
  const triangleSoup = occtResultToTriangleSoup(result);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(triangleSoup.positions, 3));
  if (triangleSoup.normals) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(triangleSoup.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.stepMeshCount = triangleSoup.meshCount;
  geometry.userData.stepTriangleCount = triangleSoup.triangleCount;
  return geometry;
}

// 按扩展名解析为统一几何；STEP 在浏览器内经 OpenCascade/WASM 三角化后接入同一投影链路
async function parseModelData(data, ext) {
  if (isStepExtension(ext)) {
    return parseStepGeometry(data);
  }
  if (ext === 'stl') {
    return extractGeometryFromParsed(stlLoader.parse(data));  // data: ArrayBuffer
  }
  if (ext === 'obj') {
    return extractGeometryFromParsed(objLoader.parse(data));  // data: text
  }
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await gltfLoader.parseAsync(data, '');        // data: ArrayBuffer
    return extractGeometryFromParsed(gltf.scene);
  }
  throw new Error(`仅支持 ${SUPPORTED_MODEL_EXTENSIONS.map(item => item.toUpperCase()).join(' / ')}。`);
}

// 加载内置/网络资产；STEP 和标记为 zUp 的资产统一校正为 Three.js 的 Y 轴向上
async function loadAssetFromUrl(url, name, zUp) {
  try {
    setStatus(`正在加载资产 ${name}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ext = getModelExtension(url);
    const data = (ext === 'obj') ? await res.text() : await res.arrayBuffer();
    const geom = await parseModelData(data, ext);
    if (!geom) throw new Error('未找到可显示的网格。');
    const shouldRotateZUp = zUp || isStepExtension(ext);
    if (shouldRotateZUp) { geom.rotateX(-Math.PI / 2); geom.computeVertexNormals(); }
    state.importedGeometry = geom;
    state.importedName = name;
    state.currentModel = 'imported';
    rebuildModel();
    const tris = Math.round(geom.attributes.position.count / 3);
    setStatus(`已加载模型 ${name}（约 ${tris} 个三角面${shouldRotateZUp ? '，已校正 Z→Y 轴向' : ''}，已居中缩放，三视图已生成）。`);
  } catch (e) {
    console.error(e);
    setStatus(`资产加载失败：${e.message || e}`);
  }
}

async function handleFileSelect(file, statusEl) {
  const requestId = ++modelLoadRequest;
  const ext = getModelExtension(file.name);
  try {
    if (!SUPPORTED_MODEL_EXTENSIONS.includes(ext)) {
      throw new Error(`不支持 .${ext || '未知'} 文件；请选择 STEP、OBJ、STL、GLB 或 GLTF。`);
    }
    if (statusEl) statusEl.innerHTML = `正在读取 <strong>${file.name}</strong>…`;
    const data = (ext === 'obj') ? await file.text() : await file.arrayBuffer();
    const geom = await parseModelData(data, ext);
    if (!geom) throw new Error('未找到可显示的网格。');
    if (requestId !== modelLoadRequest) return;
    if (isStepExtension(ext)) {
      // 机械 CAD 文件通常以 Z 轴为竖直方向；平台统一采用 Three.js 的 Y 轴向上。
      geom.rotateX(-Math.PI / 2);
      geom.computeVertexNormals();
    }
    state.importedGeometry = geom;
    state.importedName = file.name;
    state.currentModel = 'imported';
    modelButtons.forEach(b => b.classList.remove('active'));
    rebuildModel();
    const tris = Math.round((geom.index ? geom.index.count : geom.attributes.position.count) / 3);
    const note = isStepExtension(ext) ? '；STEP 实体已在浏览器内三角化并校正为 Y 轴向上' : '';
    if (statusEl) statusEl.innerHTML = `已导入 <strong>${file.name}</strong>（约 ${tris} 个三角面${note}）。`;
    setStatus(`已导入 ${file.name}：模型已居中缩放，三视图和消隐线已重新生成。`);
  } catch (e) {
    console.error(e);
    if (statusEl) statusEl.textContent = `导入失败：${e.message || e}`;
  }
}

function bindObjImport() {
  const file = document.getElementById('obj-file');
  const btn = document.getElementById('obj-import-btn');
  const status = document.getElementById('obj-status');
  if (file && btn) {
    btn.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) handleFileSelect(f, status); file.value = ''; });
  }

  const fileM = document.getElementById('obj-file-mobile');
  const btnM = document.getElementById('obj-import-btn-mobile');
  if (fileM && btnM) {
    btnM.addEventListener('click', () => fileM.click());
    fileM.addEventListener('change', () => { const f = fileM.files?.[0]; if (f) handleFileSelect(f, null); fileM.value = ''; });
  }
}

function setupToggle(id, key, onChange, idM) {
  const el = document.getElementById(id);
  const elM = idM ? document.getElementById(idM) : null;
  const setClass = () => {
    el?.classList.toggle('on', state[key]);
    elM?.classList.toggle('on', state[key]);
    el?.setAttribute('aria-pressed', String(state[key]));
    elM?.setAttribute('aria-pressed', String(state[key]));
  };
  const handler = () => { state[key] = !state[key]; setClass(); onChange?.(); };
  el?.addEventListener('click', handler);
  elM?.addEventListener('click', handler);
  setClass();
}

function bindSlider(id, idVal, idM, idValM, key, mapper, onChange) {
  const el = document.getElementById(id);
  const val = document.getElementById(idVal);
  const elM = document.getElementById(idM);
  const valM = document.getElementById(idValM);
  const setVal = (v) => {
    const text = mapper(v);
    if (val) val.textContent = text;
    if (valM) valM.textContent = text;
  };
  const sync = (src) => {
    const v = Number(src.value);
    if (el && el !== src) el.value = String(v);
    if (elM && elM !== src) elM.value = String(v);
    state[key] = v;
    setVal(v);
    onChange?.();
  };
  el?.addEventListener('input', () => sync(el));
  elM?.addEventListener('input', () => sync(elM));
  setVal(state[key]);
}

function bindControls() {
  const unfoldBtn = document.getElementById('unfold-btn');
  const unfoldBtnM = document.getElementById('unfold-btn-mobile');
  const unfoldFab = document.getElementById('mobile-unfold-fab');

  const toggleUnfold = () => {
    if (state.isTiled) setTiledMode(false);
    const target = state.isUnfolded ? 0 : 1;
    // 只翻转投影面，保持用户当前的旋转角度、平移位置和缩放。
    state.transitionActive = true;
    state.transitionFrom = state.unfoldProgress;
    state.transitionTo = target;
    state.transitionStart = performance.now();
    state.isUnfolded = target === 1;
    const text = state.isUnfolded ? '合并三视图' : '展开三视图';
    [unfoldBtn, unfoldBtnM, unfoldFab].forEach(btn => {
      if (!btn) return;
      const label = btn.querySelector('span');
      if (label) label.textContent = text;
      else btn.textContent = text;
      btn.setAttribute('aria-pressed', String(state.isUnfolded));
    });
  };
  unfoldBtn?.addEventListener('click', toggleUnfold);
  unfoldBtnM?.addEventListener('click', toggleUnfold);
  unfoldFab?.addEventListener('click', toggleUnfold);

  setupToggle('tog-projlines', 'showProjLines', () => updateUnfold(state.unfoldProgress), 'tog-projlines-m');
  setupToggle('tog-hidden', 'showHidden', () => drawProjections(), 'tog-hidden-m');
  setupToggle('tog-centers', 'showCenterLines', () => drawProjections(), 'tog-centers-m');
  setupToggle('tog-axes', 'showAxes', () => { axesGroup.visible = state.showAxes; }, 'tog-axes-m');
  setupToggle('tog-transparent', 'transparentModel', updateModelTransparency, 'tog-transparent-m');

  // 唯一参数：模型与三个投影面的统一距离（增大则三面一起外推，避免模型遮挡投影）
  bindSlider('plane-gap', 'plane-gap-val', 'plane-gap-m', 'plane-gap-val-m', 'planeGap',
    (v) => v.toFixed(1), applyClearance);

  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (e.code === 'Space' && state.mode === 'explore') { e.preventDefault(); toggleUnfold(); }
  });
}

// ===== 手机端抽屉 =====
let drawerOpen = false;
function openDrawer() {
  const scrim = document.getElementById('mobile-drawer-scrim');
  const drawer = document.getElementById('mobile-drawer');
  if (!scrim || !drawer) return;
  drawerOpen = true;
  scrim.classList.add('show');
  drawer.classList.add('show');
  scrim.setAttribute('aria-hidden', 'false');
  drawer.setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  const scrim = document.getElementById('mobile-drawer-scrim');
  const drawer = document.getElementById('mobile-drawer');
  if (!scrim || !drawer) return;
  drawerOpen = false;
  scrim.classList.remove('show');
  drawer.classList.remove('show');
  scrim.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('aria-hidden', 'true');
}

function setMobileTab(tab) {
  const tabs = Array.from(document.querySelectorAll('.mobile-drawer-tab'));
  tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const contents = ['models', 'controls', 'settings'];
  contents.forEach(key => {
    const el = document.getElementById(`mobile-content-${key}`);
    if (el) el.style.display = (key === tab) ? '' : 'none';
  });
}

function bindMobileUI() {
  const menuBtn = document.getElementById('mobile-menu-btn');
  const scrim = document.getElementById('mobile-drawer-scrim');
  const quizBtn = document.getElementById('quiz-btn-mobile');
  menuBtn?.addEventListener('click', openDrawer);
  scrim?.addEventListener('click', closeDrawer);
  quizBtn?.addEventListener('click', () => {
    document.querySelector('.mode-tab[data-mode="quiz"]')?.click();
    closeDrawer();
  });
  Array.from(document.querySelectorAll('.mobile-drawer-tab')).forEach(t => {
    t.addEventListener('click', () => setMobileTab(t.dataset.tab));
  });
}

// ===== 空间练习：题库驱动，模型和真实三视图始终作为判断证据 =====
let practiceIndex = 0;
let practiceSelected = new Set();
let practiceAnswered = false;
let practiceHintUsed = false;
let practiceStartedAt = 0;
let practiceAttempts = 0;
let practiceRecords = [];
let practiceRestoreState = null;
let practiceInteraction = null;

const TILED_VIEW_ORDER = [
  { key: 'front', label: '主视图', direction: [0, 0, 1] },
  { key: 'top', label: '俯视图', direction: [0, 1, 0] },
  { key: 'side', label: '左视图', direction: [-1, 0, 0] }
];

function currentPracticeQuestion() {
  return QUESTION_BANK[practiceIndex];
}

function isChoiceQuestion(question) {
  return question?.type === 'single' || question?.type === 'multiple';
}

function currentCameraDirectionArray() {
  return camera.position.clone().sub(controls.target).normalize().toArray();
}

function setPracticeFeedback(text, tone = 'info') {
  const feedback = document.getElementById('quiz-feedback');
  if (!feedback) return;
  feedback.textContent = text;
  feedback.dataset.tone = tone;
}

function updatePracticeInteractionUI() {
  const question = currentPracticeQuestion();
  const root = document.getElementById('quiz-interaction');
  const status = document.getElementById('quiz-interaction-status');
  if (!root || !status || !question) return;
  document.body.classList.toggle('quiz-rotate-task', question.type === 'rotate-to-view' && !practiceAnswered);
  root.hidden = isChoiceQuestion(question);
  if (isChoiceQuestion(question)) return;

  if (question.type === 'rotate-to-view') {
    const angle = directionAngleDegrees(currentCameraDirectionArray(), question.targetDirection);
    const ready = angle <= question.toleranceDegrees;
    root.dataset.type = 'rotate';
    status.textContent = ready ? `已对正 ${question.targetView === 'front' ? '主视方向' : '目标方向'}（偏差 ${angle.toFixed(1)}°）。` : `继续旋转模型（距目标 ${angle.toFixed(1)}°）。`;
    root.classList.toggle('ready', ready);
  } else if (question.type === 'click-model') {
    root.dataset.type = 'model';
    root.classList.remove('ready');
    status.textContent = practiceInteraction?.componentName ? `已选择构件：${getComponentInfo(practiceInteraction.componentName).label}。可重新点击更换。` : '请在三维模型上短按目标构件；拖动仍用于旋转模型。';
  } else {
    root.dataset.type = 'projection';
    root.classList.remove('ready');
    status.textContent = practiceInteraction?.view ? `已在${practiceInteraction.view === 'front' ? '主视图' : practiceInteraction.view === 'top' ? '俯视图' : '左视图'}选择位置。可重新点击更换。` : '请在右侧对应三视图中点击指定位置。';
  }
}

function updatePracticeSubmitState() {
  const question = currentPracticeQuestion();
  const submit = document.getElementById('quiz-submit');
  const next = document.getElementById('quiz-next-view');
  if (submit) submit.disabled = practiceAnswered || (isChoiceQuestion(question) ? practiceSelected.size === 0 : !practiceInteraction);
  if (next) next.disabled = !practiceAnswered;
}

function handlePracticePointerHit(event, rect) {
  const question = currentPracticeQuestion();
  if (!question || practiceAnswered || isChoiceQuestion(question) || question.type === 'rotate-to-view') return false;
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
  raycaster.setFromCamera(ndc, camera);

  if (question.type === 'click-model') {
    const nearby = findNearbyThinComponent(event.clientX, event.clientY, rect);
    const hits = raycaster.intersectObjects(modelGroup.children, true);
    const object = nearby || hits[0]?.object;
    if (!object) {
      setPracticeFeedback('未命中构件；请在模型表面短按后重试。');
      return true;
    }
    practiceInteraction = { componentName: object.name };
    updatePracticeInteractionUI();
    updatePracticeSubmitState();
    setPracticeFeedback(`已选择“${getComponentInfo(object.name).label}”，请提交核对。`);
    return true;
  }

  const planeHits = raycaster.intersectObjects(Object.values(projPlanes).filter(Boolean), false);
  const hit = planeHits[0];
  if (!hit?.uv) {
    setPracticeFeedback('请点击三视图图面中的目标位置。');
    return true;
  }
  const view = Object.entries(projPlanes).find(([, plane]) => plane === hit.object)?.[0];
  practiceInteraction = { view, u: hit.uv.x, v: hit.uv.y };
  updatePracticeInteractionUI();
  updatePracticeSubmitState();
  const matched = getHotspotHit(practiceInteraction, question.hotspots);
  setPracticeFeedback(matched ? '已选择图上位置，请提交核对。' : '已选择图上位置；请检查视图和线/特征位置后提交。');
  return true;
}

function setPracticeModeModel(question) {
  state.currentModel = question.modelId;
  state.showHidden = Boolean(question.showHidden);
  state.isUnfolded = true;
  state.unfoldProgress = 1;
  state.transitionActive = false;
  rebuildModel();
  Object.entries(projPlanes).forEach(([view, plane]) => {
    if (plane) plane.visible = question.views.includes(view);
  });
  updateUnfold(1);

  if (question.focusComponent) {
    const target = modelGroup.getObjectByName(question.focusComponent);
    if (target) setFocusComponent(target);
  }
}

function updatePracticeOptionUI() {
  const question = currentPracticeQuestion();
  document.querySelectorAll('.quiz-option[data-answer]').forEach(button => {
    const optionState = getQuizOptionState(button.dataset.answer, practiceSelected, question.answer, practiceAnswered);
    button.classList.toggle('selected', optionState.selected);
    button.classList.toggle('correct', optionState.correct);
    button.classList.toggle('wrong', optionState.wrong);
    button.classList.toggle('missed', optionState.missed);
    button.disabled = practiceAnswered;
    button.setAttribute('aria-pressed', String(practiceSelected.has(button.dataset.answer)));
  });

  const submit = document.getElementById('quiz-submit');
  const next = document.getElementById('quiz-next-view');
  if (isChoiceQuestion(question)) {
    if (submit) submit.disabled = practiceAnswered || practiceSelected.size === 0;
  }
  if (next) next.disabled = !practiceAnswered;
}

function renderPracticeMemory(question) {
  const host = document.getElementById('quiz-memory');
  const svg = document.getElementById('quiz-memory-svg');
  const copy = document.getElementById('quiz-memory-text');
  if (!host || !svg || !copy) return;
  const isBridge = String(question?.id || '').startsWith('bridge-');
  const views = isBridge ? {
    front: { name: '立面', plane: 'x–z', axis: 'y' },
    top: { name: '平面', plane: 'x–y', axis: 'z' },
    side: { name: '横断面', plane: 'y–z', axis: 'x' }
  } : {
    front: { name: '主视图', plane: 'x–y', axis: 'z' },
    top: { name: '俯视图', plane: 'x–z', axis: 'y' },
    side: { name: '左视图', plane: 'y–z', axis: 'x' }
  };
  const view = views[question?.targetView];
  host.hidden = question?.type !== 'rotate-to-view' || !view;
  if (host.hidden) {
    svg.replaceChildren();
    copy.textContent = '';
    return;
  }
  const active = axis => axis === view.axis ? 'quiz-memory-pulse' : '';
  const color = axis => axis === view.axis ? '#d86c28' : '#617684';
  const depthAxis = isBridge ? 'y' : 'z';
  const heightAxis = isBridge ? 'z' : 'y';
  svg.innerHTML = `
    <line x1="58" y1="57" x2="118" y2="57" stroke="${color('x')}" stroke-width="${view.axis === 'x' ? 4 : 2}" class="${active('x')}" />
    <line x1="58" y1="57" x2="27" y2="79" stroke="${color(depthAxis)}" stroke-width="${view.axis === depthAxis ? 4 : 2}" class="${active(depthAxis)}" />
    <line x1="58" y1="57" x2="58" y2="14" stroke="${color(heightAxis)}" stroke-width="${view.axis === heightAxis ? 4 : 2}" class="${active(heightAxis)}" />
    <circle cx="58" cy="57" r="3.5" fill="#263746" />
    <text x="123" y="61" fill="${color('x')}" font-size="10" font-weight="700">x ${isBridge ? '纵桥' : '长度'}</text>
    <text x="9" y="87" fill="${color(depthAxis)}" font-size="10" font-weight="700">${depthAxis} ${isBridge ? '横桥' : '深度'}</text>
    <text x="64" y="15" fill="${color(heightAxis)}" font-size="10" font-weight="700">${heightAxis} ${isBridge ? '竖向' : '高度'}</text>
    <rect x="154" y="13" width="83" height="64" rx="5" fill="#eaf3f7" stroke="#2775a5" stroke-width="2" stroke-dasharray="7 5" />
    <text x="195.5" y="40" text-anchor="middle" fill="#263746" font-size="13" font-weight="700">${view.name}</text>
    <text x="195.5" y="58" text-anchor="middle" fill="#2775a5" font-size="10" font-weight="700">保留 ${view.plane}</text>
    <circle cx="271" cy="45" r="8" fill="none" stroke="#263746" stroke-width="2" />
    <circle cx="271" cy="45" r="2.5" fill="#263746" />
    <path d="M260 45 H240 M248 39 L240 45 L248 51" fill="none" stroke="#d86c28" stroke-width="2" class="quiz-memory-pulse" />`;
  copy.textContent = `当前只调用一条：视线沿 ${view.axis} 轴，令 ${view.axis} 方向积聚成一点，画面留下 ${view.plane}。做到以后再换${isBridge ? '一种桥' : '一个构件'}或另一张视图。`;
}

function renderPracticeQuestion() {
  const question = currentPracticeQuestion();
  const optionRoot = document.getElementById('quiz-options');
  const feedback = document.getElementById('quiz-feedback');
  const evidence = document.getElementById('quiz-evidence');
  const reflection = document.getElementById('quiz-reflection');
  const reflectionPrompt = document.getElementById('quiz-reflection-prompt');
  const reflectionSelect = document.getElementById('quiz-reflection-select');
  const summary = document.getElementById('quiz-summary');
  const next = document.getElementById('quiz-next-view');

  practiceSelected = new Set();
  practiceInteraction = null;
  practiceAnswered = false;
  practiceHintUsed = false;
  practiceAttempts = 0;
  practiceStartedAt = performance.now();

  document.getElementById('quiz-question-text').textContent = question.prompt;
  document.getElementById('quiz-skill').textContent = question.skill;
  document.getElementById('quiz-difficulty').textContent = `难度 ${question.difficulty}`;
  document.getElementById('quiz-stage-pill').textContent = `第 ${practiceIndex + 1} / ${QUESTION_BANK.length} 题`;
  renderPracticeMemory(question);
  document.getElementById('quiz-progress-fill').style.width = `${((practiceIndex + 1) / QUESTION_BANK.length) * 100}%`;
  next.textContent = practiceIndex === QUESTION_BANK.length - 1 ? '查看练习小结' : '下一题';
  feedback.textContent = '先观察模型与真实三视图，选择后再提交判断。';
  feedback.dataset.tone = 'info';
  evidence.hidden = true;
  evidence.textContent = '';
  reflection.hidden = true;
  reflectionPrompt.textContent = question.reflection;
  reflectionSelect.value = '';
  summary.hidden = true;

  ['front', 'top', 'side'].forEach(view => {
    document.getElementById(`quiz-tag-${view}`)?.classList.toggle('on', question.views.includes(view));
  });

  optionRoot.replaceChildren(...(isChoiceQuestion(question) ? question.options.map(option => {
    const button = document.createElement('button');
    button.className = 'quiz-option';
    button.dataset.answer = option.id;
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.textContent = option.label;
    button.addEventListener('click', () => {
      if (practiceAnswered) return;
      if (question.type === 'single') practiceSelected = new Set([option.id]);
      else if (practiceSelected.has(option.id)) practiceSelected.delete(option.id);
      else practiceSelected.add(option.id);
      feedback.textContent = practiceSelected.size ? '已选择答案。请根据三维模型和投影线核对后提交。' : '请至少选择一个答案。';
      updatePracticeOptionUI();
    });
    return button;
  }) : []));

  setPracticeModeModel(question);
  updatePracticeInteractionUI();
  updatePracticeOptionUI();
  updatePracticeSubmitState();
}

function submitPracticeAnswer() {
  const question = currentPracticeQuestion();
  const response = isChoiceQuestion(question) ? practiceSelected : (question.type === 'rotate-to-view' ? { direction: currentCameraDirectionArray() } : practiceInteraction);
  if (practiceAnswered || (isChoiceQuestion(question) ? practiceSelected.size === 0 : !response)) return;
  const feedback = document.getElementById('quiz-feedback');
  const evidence = document.getElementById('quiz-evidence');
  const reflection = document.getElementById('quiz-reflection');
  const result = evaluateQuestionAnswer(question, response);
  practiceAnswered = true;
  practiceAttempts += 1;
  if (!isChoiceQuestion(question)) practiceInteraction = response;
  updatePracticeOptionUI();
  updatePracticeInteractionUI();
  updatePracticeSubmitState();

  if (question.revealHiddenAfterSubmit) {
    state.showHidden = true;
    document.getElementById('tog-hidden')?.classList.add('on');
    drawProjections();
  }

  evidence.hidden = false;
  evidence.textContent = `图学证据：${question.evidence}`;
  reflection.hidden = false;
  if (result.exact) {
    feedback.textContent = '判断正确。请说明你用到的图学依据，再进入下一题。';
    feedback.dataset.tone = 'success';
  } else {
    const details = [];
    if (result.missing?.length) details.push('未命中目标');
    if (result.unexpected?.length) details.push('选择了不符合的对象');
    feedback.textContent = `本次判断需要修正（${details.join('；') || '未满足题目条件'}）。请用上面的证据回到模型和投影中核对。`;
    feedback.dataset.tone = 'error';
  }
}

function finishPracticeQuestion() {
  if (!practiceAnswered) return;
  const question = currentPracticeQuestion();
  const response = isChoiceQuestion(question) ? practiceSelected : practiceInteraction;
  practiceRecords.push(createPracticeRecord(question, response, 0, {
    endedAt: Math.round(performance.now() - practiceStartedAt),
    attempts: practiceAttempts,
    hintUsed: practiceHintUsed,
    reflection: document.getElementById('quiz-reflection-select')?.value || null
  }));

  if (practiceIndex < QUESTION_BANK.length - 1) {
    practiceIndex += 1;
    renderPracticeQuestion();
    return;
  }

  const summary = summarizePractice(practiceRecords);
  const summaryEl = document.getElementById('quiz-summary');
  summaryEl.hidden = false;
  summaryEl.textContent = `本轮完成 ${summary.completed} 题，正确 ${summary.correct} 题。提示使用 ${summary.hintsUsed} 次。建议回顾出现错误的图学关系，再重新练习。`;
  document.getElementById('quiz-next-view').textContent = '重新练习';
  practiceIndex = -1;
}

function getObjectPath(object, root) {
  if (!object || !root) return null;
  const path = [];
  let current = object;
  while (current && current !== root) {
    const parent = current.parent;
    if (!parent) return null;
    const index = parent.children.indexOf(current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function resolveObjectPath(root, path) {
  if (!root || !Array.isArray(path)) return null;
  return path.reduce((current, index) => current?.children?.[index] || null, root);
}

function captureBridgeTaskSnapshot() {
  return {
    active: bridgeTaskState.active,
    stage: bridgeTaskState.stage,
    prompt: document.getElementById('bridge-task-prompt')?.textContent || '',
    feedback: document.getElementById('bridge-task-feedback')?.textContent || '',
    feedbackTone: document.getElementById('bridge-task-feedback')?.dataset.tone || 'info',
    viewActionsHidden: document.getElementById('bridge-task-view-actions')?.hidden ?? true,
    startText: document.getElementById('bridge-task-start')?.textContent || '',
    viewButtons: Array.from(document.querySelectorAll('[data-task-view]')).map(button => ({
      view: button.dataset.taskView,
      correct: button.classList.contains('correct'),
      wrong: button.classList.contains('wrong'),
      disabled: button.disabled
    }))
  };
}

function applyBridgeTaskSnapshot(snapshot) {
  if (!snapshot) return;
  bridgeTaskState.active = Boolean(snapshot.active);
  bridgeTaskState.stage = snapshot.stage || 'idle';
  const prompt = document.getElementById('bridge-task-prompt');
  const feedback = document.getElementById('bridge-task-feedback');
  const viewActions = document.getElementById('bridge-task-view-actions');
  const start = document.getElementById('bridge-task-start');
  if (prompt) prompt.textContent = snapshot.prompt;
  if (feedback) {
    feedback.textContent = snapshot.feedback;
    feedback.dataset.tone = snapshot.feedbackTone;
  }
  if (viewActions) viewActions.hidden = snapshot.viewActionsHidden;
  if (start) start.textContent = snapshot.startText;
  (snapshot.viewButtons || []).forEach(saved => {
    const button = document.querySelector(`[data-task-view="${saved.view}"]`);
    if (!button) return;
    button.classList.toggle('correct', saved.correct);
    button.classList.toggle('wrong', saved.wrong);
    button.disabled = saved.disabled;
  });
}

function captureProductState() {
  const settledUnfoldProgress = state.transitionActive ? state.transitionTo : state.unfoldProgress;
  return {
    currentModel: state.currentModel,
    showProjLines: state.showProjLines,
    showHidden: state.showHidden,
    showCenterLines: state.showCenterLines,
    showAxes: state.showAxes,
    transparentModel: state.transparentModel,
    planeAlpha: state.planeAlpha,
    planeSize: state.planeSize,
    planeGap: state.planeGap,
    importedGeometry: state.importedGeometry,
    importedName: state.importedName,
    isUnfolded: settledUnfoldProgress >= 0.5,
    unfoldProgress: settledUnfoldProgress,
    transitionActive: false,
    isTiled: state.isTiled,
    selectedComponentPath: getObjectPath(selectedComponent, modelGroup),
    bridgeTask: captureBridgeTaskSnapshot(),
    statusText: statusStrip?.textContent || '',
    cameraPosition: camera.position.toArray(),
    cameraUp: camera.up.toArray(),
    controlsTarget: controls.target.toArray()
  };
}

function applyProductState(snapshot) {
  if (!snapshot) return false;
  const {
    cameraPosition,
    cameraUp,
    controlsTarget,
    isTiled: restoreTiled,
    returnMode: _returnMode,
    selectedComponentPath,
    bridgeTask,
    statusText,
    ...restoredState
  } = snapshot;
  Object.assign(state, restoredState, { isTiled: false, transitionActive: false });
  rebuildModel();
  if (cameraPosition) camera.position.fromArray(cameraPosition);
  if (cameraUp) camera.up.fromArray(cameraUp);
  if (controlsTarget) controls.target.fromArray(controlsTarget);
  camera.lookAt(controls.target);
  controls.update();
  Object.values(projPlanes).forEach(plane => { if (plane) plane.visible = true; });
  updateUnfold(state.unfoldProgress);
  bridgeTaskState.active = false;
  const restoredComponent = resolveObjectPath(modelGroup, selectedComponentPath);
  if (restoredComponent?.isMesh) setFocusComponent(restoredComponent);
  applyBridgeTaskSnapshot(bridgeTask);
  [
    ['tog-projlines', 'tog-projlines-m', 'showProjLines'],
    ['tog-hidden', 'tog-hidden-m', 'showHidden'],
    ['tog-centers', 'tog-centers-m', 'showCenterLines'],
    ['tog-axes', 'tog-axes-m', 'showAxes'],
    ['tog-transparent', 'tog-transparent-m', 'transparentModel']
  ].forEach(([desktopId, mobileId, key]) => {
    document.getElementById(desktopId)?.classList.toggle('on', state[key]);
    document.getElementById(mobileId)?.classList.toggle('on', state[key]);
    document.getElementById(desktopId)?.setAttribute('aria-pressed', String(state[key]));
    document.getElementById(mobileId)?.setAttribute('aria-pressed', String(state[key]));
  });
  ['plane-gap', 'plane-gap-m'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = String(state.planeGap);
  });
  ['plane-gap-val', 'plane-gap-val-m'].forEach(id => {
    const output = document.getElementById(id);
    if (output) output.textContent = state.planeGap.toFixed(1);
  });
  const unfoldText = state.isUnfolded ? '合并三视图' : '展开三视图';
  ['unfold-btn', 'unfold-btn-mobile', 'mobile-unfold-fab'].forEach(id => {
    const button = document.getElementById(id);
    if (!button) return;
    const label = button.querySelector('span');
    if (label) label.textContent = unfoldText;
    else button.textContent = unfoldText;
    button.setAttribute('aria-pressed', String(state.isUnfolded));
  });
  if (statusText) setStatus(statusText);
  mountRenderer();
  onResize();
  return Boolean(restoreTiled);
}

function setProductEnvironmentVisible(visible) {
  [floorGroup, projectionGroup, modelGroup, focusGroup]
    .forEach(group => { group.visible = visible; });
  projectionGroup.visible = visible && !state.isTiled;
  floorGroup.visible = visible && !state.isTiled;
  axesGroup.visible = visible && state.showAxes;
  projLinesGroup.visible = visible && state.showProjLines && !state.isTiled;
}

function syncModeUI(mode) {
  const modeTabs = Array.from(document.querySelectorAll('.mode-tab'));
  const quizOverlay = document.getElementById('quiz-overlay');
  modeTabs.forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.body.classList.toggle('mode-lab', mode === 'lab');
  document.body.classList.toggle('mode-compound', mode === 'compound');
  document.body.classList.toggle('mode-quiz', mode === 'quiz');
  document.body.classList.toggle('mode-vice', mode === 'vice');
  if (mode !== 'quiz') document.body.classList.remove('quiz-rotate-task');
  ['ribbon', 'tree-panel', 'props-panel', 'mobile-drawer'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.inert = mode === 'quiz';
  });
  quizOverlay.style.display = mode === 'quiz' ? 'block' : 'none';
  quizOverlay.setAttribute('aria-hidden', mode === 'quiz' ? 'false' : 'true');
}

function isTeachingMode(mode) {
  return mode === 'lab' || mode === 'compound' || mode === 'vice';
}

function setAppMode(nextMode, options = {}) {
  if (!['lab', 'compound', 'explore', 'quiz', 'vice'].includes(nextMode) || nextMode === state.mode) return;
  const previousMode = state.mode;
  modelLoadRequest += 1;

  if (previousMode === 'explore' && isTeachingMode(nextMode) && !options.productStateReady) {
    exploreRestoreState = captureProductState();
  }
  if (nextMode === 'quiz' && !practiceRestoreState) {
    const productState = isTeachingMode(previousMode) && exploreRestoreState
      ? exploreRestoreState
      : captureProductState();
    practiceRestoreState = { ...productState, returnMode: previousMode };
  }
  if (state.isTiled && nextMode !== 'explore') setTiledMode(false);
  if (previousMode === 'lab') labController?.leave();
  if (previousMode === 'compound') compoundController?.leave();
  if (previousMode === 'vice') viceController.leave();

  state.mode = nextMode;
  syncModeUI(nextMode);

  if (nextMode === 'vice') {
    setProductEnvironmentVisible(false);
    viceController.enter();
    return;
  }

  if (nextMode === 'lab') {
    setProductEnvironmentVisible(false);
    labController?.enter();
    hudMode.textContent = '教材实验 · 点线面投影';
    mountRenderer();
    onResize();
    return;
  }

  if (nextMode === 'compound') {
    state.showHidden = true;
    state.transparentModel = false;
    setProductEnvironmentVisible(true);
    floorGroup.visible = false;
    projectionGroup.visible = false;
    axesGroup.visible = false;
    projLinesGroup.visible = false;
    focusGroup.visible = false;
    compoundController?.enter();
    hudMode.textContent = '教材例题 · 组合体投影';
    mountRenderer();
    onResize();
    return;
  }

  setProductEnvironmentVisible(true);
  if (nextMode === 'quiz') {
    bridgeTaskState.active = false;
    hudMode.textContent = '空间练习 · 预测与核对';
    practiceIndex = 0;
    practiceRecords = [];
    renderPracticeQuestion();
    setStatus('空间练习：先观察真实模型和三视图，再作出预测并用图学证据核对。');
    mountRenderer();
    onResize();
    return;
  }

  hudMode.textContent = '三维透视 · 第一角';
  let restoreTiled = false;
  if (!options.productStateReady && isTeachingMode(previousMode) && exploreRestoreState) {
    restoreTiled = applyProductState(exploreRestoreState);
  } else {
    mountRenderer();
    onResize();
  }
  if (restoreTiled) setTiledMode(true);
}

function exitPractice(targetMode = null) {
  const snapshot = practiceRestoreState;
  const returnMode = targetMode || snapshot?.returnMode || 'explore';
  practiceRestoreState = null;

  const productSnapshot = returnMode === 'explore' && isTeachingMode(snapshot?.returnMode) && exploreRestoreState
    ? exploreRestoreState
    : snapshot;
  if (isTeachingMode(returnMode) && snapshot?.returnMode === 'explore' && productSnapshot) {
    exploreRestoreState = { ...productSnapshot };
  }
  const restoreTiled = applyProductState(productSnapshot);
  setAppMode(returnMode, { productStateReady: true });
  if (returnMode === 'explore' && restoreTiled) setTiledMode(true);
}

function bindQuizUI() {
  const modeTabs = Array.from(document.querySelectorAll('.mode-tab'));
  modeTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const nextMode = tab.dataset.mode;
      if (nextMode === state.mode) return;
      if (state.mode === 'quiz' && nextMode !== 'quiz') exitPractice(nextMode);
      else setAppMode(nextMode);
    });
  });

  document.getElementById('quiz-close')?.addEventListener('click', () => exitPractice());
  document.getElementById('quiz-hint')?.addEventListener('click', () => {
    const question = currentPracticeQuestion();
    if (!question) return;
    practiceHintUsed = true;
    const feedback = document.getElementById('quiz-feedback');
    feedback.textContent = `提示：${question.hint}`;
    feedback.dataset.tone = 'info';
  });
  document.getElementById('quiz-submit')?.addEventListener('click', submitPracticeAnswer);
  document.getElementById('quiz-next-view')?.addEventListener('click', () => {
    if (practiceIndex === -1) {
      practiceIndex = 0;
      practiceRecords = [];
      renderPracticeQuestion();
    } else finishPracticeQuestion();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.mode === 'quiz') exitPractice();
  });
}

function projectionTargetDataUrl(key) {
  ensureProjResources();
  let canvas = projCanvases[key];
  const target = projTargets[key];
  if (!target || !VIEW[key]) return '';
  if (!canvas) {
    canvas = document.createElement('canvas');
    projCanvases[key] = canvas;
  }
  canvas.width = target.width;
  canvas.height = target.height;
  const width = target.width;
  const height = target.height;
  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  const context = canvas.getContext('2d');
  const imageData = context.createImageData(width, height);
  const orientation = VIEW[key];
  for (let y = 0; y < height; y += 1) {
    const destinationY = orientation.flipY ? y : height - y - 1;
    const sourceRowOffset = y * width * 4;
    const destinationRowOffset = destinationY * width * 4;
    if (!orientation.flipX) {
      imageData.data.set(
        pixels.subarray(sourceRowOffset, sourceRowOffset + width * 4),
        destinationRowOffset
      );
      continue;
    }
    for (let x = 0; x < width; x += 1) {
      const destinationX = orientation.flipX ? width - x - 1 : x;
      const sourceOffset = sourceRowOffset + x * 4;
      const destinationOffset = (destinationY * width + destinationX) * 4;
      imageData.data[destinationOffset] = pixels[sourceOffset];
      imageData.data[destinationOffset + 1] = pixels[sourceOffset + 1];
      imageData.data[destinationOffset + 2] = pixels[sourceOffset + 2];
      imageData.data[destinationOffset + 3] = pixels[sourceOffset + 3];
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function projectionPointPositions(worldPoint) {
  ensureProjResources();
  const point = Array.isArray(worldPoint)
    ? new THREE.Vector3(...worldPoint)
    : new THREE.Vector3(worldPoint?.x || 0, worldPoint?.y || 0, worldPoint?.z || 0);
  return Object.fromEntries(['front', 'side', 'top'].map(key => {
    const projected = point.clone().project(projCams[key]);
    const orientation = VIEW[key];
    const rawX = (projected.x + 1) / 2;
    const x = orientation.flipX ? 1 - rawX : rawX;
    const y = orientation.flipY ? (projected.y + 1) / 2 : (1 - projected.y) / 2;
    return [key, { x, y, depth: projected.z }];
  }));
}

function setCompoundProjectionHidden(enabled) {
  state.showHidden = Boolean(enabled);
  document.getElementById('tog-hidden')?.classList.toggle('on', state.showHidden);
  document.getElementById('tog-hidden-m')?.classList.toggle('on', state.showHidden);
}

function updateTiledProjectionCards() {
  TILED_VIEW_ORDER.forEach(({ key }) => {
    const image = document.querySelector(`[data-tiled-image="${key}"]`);
    const src = projectionTargetDataUrl(key);
    if (image && src) image.src = src;
  });
}

let tiledProjectionRefreshFrame = 0;
function scheduleTiledProjectionRefresh() {
  if (!state.isTiled || tiledProjectionRefreshFrame) return;
  tiledProjectionRefreshFrame = requestAnimationFrame(() => {
    tiledProjectionRefreshFrame = 0;
    if (!state.isTiled || !projScene) return;
    renderProjViews();
    updateTiledProjectionCards();
  });
}

function updateViewMatchFeedback() {
  if (!state.isTiled) return;
  const direction = currentCameraDirectionArray();
  const match = TILED_VIEW_ORDER.find(view => directionAngleDegrees(direction, view.direction) <= 9) || null;
  if (match?.key !== state.activeMatchedView) {
    state.activeMatchedView = match?.key || null;
    if (match) state.matchedViewEnteredAt = performance.now();
  }
  document.querySelectorAll('[data-tiled-card]').forEach(card => {
    const active = card.dataset.tiledCard === state.activeMatchedView;
    card.classList.toggle('matched', active);
    card.classList.toggle('sparkle', active && performance.now() - state.matchedViewEnteredAt < 900);
  });
}

function setStandardCameraView(viewKey) {
  const config = VIEW[viewKey];
  if (!config) return;
  const distance = camera.position.distanceTo(controls.target);
  camera.position.copy(controls.target).addScaledVector(config.eye, distance);
  camera.up.copy(config.up);
  camera.lookAt(controls.target);
  controls.update();
  updateViewMatchFeedback();
}

function setTiledMode(enabled) {
  if (enabled && state.mode !== 'explore') return;
  state.isTiled = enabled;
  const viewportEl = document.getElementById('viewport');
  const button = document.getElementById('tile-btn');
  mountRenderer();
  viewportEl?.classList.toggle('tiled-mode', enabled);
  projectionGroup.visible = !enabled;
  floorGroup.visible = !enabled;
  projLinesGroup.visible = !enabled && state.showProjLines;
  if (button) {
    button.classList.toggle('on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    const label = button.querySelector('.cap');
    if (label) label.textContent = enabled ? '退出平铺对照' : '平铺三视图';
  }
  if (enabled) {
    state.isUnfolded = false;
    state.unfoldProgress = 0;
    state.transitionActive = false;
    updateUnfold(0);
    drawProjections();
    updateViewMatchFeedback();
    setStatus('平铺对照：左侧可自由旋转三维模型；右侧按第一角画法显示三视图。');
  } else {
    state.activeMatchedView = null;
    document.querySelectorAll('[data-tiled-card]').forEach(card => card.classList.remove('matched', 'sparkle'));
    drawProjections();
  }
  onResize();
}

function bindTiledViewUI() {
  document.getElementById('tile-btn')?.addEventListener('click', () => setTiledMode(!state.isTiled));
  document.querySelectorAll('[data-standard-view]').forEach(button => {
    button.addEventListener('click', () => setStandardCameraView(button.dataset.standardView));
  });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleTiledProjectionRefresh);
    document.querySelectorAll('[data-tiled-image]').forEach(image => observer.observe(image));
  }
}

function getRendererHost() {
  if (state.mode === 'lab') return document.getElementById('lab-canvas-host') || viewport;
  if (state.mode === 'compound') return document.getElementById('compound-model-host') || viewport;
  if (state.isTiled) return document.getElementById('model-pane') || viewport;
  return viewport;
}

function mountRenderer() {
  const host = getRendererHost();
  if (renderer.domElement.parentElement === host) return host;
  if (host === viewport) host.insertBefore(renderer.domElement, host.firstChild);
  else host.prepend(renderer.domElement);
  return host;
}

function onResize() {
  if (state.mode === 'vice') return;
  const host = getRendererHost();
  const w = host.clientWidth;
  const h = host.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (state.isTiled) scheduleTiledProjectionRefresh();
  if (state.mode === 'compound') compoundController?.scrollActiveLessonIntoView();
}

function animate() {
  requestAnimationFrame(animate);
  if (state.mode === 'vice') return;
  if (state.transitionActive) {
    const raw = Math.min(1, (performance.now() - state.transitionStart) / state.transitionDuration);
    const eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - Math.pow(-2 * raw + 2, 3) / 2;
    state.unfoldProgress = THREE.MathUtils.lerp(state.transitionFrom, state.transitionTo, eased);
    updateUnfold(state.unfoldProgress);
    if (raw >= 1) {
      state.unfoldProgress = state.transitionTo;
      state.transitionActive = false;
      updateUnfold(state.unfoldProgress);
    }
  }
  controls.update();
  if (state.mode === 'compound') compoundController?.update();
  updateViewMatchFeedback();
  if (state.mode === 'quiz' && currentPracticeQuestion()?.type === 'rotate-to-view' && !practiceAnswered) {
    practiceInteraction = { direction: currentCameraDirectionArray() };
    updatePracticeInteractionUI();
    updatePracticeSubmitState();
  }
  renderer.render(scene, camera);
}

// ===== 启动 =====
window.addEventListener('resize', onResize);

labController = createBasicProjectionLab({ THREE, scene, camera, controls, setStatus });
compoundController = createCompoundProjectionLab({
  THREE,
  camera,
  controls,
  rendererElement: renderer.domElement,
  modelGroup,
  activateModel: () => {
    state.currentModel = 'chapter5';
    state.importedGeometry = null;
    state.importedName = '';
    rebuildModel();
    if (state.mode === 'compound') {
      [floorGroup, projectionGroup, axesGroup, projLinesGroup, focusGroup].forEach(group => { group.visible = false; });
    }
  },
  refreshProjections: drawProjections,
  projectionImageProvider: projectionTargetDataUrl,
  projectionPointProvider: projectionPointPositions,
  setProjectionHidden: setCompoundProjectionHidden,
  clearFocus: () => clearFocus(false),
  setStatus
});

populateBridgeLibrary();
bindModelButtons();
bindObjImport();
bindControls();
bindMobileUI();
bindQuizUI();
bindFocusPicking();
bindBridgeTaskUI();
bindTiledViewUI();

onResize();
rebuildModel();
fitModelCamera();
setAppMode('lab');
animate();

setStatus('教材实验：从投影形成开始，依次观察点、线、面的三面投影及其空间关系。');

// Shareable local teaching entry. Only registered modes and models are accepted.
const entryParameters = new URLSearchParams(location.search);
const entryMode = entryParameters.get('mode');
if (entryMode && ['lab', 'compound', 'explore', 'quiz', 'vice'].includes(entryMode)) setAppMode(entryMode);
if (entryMode === 'explore') {
  const entryModel = entryParameters.get('model');
  const entryButton = modelButtons.find(button => button.dataset.model === entryModel);
  if (entryButton) selectLibraryModel(entryButton);
  else if (Object.hasOwn(MODELS, entryModel) && entryModel !== 'chapter5') {
    // Archived models remain available only by their existing explicit share URL.
    selectLibraryModel({ dataset: { model: entryModel } });
  }
}

const aiWorkbench = createAiWorkbenchAdapter({
  getMode: () => state.mode,
  getModelId: () => state.currentModel,
  getModelLabel: () => MODELS[state.currentModel]?.name || '当前模型',
  getRevision: () => modelRevision,
  getCompound: () => compoundController,
  getVariation: id => modelVariations.get(id),
  setVariation: (id, values) => modelVariations.set(id, { ...values }),
  getEditContext: (id, values) => MODELS[id]?.editContext?.(values),
  getFacts: compoundContext => collectModelFacts({
    modelRoot: modelGroup, modelId: state.currentModel, label: MODELS[state.currentModel]?.name,
    note: MODELS[state.currentModel]?.note, selectedComponent, mode: state.mode, compoundContext
  }),
  rebuild: rebuildModel
});
createAiModelAssistant({ ...aiWorkbench, captureImages: captureAiImages });

// BEGIN AI VIEW CAPTURE
async function captureAiImages() {
  if (!['explore', 'compound'].includes(state.mode)) return [];
  const mode = state.mode, revision = modelRevision;
  const views = [['front', '主视图'], ['top', '俯视图'], ['side', '左视图']];
  // Only the renderer canvas and the three drawing images are captured. Read the
  // WebGL canvas synchronously immediately after rendering, before any await.
  let modelImage;
  try {
    renderer.render(scene, camera);
    modelImage = renderer.domElement.toDataURL('image/jpeg', 0.9);
    if (!/^data:image\/jpeg;base64,/.test(modelImage)) throw new Error();
  } catch {
    throw new Error('无法读取当前模型画布，请等待模型显示后重试。');
  }
  const images = [{ label: '当前三维模型与观察角度', dataUrl: modelImage }];
  if (mode === 'explore') {
    for (const [key, label] of views) {
      const dataUrl = projectionTargetDataUrl(key);
      if (!/^data:image\/png;base64,/.test(dataUrl)) throw new Error(`${label}尚未生成，请等待三视图显示后重试。`);
      images.push({ label: `${label}（当前实体的正投影）`, dataUrl });
    }
    return images;
  }

  // The compound UI can be showing exact BREP SVGs while render targets still
  // contain an interactive mesh preview. Always capture the actual UI source.
  const snapshots = views.map(([key, label]) => {
    const element = document.querySelector(`[data-compound-image="${key}"]`);
    if (!element?.src || !element.complete || !(element.naturalWidth > 0)) {
      throw new Error(`${label}尚未加载完成，请等待三视图显示后重试。`);
    }
    return { element, label, src: element.src, source: element.dataset.projectionSource === 'exact-brep' ? 'exact-brep' : 'interactive-preview' };
  });
  for (const snapshot of snapshots) {
    const dataUrl = await aiDrawingImagePng(snapshot);
    images.push({ label: `${snapshot.label}（${snapshot.source === 'exact-brep' ? '当前精确投影' : '当前交互预览'}）`, dataUrl });
  }
  if (state.mode !== mode || modelRevision !== revision || snapshots.some(snapshot =>
    snapshot.element.src !== snapshot.src
    || (snapshot.element.dataset.projectionSource === 'exact-brep' ? 'exact-brep' : 'interactive-preview') !== snapshot.source)) {
    throw new Error('模型或三视图已变化，请重新附上当前图像。');
  }
  return images;
}

async function aiDrawingImagePng({ src, label, source, element }) {
  const svgHeader = /^data:image\/svg\+xml(?:;charset=[\w-]+)?(;base64)?,/i.exec(src);
  let imageSrc = src, width, height;
  if (svgHeader) {
    try {
      const encoded = src.slice(svgHeader[0].length);
      const xml = svgHeader[1]
        ? new TextDecoder().decode(Uint8Array.from(atob(encoded), character => character.charCodeAt(0)))
        : decodeURIComponent(encoded);
      const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml');
      const svg = parsed.documentElement;
      if (parsed.querySelector('parsererror') || svg?.localName !== 'svg') throw new Error();
      const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw new Error();
      const scale = 1200 / Math.max(box[2], box[3]);
      width = Math.max(1, Math.round(box[2] * scale));
      height = Math.max(1, Math.round(box[3] * scale));
      // Specify intrinsic dimensions on the export copy so a browser's default
      // SVG viewport (often 300×150) cannot change the viewBox aspect ratio.
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      // Non-scaling strokes otherwise stay around one pixel even in a larger
      // export. Preserve the displayed relative weight on this detached copy.
      const displayedWidth = element?.getBoundingClientRect?.().width;
      const strokeScale = Math.min(4, width / (Number.isFinite(displayedWidth) && displayedWidth > 0 ? displayedWidth : 400));
      for (const item of svg.querySelectorAll('[stroke-width], [stroke-dasharray]')) {
        const stroke = item.getAttribute('stroke-width');
        if (stroke !== null && /^\d*\.?\d+(?:px)?$/.test(stroke.trim())) {
          item.setAttribute('stroke-width', String(Number.parseFloat(stroke) * strokeScale));
        }
        const dash = item.getAttribute('stroke-dasharray');
        if (dash !== null && dash.trim()) {
          const lengths = dash.trim().split(/[\s,]+/).map(Number);
          if (lengths.every(value => Number.isFinite(value) && value >= 0)) {
            item.setAttribute('stroke-dasharray', lengths.map(value => value * strokeScale).join(' '));
          }
        }
      }
      imageSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    } catch {
      throw new Error(`${label}的SVG或viewBox无效，请刷新该视图后重试。`);
    }
  } else if (source === 'exact-brep' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(src)) {
    throw new Error(`${label}的图像来源无效，请等待当前视图重新生成后重试。`);
  }
  const image = await new Promise((resolve, reject) => {
    const loaded = new Image();
    const fail = () => reject(new Error(`${label}图像无法加载，请刷新该视图后重试。`));
    const timer = setTimeout(() => { loaded.onload = null; loaded.onerror = null; fail(); }, 5000);
    loaded.onload = () => {
      clearTimeout(timer);
      if (!(loaded.naturalWidth > 0 && loaded.naturalHeight > 0)) { fail(); return; }
      resolve(loaded);
    };
    loaded.onerror = () => { clearTimeout(timer); fail(); };
    loaded.src = imageSrc;
  });
  if (!width || !height) {
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    width = Math.max(1, Math.round(image.naturalWidth * scale));
    height = Math.max(1, Math.round(image.naturalHeight * scale));
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error();
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const png = canvas.toDataURL('image/png');
    if (!/^data:image\/png;base64,/.test(png)) throw new Error();
    return png;
  } catch {
    throw new Error(`${label}无法转换为图像，请刷新该视图后重试。`);
  }
}
// END AI VIEW CAPTURE
