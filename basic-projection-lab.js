import {
  classifyLineLine,
  classifyLineProjection,
  classifyPlaneProjection,
  engineeringToWorld,
  pointInPlane,
  pointOnLine,
  projectPoint,
  projectPointFirstAngle
} from './basic-projection-math.js';
import {
  LAB_LESSONS,
  LINE_PRESETS,
  PLANE_PRESETS,
  PROJECTION_TYPES,
  RELATION_PRESETS,
  createLabState,
  getLabLesson,
  getLabQuestion
} from './basic-projection-lessons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWS = Object.freeze(['front', 'top', 'side']);
const VIEW_META_DEFAULTS = Object.freeze({
  front: 'V 面 x-z',
  top: 'H 面 x-y',
  side: 'W 面 y-z'
});
const TASK_TITLES = Object.freeze({
  projection: '先观察投射线',
  point: '先判断坐标对应',
  line: '比较投影与实长',
  plane: '比较投影与实形',
  relation: '综合三个视图判断'
});
const POINT_VARIANTS = Object.freeze([
  Object.freeze({ x: 1.35, y: 0.85, z: 1.25 }),
  Object.freeze({ x: 0.8, y: 1.45, z: 0.65 }),
  Object.freeze({ x: 0.45, y: 0.65, z: 1.75 })
]);

const COLORS = Object.freeze({
  object: 0x1769aa,
  objectDark: 0x24435d,
  evidence: 0xd89b2b,
  guide: 0x77a8ba,
  guideSoft: 0xa7bbc8,
  plane: 0x8fb7cf,
  secondary: 0xc1664d,
  point: 0xd89b2b
});

const FRAME = Object.freeze({
  frontY: 0,
  topZ: 0,
  sideX: 0
});

function cloneLabState(state) {
  return {
    ...state,
    point: { ...state.point },
    selectedAnswers: [...state.selectedAnswers]
  };
}

function setEquals(first, second) {
  if (first.size !== second.size) return false;
  return [...first].every(value => second.has(value));
}

function cycleValue(options, current) {
  const index = Math.max(0, options.findIndex(option => option.id === current));
  return options[(index + 1) % options.length].id;
}

function lineTeachingAnalysis(result) {
  const kind = result.classification === 'collapsed'
    ? 'accumulated'
    : result.classification === 'foreshortened'
      ? 'shortened'
      : result.classification;
  return { ...result, kind };
}

function planeTeachingAnalysis(result) {
  const kind = result.classification === 'collapsed'
    ? 'accumulated'
    : result.classification === 'foreshortened'
      ? 'similar'
      : result.classification;
  const label = result.classification === 'foreshortened' ? '类似形' : result.label;
  return { ...result, kind, label };
}

function readPoint(point) {
  if (Array.isArray(point)) return { x: point[0], y: point[1], z: point[2] };
  return point;
}

function interpolatePoint(a, b, t) {
  const first = readPoint(a);
  const second = readPoint(b);
  return {
    x: first.x + (second.x - first.x) * t,
    y: first.y + (second.y - first.y) * t,
    z: first.z + (second.z - first.z) * t
  };
}

/**
 * Creates the point/line/plane projection laboratory.
 *
 * The controller deliberately shares the host application's scene, camera and
 * controls. It does not create a renderer and keeps all teaching geometry in
 * one independently visible and disposable root group.
 */
export function createBasicProjectionLab({ THREE, scene, camera, controls, setStatus }) {
  if (!THREE || !scene || !camera || !controls) {
    throw new TypeError('createBasicProjectionLab requires THREE, scene, camera and controls.');
  }

  const doc = globalThis.document;
  const announce = typeof setStatus === 'function' ? setStatus : () => {};
  const labRootGroup = new THREE.Group();
  labRootGroup.name = 'basic_projection_lab_root';
  labRootGroup.visible = false;
  scene.add(labRootGroup);

  let state = createLabState();
  let analysis = {};
  let question = null;
  let active = false;
  let disposed = false;
  let cameraSnapshot = null;
  let labCameraView = null;
  const eventController = typeof AbortController === 'function' ? new AbortController() : null;
  const eventOptions = eventController ? { signal: eventController.signal } : undefined;

  const dom = doc ? {
    shell: doc.getElementById('lab-shell'),
    lessonNav: doc.getElementById('lab-lesson-nav'),
    reset: doc.getElementById('lab-reset'),
    kicker: doc.getElementById('lab-kicker'),
    title: doc.getElementById('lab-title'),
    controls: doc.getElementById('lab-context-controls'),
    boardKicker: doc.getElementById('lab-board-kicker'),
    boardTitle: doc.getElementById('lab-board-title'),
    boardState: doc.getElementById('lab-board-state'),
    board: doc.querySelector('.lab-projection-board'),
    correspondence: doc.getElementById('lab-correspondence'),
    phase: doc.getElementById('lab-phase'),
    progress: doc.getElementById('lab-progress'),
    taskTitle: doc.getElementById('lab-task-title'),
    taskPrompt: doc.getElementById('lab-task-prompt'),
    answers: doc.getElementById('lab-answer-options'),
    feedback: doc.getElementById('lab-feedback'),
    primary: doc.getElementById('lab-primary-action'),
    views: {
      front: doc.getElementById('lab-view-front'),
      top: doc.getElementById('lab-view-top'),
      side: doc.getElementById('lab-view-side')
    },
    viewMeta: {
      front: doc.getElementById('lab-view-meta-front'),
      top: doc.getElementById('lab-view-meta-top'),
      side: doc.getElementById('lab-view-meta-side')
    },
    viewLabels: {
      front: doc.getElementById('lab-view-label-front'),
      top: doc.getElementById('lab-view-label-top'),
      side: doc.getElementById('lab-view-label-side')
    },
    viewCards: {
      front: doc.querySelector('[data-lab-view-card="front"]'),
      top: doc.querySelector('[data-lab-view-card="top"]'),
      side: doc.querySelector('[data-lab-view-card="side"]')
    }
  } : {};

  function ensureUsable() {
    if (disposed) throw new Error('The basic projection lab has been disposed.');
  }

  function vector3(point) {
    // 教材工程坐标 (X 长、Y 宽、Z 高) → Three.js 世界坐标 (x, z, y)。
    return new THREE.Vector3(...engineeringToWorld(point));
  }

  function disposeMaterial(material, disposedTextures) {
    if (!material) return;
    Object.values(material).forEach(value => {
      if (value?.isTexture && !disposedTextures.has(value)) {
        disposedTextures.add(value);
        value.dispose();
      }
    });
    material.dispose?.();
  }

  function clearLabGeometry() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    labRootGroup.traverse(object => {
      if (object === labRootGroup) return;
      if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => disposeMaterial(material, textures));
    labRootGroup.clear();
  }

  function lineMaterial(color, dashed = false, opacity = 1) {
    const options = { color, transparent: opacity < 1, opacity, depthTest: true };
    return dashed
      ? new THREE.LineDashedMaterial({ ...options, dashSize: 0.11, gapSize: 0.075 })
      : new THREE.LineBasicMaterial(options);
  }

  function addLine(points, color = COLORS.object, options = {}) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(vector3));
    const line = new THREE.Line(
      geometry,
      lineMaterial(color, Boolean(options.dashed), options.opacity ?? 1)
    );
    if (options.dashed) line.computeLineDistances();
    line.renderOrder = options.renderOrder ?? 2;
    labRootGroup.add(line);
    return line;
  }

  function addPoint(point, color = COLORS.point, radius = 0.095) {
    const geometry = new THREE.SphereGeometry(radius, 20, 14);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.68,
      metalness: 0.04,
      emissive: color,
      emissiveIntensity: 0.08
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(vector3(point));
    mesh.renderOrder = 4;
    labRootGroup.add(mesh);
    return mesh;
  }

  function addLabel(text, point, color = '#36536b') {
    if (!doc) return null;
    const canvas = doc.createElement('canvas');
    canvas.width = 160;
    canvas.height = 80;
    const context = canvas.getContext('2d');
    context.font = '700 42px Arial, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = color;
    context.fillText(text, 80, 42);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(vector3(point));
    sprite.scale.set(0.58, 0.29, 1);
    sprite.renderOrder = 8;
    labRootGroup.add(sprite);
    return sprite;
  }

  function addSurface(points, color = COLORS.object, opacity = 0.2, renderOrder = 1) {
    const vertices = points.flatMap(point => {
      const p = vector3(point);
      return [p.x, p.y, p.z];
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.82,
      metalness: 0
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    labRootGroup.add(mesh);
    addLine([...points, points[0]], color, { opacity: Math.min(1, opacity + 0.58), renderOrder: renderOrder + 1 });
    return mesh;
  }

  function addReferencePlane(width, height, position, rotation) {
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      color: COLORS.plane,
      transparent: true,
      opacity: 0.075,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.position.copy(vector3(position));
    plane.rotation.set(rotation.x, rotation.y, rotation.z);
    plane.renderOrder = -3;
    labRootGroup.add(plane);

    const edgeGeometry = new THREE.EdgesGeometry(geometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: COLORS.guideSoft,
      transparent: true,
      opacity: 0.55
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.renderOrder = -2;
    plane.add(edges);
    return plane;
  }

  function addCoordinateAxes() {
    addLine([{ x: -2.15, y: 0, z: 0 }, { x: 2.15, y: 0, z: 0 }], 0xb8796f, { opacity: 0.72 });
    addLine([{ x: 0, y: -1.85, z: 0 }, { x: 0, y: 2.15, z: 0 }], 0x6b9676, { opacity: 0.72 });
    addLine([{ x: 0, y: 0, z: -1.0 }, { x: 0, y: 0, z: 2.25 }], 0x648ba8, { opacity: 0.72 });
    addLabel('O', { x: 0.16, y: 0.12, z: 0.16 });
    addLabel('X', { x: 2.28, y: 0, z: 0 }, '#a75f55');
    addLabel('Y', { x: 0, y: 2.28, z: 0 }, '#527c61');
    addLabel('Z', { x: 0, y: 0, z: 2.38 }, '#4f7898');
  }

  function addTrihedralFrame() {
    addReferencePlane(4.9, 4.4, { x: 0, y: FRAME.frontY, z: 0 }, { x: 0, y: 0, z: 0 });
    addReferencePlane(4.9, 4.4, { x: 0, y: 0, z: FRAME.topZ }, { x: -Math.PI / 2, y: 0, z: 0 });
    addReferencePlane(4.4, 4.4, { x: FRAME.sideX, y: 0, z: 0 }, { x: 0, y: Math.PI / 2, z: 0 });
    addCoordinateAxes();
    addLabel('V', { x: -1.9, y: 0.03, z: 1.75 }, '#54758c');
    addLabel('H', { x: -1.9, y: 1.7, z: 0.03 }, '#54758c');
    addLabel('W', { x: 0.03, y: 1.7, z: 1.75 }, '#54758c');
  }

  function pointOnProjectionPlane(point, view) {
    const p = readPoint(point);
    if (view === 'front') return { x: p.x, y: FRAME.frontY + 0.012, z: p.z };
    if (view === 'top') return { x: p.x, y: p.y, z: FRAME.topZ + 0.012 };
    return { x: FRAME.sideX + 0.012, y: p.y, z: p.z };
  }

  function addPointProjection(point, options = {}) {
    const evidenceColor = state.evaluated ? COLORS.evidence : COLORS.guide;
    addPoint(point, options.pointColor ?? COLORS.object, options.radius ?? 0.1);
    VIEWS.forEach(view => {
      const projected = pointOnProjectionPlane(point, view);
      addLine([point, projected], COLORS.guide, { dashed: true, opacity: 0.48 });
      addPoint(projected, evidenceColor, 0.052);
    });
  }

  function addProjectedLine(a, b) {
    const evidenceColor = state.evaluated ? COLORS.evidence : COLORS.guide;
    VIEWS.forEach(view => {
      const first = pointOnProjectionPlane(a, view);
      const second = pointOnProjectionPlane(b, view);
      addLine([first, second], evidenceColor, { opacity: 0.86, renderOrder: 5 });
      addLine([a, first], COLORS.guide, { dashed: true, opacity: 0.25 });
      addLine([b, second], COLORS.guide, { dashed: true, opacity: 0.25 });
    });
  }

  function addProjectedPlane(points) {
    const evidenceColor = state.evaluated ? COLORS.evidence : COLORS.guide;
    VIEWS.forEach(view => {
      const projected = points.map(point => pointOnProjectionPlane(point, view));
      addSurface(projected, evidenceColor, 0.105, 4);
      points.forEach((point, index) => {
        addLine([point, projected[index]], COLORS.guide, { dashed: true, opacity: 0.22 });
      });
    });
  }

  function projectAlong(point, direction, planeY) {
    const p = readPoint(point);
    const d = readPoint(direction);
    const t = (planeY - p.y) / d.y;
    return { x: p.x + d.x * t, y: planeY, z: p.z + d.z * t };
  }

  function projectFromCenter(point, center, planeY) {
    const p = readPoint(point);
    const source = readPoint(center);
    const direction = { x: p.x - source.x, y: p.y - source.y, z: p.z - source.z };
    return projectAlong(source, direction, planeY);
  }

  function buildProjectionScene() {
    const planeY = -1.6;
    addReferencePlane(5.0, 4.5, { x: 0, y: planeY, z: 0.45 }, { x: 0, y: 0, z: 0 });
    addCoordinateAxes();

    const objectPoints = [
      { x: -0.95, y: 0.55, z: 0.15 },
      { x: 0.95, y: 0.55, z: 0.35 },
      { x: 0.05, y: 0.55, z: 1.65 }
    ];
    addSurface(objectPoints, COLORS.object, 0.3, 2);
    objectPoints.forEach(point => addPoint(point, COLORS.object, 0.065));

    let projectedPoints;
    const entities = [{ type: 'plane', points: objectPoints, label: '物体' }];
    let correspondence;

    if (state.projectionType === 'central') {
      const center = { x: 0, y: 3.25, z: 2.45 };
      addPoint(center, COLORS.secondary, 0.12);
      addLabel('S', { x: -0.22, y: 3.25, z: 2.73 }, '#a85a46');
      projectedPoints = objectPoints.map(point => projectFromCenter(point, center, planeY + 0.014));
      projectedPoints.forEach((projectedPoint, index) => {
        // 射线 S—A—a 穿过物体点并一直到达投影面。
        addLine([center, projectedPoint], COLORS.guide, { opacity: 0.78 });
        entities.push({ type: 'line', points: [center, projectedPoint], tone: 'guide', evidence: false });
        if (index === 0) entities.push({ type: 'point', points: [center], label: 'S', tone: 'secondary', evidence: false });
      });
      correspondence = ['投射线汇聚于中心 S', '物体离中心越近，投影变化越明显'];
    } else {
      const direction = state.projectionType === 'orthographic'
        ? { x: 0, y: -1, z: 0 }
        : { x: -0.38, y: -1, z: -0.2 };
      projectedPoints = objectPoints.map(point => projectAlong(point, direction, planeY + 0.014));
      objectPoints.forEach((point, index) => {
        const start = {
          x: point.x - direction.x * 0.85,
          y: point.y - direction.y * 0.85,
          z: point.z - direction.z * 0.85
        };
        addLine([start, projectedPoints[index]], COLORS.guide, { opacity: 0.78 });
        entities.push({ type: 'line', points: [start, projectedPoints[index]], tone: 'guide', evidence: false });
      });
      correspondence = state.projectionType === 'orthographic'
        ? ['投射线彼此平行', '投射线垂直于投影面']
        : ['投射线彼此平行', '投射线倾斜于投影面'];
    }

    const projectionColor = state.evaluated ? COLORS.evidence : COLORS.guide;
    addSurface(projectedPoints, projectionColor, 0.27, 5);
    projectedPoints.forEach(point => addPoint(point, projectionColor, 0.06));
    entities.push({ type: 'plane', points: projectedPoints, label: '投影', tone: 'evidence' });

    return {
      entities,
      correspondence,
      viewMeta: {
        front: '投影面',
        top: '投射方向',
        side: '投射方向'
      }
    };
  }

  function buildPointScene() {
    addTrihedralFrame();
    const point = { ...state.point };
    addPointProjection(point);
    return {
      entities: [{ type: 'point', points: [point], label: 'A' }],
      correspondence: [
        `长对正：x = ${point.x.toFixed(2)}`,
        `高平齐：z = ${point.z.toFixed(2)}`,
        `宽相等：y = ${point.y.toFixed(2)}`
      ],
      viewMeta: { ...VIEW_META_DEFAULTS }
    };
  }

  function linePresetPoints() {
    if (state.linePreset === 'front-parallel') {
      return [
        { x: 0.35, y: 0.75, z: 0.35 },
        { x: 2.1, y: 0.75, z: 1.75 }
      ];
    }
    if (state.linePreset === 'front-perpendicular') {
      return [
        { x: 1.1, y: 0.35, z: 1.0 },
        { x: 1.1, y: 1.8, z: 1.0 }
      ];
    }
    return [
      { x: 0.35, y: 0.4, z: 0.35 },
      { x: 2.1, y: 1.6, z: 1.8 }
    ];
  }

  function buildLineScene() {
    addTrihedralFrame();
    const [a, b] = linePresetPoints();
    addLine([a, b], COLORS.object, { opacity: 1, renderOrder: 4 });
    addPoint(a, COLORS.objectDark, 0.085);
    addPoint(b, COLORS.objectDark, 0.085);
    addProjectedLine(a, b);

    const lineViews = Object.fromEntries(VIEWS.map(view => [
      view,
      lineTeachingAnalysis(classifyLineProjection(a, b, view))
    ]));
    return {
      entities: [{ type: 'line', points: [a, b], label: 'AB', pointLabels: ['A', 'B'] }],
      lineViews,
      correspondence: VIEWS.map(view => {
        const name = view === 'front' ? '主视图' : view === 'top' ? '俯视图' : '左视图';
        return `${name}：${lineViews[view].label}`;
      }),
      viewMeta: Object.fromEntries(VIEWS.map(view => [view, lineViews[view].label]))
    };
  }

  function planePresetPoints() {
    if (state.planePreset === 'horizontal') {
      return [
        { x: 0.35, y: 0.4, z: 0.9 },
        { x: 2.1, y: 0.8, z: 0.9 },
        { x: 1.0, y: 1.8, z: 0.9 }
      ];
    }
    if (state.planePreset === 'front-perpendicular') {
      return [
        { x: 0.4, y: 0.4, z: 0.4 },
        { x: 2.0, y: 0.8, z: 1.6 },
        { x: 1.2, y: 1.8, z: 1.0 }
      ];
    }
    return [
      { x: 0.35, y: 0.4, z: 0.3 },
      { x: 2.1, y: 1.5, z: 0.65 },
      { x: 0.9, y: 1.1, z: 1.9 }
    ];
  }

  function buildPlaneScene() {
    addTrihedralFrame();
    const points = planePresetPoints();
    addSurface(points, COLORS.object, 0.28, 3);
    points.forEach(point => addPoint(point, COLORS.objectDark, 0.07));
    addProjectedPlane(points);

    const planeViews = Object.fromEntries(VIEWS.map(view => [
      view,
      planeTeachingAnalysis(classifyPlaneProjection(...points, view))
    ]));
    return {
      entities: [{ type: 'plane', points, label: 'α', pointLabels: ['A', 'B', 'C'] }],
      planeViews,
      correspondence: VIEWS.map(view => {
        const name = view === 'front' ? '主视图' : view === 'top' ? '俯视图' : '左视图';
        return `${name}：${planeViews[view].label}`;
      }),
      viewMeta: Object.fromEntries(VIEWS.map(view => [view, planeViews[view].label]))
    };
  }

  function buildPointOnLineRelation() {
    const b = { x: 0.35, y: 0.4, z: 0.35 };
    const c = { x: 2.1, y: 1.6, z: 1.8 };
    const a = interpolatePoint(b, c, 0.44);
    addLine([b, c], COLORS.object, { renderOrder: 4 });
    addPoint(b, COLORS.objectDark, 0.075);
    addPoint(c, COLORS.objectDark, 0.075);
    addPointProjection(a, {
      pointColor: state.evaluated ? COLORS.evidence : COLORS.secondary,
      radius: 0.105
    });
    addProjectedLine(b, c);
    return {
      entities: [
        { type: 'line', points: [b, c], label: 'BC', pointLabels: ['B', 'C'] },
        { type: 'point', points: [a], label: 'A', tone: 'evidence' }
      ],
      relation: { kind: 'point-on-line', exact: pointOnLine(a, b, c) },
      correspondence: ['A 的三个投影均落在 BC 的同名投影上', '三个视图中的分点参数一致']
    };
  }

  function buildLineInPlaneRelation() {
    const plane = [
      { x: 0.35, y: 0.4, z: 0.3 },
      { x: 2.1, y: 1.5, z: 0.65 },
      { x: 0.9, y: 1.1, z: 1.9 }
    ];
    const d = interpolatePoint(plane[0], plane[1], 0.35);
    const e = interpolatePoint(plane[0], plane[2], 0.72);
    addSurface(plane, COLORS.object, 0.21, 2);
    const relationColor = state.evaluated ? COLORS.evidence : COLORS.secondary;
    addLine([d, e], relationColor, { renderOrder: 5 });
    addPoint(d, relationColor, 0.075);
    addPoint(e, relationColor, 0.075);
    addProjectedPlane(plane);
    addProjectedLine(d, e);
    return {
      entities: [
        { type: 'plane', points: plane, label: 'α', pointLabels: ['A', 'B', 'C'] },
        { type: 'line', points: [d, e], label: 'DE', pointLabels: ['D', 'E'], tone: 'evidence' }
      ],
      relation: {
        kind: 'line-in-plane',
        exact: pointInPlane(d, ...plane) && pointInPlane(e, ...plane)
      },
      correspondence: ['端点 D 位于平面 α 内', '端点 E 位于平面 α 内', '两端点在平面内 ⇒ 直线在平面内']
    };
  }

  function buildSkewLinesRelation() {
    const a = { x: 0.3, y: 0.6, z: 0.8 };
    const b = { x: 2.1, y: 0.6, z: 0.8 };
    const c = { x: 1.2, y: 1.5, z: 0.3 };
    const d = { x: 1.2, y: 1.5, z: 1.9 };
    addLine([a, b], COLORS.object, { renderOrder: 4 });
    addLine([c, d], COLORS.secondary, { renderOrder: 4 });
    [a, b].forEach(point => addPoint(point, COLORS.objectDark, 0.07));
    [c, d].forEach(point => addPoint(point, COLORS.secondary, 0.07));
    addProjectedLine(a, b);
    addProjectedLine(c, d);
    const actual = classifyLineLine(a, b, c, d);
    return {
      entities: [
        { type: 'line', points: [a, b], label: 'AB', pointLabels: ['A', 'B'] },
        { type: 'line', points: [c, d], label: 'CD', pointLabels: ['C', 'D'], tone: 'secondary' }
      ],
      relation: { kind: 'skew-lines', actual, exact: actual === 'skew' },
      correspondence: ['单个视图中的“相交”不能证明空间相交', '主视图中的“交点”在另外两个投影中没有同一对应点', '综合判断：两直线交叉']
    };
  }

  function buildRelationScene() {
    addTrihedralFrame();
    const result = state.relationPreset === 'line-in-plane'
      ? buildLineInPlaneRelation()
      : state.relationPreset === 'skew-lines'
        ? buildSkewLinesRelation()
        : buildPointOnLineRelation();
    return {
      ...result,
      viewMeta: {
        front: '共同判断',
        top: '共同判断',
        side: '共同判断'
      }
    };
  }

  function rebuildScene() {
    clearLabGeometry();
    const builders = {
      projection: buildProjectionScene,
      point: buildPointScene,
      line: buildLineScene,
      plane: buildPlaneScene,
      relation: buildRelationScene
    };
    analysis = (builders[state.lessonId] || buildProjectionScene)();
    question = getLabQuestion(state, analysis);
  }

  function svgElement(tag, attributes = {}) {
    const element = doc.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
    return element;
  }

  function svgCoordinates(point, view) {
    const [u, v] = projectPointFirstAngle(point, view);
    return [90 + u * 22, 68 - v * 22];
  }

  function addSvgAxes(svg) {
    svg.append(
      svgElement('line', { x1: 8, y1: 68, x2: 172, y2: 68, class: 'axis' }),
      svgElement('line', { x1: 90, y1: 8, x2: 90, y2: 112, class: 'axis' })
    );
  }

  function projectedArea2D(points, view) {
    const [a, b, c] = points.map(point => projectPoint(point, view));
    return Math.abs(
      (b[0] - a[0]) * (c[1] - a[1])
      - (b[1] - a[1]) * (c[0] - a[0])
    ) / 2;
  }

  function farthestProjectedPair(points, view) {
    let best = [points[0], points[1]];
    let bestDistance = -1;
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const first = projectPoint(points[i], view);
        const second = projectPoint(points[j], view);
        const distance = Math.hypot(second[0] - first[0], second[1] - first[1]);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = [points[i], points[j]];
        }
      }
    }
    return best;
  }

  function styleSvgEntity(element, entity) {
    if (entity.tone === 'secondary') element.style.stroke = '#c1664d';
    if (entity.tone === 'guide') {
      element.style.stroke = '#8ca5b5';
      element.style.strokeDasharray = '4 3';
      element.style.opacity = '0.72';
    }
    if (entity.tone === 'evidence' && state.evaluated) element.style.stroke = '#d39b18';
  }

  function addSvgLabel(svg, x, y, text, tone) {
    if (!text) return;
    const label = svgElement('text', { x: x + 5, y: y - 5 });
    label.textContent = text;
    if (tone === 'secondary') label.style.fill = '#a54d38';
    if (tone === 'evidence' && state.evaluated) label.style.fill = '#9a6b00';
    svg.append(label);
  }

  function projectedLabel(label, view) {
    if (!label) return label;
    const suffix = view === 'front' ? '′' : view === 'side' ? '″' : '';
    if (/^[A-Z]$/.test(label)) return `${label.toLowerCase()}${suffix}`;
    if (label === 'α') return `${label}${suffix}`;
    return label;
  }

  function drawSvgEntity(svg, entity, view) {
    const evidenceClass = state.evaluated && entity.evidence !== false ? ' evidence' : '';
    if (entity.type === 'point') {
      const [x, y] = svgCoordinates(entity.points[0], view);
      const point = svgElement('circle', { cx: x, cy: y, r: 3.8, class: `shape${evidenceClass}` });
      styleSvgEntity(point, entity);
      svg.append(point);
      addSvgLabel(svg, x, y, projectedLabel(entity.label, view), entity.tone);
      return;
    }

    if (entity.type === 'line') {
      const [first, second] = entity.points.map(point => svgCoordinates(point, view));
      const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
      let shape;
      if (length < 0.8) {
        shape = svgElement('circle', {
          cx: first[0],
          cy: first[1],
          r: 4,
          class: `shape${evidenceClass}`
        });
      } else {
        shape = svgElement('line', {
          x1: first[0],
          y1: first[1],
          x2: second[0],
          y2: second[1],
          class: `shape${evidenceClass}`
        });
      }
      styleSvgEntity(shape, entity);
      svg.append(shape);
      if (length < 0.8) {
        const firstLabel = projectedLabel(entity.pointLabels?.[0], view);
        const secondLabel = projectedLabel(entity.pointLabels?.[1], view);
        addSvgLabel(
          svg,
          first[0],
          first[1],
          firstLabel && secondLabel ? `${firstLabel}≡${secondLabel}` : entity.label,
          entity.tone
        );
      } else {
        addSvgLabel(svg, first[0], first[1], projectedLabel(entity.pointLabels?.[0], view), entity.tone);
        addSvgLabel(
          svg,
          second[0],
          second[1],
          projectedLabel(entity.pointLabels?.[1], view) || entity.label,
          entity.tone
        );
      }
      return;
    }

    if (entity.type === 'plane') {
      const collapsed = projectedArea2D(entity.points, view) < 1e-8;
      const projectedPoints = entity.points.map(point => svgCoordinates(point, view));
      let shape;
      let labelPosition;
      if (collapsed) {
        const pair = farthestProjectedPair(entity.points, view).map(point => svgCoordinates(point, view));
        shape = svgElement('line', {
          x1: pair[0][0],
          y1: pair[0][1],
          x2: pair[1][0],
          y2: pair[1][1],
          class: `shape${evidenceClass}`
        });
        labelPosition = pair[1];
      } else {
        shape = svgElement('polygon', {
          points: projectedPoints.map(point => point.join(',')).join(' '),
          class: `surface${evidenceClass}`
        });
        labelPosition = projectedPoints[2];
      }
      styleSvgEntity(shape, entity);
      svg.append(shape);
      if (entity.pointLabels?.length) {
        projectedPoints.forEach((point, index) => {
          addSvgLabel(svg, point[0], point[1], projectedLabel(entity.pointLabels[index], view), entity.tone);
        });
      } else {
        addSvgLabel(svg, labelPosition[0], labelPosition[1], projectedLabel(entity.label, view), entity.tone);
      }
    }
  }

  function renderProjectionBoard() {
    if (!doc) return;
    VIEWS.forEach(view => {
      const svg = dom.views?.[view];
      if (!svg) return;
      svg.replaceChildren();
      addSvgAxes(svg);
      (analysis.entities || []).forEach(entity => drawSvgEntity(svg, entity, view));
      if (dom.viewMeta?.[view]) {
        const liveMeta = state.lessonId === 'projection'
          ? analysis.viewMeta?.[view]
          : VIEW_META_DEFAULTS[view];
        dom.viewMeta[view].textContent = state.evaluated
          ? analysis.viewMeta?.[view] || VIEW_META_DEFAULTS[view]
          : liveMeta || VIEW_META_DEFAULTS[view];
      }

      const expectedViews = new Set((question?.answer || []).filter(answer => VIEWS.includes(answer)));
      const highlight = state.evaluated && (expectedViews.size === 0 || expectedViews.has(view));
      dom.viewCards?.[view]?.classList.toggle('evidence', highlight);
    });

    if (dom.boardState) {
      dom.boardState.textContent = state.lessonId === 'projection'
        ? state.evaluated ? '规律已核对' : '实时观察'
        : state.evaluated ? '证据已核对' : '实时对应';
    }
    if (dom.correspondence) {
      dom.correspondence.replaceChildren();
      const correspondence = state.evaluated
        ? analysis.correspondence || []
        : ['先观察图形并作出判断，核对后显示对应规律'];
      correspondence.forEach(text => {
        const chip = doc.createElement('span');
        chip.textContent = text;
        chip.classList.toggle('verified', state.evaluated);
        dom.correspondence.append(chip);
      });
    }
  }

  function makeSegmentControl(label, setting, options, current) {
    const group = doc.createElement('div');
    group.className = 'lab-control-group';
    const caption = doc.createElement('span');
    caption.textContent = label;
    const segment = doc.createElement('div');
    segment.className = 'lab-segment';
    options.forEach((option, index) => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.labSetting = setting;
      button.dataset.value = option.id;
      button.textContent = state.evaluated ? option.label : `案例 ${String.fromCharCode(65 + index)}`;
      button.classList.toggle('active', option.id === current);
      button.setAttribute('aria-pressed', String(option.id === current));
      segment.append(button);
    });
    group.append(caption, segment);
    return group;
  }

  function makeCoordinateControl(axis) {
    const group = doc.createElement('div');
    group.className = 'lab-coordinate';
    const label = doc.createElement('label');
    const input = doc.createElement('input');
    const output = doc.createElement('output');
    const inputId = `lab-point-${axis}`;
    label.htmlFor = inputId;
    label.textContent = axis.toUpperCase();
    input.id = inputId;
    input.type = 'range';
    input.min = '-1.6';
    input.max = '1.8';
    input.step = '0.05';
    input.value = String(state.point[axis]);
    input.dataset.labCoordinate = axis;
    output.htmlFor = inputId;
    output.textContent = state.point[axis].toFixed(2);
    group.append(label, input, output);
    return group;
  }

  function renderControls() {
    if (!doc || !dom.controls) return;
    dom.controls.replaceChildren();
    if (state.lessonId === 'projection') {
      dom.controls.append(makeSegmentControl('投影方式', 'projectionType', PROJECTION_TYPES, state.projectionType));
    } else if (state.lessonId === 'point') {
      const group = doc.createElement('div');
      group.className = 'lab-control-group lab-point-controls';
      const caption = doc.createElement('span');
      caption.textContent = '点 A 坐标';
      group.append(caption, ...['x', 'y', 'z'].map(makeCoordinateControl));
      dom.controls.append(group);
    } else if (state.lessonId === 'line') {
      dom.controls.append(makeSegmentControl('直线位置', 'linePreset', LINE_PRESETS, state.linePreset));
    } else if (state.lessonId === 'plane') {
      dom.controls.append(makeSegmentControl('平面位置', 'planePreset', PLANE_PRESETS, state.planePreset));
    } else {
      dom.controls.append(makeSegmentControl('空间关系', 'relationPreset', RELATION_PRESETS, state.relationPreset));
    }
  }

  function renderHeaderAndNavigation() {
    if (!doc) return;
    const lesson = getLabLesson(state.lessonId);
    if (dom.kicker) dom.kicker.textContent = lesson.kicker;
    if (dom.title) dom.title.textContent = lesson.title;
    const projectionLesson = state.lessonId === 'projection';
    if (dom.boardKicker) dom.boardKicker.textContent = projectionLesson ? '投影形成' : '第一角投影';
    if (dom.boardTitle) dom.boardTitle.textContent = projectionLesson ? '单面投影观察板' : '三视图证据板';
    const viewLabels = projectionLesson
      ? { front: '正面观察', top: '俯视观察', side: '侧面观察' }
      : { front: '主视图（V）', top: '俯视图（H）', side: '左视图（W）' };
    VIEWS.forEach(view => {
      if (dom.viewLabels?.[view]) dom.viewLabels[view].textContent = viewLabels[view];
    });
    doc.querySelectorAll('[data-lab-lesson]').forEach((button, index) => {
      const selected = button.dataset.labLesson === state.lessonId;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      button.querySelector('b')?.setAttribute('data-step', `${index + 1} / ${LAB_LESSONS.length}`);
    });
  }

  function renderTask() {
    if (!doc || !question) return;
    const selected = new Set(state.selectedAnswers);
    const expected = new Set(question.answer);
    const lessonIndex = LAB_LESSONS.findIndex(lesson => lesson.id === state.lessonId);

    if (dom.phase) dom.phase.textContent = state.evaluated ? '核对' : '观察判断';
    if (dom.progress) dom.progress.textContent = `${lessonIndex + 1} / ${LAB_LESSONS.length}`;
    if (dom.taskTitle) dom.taskTitle.textContent = TASK_TITLES[state.lessonId];
    if (dom.taskPrompt) dom.taskPrompt.textContent = question.prompt;
    if (dom.answers) {
      dom.answers.replaceChildren();
      dom.answers.dataset.selection = question.type;
      question.choices.forEach(choice => {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'lab-answer-option';
        button.dataset.answer = choice.id;
        button.textContent = choice.label;
        button.classList.toggle('selected', selected.has(choice.id));
        if (state.evaluated) {
          button.classList.toggle('correct', expected.has(choice.id));
          button.classList.toggle('wrong', selected.has(choice.id) && !expected.has(choice.id));
          button.disabled = true;
        }
        button.setAttribute('aria-pressed', String(selected.has(choice.id)));
        dom.answers.append(button);
      });
    }

    if (dom.feedback) {
      dom.feedback.hidden = !state.evaluated;
      if (state.evaluated) {
        dom.feedback.dataset.tone = state.resultExact ? 'success' : 'error';
        dom.feedback.textContent = `${state.resultExact ? '判断正确。' : '判断还不准确。'}${question.evidence}`;
      } else {
        delete dom.feedback.dataset.tone;
        dom.feedback.textContent = '';
      }
    }

    if (dom.primary) {
      dom.primary.disabled = state.evaluated ? false : selected.size === 0;
      dom.primary.textContent = state.evaluated ? '换一组条件' : '核对判断';
    }
  }

  function renderAll({ includeControls = true } = {}) {
    rebuildScene();
    renderHeaderAndNavigation();
    if (includeControls) renderControls();
    renderTask();
    renderProjectionBoard();
  }

  function resetAnswer() {
    state.selectedAnswers = [];
    state.evaluated = false;
    state.resultExact = null;
  }

  function updateCondition({ includeControls = true } = {}) {
    resetAnswer();
    renderAll({ includeControls });
    announce(getLabLesson(state.lessonId).status);
  }

  function evaluateAnswer() {
    if (!question || state.selectedAnswers.length === 0 || state.evaluated) return;
    state.evaluated = true;
    state.resultExact = setEquals(new Set(state.selectedAnswers), new Set(question.answer));
    rebuildScene();
    renderControls();
    renderTask();
    renderProjectionBoard();
    announce(state.resultExact
      ? `判断正确：${question.evidence}`
      : `请根据三视图证据继续核对：${question.evidence}`);
    const viewport = doc?.defaultView;
    if (viewport?.innerWidth <= 680 && dom.board) {
      const behavior = viewport.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth';
      viewport.requestAnimationFrame(() => {
        dom.board.scrollIntoView({ behavior, block: 'start' });
      });
    }
  }

  function changeCondition() {
    state.variant += 1;
    if (state.lessonId === 'projection') {
      state.projectionType = cycleValue(PROJECTION_TYPES, state.projectionType);
    } else if (state.lessonId === 'point') {
      const variant = POINT_VARIANTS[state.variant % POINT_VARIANTS.length];
      state.point = { ...variant };
    } else if (state.lessonId === 'line') {
      state.linePreset = cycleValue(LINE_PRESETS, state.linePreset);
    } else if (state.lessonId === 'plane') {
      state.planePreset = cycleValue(PLANE_PRESETS, state.planePreset);
    } else {
      state.relationPreset = cycleValue(RELATION_PRESETS, state.relationPreset);
    }
    updateCondition();
  }

  function selectLesson(id) {
    ensureUsable();
    const lesson = getLabLesson(id);
    state.lessonId = lesson.id;
    state.variant = 0;
    resetAnswer();
    renderAll();
    announce(`${lesson.label}：${lesson.status}`);
    return cloneLabState(state);
  }

  function reset() {
    ensureUsable();
    const lessonId = state.lessonId;
    state = createLabState();
    state.lessonId = lessonId;
    renderAll();
    announce(`${getLabLesson(lessonId).label}已复位。`);
    return cloneLabState(state);
  }

  function captureCamera() {
    if (cameraSnapshot) return;
    cameraSnapshot = {
      position: camera.position.clone(),
      up: camera.up.clone(),
      target: controls.target.clone(),
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      enablePan: controls.enablePan,
      enableRotate: controls.enableRotate,
      enableZoom: controls.enableZoom
    };
  }

  function applyLabCamera() {
    if (labCameraView) {
      camera.position.copy(labCameraView.position);
      camera.up.copy(labCameraView.up);
      controls.target.copy(labCameraView.target);
    } else {
      camera.position.set(6.3, 4.5, 7.2);
      camera.up.set(0, 1, 0);
      controls.target.set(0.65, 0.75, 0.65);
    }
    controls.minDistance = 2.8;
    controls.maxDistance = 26;
    controls.enablePan = true;
    controls.enableRotate = true;
    controls.enableZoom = true;
    camera.lookAt(controls.target);
    controls.update();
  }

  function restoreCamera() {
    if (!cameraSnapshot) return;
    camera.position.copy(cameraSnapshot.position);
    camera.up.copy(cameraSnapshot.up);
    controls.target.copy(cameraSnapshot.target);
    controls.minDistance = cameraSnapshot.minDistance;
    controls.maxDistance = cameraSnapshot.maxDistance;
    controls.enablePan = cameraSnapshot.enablePan;
    controls.enableRotate = cameraSnapshot.enableRotate;
    controls.enableZoom = cameraSnapshot.enableZoom;
    camera.lookAt(controls.target);
    controls.update();
    cameraSnapshot = null;
  }

  function enter(options = {}) {
    ensureUsable();
    if (!active) {
      captureCamera();
      active = true;
    }
    labRootGroup.visible = true;
    if (options.resetCamera !== false) applyLabCamera();
    renderAll();
    const lesson = getLabLesson(state.lessonId);
    announce(`教材实验 · ${lesson.label}：${lesson.status}`);
    return controller;
  }

  function leave(options = {}) {
    if (disposed) return controller;
    labRootGroup.visible = false;
    if (active) {
      labCameraView = {
        position: camera.position.clone(),
        up: camera.up.clone(),
        target: controls.target.clone()
      };
    }
    if (active && options.restoreCamera !== false) restoreCamera();
    active = false;
    return controller;
  }

  function setVisible(visible, options = {}) {
    return visible ? enter(options) : leave(options);
  }

  function handleLessonClick(event) {
    const button = event.target.closest?.('[data-lab-lesson]');
    if (button) selectLesson(button.dataset.labLesson);
  }

  function handleControlClick(event) {
    const button = event.target.closest?.('button[data-lab-setting]');
    if (!button) return;
    const setting = button.dataset.labSetting;
    if (!['projectionType', 'linePreset', 'planePreset', 'relationPreset'].includes(setting)) return;
    state[setting] = button.dataset.value;
    updateCondition();
  }

  function handleCoordinateInput(event) {
    const input = event.target.closest?.('input[data-lab-coordinate]');
    if (!input) return;
    const axis = input.dataset.labCoordinate;
    state.point[axis] = Number(input.value);
    const output = input.parentElement?.querySelector('output');
    if (output) output.textContent = state.point[axis].toFixed(2);
    updateCondition({ includeControls: false });
  }

  function handleAnswerClick(event) {
    const button = event.target.closest?.('button[data-answer]');
    if (!button || state.evaluated || !question) return;
    const answer = button.dataset.answer;
    if (question.type === 'multiple') {
      const selected = new Set(state.selectedAnswers);
      if (selected.has(answer)) selected.delete(answer);
      else selected.add(answer);
      state.selectedAnswers = [...selected];
    } else {
      state.selectedAnswers = [answer];
    }
    renderTask();
  }

  function handlePrimaryAction() {
    if (state.evaluated) changeCondition();
    else evaluateAnswer();
  }

  function bindDom() {
    if (!doc) return;
    dom.lessonNav?.addEventListener('click', handleLessonClick, eventOptions);
    dom.reset?.addEventListener('click', reset, eventOptions);
    dom.controls?.addEventListener('click', handleControlClick, eventOptions);
    dom.controls?.addEventListener('input', handleCoordinateInput, eventOptions);
    dom.answers?.addEventListener('click', handleAnswerClick, eventOptions);
    dom.primary?.addEventListener('click', handlePrimaryAction, eventOptions);
  }

  function dispose() {
    if (disposed) return;
    leave();
    eventController?.abort();
    clearLabGeometry();
    scene.remove(labRootGroup);
    disposed = true;
  }

  const controller = {
    rootGroup: labRootGroup,
    enter,
    leave,
    reset,
    selectLesson,
    setVisible,
    refresh: () => {
      ensureUsable();
      renderAll();
      return controller;
    },
    getState: () => cloneLabState(state),
    getAnalysis: () => analysis,
    isActive: () => active,
    dispose
  };

  bindDom();
  renderAll();
  return controller;
}
