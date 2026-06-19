import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const viewport = document.getElementById('viewport');
const statusStrip = document.getElementById('status-strip');
const objLoader = new OBJLoader();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101723);
scene.fog = new THREE.Fog(0x101723, 18, 42);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(8.4, 6.6, 10.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 1.45, 0);

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
  importedObjText: null,
  importedName: ''
};

const modelGroup = new THREE.Group();
const projectionGroup = new THREE.Group();
const axesGroup = new THREE.Group();
const projLinesGroup = new THREE.Group();
const floorGroup = new THREE.Group();
scene.add(floorGroup, projectionGroup, modelGroup, axesGroup, projLinesGroup);

const COL = {
  cyan: 0x62d7e8,
  amber: 0xf2b84b,
  green: 0x83d17b,
  coral: 0xf07864,
  violet: 0xa78bfa,
  blue: 0x5db7f0,
  steel: 0x8fa9b8,
  dark: 0x172233,
  edge: 0xe9f7fb,
  hidden: 0xaab7c2
};

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
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addCylinder(group, name, x, y, z, radius, height, color, segments = 48) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, segments),
    makeMat(color)
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addCylinderX(group, name, x, y, z, radius, length, color, segments = 48) {
  const mesh = addCylinder(group, name, x, y, z, radius, length, color, segments);
  mesh.rotation.z = Math.PI / 2;
  return mesh;
}

function addCylinderZ(group, name, x, y, z, radius, length, color, segments = 48) {
  const mesh = addCylinder(group, name, x, y, z, radius, length, color, segments);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function addTorusX(group, name, x, y, z, radius, tube, color) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 18, 72),
    makeMat(color, { roughness: 0.42 })
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addTriPrism(group, name, color, points, depth, x = 0, y = 0, z = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(p => shape.lineTo(p[0], p[1]));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.center();
  const mesh = new THREE.Mesh(geo, makeMat(color));
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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

const MODELS = {
  step: {
    name: '叠加台阶块',
    note: '由长方体逐层叠加形成，适合训练长对正、宽相等、高平齐。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'lower_block', 0, 0.35, 0, 4.4, 0.7, 2.8, COL.blue);
      addBox(g, 'middle_block', -0.55, 1.05, 0, 3.25, 0.7, 2.8, 0x40aee6);
      addBox(g, 'top_block', -1.15, 1.75, 0, 2.05, 0.7, 2.8, 0x2389c8);
      return g;
    }
  },

  slottedBlock: {
    name: '开槽垫块',
    note: '从长方体中切出矩形通槽，内轮廓和不可见边在三视图中很典型。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'slot_base', 0, 0.28, 0, 4.4, 0.56, 2.8, COL.green);
      addBox(g, 'left_rail', 0, 0.9, -0.92, 4.4, 0.8, 0.66, 0x67bf70);
      addBox(g, 'right_rail', 0, 0.9, 0.92, 4.4, 0.8, 0.66, 0x52ab5d);
      addBox(g, 'end_stop', -1.65, 0.9, 0, 0.62, 0.8, 2.8, 0x489c53);
      return g;
    }
  },

  notchedBlock: {
    name: '缺口切割块',
    note: '长方体角部被切除，正视和侧视会出现局部台阶轮廓。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'main_body', -0.32, 0.78, 0, 3.7, 1.56, 2.8, COL.coral);
      addBox(g, 'remaining_front_step', 1.72, 0.39, 0.72, 0.72, 0.78, 1.36, 0xe66b58);
      addBox(g, 'remaining_top_step', 1.72, 1.17, -0.38, 0.72, 0.78, 2.04, 0xc95b4a);
      return g;
    }
  },

  ribBracket: {
    name: '肋板支架',
    note: '底板、立板和三角肋板组合，是组合体形体分析中的常见支架。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'base_plate', 0, 0.25, 0, 4.5, 0.5, 2.8, COL.steel);
      addBox(g, 'vertical_plate', -1.25, 1.25, 0, 0.55, 2.0, 2.45, 0x7897aa);
      addBox(g, 'top_boss', -1.25, 2.42, 0, 1.2, 0.38, 1.45, 0x66869b);
      addTriPrism(g, 'front_rib', 0x8eaabc, [[-0.95, -0.9], [0.95, -0.9], [-0.95, 0.95]], 0.28, -0.4, 0.98, 0.82);
      addTriPrism(g, 'back_rib', 0x8eaabc, [[-0.95, -0.9], [0.95, -0.9], [-0.95, 0.95]], 0.28, -0.4, 0.98, -0.82);
      return g;
    }
  },

  bearingSeat: {
    name: '轴承座',
    note: '由底板、支承板、圆柱筒和肋板组成，最接近机械制图里的典型组合体。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'bearing_base', 0, 0.25, 0, 4.8, 0.5, 2.9, 0x8197a5);
      addBox(g, 'left_support_plate', -0.95, 1.05, 0, 0.45, 1.6, 2.2, 0x6f8998);
      addBox(g, 'right_support_plate', 0.95, 1.05, 0, 0.45, 1.6, 2.2, 0x6f8998);
      addCylinderX(g, 'bearing_barrel', 0, 1.92, 0, 0.82, 2.45, COL.amber, 64);
      addTorusX(g, 'bearing_hole_rim', 0, 1.92, 0, 0.45, 0.055, 0x273646);
      addTriPrism(g, 'front_web_rib', 0x95aab8, [[-0.75, -0.8], [0.75, -0.8], [0, 0.8]], 0.26, 0, 0.92, 0.9);
      addTriPrism(g, 'back_web_rib', 0x95aab8, [[-0.75, -0.8], [0.75, -0.8], [0, 0.8]], 0.26, 0, 0.92, -0.9);
      [-1.75, 1.75].forEach(x => addCylinder(g, 'bolt_boss', x, 0.62, 0.92, 0.28, 0.24, 0x9fb0ba, 32));
      [-1.75, 1.75].forEach(x => addCylinder(g, 'bolt_boss', x, 0.62, -0.92, 0.28, 0.24, 0x9fb0ba, 32));
      return g;
    }
  },

  dovetailSlide: {
    name: '燕尾槽滑块',
    note: '滑块中的燕尾槽由斜面切割形成，能训练斜线投影和槽口识读。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'slide_base', 0, 0.35, 0, 4.4, 0.7, 2.7, COL.violet);
      addBox(g, 'upper_land_left', -1.32, 1.0, 0, 1.05, 0.6, 2.7, 0x9279e0);
      addBox(g, 'upper_land_right', 1.32, 1.0, 0, 1.05, 0.6, 2.7, 0x9279e0);
      addTriPrism(g, 'left_dovetail_slope', 0xb69af6, [[-0.55, -0.42], [0.55, -0.42], [0.15, 0.42], [-0.55, 0.42]], 2.7, -0.45, 0.95, 0);
      addTriPrism(g, 'right_dovetail_slope', 0x8068cb, [[-0.55, -0.42], [0.55, -0.42], [0.55, 0.42], [-0.15, 0.42]], 2.7, 0.45, 0.95, 0);
      return g;
    }
  },

  vBlock: {
    name: 'V 形定位块',
    note: 'V 形槽常用于圆柱定位，斜面和对称中心线在三视图中非常典型。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'v_base', 0, 0.35, 0, 4.2, 0.7, 2.8, 0x4fb3cf);
      addTriPrism(g, 'left_v_face', 0x62d7e8, [[-0.95, -0.48], [0.55, -0.48], [-0.95, 0.48]], 2.8, -0.45, 1.05, 0);
      addTriPrism(g, 'right_v_face', 0x3aa8c7, [[-0.55, -0.48], [0.95, -0.48], [0.95, 0.48]], 2.8, 0.45, 1.05, 0);
      addCylinderZ(g, 'reference_cylinder', 0, 1.58, 0, 0.34, 2.45, 0xf2b84b, 48);
      return g;
    }
  },

  compoundSeat: {
    name: '综合支座',
    note: '底板、凸台、立柱、槽口和圆柱面混合，用于综合读图训练。',
    build() {
      const g = new THREE.Group();
      addBox(g, 'compound_base', 0, 0.25, 0, 4.7, 0.5, 2.9, 0x78a079);
      addBox(g, 'compound_rear_wall', -1.35, 1.05, -0.55, 0.65, 1.6, 1.8, 0x608d63);
      addBox(g, 'compound_side_pad', 0.85, 0.92, 0.55, 1.7, 0.84, 1.55, 0x6fa871);
      addCylinder(g, 'vertical_boss', 0.85, 1.66, 0.55, 0.58, 0.65, 0x8fcf88, 48);
      addBox(g, 'slot_left_cheek', -0.2, 0.92, -0.88, 1.4, 0.84, 0.38, 0x78b179);
      addBox(g, 'slot_right_cheek', -0.2, 0.92, -0.2, 1.4, 0.84, 0.38, 0x78b179);
      addTriPrism(g, 'compound_rib', 0x9bc49a, [[-0.7, -0.65], [0.7, -0.65], [-0.7, 0.65]], 0.36, -0.55, 0.9, 0.55);
      return g;
    }
  }
};

const projPlanes = { front: null, top: null, side: null };
const projTextures = { front: null, top: null, side: null };
const projCanvases = { front: null, top: null, side: null };

function getPlaneLayout(t = state.unfoldProgress) {
  const S = state.planeSize;
  const gap = state.planeGap;
  const backZ = -S / 2;
  const sideX = S / 2;
  const frontCenter = new THREE.Vector3(0, S / 2 - gap, backZ);

  const topClosed = new THREE.Vector3(0, -gap, 0);
  const topOpen = new THREE.Vector3(0, -gap - S / 2, backZ);
  const sideClosed = new THREE.Vector3(sideX, S / 2 - gap, 0);
  const sideOpen = new THREE.Vector3(sideX + S / 2, S / 2 - gap, backZ);

  return {
    S,
    gap,
    backZ,
    sideX,
    front: { pos: frontCenter, rot: new THREE.Euler(0, 0, 0) },
    top: {
      pos: topClosed.clone().lerp(topOpen, t),
      rot: new THREE.Euler(-Math.PI / 2 + t * Math.PI / 2, 0, 0)
    },
    side: {
      pos: sideClosed.clone().lerp(sideOpen, t),
      rot: new THREE.Euler(0, Math.PI / 2 - t * Math.PI / 2, 0)
    }
  };
}

function createCanvasTexture(view) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 720;
  projCanvases[view] = canvas;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  projTextures[view] = texture;
  return texture;
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

function createProjectionPlanes() {
  clearGroup(projectionGroup);
  clearGroup(projLinesGroup);

  const S = state.planeSize;
  const layout = getPlaneLayout();

  const frontGeo = new THREE.PlaneGeometry(S, S);
  projPlanes.front = new THREE.Mesh(frontGeo, makeProjectionMaterial('front'));
  projPlanes.front.position.copy(layout.front.pos);
  projectionGroup.add(projPlanes.front);

  const topGeo = new THREE.PlaneGeometry(S, S);
  projPlanes.top = new THREE.Mesh(topGeo, makeProjectionMaterial('top'));
  projectionGroup.add(projPlanes.top);

  const sideGeo = new THREE.PlaneGeometry(S, S);
  projPlanes.side = new THREE.Mesh(sideGeo, makeProjectionMaterial('side'));
  projectionGroup.add(projPlanes.side);

  const borderMat = new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.62 });
  Object.entries(projPlanes).forEach(([view, plane]) => {
    plane.renderOrder = 1;
    const edges = new THREE.EdgesGeometry(plane.geometry);
    const border = new THREE.LineSegments(edges, borderMat.clone());
    border.name = `${view}_border`;
    plane.add(border);
  });

  drawProjections();
  updateUnfold(state.unfoldProgress);
}

function addPlaneLabel(plane, text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 84;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '700 30px Microsoft YaHei, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 160, 42);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(1.55, 0.42, 1);
  sprite.position.set(0, state.planeSize / 2 - 0.28, 0.02);
  plane.add(sprite);
}

function drawProjections() {
  const edges = getModelEdges();
  const bounds = getModelBounds();

  ['front', 'top', 'side'].forEach(view => {
    const canvas = projCanvases[view];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const S = state.planeSize;
    const scale = W / S;
    const bgAlpha = Math.min(0.42, state.planeAlpha * 1.85);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = `rgba(20, 32, 47, ${bgAlpha})`;
    ctx.fillRect(0, 0, W, H);

    drawGrid(ctx, W, H);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#e9f7fb';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    edges.forEach(([a, b]) => {
      const pa = projectPoint(a, view, W, H, scale, bounds);
      const pb = projectPoint(b, view, W, H, scale, bounds);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    });
    ctx.stroke();
    ctx.restore();

    if (state.showHidden) drawHiddenHints(ctx, view, W, H, scale, bounds);

    drawFeaturePoints(ctx, view, W, H, scale, bounds, edges);
    projTextures[view].needsUpdate = true;
  });
}

function drawGrid(ctx, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(98,215,232,.10)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 12; i++) {
    const p = (i / 12) * W;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(W, p); ctx.stroke();
  }
  ctx.restore();
}

function drawHiddenHints(ctx, view, W, H, scale, bounds) {
  const cx = W / 2;
  const cy = H / 2;
  ctx.save();
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = 'rgba(233,247,251,.38)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx - 44, cy);
  ctx.lineTo(cx + 44, cy);
  ctx.moveTo(cx, cy - 44);
  ctx.lineTo(cx, cy + 44);
  ctx.stroke();

  const model = modelGroup.children[0];
  if (model && (state.currentModel === 'ugroove' || state.currentModel === 'notch')) {
    const p1 = projectPoint(new THREE.Vector3(bounds.min.x + 0.45, bounds.max.y * 0.55, bounds.min.z + 0.45), view, W, H, scale, bounds);
    const p2 = projectPoint(new THREE.Vector3(bounds.max.x - 0.45, bounds.max.y * 0.55, bounds.min.z + 0.45), view, W, H, scale, bounds);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFeaturePoints(ctx, view, W, H, scale, bounds, edges) {
  const pts = collectUniqueVertices(edges).slice(0, 34);
  ctx.save();
  ctx.fillStyle = '#f7d56e';
  ctx.strokeStyle = 'rgba(16,23,35,.9)';
  ctx.lineWidth = 2;
  pts.forEach(p => {
    const pp = projectPoint(p, view, W, H, scale, bounds);
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

function projectPoint(point, view, W, H, scale, bounds) {
  const cx = W / 2;
  const cy = H / 2;
  const S = state.planeSize;
  const frontCenterY = S / 2 - state.planeGap;

  if (view === 'front') {
    const localX = point.x;
    const localY = point.y - frontCenterY;
    return { x: cx + localX * scale, y: cy - localY * scale };
  }

  if (view === 'top') {
    const localX = point.x;
    const localY = -point.z;
    return { x: cx + localX * scale, y: cy - localY * scale };
  }

  const localX = -point.z;
  const localY = point.y - frontCenterY;
  return { x: cx + localX * scale, y: cy - localY * scale };
}

function getModelBounds() {
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (!Number.isFinite(box.min.x)) box.set(new THREE.Vector3(-2, 0, -1.5), new THREE.Vector3(2, 2, 1.5));
  return box;
}

function getModelEdges() {
  modelGroup.updateMatrixWorld(true);
  const edges = [];
  modelGroup.traverse(child => {
    if (!child.isMesh || child.userData.ignoreProjection) return;
    const edgeGeo = new THREE.EdgesGeometry(child.geometry, 12);
    const pos = edgeGeo.attributes.position;
    for (let i = 0; i < pos.count; i += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(child.matrixWorld);
      edges.push([a, b]);
    }
    edgeGeo.dispose();
  });
  return edges;
}

function collectUniqueVertices(edges) {
  const seen = new Set();
  const pts = [];
  edges.forEach(([a, b]) => {
    [a, b].forEach(p => {
      const key = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
      if (!seen.has(key)) {
        seen.add(key);
        pts.push(p.clone());
      }
    });
  });
  return pts;
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
  const edges = getModelEdges();
  const points = collectUniqueVertices(edges).slice(0, 18);
  const lineMat = new THREE.LineDashedMaterial({
    color: COL.amber,
    transparent: true,
    opacity: 0.45 * (1 - t * 0.65),
    dashSize: 0.1,
    gapSize: 0.08
  });

  points.forEach(p => {
    addDashedLine(p, new THREE.Vector3(p.x, p.y, layout.backZ), lineMat);
    addDashedLine(p, new THREE.Vector3(p.x, -layout.gap, p.z), lineMat);
    addDashedLine(p, new THREE.Vector3(layout.sideX, p.y, p.z), lineMat);
  });
}

function addDashedLine(from, to, mat) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, mat.clone());
  line.computeLineDistances();
  projLinesGroup.add(line);
}

function buildFloorReference() {
  clearGroup(floorGroup);
  const grid = new THREE.GridHelper(9.5, 19, 0x3d5665, 0x263848);
  grid.position.y = -state.planeGap;
  grid.material.transparent = true;
  grid.material.opacity = 0.38;
  floorGroup.add(grid);

  const hingeMat = new THREE.LineBasicMaterial({ color: COL.cyan, transparent: true, opacity: 0.62 });
  const S = state.planeSize;
  const z = -S / 2;
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-S / 2, -state.planeGap, z),
    new THREE.Vector3(S / 2, -state.planeGap, z)
  ]);
  floorGroup.add(new THREE.Line(geo, hingeMat));
}

function buildAxes() {
  clearGroup(axesGroup);
  const axes = [
    { dir: new THREE.Vector3(1, 0, 0), color: 0xff5f5f, label: 'X' },
    { dir: new THREE.Vector3(0, 1, 0), color: 0x76e090, label: 'Y' },
    { dir: new THREE.Vector3(0, 0, 1), color: 0x5d9cff, label: 'Z' }
  ];
  axes.forEach(axis => {
    const arrow = new THREE.ArrowHelper(axis.dir, new THREE.Vector3(-3.9, -state.planeGap, -3.6), 1.35, axis.color, 0.18, 0.09);
    axesGroup.add(arrow);
    addAxisLabel(axis.label, axis.color, new THREE.Vector3(-3.9, -state.planeGap, -3.6).add(axis.dir.clone().multiplyScalar(1.55)));
  });
  axesGroup.visible = state.showAxes;
}

function addAxisLabel(text, color, position) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 54px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 48, 52);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.position.copy(position);
  sprite.scale.set(0.35, 0.35, 0.35);
  axesGroup.add(sprite);
}

function countMeshes(group) {
  let count = 0;
  group.traverse(child => {
    if (child.isMesh) count += 1;
  });
  return count;
}

function normalizeImportedModel(group) {
  group.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(group);
  if (!Number.isFinite(box.min.x)) throw new Error('OBJ 中没有可显示的网格。');

  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim < 1e-6) throw new Error('OBJ 模型尺寸过小或无有效几何。');

  const targetSize = Math.min(state.planeSize * 0.56, 4.6);
  const scale = targetSize / maxDim;
  group.scale.multiplyScalar(scale);
  group.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(group);
  const center = new THREE.Vector3();
  box.getCenter(center);
  group.position.x -= center.x;
  group.position.z -= center.z;
  group.position.y -= box.min.y;
  group.updateMatrixWorld(true);
}

function buildImportedModel() {
  if (!state.importedObjText) return null;
  const group = objLoader.parse(state.importedObjText);
  group.name = 'imported_obj_model';
  group.traverse(child => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (child.geometry && !child.geometry.attributes.normal) child.geometry.computeVertexNormals();
    child.material = makeMat(0x80c7e8, { roughness: 0.5, metalness: 0.03 });
  });
  if (countMeshes(group) === 0) throw new Error('OBJ 中没有可显示的 mesh。');
  normalizeImportedModel(group);
  return group;
}

function rebuildModel() {
  clearGroup(modelGroup);
  const isImported = state.currentModel === 'imported' && state.importedObjText;
  const modelDef = isImported ? null : (MODELS[state.currentModel] || MODELS.step);
  let model;
  let statusText;

  if (isImported) {
    model = buildImportedModel();
    statusText = `已导入 ${state.importedName || 'OBJ 模型'}：模型已自动居中、缩放并参与三视图投影。`;
  } else {
    model = modelDef.build();
    statusText = `${modelDef.name}：${modelDef.note} H 水平投影面下移 ${state.planeGap.toFixed(1)}，底面关系更清楚。`;
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

function bindModelButtons() {
  document.querySelectorAll('.model-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentModel = btn.dataset.model;
      rebuildModel();
    });
  });
}

function bindObjImport() {
  const input = document.getElementById('obj-file');
  const button = document.getElementById('obj-import-btn');
  const status = document.getElementById('obj-status');
  if (!input || !button) return;

  button.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (status) status.innerHTML = `正在读取 <strong>${file.name}</strong> ...`;
      const text = await file.text();
      const probe = objLoader.parse(text);
      const meshCount = countMeshes(probe);
      clearGroup(probe);
      if (meshCount === 0) throw new Error('OBJ 中没有可显示的网格。');

      state.importedObjText = text;
      state.importedName = file.name;
      state.currentModel = 'imported';
      document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
      rebuildModel();
      if (status) status.innerHTML = `已导入 <strong>${file.name}</strong>，包含 ${meshCount} 个网格。`;
    } catch (err) {
      console.error(err);
      if (status) status.textContent = `导入失败：${err.message || err}`;
    } finally {
      input.value = '';
    }
  });
}

function setupToggle(id, key, onChange) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', () => {
    state[key] = !state[key];
    el.classList.toggle('on', state[key]);
    onChange?.();
  });
}

function bindControls() {
  const unfoldBtn = document.getElementById('unfold-btn');
  const mobileUnfoldBtn = document.getElementById('mobile-unfold-fab');

  function syncUnfoldButtons() {
    const text = state.isUnfolded ? '合并三视图' : '展开三视图';
    [unfoldBtn, mobileUnfoldBtn].forEach(btn => {
      if (!btn) return;
      btn.textContent = text;
      btn.setAttribute('aria-pressed', String(state.isUnfolded));
    });
  }

  function toggleUnfold() {
    const target = state.isUnfolded ? 0 : 1;
    state.transitionActive = true;
    state.transitionFrom = state.unfoldProgress;
    state.transitionTo = target;
    state.transitionStart = performance.now();
    state.isUnfolded = target === 1;
    syncUnfoldButtons();
  }

  unfoldBtn?.addEventListener('click', toggleUnfold);
  mobileUnfoldBtn?.addEventListener('click', toggleUnfold);
  syncUnfoldButtons();

  setupToggle('tog-projlines', 'showProjLines', () => updateUnfold(state.unfoldProgress));
  setupToggle('tog-hidden', 'showHidden', () => drawProjections());
  setupToggle('tog-axes', 'showAxes', () => { axesGroup.visible = state.showAxes; });
  setupToggle('tog-transparent', 'transparentModel', updateModelTransparency);

  const alphaSlider = document.getElementById('plane-alpha');
  const alphaVal = document.getElementById('plane-alpha-val');
  alphaSlider.addEventListener('input', () => {
    state.planeAlpha = Number(alphaSlider.value) / 100;
    alphaVal.textContent = state.planeAlpha.toFixed(2);
    createProjectionPlanes();
  });

  const sizeSlider = document.getElementById('plane-size');
  const sizeVal = document.getElementById('plane-size-val');
  sizeSlider.addEventListener('input', () => {
    state.planeSize = Number(sizeSlider.value);
    sizeVal.textContent = state.planeSize.toFixed(1).replace(/\.0$/, '');
    buildFloorReference();
    createProjectionPlanes();
  });

  const gapSlider = document.getElementById('plane-gap');
  const gapVal = document.getElementById('plane-gap-val');
  gapSlider.addEventListener('input', () => {
    state.planeGap = Number(gapSlider.value);
    gapVal.textContent = state.planeGap.toFixed(1);
    buildFloorReference();
    buildAxes();
    createProjectionPlanes();
    if (state.currentModel === 'imported' && state.importedObjText) {
      setStatus(`已导入 ${state.importedName || 'OBJ 模型'}：H 水平投影面下移 ${state.planeGap.toFixed(1)}，底面和投影面不再挤在一起。`);
    } else {
      const modelDef = MODELS[state.currentModel] || MODELS.step;
      setStatus(`${modelDef.name}：H 水平投影面下移 ${state.planeGap.toFixed(1)}，底面和投影面不再挤在一起。`);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.code === 'Space') {
      e.preventDefault();
      toggleUnfold();
    }
  });
}

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

window.addEventListener('resize', onResize);

bindModelButtons();
bindObjImport();
bindControls();
onResize();
rebuildModel();
animate();
