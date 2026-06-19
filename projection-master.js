import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

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
  planeGap: 1.4,
  importedGeometry: null,
  importedName: '',
  mode: 'explore'
};

const modelGroup = new THREE.Group();
const projectionGroup = new THREE.Group();
const axesGroup = new THREE.Group();
const projLinesGroup = new THREE.Group();
const floorGroup = new THREE.Group();
scene.add(floorGroup, projectionGroup, modelGroup, axesGroup, projLinesGroup);

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

// ===== 投影核心 =====
const projPlanes = { front: null, top: null, side: null };
const projTextures = { front: null, top: null, side: null };
const projCanvases = { front: null, top: null, side: null };
const DEPTH_RES = 512; // 消隐深度图分辨率

// 视图设置：第一角投影
const VIEW = {
  front: { dir: new THREE.Vector3(0, 0, 1), depth: (p) => p.z },
  top: { dir: new THREE.Vector3(0, 1, 0), depth: (p) => p.y },
  side: { dir: new THREE.Vector3(-1, 0, 0), depth: (p) => -p.x }
};
const FEATURE_ANGLE = THREE.MathUtils.degToRad(22); // 硬边阈值

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
  return new THREE.MeshBasicMaterial({
    map: createCanvasTexture(view),
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false
  });
}

function qp(p) { return `${Math.round(p.x*1000)},${Math.round(p.y*1000)},${Math.round(p.z*1000)}`; }

function buildProjectionMesh() {
  modelGroup.updateMatrixWorld(true);
  const tris = [];
  const edgeMap = new Map();

  modelGroup.traverse(child => {
    if (!child.isMesh) return;
    const g = child.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const mw = child.matrixWorld;
    const nTri = idx ? idx.count / 3 : pos.count / 3;
    for (let i = 0; i < nTri; i++) {
      const i0 = idx ? idx.getX(i*3) : i*3;
      const i1 = idx ? idx.getX(i*3+1) : i*3+1;
      const i2 = idx ? idx.getX(i*3+2) : i*3+2;
      const v0 = new THREE.Vector3().fromBufferAttribute(pos,i0).applyMatrix4(mw);
      const v1 = new THREE.Vector3().fromBufferAttribute(pos,i1).applyMatrix4(mw);
      const v2 = new THREE.Vector3().fromBufferAttribute(pos,i2).applyMatrix4(mw);
      const e01 = new THREE.Vector3().subVectors(v1,v0);
      const e12 = new THREE.Vector3().subVectors(v2,v1);
      const n = new THREE.Vector3().crossVectors(e01,e12).normalize();
      if (!Number.isFinite(n.x + n.y + n.z)) continue;
      const tri = { v0, v1, v2, n };
      tris.push(tri);
      [[v0,v1],[v1,v2],[v2,v0]].forEach(([a,b]) => {
        const ka = qp(a), kb = qp(b);
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const e = edgeMap.get(key) || { a, b, ns: [] };
        e.ns.push(n);
        edgeMap.set(key, e);
      });
    }
  });
  return { tris, edges: Array.from(edgeMap.values()) };
}

function shouldDrawEdge(e, viewDir) {
  if (e.ns.length !== 2) return true;
  const d0 = e.ns[0].dot(viewDir);
  const d1 = e.ns[1].dot(viewDir);
  if (d0 * d1 < 0) return true; // 轮廓边
  if (Math.abs(e.ns[0].angleTo(e.ns[1])) > FEATURE_ANGLE) return true; // 硬边
  return false;
}

function buildDepthBuffer(tris, view, W, H, scale, bounds, S) {
  const depth = VIEW[view].depth;
  const buf = new Float32Array(DEPTH_RES * DEPTH_RES);
  for (let i = 0; i < buf.length; i++) buf[i] = -Infinity;

  for (const t of tris) {
    const a = projectPoint(t.v0, view, W, H, scale, bounds, S);
    const b = projectPoint(t.v1, view, W, H, scale, bounds, S);
    const c = projectPoint(t.v2, view, W, H, scale, bounds, S);

    const sx = DEPTH_RES / W;
    const sy = DEPTH_RES / H;
    const ax = a.x * sx, ay = a.y * sy, ad = depth(t.v0);
    const bx = b.x * sx, by = b.y * sy, bd = depth(t.v1);
    const cx = c.x * sx, cy = c.y * sy, cd = depth(t.v2);

    let minx = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    let maxx = Math.min(DEPTH_RES - 1, Math.ceil(Math.max(ax, bx, cx)));
    let miny = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    let maxy = Math.min(DEPTH_RES - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) continue;
    const inv = 1 / area;

    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (cx - px) * (by - py)) * inv;
        const w1 = ((cx - px) * (ay - py) - (ax - px) * (cy - py)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const zd = w0 * ad + w1 * bd + w2 * cd;
        const idx = y * DEPTH_RES + x;
        if (zd > buf[idx]) buf[idx] = zd;
      }
    }
  }
  return buf;
}

function drawGrid(ctx, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(94,208,230,.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 12; i++) {
    const p = (i / 12) * W;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(W, p); ctx.stroke();
  }
  ctx.restore();
}

function drawCenterLine(ctx, view, W, H, scale, bounds, S, boundsBox) {
  const center = new THREE.Vector3(0, boundsBox.min.y + (boundsBox.max.y - boundsBox.min.y) / 2, 0);
  // 简单对称中心线（可选扩展）
  // 为避免过度绘制，本版仅在轴承座/通孔板等模型中画十字线示意
}

function projectPoint(p, view, W, H, scale, bounds, S) {
  const cx = W / 2, cy = H / 2;
  const frontCenterY = (S || state.planeSize) / 2 - state.planeGap;
  let localX, localY;
  if (view === 'front') { localX = p.x; localY = p.y - frontCenterY; }
  else if (view === 'top') { localX = p.x; localY = -p.z; }
  else { localX = p.z; localY = p.y - frontCenterY; } // 侧视：外翻后与世界z同向
  return { x: cx + localX * scale, y: cy - localY * scale };
}

function sampleEdgeVisibility(a, b, view, depthBuf, W, H, scale, bounds, S) {
  const N = 28;
  const depthFn = VIEW[view].depth;
  const sx = DEPTH_RES / W, sy = DEPTH_RES / H;
  const eps = Math.max(1e-3, (S || state.planeSize) * 0.012);

  let prevOk = null;
  const segments = [];
  let current = null;

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    const pd = projectPoint(p, view, W, H, scale, bounds, S);
    const xi = Math.max(0, Math.min(DEPTH_RES - 1, Math.round(pd.x * sx)));
    const yi = Math.max(0, Math.min(DEPTH_RES - 1, Math.round(pd.y * sy)));
    const zdepth = depthBuf[yi * DEPTH_RES + xi];
    const visible = (zdepth === -Infinity) || (depthFn(p) >= zdepth - eps);

    if (visible !== prevOk) {
      if (current) segments.push(current);
      current = { visible, pts: [pd] };
    } else {
      if (!current) current = { visible, pts: [pd] };
      else current.pts.push(pd);
    }
    prevOk = visible;
  }
  if (current) segments.push(current);
  return segments;
}

function drawProjections() {
  const { tris, edges } = buildProjectionMesh();
  const boundsBox = getModelBounds();

  ['front', 'top', 'side'].forEach(view => {
    const canvas = projCanvases[view];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const S = state.planeSize;
    const scale = W / S;
    const bgAlpha = Math.min(0.42, state.planeAlpha * 1.85);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(18, 28, 44, ${bgAlpha})`;
    ctx.fillRect(0, 0, W, H);
    drawGrid(ctx, W, H);

    const depthBuf = buildDepthBuffer(tris, view, W, H, scale, boundsBox, S);
    const viewDir = VIEW[view].dir.clone();

    const visibleRuns = [];
    const hiddenRuns = [];
    for (const e of edges) {
      if (!shouldDrawEdge(e, viewDir)) continue;
      const segs = sampleEdgeVisibility(e.a, e.b, view, depthBuf, W, H, scale, boundsBox, S);
      for (const s of segs) {
        if (s.pts.length < 2) continue;
        (s.visible ? visibleRuns : hiddenRuns).push(s.pts);
      }
    }

    // 虚线先画（在后面）
    if (state.showHidden) {
      ctx.save();
      ctx.setLineDash([11, 7]);
      ctx.strokeStyle = 'rgba(145,165,185,.85)';
      ctx.lineWidth = 2.0;
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      hiddenRuns.forEach(r => {
        ctx.moveTo(r[0].x, r[0].y);
        for (let i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
      });
      ctx.stroke();
      ctx.restore();
    }

    // 实线后画（在上面）
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#eaf6fb';
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    visibleRuns.forEach(r => {
      ctx.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) ctx.lineTo(r[i].x, r[i].y);
    });
    ctx.stroke();
    ctx.restore();

    // 可选：中心线（示例）
    if (state.showHidden) {
      ctx.save();
      ctx.setLineDash([16, 4, 3, 4]);
      ctx.strokeStyle = 'rgba(240,180,84,.65)';
      ctx.lineWidth = 1.5;
      ctx.restore();
    }

    projTextures[view].needsUpdate = true;
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
  buildFloorReference();
  buildAxes();
  createProjectionPlanes();
  setStatus(statusText);
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
      modelButtons.forEach(b => { if (b.dataset.model === btn.dataset.model) b.classList.add('active'); });
      state.currentModel = btn.dataset.model;
      rebuildModel();
    });
  });
}

const objLoader = new OBJLoader();
const stlLoader = new STLLoader();

async function handleFileSelect(file, statusEl) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    if (statusEl) statusEl.innerHTML = `正在读取 <strong>${file.name}</strong>…`;
    let parsed;
    if (ext === 'stl') {
      const buffer = await file.arrayBuffer();
      parsed = stlLoader.parse(buffer);
    } else if (ext === 'obj') {
      const text = await file.text();
      parsed = objLoader.parse(text);
    } else {
      throw new Error('仅支持 OBJ / STL。');
    }
    const geom = extractGeometryFromParsed(parsed);
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

  bindSlider('plane-alpha', 'plane-alpha-val', 'plane-alpha-m', 'plane-alpha-val-m', 'planeAlpha',
    (v) => (v/100).toFixed(2), createProjectionPlanes);
  bindSlider('plane-size', 'plane-size-val', 'plane-size-m', 'plane-size-val-m', 'planeSize',
    (v) => v.toFixed(1).replace(/\.0$/,''), () => { buildFloorReference(); createProjectionPlanes(); });
  bindSlider('plane-gap', 'plane-gap-val', 'plane-gap-m', 'plane-gap-val-m', 'planeGap',
    (v) => v.toFixed(1), () => { buildFloorReference(); buildAxes(); createProjectionPlanes(); });

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

onResize();
rebuildModel();
animate();

setStatus('v5：手机/PC 双适配、OBJ/STL 导入、消隐虚线、展开合并和三视图递进推理训练已就绪。');
