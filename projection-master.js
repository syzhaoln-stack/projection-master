import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ===== 基础设置 =====
const viewport = document.getElementById('viewport');
const statusStrip = document.getElementById('status-strip');
const hudMode = document.getElementById('hud-mode');

const scene = new THREE.Scene();
scene.background = null; // 透明，用CSS背景
scene.fog = new THREE.Fog(0x071022, 18, 46);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(8.6, 6.8, 10.4);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 1.45, 0);

// 光照
scene.add(new THREE.HemisphereLight(0xb9d8ec, 0x172231, 1.05));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
keyLight.position.set(6, 10, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -9;
keyLight.shadow.camera.right = 9;
keyLight.shadow.camera.top = 9;
keyLight.shadow.camera.bottom = -9;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x7bc7ff, 0.58);
rimLight.position.set(-7, 5, -5);
scene.add(rimLight);

// ===== 状态 =====
const state = {
  currentModel: 'step',
  unfoldProgress: 0,
  isUnfolded: false,
  transitionActive: false,
  transitionFrom: 0,
  transitionTo: 0,
  transitionStart: 0,
  transitionDuration: 760,
  showProjLines: true,
  showHidden: true,
  showAxes: true,
  transparentModel: false,
  planeAlpha: 0.16,
  planeSize: 7.5,
  planeGap: 1.6,
  importedGeometry: null,
  importedName: '',
  mode: 'explore'
};

const modelGroup = new THREE.Group();
const projectionGroup = new THREE.Group();
const axesGroup = new THREE.Group();
const projLinesGroup = new THREE.Group();
const floorGroup = new THREE.Group();
const focusGroup = new THREE.Group();   // 局部三视图聚焦框标记
scene.add(floorGroup, projectionGroup, modelGroup, axesGroup, projLinesGroup, focusGroup);

// 局部三视图：聚焦区域（null=整体）
let focusBox = null;
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

// ===== 投影核心 =====
const projPlanes = { front: null, top: null, side: null };
const projTextures = { front: null, top: null, side: null };
const projCanvases = { front: null, top: null, side: null };
// ===== 三视图：正交相机渲染到贴图（稳定正确，支持任意复杂度） =====
const PROJ_RES = 1024;           // 每个视图渲染分辨率
const PROJ_BG = 0x0e1a2c;        // 视图底色
const EDGE_THRESHOLD = 24;       // 特征边阈值（度）：低于此夹角的面间边不画
const projTargets = { front: null, top: null, side: null };
const projCams = { front: null, top: null, side: null };
let projScene = null;            // 离屏线框场景（只含当前模型的线/遮挡体/中心线）
let projResourcesReady = false;

// 第一角投影各视图的取景朝向与镜像校正（flip 经截图核验后微调）
const VIEW = {
  front: { eye: new THREE.Vector3(0, 0, 1),  up: new THREE.Vector3(0, 1, 0),  flipX: false, flipY: false },
  top:   { eye: new THREE.Vector3(0, 1, 0),  up: new THREE.Vector3(0, 0, -1), flipX: false, flipY: false },
  side:  { eye: new THREE.Vector3(1, 0, 0),  up: new THREE.Vector3(0, 1, 0),  flipX: true,  flipY: false }
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
    uniforms: { uColor: { value: new THREE.Color(0xeaf6fb) }, uT: { value: thickness } },
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
  modelGroup.updateMatrixWorld(true);

  const box = getProjBounds();
  const size = new THREE.Vector3(); box.getSize(size);
  const ext = Math.max(size.x, size.y, size.z) || 1;
  const dash = ext * 0.02;

  // 收集每个 mesh 的世界空间几何
  const worldGeos = [];
  modelGroup.traverse(child => {
    if (!child.isMesh || !child.geometry) return;
    const g = child.geometry.clone();
    g.applyMatrix4(child.matrixWorld);
    worldGeos.push(g);
  });
  if (!worldGeos.length) return;

  // 遮挡体（底色实绘：盖住剪影内部、只留外轮廓白边；并写深度供消隐）
  // polygonOffset 推后，让边线压在前不闪烁
  const occMat = new THREE.MeshBasicMaterial({ color: PROJ_BG });
  occMat.polygonOffset = true; occMat.polygonOffsetFactor = 1; occMat.polygonOffsetUnits = 1;
  _projDisposables.push(occMat);
  // 剪影（外轮廓）
  const silMat = makeSilhouetteMaterial(ext * 0.004);
  _projDisposables.push(silMat);
  // 可见实线
  const visMat = new THREE.LineBasicMaterial({ color: 0xeaf6fb });
  _projDisposables.push(visMat);
  // 隐藏虚线（仅在被遮挡处绘制）
  const hidMat = new THREE.LineDashedMaterial({ color: 0x8aa0b4, dashSize: dash, gapSize: dash * 0.72, transparent: true, opacity: 0.92 });
  hidMat.depthFunc = THREE.GreaterDepth;
  _projDisposables.push(hidMat);

  worldGeos.forEach(g => {
    _projDisposables.push(g);
    const sil = new THREE.Mesh(g, silMat); sil.renderOrder = 0; projScene.add(sil);
    const occ = new THREE.Mesh(g, occMat); occ.renderOrder = 1; projScene.add(occ);
    const eg = new THREE.EdgesGeometry(g, EDGE_THRESHOLD);
    _projDisposables.push(eg);
    if (state.showHidden) {
      const hid = new THREE.LineSegments(eg, hidMat); hid.renderOrder = 2;
      hid.computeLineDistances();
      projScene.add(hid);
    }
    const vis = new THREE.LineSegments(eg, visMat); vis.renderOrder = 3; projScene.add(vis);
  });

  // 中心线（链式点划线，置顶不消隐）
  const centerSegs = computeCenterLines(box);
  if (centerSegs.length) {
    const cMat = new THREE.LineDashedMaterial({
      color: 0xf0b454, dashSize: ext * 0.05, gapSize: ext * 0.022,
      transparent: true, opacity: 0.85, depthTest: false
    });
    _projDisposables.push(cMat);
    const pts = [];
    centerSegs.forEach(([a, b]) => { pts.push(a, b); });
    const cGeo = new THREE.BufferGeometry().setFromPoints(pts);
    _projDisposables.push(cGeo);
    const cLines = new THREE.LineSegments(cGeo, cMat); cLines.renderOrder = 4;
    cLines.computeLineDistances();
    projScene.add(cLines);
  }
}

// 中心线：优先用模型自带特征轴（圆柱/孔），否则取竖直对称中心线
function computeCenterLines(box) {
  const segs = [];
  const size = new THREE.Vector3(); box.getSize(size);
  const pad = Math.max(size.x, size.y, size.z) * 0.08;

  const def = MODELS[state.currentModel];
  const axes = def && def.centerAxes;
  if (axes && axes.length) {
    axes.forEach(ax => {
      const a = new THREE.Vector3(ax.from[0], ax.from[1], ax.from[2]);
      const b = new THREE.Vector3(ax.to[0], ax.to[1], ax.to[2]);
      const d = new THREE.Vector3().subVectors(b, a).normalize().multiplyScalar(pad);
      segs.push([a.clone().sub(d), b.clone().add(d)]);
    });
    return segs;
  }
  // 默认竖直对称中心线（多数模型关于 x=0 对称）
  segs.push([
    new THREE.Vector3(0, box.min.y - pad, 0),
    new THREE.Vector3(0, box.max.y + pad, 0)
  ]);
  return segs;
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
  const dist = Math.max(fullSize.x, fullSize.y, fullSize.z, S) * 2 + 4;  // 仅影响裁剪

  // 各视图的取景半宽与“看向点”（其余轴用整体模型中心保证完整入框）
  let frames;
  if (focusBox) {
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
      front: { half, look: new THREE.Vector3(0, fcY, fc.z) },
      top:   { half, look: new THREE.Vector3(0, fc.y, 0) },
      side:  { half, look: new THREE.Vector3(fc.x, fcY, 0) }
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
    cam.left = -f.half; cam.right = f.half; cam.top = f.half; cam.bottom = -f.half;
    cam.near = 0.01; cam.far = dist * 2;
    cam.up.copy(cfg.up);
    cam.position.copy(f.look).addScaledVector(cfg.eye, dist);
    cam.lookAt(f.look);
    cam.updateProjectionMatrix();

    renderer.setRenderTarget(projTargets[view]);
    renderer.render(projScene, cam);
  });

  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
}

function drawProjections() {
  buildProjScene();
  renderProjViews();
}

// ===== 局部三视图：点选构件聚焦 =====
function updateFocusMarker() {
  clearGroup(focusGroup);
  if (!focusBox) return;
  const helper = new THREE.Box3Helper(focusBox, new THREE.Color(0xf0b454));
  if (helper.material) { helper.material.transparent = true; helper.material.opacity = 0.9; helper.material.depthTest = false; }
  helper.renderOrder = 5;
  focusGroup.add(helper);
}

function setFocusAtPoint(p) {
  const box = getModelBounds();
  const size = new THREE.Vector3(); box.getSize(size);
  const ext = Math.max(size.x, size.y, size.z) || 1;
  const h = ext * 0.2;
  focusBox = new THREE.Box3(
    new THREE.Vector3(p.x - h, p.y - h, p.z - h),
    new THREE.Vector3(p.x + h, p.y + h, p.z + h)
  );
  updateFocusMarker();
  drawProjections();
  setStatus(`局部三视图：已对聚焦区域出图（黄框）。点击空白处恢复整体三视图。`);
}

function clearFocus(announce) {
  if (!focusBox && !announce) return;
  focusBox = null;
  updateFocusMarker();
  drawProjections();
  if (announce) setStatus('已恢复整体三视图。提示：点击模型上任意构件，可对其局部出三视图。');
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
    if (state.mode === 'quiz') return;
    const rect = dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(modelGroup.children, true);
    if (hits.length) setFocusAtPoint(hits[0].point);
    else clearFocus(true);
  });
}

function getModelBounds() {
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (!Number.isFinite(box.min.x)) box.set(new THREE.Vector3(-2, 0, -1.5), new THREE.Vector3(2, 2, 1.5));
  return box;
}

function updateUnfold(t) {
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
  points.forEach(p => {
    addDashedLine(p, new THREE.Vector3(p.x, p.y, layout.backZ), lineMat);
    addDashedLine(p, new THREE.Vector3(p.x, -layout.gap, p.z), lineMat);
    addDashedLine(p, new THREE.Vector3(layout.sideX, p.y, p.z), lineMat);
  });
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
  const grid = new THREE.GridHelper(9.5, 19, 0x3d5665, 0x263848);
  grid.position.y = -state.planeGap;
  grid.material.transparent = true; grid.material.opacity = 0.38;
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
  const axes = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xff5f5f, label: 'X' },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x76e090, label: 'Y' },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x5d9cff, label: 'Z' }
  ];
  axes.forEach(a => {
    const arrow = new THREE.ArrowHelper(a.dir, new THREE.Vector3(-3.9, -state.planeGap, -3.6), 1.35, a.color, 0.18, 0.09);
    axesGroup.add(arrow);
    addAxisLabel(a.label, a.color, new THREE.Vector3(-3.9, -state.planeGap, -3.6).add(a.dir.clone().multiplyScalar(1.55)));
  });
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
  clearGroup(modelGroup);
  focusBox = null; clearGroup(focusGroup);   // 换模型时复位局部聚焦
  const isImported = state.currentModel === 'imported' && state.importedGeometry;
  const def = isImported ? null : (MODELS[state.currentModel] || MODELS.step);
  let model, statusText;

  if (isImported) {
    model = buildImportedModel();
    statusText = `已导入 ${state.importedName || '模型'}：自动居中缩放，三视图投影（含消隐虚线）已就绪。`;
  } else {
    model = def.build();
    statusText = `${def.name}：${def.note}`;
  }

  modelGroup.add(model);
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
    child.material.transparent = state.transparentModel;
    child.material.opacity = state.transparentModel ? 0.54 : 1;
    child.material.depthWrite = !state.transparentModel;
  });
}

// ===== UI绑定（手机/PC共享状态）=====
let modelButtons = [];

function bindModelButtons() {
  modelButtons = Array.from(document.querySelectorAll('.model-btn'));
  modelButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modelButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (btn.dataset.url) {
        loadAssetFromUrl(btn.dataset.url, btn.dataset.name || btn.textContent.trim(), btn.dataset.zup === '1');
      } else {
        state.currentModel = btn.dataset.model;
        rebuildModel();
      }
    });
  });
}

const objLoader = new OBJLoader();
const stlLoader = new STLLoader();
const gltfLoader = new GLTFLoader();

// 按扩展名解析为统一几何（OBJ / STL / GLB / GLTF），ext 可省略由 url/name 推断
async function parseModelData(data, ext) {
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
  throw new Error('仅支持 OBJ / STL / GLB / GLTF。');
}

// 加载内置/网络桥梁资产；zUp=true 时绕 X 校正为 y-up（工程/CAD 资产多为 z 轴向上）
async function loadAssetFromUrl(url, name, zUp) {
  try {
    setStatus(`正在加载资产 ${name}…`);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const ext = (url.split('.').pop() || '').toLowerCase();
    const data = (ext === 'obj') ? await res.text() : await res.arrayBuffer();
    const geom = await parseModelData(data, ext);
    if (!geom) throw new Error('未找到可显示的网格。');
    if (zUp) { geom.rotateX(-Math.PI / 2); geom.computeVertexNormals(); }
    state.importedGeometry = geom;
    state.importedName = name;
    state.currentModel = 'imported';
    rebuildModel();
    const tris = Math.round(geom.attributes.position.count / 3);
    setStatus(`已加载桥梁资产 ${name}（约 ${tris} 个三角面${zUp ? '，已校正 Z→Y 轴向' : ''}，已居中缩放，三视图已生成）。`);
  } catch (e) {
    console.error(e);
    setStatus(`资产加载失败：${e.message || e}`);
  }
}

async function handleFileSelect(file, statusEl) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    if (statusEl) statusEl.innerHTML = `正在读取 <strong>${file.name}</strong>…`;
    const data = (ext === 'obj') ? await file.text() : await file.arrayBuffer();
    const geom = await parseModelData(data, ext);
    if (!geom) throw new Error('未找到可显示的网格。');
    state.importedGeometry = geom;
    state.importedName = file.name;
    state.currentModel = 'imported';
    modelButtons.forEach(b => b.classList.remove('active'));
    rebuildModel();
    const tris = Math.round((geom.index ? geom.index.count : geom.attributes.position.count) / 3);
    if (statusEl) statusEl.innerHTML = `已导入 <strong>${file.name}</strong>（约 ${tris} 个三角面）。`;
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
    const target = state.isUnfolded ? 0 : 1;
    state.transitionActive = true;
    state.transitionFrom = state.unfoldProgress;
    state.transitionTo = target;
    state.transitionStart = performance.now();
    state.isUnfolded = target === 1;
    const text = state.isUnfolded ? '合并三视图' : '展开三视图';
    [unfoldBtn, unfoldBtnM, unfoldFab].forEach(btn => {
      if (!btn) return;
      btn.textContent = text;
      btn.setAttribute('aria-pressed', String(state.isUnfolded));
    });
  };
  unfoldBtn?.addEventListener('click', toggleUnfold);
  unfoldBtnM?.addEventListener('click', toggleUnfold);
  unfoldFab?.addEventListener('click', toggleUnfold);

  setupToggle('tog-projlines', 'showProjLines', () => updateUnfold(state.unfoldProgress), 'tog-projlines-m');
  setupToggle('tog-hidden', 'showHidden', () => drawProjections(), 'tog-hidden-m');
  setupToggle('tog-axes', 'showAxes', () => { axesGroup.visible = state.showAxes; }, 'tog-axes-m');
  setupToggle('tog-transparent', 'transparentModel', updateModelTransparency, 'tog-transparent-m');

  // 唯一参数：模型与三个投影面的统一距离（增大则三面一起外推，避免模型遮挡投影）
  bindSlider('plane-gap', 'plane-gap-val', 'plane-gap-m', 'plane-gap-val-m', 'planeGap',
    (v) => v.toFixed(1), applyClearance);

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); toggleUnfold(); }
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

// ===== 空间智能测评：由一个视图逐步收缩候选 =====
const QUIZ_STEPS = [
  {
    views: ['front'],
    question: '只看正面图：哪些实体可能成立？',
    feedback: '一个矩形正面图还不够：圆柱侧放、方柱、三角板侧视都可能混淆。',
    possible: ['cylinder', 'rect', 'tri']
  },
  {
    views: ['front', 'top'],
    question: '加入俯视图后：哪些候选还可能成立？',
    feedback: '俯视图给出了深度信息，三角板被排除，但圆柱侧放和方柱仍可能看起来相似。',
    possible: ['cylinder', 'rect']
  },
  {
    views: ['front', 'top', 'side'],
    question: '再加入侧面图：唯一成立的是哪一个？',
    feedback: '三个视图合起来，圆柱的圆/曲面特征不匹配，答案收缩为方柱 / 长方体。',
    possible: ['rect']
  }
];

const QUIZ_LABELS = {
  cylinder: '圆柱体',
  rect: '方柱 / 长方体',
  tri: '三角板',
  sphere: '球体'
};

let quizStep = 0;

function renderQuizStep() {
  const step = QUIZ_STEPS[quizStep];
  const question = document.getElementById('quiz-question-text');
  const feedback = document.getElementById('quiz-feedback');
  const pill = document.getElementById('quiz-stage-pill');
  const progress = document.getElementById('quiz-progress-fill');
  const next = document.getElementById('quiz-next-view');
  question.textContent = step.question;
  feedback.textContent = step.feedback;
  pill.textContent = `第 ${quizStep + 1} / ${QUIZ_STEPS.length} 步`;
  progress.style.width = `${((quizStep + 1) / QUIZ_STEPS.length) * 100}%`;
  next.textContent = quizStep === QUIZ_STEPS.length - 1 ? '已经唯一' : '给出下一个视图';
  next.disabled = quizStep === QUIZ_STEPS.length - 1;

  ['front', 'top', 'side'].forEach(view => {
    const tag = document.getElementById(`quiz-tag-${view}`);
    const card = document.getElementById(`quiz-view-${view}`);
    tag?.classList.toggle('on', step.views.includes(view));
    card?.classList.toggle('revealed', step.views.includes(view));
  });

  document.querySelectorAll('.quiz-option[data-answer]').forEach(btn => {
    const ok = step.possible.includes(btn.dataset.answer);
    btn.classList.toggle('correct', ok);
    btn.classList.toggle('disabled', !ok);
    btn.setAttribute('aria-disabled', String(!ok));
  });
}

function bindQuizUI() {
  const modeTabs = Array.from(document.querySelectorAll('.mode-tab'));
  const quizOverlay = document.getElementById('quiz-overlay');
  modeTabs.forEach(t => {
    t.addEventListener('click', () => {
      modeTabs.forEach(x => x.classList.toggle('active', x === t));
      modeTabs.forEach(x => x.setAttribute('aria-selected', x === t ? 'true' : 'false'));
      state.mode = t.dataset.mode;
      if (state.mode === 'quiz') {
        quizOverlay.style.display = 'block';
        quizOverlay.setAttribute('aria-hidden', 'false');
        hudMode.textContent = '空间测评 · 三视图递进推理';
        quizStep = 0;
        renderQuizStep();
        setStatus('测评模式：先给一个视图，再逐步增加视图，观察候选实体如何收缩。');
      } else {
        quizOverlay.style.display = 'none';
        quizOverlay.setAttribute('aria-hidden', 'true');
        hudMode.textContent = '三维透视 · 第一角';
      }
    });
  });

  document.getElementById('quiz-close')?.addEventListener('click', () => {
    modeTabs.find(t => t.dataset.mode === 'explore')?.click();
  });

  document.getElementById('quiz-reset')?.addEventListener('click', () => {
    quizStep = 0;
    renderQuizStep();
  });

  document.getElementById('quiz-next-view')?.addEventListener('click', () => {
    if (quizStep < QUIZ_STEPS.length - 1) {
      quizStep += 1;
      renderQuizStep();
    }
  });

  document.querySelectorAll('.quiz-option[data-answer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const step = QUIZ_STEPS[quizStep];
      const answer = btn.dataset.answer;
      const label = QUIZ_LABELS[answer] || btn.textContent.trim();
      const feedback = document.getElementById('quiz-feedback');
      if (step.possible.includes(answer)) {
        feedback.textContent = quizStep === QUIZ_STEPS.length - 1
          ? `${label} 是最终唯一答案。三视图共同约束了长、宽、高和特征形状。`
          : `${label} 目前仍可能成立。继续给出下一个视图，候选会进一步减少。`;
      } else {
        feedback.textContent = `${label} 已被当前视图条件排除。注意比较轮廓、深度和曲面/斜面特征。`;
      }
    });
  });

  renderQuizStep();
}

// ===== 主循环 =====
function onResize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
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
  renderer.render(scene, camera);
}

// ===== 启动 =====
window.addEventListener('resize', onResize);

bindModelButtons();
bindObjImport();
bindControls();
bindMobileUI();
bindQuizUI();
bindFocusPicking();

onResize();
rebuildModel();
animate();

setStatus('v7：仿 CAD 工作台 — 正交三视图（含中心线/消隐）、桥梁参数化模型与 OBJ 资产导入；点击模型上的构件可对局部出三视图。');
