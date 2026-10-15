import { ADDITION, Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { syncFaces, syncLines } from 'replicad-threejs-helper';
import { auditLessonWithExactKernel } from './replicad-kernel-client.js?v=8.3.0';
import {
  COMPOUND_LESSONS,
  clampStageIndex,
  createCompoundLessonState,
  evaluateCompoundAnswer,
  getCompoundLesson,
  visibleIdsForState
} from './compound-projection-lessons.js?v=8.2.7';
import {
  EXAMPLE51_DIMENSIONS,
  EXAMPLE55_BODY,
  EXAMPLE56_DIMENSIONS,
  createExample55Construction,
  createExample55ProjectionBlueprint,
  createExample56BaseSlot,
  createExample56ProjectionBlueprint,
  example56BaseHalfDepthAt,
  flattenProjectionSegments
} from './chapter5-projection-geometry.js?v=8.2.7';

const COLORS = Object.freeze({
  base: 0x668aa1,
  add: 0x318cae,
  addAlt: 0x78afbf,
  feature: 0x9477b4,
  result: 0x536f82,
  tool: 0xe0a03b,
  toolApplied: 0xc57a17,
  dark: 0x20364a
});

function cloneState(state) {
  return {
    ...state,
    parameters: { ...state.parameters },
    cutterValues: Object.fromEntries(Object.entries(state.cutterValues).map(([id, values]) => [id, { ...values }])),
    appliedCutters: [...state.appliedCutters],
    assemblyOffsets: Object.fromEntries(Object.entries(state.assemblyOffsets || {}).map(([id, values]) => [id, { ...values }])),
    detachedComponents: [...(state.detachedComponents || [])],
    display: { ...(state.display || {}) },
    pickedPoint: state.pickedPoint ? [...state.pickedPoint] : null
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createCompoundProjectionLab({
  THREE,
  camera,
  controls,
  rendererElement,
  modelGroup,
  activateModel,
  refreshProjections,
  projectionImageProvider,
  projectionPointProvider,
  setProjectionHidden,
  clearFocus,
  setStatus
}) {
  if (!THREE || !camera || !controls || !modelGroup || !activateModel || !refreshProjections) {
    throw new TypeError('createCompoundProjectionLab requires the shared renderer environment and model callbacks.');
  }

  const evaluator = new Evaluator();
  evaluator.attributes = ['position', 'normal'];
  evaluator.useGroups = false;
  evaluator.consolidateGroups = true;
  evaluator.useCDTClipping = true;

  const doc = typeof document === 'undefined' ? null : document;
  const rootElement = doc?.getElementById('compound-shell') || null;
  const dom = {
    lessonNav: doc?.getElementById('compound-lesson-nav') || null,
    source: doc?.getElementById('compound-source') || null,
    sourceLabel: doc?.getElementById('compound-source-label') || null,
    title: doc?.getElementById('compound-title') || null,
    titleLabel: doc?.getElementById('compound-title-label') || null,
    objective: doc?.getElementById('compound-objective') || null,
    aiInput: doc?.getElementById('compound-ai-input') || null,
    cadAction: doc?.getElementById('compound-cad-action') || null,
    operationTags: doc?.getElementById('compound-operation-tags') || null,
    sequence: doc?.getElementById('compound-sequence') || null,
    stageNote: doc?.getElementById('compound-stage-note') || null,
    booleanCard: doc?.getElementById('compound-boolean-card') || null,
    booleanWorkbench: doc?.getElementById('compound-boolean-workbench') || null,
    observationCard: doc?.getElementById('compound-observation-card') || null,
    observationTools: doc?.getElementById('compound-observation-tools') || null,
    assemblyCard: doc?.getElementById('compound-assembly-card') || null,
    assemblyWorkbench: doc?.getElementById('compound-assembly-workbench') || null,
    components: doc?.getElementById('compound-components') || null,
    parameters: doc?.getElementById('compound-parameters') || null,
    questionPrompt: doc?.getElementById('compound-question-prompt') || null,
    answers: doc?.getElementById('compound-answers') || null,
    feedback: doc?.getElementById('compound-feedback') || null,
    submit: doc?.getElementById('compound-submit') || null,
    reset: doc?.getElementById('compound-reset') || null,
    previous: doc?.getElementById('compound-prev-stage') || null,
    next: doc?.getElementById('compound-next-stage') || null,
    explode: doc?.getElementById('compound-explode') || null,
    explodeOutput: doc?.getElementById('compound-explode-output') || null,
    assemble: doc?.getElementById('compound-assemble') || null,
    explodeAll: doc?.getElementById('compound-explode-all') || null,
    progress: doc?.getElementById('compound-stage-progress') || null,
    kernelStatus: doc?.getElementById('compound-kernel-status') || null,
    projectionBoard: doc?.querySelector('.compound-projection-board') || null,
    mobileViewTabs: doc?.querySelector('.compound-mobile-view-tabs') || null,
    axisNote: doc?.querySelector('.compound-axis-note') || null,
    modelHelp: doc?.querySelector('.compound-model-help') || null
  };

  let lesson = COMPOUND_LESSONS[0];
  let state = createCompoundLessonState(lesson);
  let latestModelRoot = null;
  let active = false;
  let cameraSnapshot = null;
  let explodeCurrent = 0;
  let explodeTarget = 0;
  let explodeProjectionDirty = false;
  let lastExplodeProjectionSync = 0;
  let rebuildFrame = 0;
  let drag = null;
  let pointPickDown = null;
  let pointMarker = null;
  let exactKernelAudit = { status: 'idle', stage: '', key: '', result: null, error: '' };
  let exactKernelTimer = 0;
  let exactKernelRequestToken = 0;
  let mobileProjectionView = 'front';
  let edgeResolution = { width: 0, height: 0 };
  const assemblyCurrentOffsets = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const eventController = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const eventOptions = eventController ? { signal: eventController.signal } : undefined;

  function material(color, options = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.46,
      metalness: 0.04,
      ...options
    });
  }

  function addMesh(parent, name, geometry, color, options = {}) {
    const mesh = new THREE.Mesh(geometry, material(color, options.material));
    mesh.name = name;
    mesh.position.fromArray(options.position || [0, 0, 0]);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = options.receiveShadow !== false;
    mesh.userData.baseOpacity = options.material?.opacity ?? 1;
    mesh.userData.baseTransparent = Boolean(options.material?.transparent);
    if (options.material?.transparent) {
      mesh.userData.preserveMaterialOpacity = true;
    }
    if (options.booleanTool) {
      mesh.userData.excludeFromProjection = true;
      mesh.userData.booleanTool = true;
      mesh.userData.cutterId = options.cutterId;
    }
    parent.add(mesh);
    return mesh;
  }

  function makeComponent(root, id, label, explodeVector = [0, 0, 0], operation = 'add') {
    const group = new THREE.Group();
    const assemblyPart = lesson.assembly?.parts?.find(part => part.id === id) || null;
    group.name = `chapter5_${id}`;
    group.userData.chapter5Id = id;
    group.userData.label = label;
    group.userData.operation = operation;
    group.userData.homePosition = [0, 0, 0];
    group.userData.explodeVector = explodeVector;
    group.userData.assemblyPart = Boolean(assemblyPart);
    group.userData.assemblyFixed = Boolean(assemblyPart?.fixed);
    group.userData.assemblyDragPlane = assemblyPart?.dragPlane || 'xy';
    root.add(group);
    return group;
  }

  function createRoot(key) {
    const root = new THREE.Group();
    root.name = `chapter5_${key}_root`;
    root.userData.chapter5Lesson = lesson.id;
    return root;
  }

  function frontRoundedBaseShape(width, depth, radius) {
    const halfWidth = width / 2;
    const halfDepth = depth / 2;
    const r = Math.max(0, Math.min(radius, halfWidth, halfDepth));
    const shape = new THREE.Shape();
    // Shape 的纵坐标经 Y 向拉伸后对应 -Z；下边因此是教材中的底板前缘。
    shape.moveTo(-halfWidth, halfDepth);
    shape.lineTo(halfWidth, halfDepth);
    shape.lineTo(halfWidth, -halfDepth + r);
    shape.quadraticCurveTo(halfWidth, -halfDepth, halfWidth - r, -halfDepth);
    shape.lineTo(-halfWidth + r, -halfDepth);
    shape.quadraticCurveTo(-halfWidth, -halfDepth, -halfWidth, -halfDepth + r);
    shape.lineTo(-halfWidth, halfDepth);
    shape.closePath();
    return shape;
  }

  function archedUprightShape(radius, centerHeight) {
    const shape = new THREE.Shape();
    shape.moveTo(-radius, 0);
    shape.lineTo(radius, 0);
    shape.lineTo(radius, centerHeight);
    shape.absarc(0, centerHeight, radius, 0, Math.PI, false);
    shape.lineTo(-radius, 0);
    shape.closePath();
    return shape;
  }

  function polygonShape(points) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    points.slice(1).forEach(point => shape.lineTo(point[0], point[1]));
    shape.closePath();
    return shape;
  }

  function ringShape(outerRadius, innerRadius) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    return shape;
  }

  function roundedBottomSlotShape(width, straightHeight, radius) {
    const half = width / 2;
    const points = [[-half, straightHeight], [half, straightHeight], [half, 0]];
    for (let index = 0; index <= 32; index += 1) {
      const angle = -Math.PI * index / 32;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    points.push([-half, straightHeight]);
    return polygonShape(points);
  }

  function basePlanShape() {
    const b = EXAMPLE56_DIMENSIONS.base;
    const r = EXAMPLE56_DIMENSIONS.ring;
    const lowerAngle = Math.atan2(-b.tangentHalfDepth, b.tangentX - r.x);
    const upperAngle = Math.atan2(b.tangentHalfDepth, b.tangentX - r.x);
    const shape = new THREE.Shape();
    shape.moveTo(b.xMin, -b.leftHalfDepth);
    shape.lineTo(b.tangentX, -b.tangentHalfDepth);
    // 底板Ⅱ的右端是与圆柱Ⅰ外圆贴合的凹圆弧，不是指向圆心的三角尖端。
    shape.absarc(r.x, 0, r.outer, lowerAngle, upperAngle, true);
    shape.lineTo(b.xMin, b.leftHalfDepth);
    shape.closePath();
    return shape;
  }

  function extrudedGeometry(shape, depth, axis = 'z', curveSegments = 48) {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
    geometry.translate(0, 0, -depth / 2);
    if (axis === 'x') geometry.rotateY(Math.PI / 2);
    if (axis === 'y') geometry.rotateX(-Math.PI / 2);
    geometry.computeVertexNormals();
    return geometry;
  }

  function geometrySpec(geometry, position = [0, 0, 0], rotation = [0, 0, 0]) {
    return { geometry, position, rotation };
  }

  function transformedGeometry(spec) {
    const geometry = spec.geometry.clone();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(spec.rotation || [0, 0, 0])));
    matrix.compose(
      new THREE.Vector3(...(spec.position || [0, 0, 0])),
      quaternion,
      new THREE.Vector3(1, 1, 1)
    );
    geometry.applyMatrix4(matrix);
    geometry.clearGroups();
    geometry.deleteAttribute('uv');
    return geometry;
  }

  function brushFromSpec(spec) {
    const brush = new Brush(transformedGeometry(spec));
    brush.updateMatrixWorld(true);
    return brush;
  }

  function finalizeCsgGeometry(result) {
    const geometry = result.geometry.clone();
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    const welded = mergeVertices(geometry, 1e-3);
    const creased = toCreasedNormals(welded, Math.PI / 5);
    creased.computeBoundingBox();
    creased.computeBoundingSphere();
    creased.userData.projectionEdgeThreshold = 20;
    return creased;
  }

  function evaluateCsgSpecs(baseSpecs, cutterSpecs = []) {
    if (!baseSpecs.length) throw new TypeError('At least one base solid is required for CSG evaluation.');
    let result = brushFromSpec(baseSpecs[0]);
    baseSpecs.slice(1).forEach(spec => {
      const addition = brushFromSpec(spec);
      result = evaluator.evaluate(result, addition, ADDITION);
      result.updateMatrixWorld(true);
    });
    cutterSpecs.forEach(spec => {
      const cutter = brushFromSpec(spec);
      result = evaluator.evaluate(result, cutter, SUBTRACTION);
      result.updateMatrixWorld(true);
    });
    return finalizeCsgGeometry(result);
  }

  function subtractSpecs(baseSpec, cutterSpecs) {
    return evaluateCsgSpecs([baseSpec], cutterSpecs);
  }

  function addCsgResult(parent, name, baseSpec, cutterSpecs, color, options = {}) {
    let geometry;
    try {
      geometry = cutterSpecs.length ? subtractSpecs(baseSpec, cutterSpecs) : transformedGeometry(baseSpec);
    } catch (error) {
      console.error(`布尔差集失败：${name}`, error);
      geometry = transformedGeometry(baseSpec);
    }
    if (options.projectionSilhouetteOnly) geometry.userData.projectionSilhouetteOnly = true;
    if (options.projectionAnalyticOnly) geometry.userData.projectionAnalyticOnly = true;
    if (options.projectionEdgeThreshold) geometry.userData.projectionEdgeThreshold = options.projectionEdgeThreshold;
    return addMesh(parent, name, geometry, color, {
      castShadow: options.castShadow,
      receiveShadow: options.receiveShadow,
      material: { side: THREE.DoubleSide, ...(options.material || {}) }
    });
  }

  function addCsgComposite(parent, name, baseSpecs, cutterSpecs, color, options = {}) {
    let geometry;
    try {
      geometry = evaluateCsgSpecs(baseSpecs, cutterSpecs);
    } catch (error) {
      console.error(`组合体布尔运算失败：${name}`, error);
      geometry = transformedGeometry(baseSpecs[0]);
    }
    if (options.projectionSilhouetteOnly) geometry.userData.projectionSilhouetteOnly = true;
    if (options.projectionAnalyticOnly) geometry.userData.projectionAnalyticOnly = true;
    if (options.projectionEdgeThreshold) geometry.userData.projectionEdgeThreshold = options.projectionEdgeThreshold;
    return addMesh(parent, name, geometry, color, {
      castShadow: options.castShadow,
      receiveShadow: options.receiveShadow,
      material: { side: THREE.DoubleSide, ...(options.material || {}) }
    });
  }

  function addPreciseEdgeOverlay(parent, name, points, options = {}) {
    if (!points.length) return null;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(points.flat());
    const edgeMaterial = new LineMaterial({
      color: options.color || COLORS.dark,
      linewidth: options.linewidth || 3.4,
      transparent: true,
      opacity: 0.96,
      depthTest: true,
      depthWrite: false,
      alphaToCoverage: true
    });
    edgeMaterial.resolution.set(
      Math.max(1, rendererElement?.clientWidth || 1),
      Math.max(1, rendererElement?.clientHeight || 1)
    );
    const overlay = new LineSegments2(geometry, edgeMaterial);
    overlay.name = name;
    overlay.frustumCulled = false;
    overlay.renderOrder = 13;
    overlay.userData.compoundEdgeOverlay = true;
    overlay.userData.preciseEdgeOverlay = true;
    overlay.userData.excludeFromProjection = true;
    parent.add(overlay);
    return overlay;
  }

  function addProjectionGuide(parent, name, points, options = {}) {
    if (!points.length) return null;
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
    const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ transparent: true, opacity: 0 }));
    line.name = name;
    line.userData.projectionGuide = true;
    line.userData.projectionViews = options.views || [];
    line.userData.projectionLineStyle = options.style || 'auto';
    line.frustumCulled = false;
    parent.add(line);
    return line;
  }

  function appendArcSegments(points, center, radius, startAngle, endAngle, segments, predicate = () => true) {
    for (let index = 0; index < segments; index += 1) {
      const a0 = startAngle + (endAngle - startAngle) * index / segments;
      const a1 = startAngle + (endAngle - startAngle) * (index + 1) / segments;
      const mid = (a0 + a1) / 2;
      if (!predicate(mid)) continue;
      points.push(
        [center[0] + Math.cos(a0) * radius, center[1], center[2] + Math.sin(a0) * radius],
        [center[0] + Math.cos(a1) * radius, center[1], center[2] + Math.sin(a1) * radius]
      );
    }
  }

  function appendCircleSegments(points, center, radius, plane, segments = 72) {
    const pointAt = angle => {
      const a = Math.cos(angle) * radius;
      const b = Math.sin(angle) * radius;
      if (plane === 'xy') return [center[0] + a, center[1] + b, center[2]];
      if (plane === 'yz') return [center[0], center[1] + a, center[2] + b];
      return [center[0] + a, center[1], center[2] + b];
    };
    for (let index = 0; index < segments; index += 1) {
      points.push(
        pointAt(Math.PI * 2 * index / segments),
        pointAt(Math.PI * 2 * (index + 1) / segments)
      );
    }
  }

  function appendPlaneArcSegments(points, center, radius, plane, startAngle, endAngle, segments = 36) {
    const pointAt = angle => {
      const a = Math.cos(angle) * radius;
      const b = Math.sin(angle) * radius;
      if (plane === 'xy') return [center[0] + a, center[1] + b, center[2]];
      if (plane === 'yz') return [center[0], center[1] + a, center[2] + b];
      return [center[0] + a, center[1], center[2] + b];
    };
    for (let index = 0; index < segments; index += 1) {
      const a0 = startAngle + (endAngle - startAngle) * index / segments;
      const a1 = startAngle + (endAngle - startAngle) * (index + 1) / segments;
      points.push(pointAt(a0), pointAt(a1));
    }
  }

  function addSpecMesh(parent, name, spec, color, options = {}) {
    return addMesh(parent, name, spec.geometry.clone(), color, {
      ...options,
      position: spec.position,
      rotation: spec.rotation
    });
  }

  function addBox(parent, name, size, position, color = COLORS.add, options = {}) {
    return addMesh(parent, name, new THREE.BoxGeometry(...size), color, { ...options, position });
  }

  function addCylinder(parent, name, radius, length, axis, position, color = COLORS.add, options = {}) {
    const rotation = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return addMesh(parent, name, new THREE.CylinderGeometry(radius, radius, length, options.segments || 64), color, {
      ...options,
      position,
      rotation
    });
  }

  function addToolComponent(root, cutter, specs, explodeVector) {
    const component = makeComponent(root, cutter.id, cutter.label, explodeVector, 'subtract');
    const applied = state.appliedCutters.includes(cutter.id);
    specs.forEach((spec, index) => {
      addSpecMesh(component, `${cutter.id}_tool_${index + 1}`, spec, applied ? COLORS.toolApplied : COLORS.tool, {
        booleanTool: true,
        cutterId: cutter.id,
        material: {
          transparent: true,
          opacity: applied ? 0.4 : 0.58,
          depthWrite: false,
          side: THREE.DoubleSide
        }
      });
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(spec.geometry, 22),
        new THREE.LineBasicMaterial({ color: applied ? 0x8b4b08 : 0x9a5d0b, transparent: true, opacity: 0.96 })
      );
      outline.name = `${cutter.id}_tool_outline_${index + 1}`;
      outline.position.fromArray(spec.position || [0, 0, 0]);
      if (spec.rotation) outline.rotation.set(...spec.rotation);
      outline.userData.excludeFromProjection = true;
      component.add(outline);
    });
    return component;
  }

  function cutterDefinition(id) {
    return lesson.cutters?.find(cutter => cutter.id === id) || null;
  }

  function cutterValues(id) {
    return state.cutterValues[id] || cutterDefinition(id)?.defaults || {};
  }

  function isApplied(id) {
    return state.appliedCutters.includes(id);
  }

  function assemblyPartDefinition(id) {
    return lesson.assembly?.parts?.find(part => part.id === id) || null;
  }

  function assemblyOffset(id) {
    return state.assemblyOffsets?.[id] || { x: 0, y: 0, z: 0 };
  }

  function currentAssemblyOffset(id) {
    if (!assemblyCurrentOffsets.has(id)) {
      const value = assemblyOffset(id);
      assemblyCurrentOffsets.set(id, new THREE.Vector3(value.x, value.y, value.z));
    }
    return assemblyCurrentOffsets.get(id);
  }

  function isDetached(id) {
    return state.detachedComponents?.includes(id) || false;
  }

  function markDetached(id, detached) {
    state.detachedComponents = detached
      ? [...new Set([...(state.detachedComponents || []), id])]
      : (state.detachedComponents || []).filter(partId => partId !== id);
  }

  function assemblyPartAvailable(part) {
    return lesson.stages[state.stageIndex].visible.includes(part.id);
  }

  function buildExample51() {
    const root = createRoot('example51');
    const {
      baseWidth,
      baseDepth,
      baseThickness,
      uprightOuterRadius,
      uprightThickness,
      barrelOuterRadius: barrelOuter,
      barrelInnerRadius: barrelInner,
      barrelCenterY,
      ribTopY
    } = EXAMPLE51_DIMENSIONS;
    const baseFrontZ = baseDepth / 2;
    const uprightRearZ = -1.4;
    const uprightFrontZ = uprightRearZ + uprightThickness;
    const barrelLength = baseFrontZ - uprightFrontZ;
    const barrelCenterZ = (baseFrontZ + uprightFrontZ) / 2;

    const baseShape = frontRoundedBaseShape(baseWidth, baseDepth, 0.42);
    ['base-hole-left', 'base-hole-right'].forEach(id => {
      if (!isApplied(id)) return;
      const values = cutterValues(id);
      const hole = new THREE.Path();
      hole.absarc(values.x, -values.z, 0.18, 0, Math.PI * 2, true);
      baseShape.holes.push(hole);
    });
    const base = makeComponent(root, 'base', 'A0·底板', [0, -1.05, 0], 'base');
    const baseGeometry = extrudedGeometry(baseShape, baseThickness, 'y');
    baseGeometry.userData.projectionAnalyticOnly = true;
    addMesh(
      base,
      'example51_front_rounded_base',
      baseGeometry,
      COLORS.base,
      { position: [0, baseThickness / 2, 0], castShadow: false, receiveShadow: false }
    );
    const baseHalfWidth = baseWidth / 2;
    const baseHalfDepth = baseDepth / 2;
    addProjectionGuide(base, 'example51_base_front_outline', [
      [-baseHalfWidth, 0, baseFrontZ], [baseHalfWidth, 0, baseFrontZ],
      [baseHalfWidth, 0, baseFrontZ], [baseHalfWidth, baseThickness, baseFrontZ],
      [baseHalfWidth, baseThickness, baseFrontZ], [-baseHalfWidth, baseThickness, baseFrontZ],
      [-baseHalfWidth, baseThickness, baseFrontZ], [-baseHalfWidth, 0, baseFrontZ]
    ], { views: ['front'], style: 'visible' });
    addProjectionGuide(base, 'example51_base_side_outline', [
      [baseHalfWidth, 0, -baseHalfDepth], [baseHalfWidth, 0, baseHalfDepth],
      [baseHalfWidth, 0, baseHalfDepth], [baseHalfWidth, baseThickness, baseHalfDepth],
      [baseHalfWidth, baseThickness, baseHalfDepth], [baseHalfWidth, baseThickness, -baseHalfDepth],
      [baseHalfWidth, baseThickness, -baseHalfDepth], [baseHalfWidth, 0, -baseHalfDepth]
    ], { views: ['side'], style: 'visible' });
    const baseTopOutline = [
      [-baseHalfWidth, baseThickness, -baseHalfDepth], [baseHalfWidth, baseThickness, -baseHalfDepth],
      [baseHalfWidth, baseThickness, -baseHalfDepth], [baseHalfWidth, baseThickness, baseHalfDepth - 0.42]
    ];
    appendPlaneArcSegments(
      baseTopOutline,
      [baseHalfWidth - 0.42, baseThickness, baseHalfDepth - 0.42],
      0.42,
      'xz',
      0,
      Math.PI / 2,
      14
    );
    baseTopOutline.push(
      [baseHalfWidth - 0.42, baseThickness, baseHalfDepth], [-baseHalfWidth + 0.42, baseThickness, baseHalfDepth]
    );
    appendPlaneArcSegments(
      baseTopOutline,
      [-baseHalfWidth + 0.42, baseThickness, baseHalfDepth - 0.42],
      0.42,
      'xz',
      Math.PI / 2,
      Math.PI,
      14
    );
    baseTopOutline.push(
      [-baseHalfWidth, baseThickness, baseHalfDepth - 0.42], [-baseHalfWidth, baseThickness, -baseHalfDepth]
    );
    addProjectionGuide(base, 'example51_base_top_outline', baseTopOutline, { views: ['top'], style: 'visible' });

    const upright = makeComponent(root, 'upright', 'A1·拱顶立板', [-1.55, 0.85, -0.85]);
    const uprightGeometry = extrudedGeometry(
      archedUprightShape(uprightOuterRadius, barrelCenterY - baseThickness),
      uprightThickness,
      'z'
    );
    uprightGeometry.userData.projectionAnalyticOnly = true;
    addMesh(
      upright,
      'example51_arched_upright',
      uprightGeometry,
      COLORS.addAlt,
      {
        position: [0, baseThickness, (uprightRearZ + uprightFrontZ) / 2],
        castShadow: false,
        receiveShadow: false
      }
    );
    const uprightFrontOutline = [
      [-uprightOuterRadius, baseThickness, uprightFrontZ], [-uprightOuterRadius, barrelCenterY, uprightFrontZ],
      [uprightOuterRadius, barrelCenterY, uprightFrontZ], [uprightOuterRadius, baseThickness, uprightFrontZ]
    ];
    appendPlaneArcSegments(
      uprightFrontOutline,
      [0, barrelCenterY, uprightFrontZ],
      uprightOuterRadius,
      'xy',
      0,
      Math.PI,
      40
    );
    addProjectionGuide(upright, 'example51_upright_front_outline', uprightFrontOutline, {
      views: ['front'],
      style: 'visible'
    });
    const uprightTopY = barrelCenterY + uprightOuterRadius;
    addProjectionGuide(upright, 'example51_upright_side_outline', [
      [uprightOuterRadius, baseThickness, uprightRearZ], [uprightOuterRadius, uprightTopY, uprightRearZ],
      [uprightOuterRadius, uprightTopY, uprightRearZ], [uprightOuterRadius, uprightTopY, uprightFrontZ],
      [uprightOuterRadius, uprightTopY, uprightFrontZ], [uprightOuterRadius, baseThickness, uprightFrontZ],
      [uprightOuterRadius, baseThickness, uprightFrontZ], [uprightOuterRadius, baseThickness, uprightRearZ]
    ], { views: ['side'], style: 'visible' });
    addProjectionGuide(upright, 'example51_upright_top_outline', [
      [-uprightOuterRadius, uprightTopY, uprightRearZ], [uprightOuterRadius, uprightTopY, uprightRearZ],
      [uprightOuterRadius, uprightTopY, uprightRearZ], [uprightOuterRadius, uprightTopY, uprightFrontZ],
      [uprightOuterRadius, uprightTopY, uprightFrontZ], [-uprightOuterRadius, uprightTopY, uprightFrontZ],
      [-uprightOuterRadius, uprightTopY, uprightFrontZ], [-uprightOuterRadius, uprightTopY, uprightRearZ]
    ], { views: ['top'], style: 'visible' });

    const boreValues = cutterValues('bore');
    const barrel = makeComponent(root, 'barrel', 'A2·水平圆筒', [1.45, 1.45, 0.95]);
    const barrelSpec = geometrySpec(
      new THREE.CylinderGeometry(barrelOuter, barrelOuter, barrelLength, 72),
      [0, barrelCenterY, barrelCenterZ],
      [Math.PI / 2, 0, 0]
    );
    const boreSpec = geometrySpec(
      new THREE.CylinderGeometry(barrelInner, barrelInner, barrelLength + 0.42, 72),
      [boreValues.x, boreValues.y, barrelCenterZ],
      [Math.PI / 2, 0, 0]
    );
    addCsgResult(
      barrel,
      'example51_barrel_live_result',
      barrelSpec,
      isApplied('bore') ? [boreSpec] : [],
      COLORS.add,
      { projectionAnalyticOnly: true, projectionEdgeThreshold: 20, castShadow: false, receiveShadow: false }
    );

    const rib = makeComponent(root, 'rib', 'A3·矩形肋板', [0.8, 0.85, -1.45]);
    const ribMesh = addBox(
      rib,
      'example51_rectangular_rib',
      [0.34, ribTopY - baseThickness, barrelLength],
      [0, (ribTopY + baseThickness) / 2, barrelCenterZ],
      COLORS.feature,
      { castShadow: false, receiveShadow: false }
    );
    ribMesh.geometry.userData.projectionAnalyticOnly = true;

    addProjectionGuide(barrel, 'example51_barrel_side_outline', [
      [barrelOuter, barrelCenterY - barrelOuter, uprightFrontZ], [barrelOuter, barrelCenterY + barrelOuter, uprightFrontZ],
      [barrelOuter, barrelCenterY + barrelOuter, uprightFrontZ], [barrelOuter, barrelCenterY + barrelOuter, baseFrontZ],
      [barrelOuter, barrelCenterY + barrelOuter, baseFrontZ], [barrelOuter, barrelCenterY - barrelOuter, baseFrontZ],
      [barrelOuter, barrelCenterY - barrelOuter, baseFrontZ], [barrelOuter, barrelCenterY - barrelOuter, uprightFrontZ]
    ], { views: ['side'], style: 'visible' });
    addProjectionGuide(barrel, 'example51_barrel_top_outline', [
      [-barrelOuter, barrelCenterY, uprightFrontZ], [barrelOuter, barrelCenterY, uprightFrontZ],
      [barrelOuter, barrelCenterY, uprightFrontZ], [barrelOuter, barrelCenterY, baseFrontZ],
      [barrelOuter, barrelCenterY, baseFrontZ], [-barrelOuter, barrelCenterY, baseFrontZ],
      [-barrelOuter, barrelCenterY, baseFrontZ], [-barrelOuter, barrelCenterY, uprightFrontZ]
    ], { views: ['top'], style: 'visible' });
    addProjectionGuide(rib, 'example51_rib_front_outline', [
      [-0.17, baseThickness, baseFrontZ], [-0.17, ribTopY, baseFrontZ],
      [-0.17, ribTopY, baseFrontZ], [0.17, ribTopY, baseFrontZ],
      [0.17, ribTopY, baseFrontZ], [0.17, baseThickness, baseFrontZ]
    ], { views: ['front'], style: 'visible' });
    addProjectionGuide(rib, 'example51_rib_side_outline', [
      [0.17, baseThickness, uprightFrontZ], [0.17, ribTopY, uprightFrontZ],
      [0.17, ribTopY, uprightFrontZ], [0.17, ribTopY, baseFrontZ],
      [0.17, ribTopY, baseFrontZ], [0.17, baseThickness, baseFrontZ],
      [0.17, baseThickness, baseFrontZ], [0.17, baseThickness, uprightFrontZ]
    ], { views: ['side'], style: 'visible' });

    const barrelFrontZ = baseFrontZ + 0.004;
    const barrelFrontVisible = [];
    appendCircleSegments(barrelFrontVisible, [0, barrelCenterY, barrelFrontZ], barrelOuter, 'xy');
    if (isApplied('bore')) {
      appendCircleSegments(barrelFrontVisible, [boreValues.x, boreValues.y, barrelFrontZ], barrelInner, 'xy');
    }
    addProjectionGuide(barrel, 'example51_barrel_front_circles', barrelFrontVisible, {
      views: ['front'],
      style: 'visible'
    });

    if (isApplied('bore')) {
      addProjectionGuide(barrel, 'example51_bore_hidden_side', [
        [0, boreValues.y - barrelInner, uprightFrontZ], [0, boreValues.y - barrelInner, baseFrontZ],
        [0, boreValues.y + barrelInner, uprightFrontZ], [0, boreValues.y + barrelInner, baseFrontZ]
      ], { views: ['side'], style: 'hidden' });
      addProjectionGuide(barrel, 'example51_bore_hidden_top', [
        [boreValues.x - barrelInner, barrelCenterY, uprightFrontZ], [boreValues.x - barrelInner, barrelCenterY, baseFrontZ],
        [boreValues.x + barrelInner, barrelCenterY, uprightFrontZ], [boreValues.x + barrelInner, barrelCenterY, baseFrontZ]
      ], { views: ['top'], style: 'hidden' });
    }

    // 图5-2c明确规定：肋板位于圆筒下方，其水平投影不可见，画细虚线。
    addProjectionGuide(rib, 'example51_rib_hidden_top', [
      [-0.17, ribTopY, uprightFrontZ], [-0.17, ribTopY, baseFrontZ],
      [0.17, ribTopY, uprightFrontZ], [0.17, ribTopY, baseFrontZ]
    ], { views: ['top'], style: 'hidden' });

    const baseHoleTopVisible = [];
    const baseHoleFrontHidden = [];
    const baseHoleSideHidden = [];
    ['base-hole-left', 'base-hole-right'].forEach(id => {
      if (!isApplied(id)) return;
      const values = cutterValues(id);
      appendCircleSegments(baseHoleTopVisible, [values.x, baseThickness + 0.004, values.z], 0.18, 'xz', 48);
      baseHoleFrontHidden.push(
        [values.x - 0.18, 0, values.z], [values.x - 0.18, baseThickness, values.z],
        [values.x + 0.18, 0, values.z], [values.x + 0.18, baseThickness, values.z]
      );
      baseHoleSideHidden.push(
        [values.x, 0, values.z - 0.18], [values.x, baseThickness, values.z - 0.18],
        [values.x, 0, values.z + 0.18], [values.x, baseThickness, values.z + 0.18]
      );
    });
    addProjectionGuide(base, 'example51_base_holes_top', baseHoleTopVisible, { views: ['top'], style: 'visible' });
    addProjectionGuide(base, 'example51_base_holes_front_hidden', baseHoleFrontHidden, { views: ['front'], style: 'hidden' });
    addProjectionGuide(base, 'example51_base_holes_side_hidden', baseHoleSideHidden, { views: ['side'], style: 'hidden' });

    const cutterSpecs = {
      bore: [boreSpec],
      'base-hole-left': [geometrySpec(
        new THREE.CylinderGeometry(0.18, 0.18, baseThickness + 0.42, 48),
        [cutterValues('base-hole-left').x, baseThickness / 2, cutterValues('base-hole-left').z]
      )],
      'base-hole-right': [geometrySpec(
        new THREE.CylinderGeometry(0.18, 0.18, baseThickness + 0.42, 48),
        [cutterValues('base-hole-right').x, baseThickness / 2, cutterValues('base-hole-right').z]
      )]
    };
    addToolComponent(root, cutterDefinition('bore'), cutterSpecs.bore, [0, 1.35, 1.45]);
    addToolComponent(root, cutterDefinition('base-hole-left'), cutterSpecs['base-hole-left'], [-1.1, 0.9, 1.1]);
    addToolComponent(root, cutterDefinition('base-hole-right'), cutterSpecs['base-hole-right'], [1.1, 0.9, 1.1]);
    return root;
  }

  function example55Construction(parameters = {}) {
    return createExample55Construction({
      cutterValues: {
        'cut-p': cutterValues('cut-p'),
        'cut-q': cutterValues('cut-q'),
        'cut-slot': cutterValues('cut-slot')
      },
      slotLength: parameters.slotLength
    });
  }

  function example55CutterSpecs(parameters = {}, construction = example55Construction(parameters)) {
    const { p, q, slot, slotLength } = construction;
    const pSpec = geometrySpec(
      // 图5-14：P 面从底部肩线附近起坡，并在顶面中部相交。
      extrudedGeometry(polygonShape([[-2.45, 2.95], [-2.45, 0.35], [0.45, 2.95]]), 3.25, 'z'),
      [p.x, p.y, 0]
    );
    const qFront = geometrySpec(
      // Q 面在左视图中形成低肩线与对称斜顶；肩线应低于 B3 槽顶。
      extrudedGeometry(polygonShape([[-1.72, 2.95], [-1.72, 0.25], [-0.48, 2.95]]), 4.85, 'x'),
      [0, q.y, q.z]
    );
    const qRear = geometrySpec(
      extrudedGeometry(polygonShape([[1.72, 2.95], [1.72, 0.25], [0.48, 2.95]]), 4.85, 'x'),
      [0, q.y, -q.z]
    );
    // B3从底面穿出；教材默认长度 5.0 格，超出四棱柱两端形成全长贯穿槽。
    const slotSpec = geometrySpec(new THREE.BoxGeometry(slotLength, 1.5, 1.6), [slot.x, 0.3, slot.z]);
    return { 'cut-p': [pSpec], 'cut-q': [qFront, qRear], 'cut-slot': [slotSpec] };
  }

  function addExample55ProjectionGuides(root, construction) {
    const blueprint = createExample55ProjectionBlueprint({
      construction,
      appliedCutters: state.appliedCutters
    });
    const { front, side, top, slotOpenAtViewedEnd } = blueprint;
    // Retain the named condition because it is also part of the interactive
    // local-slot behavior: only a cutter reaching the viewed end opens the U.
    void slotOpenAtViewedEnd;
    addProjectionGuide(root, 'example55_front_visible', flattenProjectionSegments(front.visible), { views: ['front'], style: 'visible' });
    addProjectionGuide(root, 'example55_front_hidden', flattenProjectionSegments(front.hidden), { views: ['front'], style: 'hidden' });
    addProjectionGuide(root, 'example55_side_visible', flattenProjectionSegments(side.visible), { views: ['side'], style: 'visible' });
    addProjectionGuide(root, 'example55_side_hidden', flattenProjectionSegments(side.hidden), { views: ['side'], style: 'hidden' });
    addProjectionGuide(root, 'example55_top_visible', flattenProjectionSegments(top.visible), { views: ['top'], style: 'visible' });
    addProjectionGuide(root, 'example55_top_hidden', flattenProjectionSegments(top.hidden), { views: ['top'], style: 'hidden-emphasis' });
  }

  function addExample55PreciseEdges(root, construction) {
    const b = EXAMPLE55_BODY;
    const pApplied = isApplied('cut-p');
    const qApplied = isApplied('cut-q');
    const slotApplied = isApplied('cut-slot') && construction.slotXMax > construction.slotXMin;
    const points = [];
    const add = (a, c) => points.push(a, c);

    // 顶面是P、Q两切平面共同保留下来的精确矩形区域。
    const topXMin = pApplied ? construction.pTopX : b.xMin;
    const topZMin = qApplied ? construction.qRearTopZ : b.zMin;
    const topZMax = qApplied ? construction.qFrontTopZ : b.zMax;
    add([topXMin, b.yMax, topZMin], [b.xMax, b.yMax, topZMin]);
    add([b.xMax, b.yMax, topZMin], [b.xMax, b.yMax, topZMax]);
    add([b.xMax, b.yMax, topZMax], [topXMin, b.yMax, topZMax]);
    add([topXMin, b.yMax, topZMax], [topXMin, b.yMax, topZMin]);

    // 前、后端面上的P/Q交线按真实端面高度绘制，不再从CSG三角片提边。
    const addEndFace = (z, qLimitY) => {
      const topY = qApplied ? qLimitY : b.yMax;
      const leftY = pApplied ? Math.min(construction.pLeftY, topY) : topY;
      add([b.xMin, b.yMin, z], [b.xMax, b.yMin, z]);
      add([b.xMin, b.yMin, z], [b.xMin, leftY, z]);
      if (pApplied && topY > construction.pLeftY + 1e-5) {
        const joinX = clamp(construction.pXAt(topY), b.xMin, b.xMax);
        add([b.xMin, construction.pLeftY, z], [joinX, topY, z]);
        add([joinX, topY, z], [b.xMax, topY, z]);
      } else {
        add([b.xMin, topY, z], [b.xMax, topY, z]);
      }
      add([b.xMax, b.yMin, z], [b.xMax, topY, z]);
    };
    addEndFace(b.zMax, construction.qFrontShoulderY);
    addEndFace(b.zMin, construction.qRearShoulderY);

    // 右端面给出Q面对称斜顶和B3的真实U形开口。
    if (qApplied) {
      add([b.xMax, b.yMin, b.zMin], [b.xMax, construction.qRearShoulderY, b.zMin]);
      add([b.xMax, construction.qRearShoulderY, b.zMin], [b.xMax, b.yMax, construction.qRearTopZ]);
      add([b.xMax, b.yMax, construction.qRearTopZ], [b.xMax, b.yMax, construction.qFrontTopZ]);
      add([b.xMax, b.yMax, construction.qFrontTopZ], [b.xMax, construction.qFrontShoulderY, b.zMax]);
      add([b.xMax, construction.qFrontShoulderY, b.zMax], [b.xMax, b.yMin, b.zMax]);
    } else {
      add([b.xMax, b.yMin, b.zMin], [b.xMax, b.yMax, b.zMin]);
      add([b.xMax, b.yMax, b.zMin], [b.xMax, b.yMax, b.zMax]);
      add([b.xMax, b.yMax, b.zMax], [b.xMax, b.yMin, b.zMax]);
    }

    const slotOpenAtLeft = slotApplied
      && construction.slotXMin <= b.xMin + 1e-5
      && construction.slotXMax >= b.xMin - 1e-5;
    const slotOpenAtRight = slotApplied
      && construction.slotXMin <= b.xMax + 1e-5
      && construction.slotXMax >= b.xMax - 1e-5;
    if (slotOpenAtRight) {
      add([b.xMax, b.yMin, b.zMin], [b.xMax, b.yMin, construction.slotZMin]);
      add([b.xMax, b.yMin, construction.slotZMin], [b.xMax, construction.slotTopY, construction.slotZMin]);
      add([b.xMax, construction.slotTopY, construction.slotZMin], [b.xMax, construction.slotTopY, construction.slotZMax]);
      add([b.xMax, construction.slotTopY, construction.slotZMax], [b.xMax, b.yMin, construction.slotZMax]);
      add([b.xMax, b.yMin, construction.slotZMax], [b.xMax, b.yMin, b.zMax]);
    } else {
      add([b.xMax, b.yMin, b.zMin], [b.xMax, b.yMin, b.zMax]);
    }

    if (slotApplied) {
      const x0 = construction.slotXMin;
      const x1 = construction.slotXMax;
      const y0 = b.yMin;
      const y1 = construction.slotTopY;
      const z0 = construction.slotZMin;
      const z1 = construction.slotZMax;
      add([x0, y1, z0], [x1, y1, z0]);
      add([x0, y1, z1], [x1, y1, z1]);
      add([x0, y0, z0], [x1, y0, z0]);
      add([x0, y0, z1], [x1, y0, z1]);
      // 局部槽需要画两道止端交线；贯穿槽的远端洞口则交给深度遮挡，
      // 避免人工叠线越过实体形成“悬空方框”。近端U形口已在上方单独绘制。
      if (!slotOpenAtLeft) {
        add([x0, y0, z0], [x0, y1, z0]);
        add([x0, y1, z0], [x0, y1, z1]);
        add([x0, y1, z1], [x0, y0, z1]);
      }
      if (!slotOpenAtRight) {
        add([x1, y0, z0], [x1, y1, z0]);
        add([x1, y1, z0], [x1, y1, z1]);
        add([x1, y1, z1], [x1, y0, z1]);
      }
    }
    addPreciseEdgeOverlay(root, 'example55_precise_feature_edges', points);
  }

  function buildExample55(parameters = {}) {
    const root = createRoot('example55');
    const construction = example55Construction(parameters);
    const specs = example55CutterSpecs(parameters, construction);
    const bodySpec = geometrySpec(new THREE.BoxGeometry(4.4, 2.7, 2.8), [0, 1.35, 0]);
    const body = makeComponent(root, 'body', 'A·四棱柱/差集结果', [0, -0.75, 0], 'base');
    const result = addCsgResult(
      body,
      'example55_live_result',
      bodySpec,
      lesson.cutters.filter(cutter => isApplied(cutter.id)).flatMap(cutter => specs[cutter.id]),
      state.appliedCutters.length ? COLORS.result : COLORS.base,
      {
        projectionEdgeThreshold: 28,
        castShadow: false,
        receiveShadow: false,
        material: { roughness: 0.62, metalness: 0 }
      }
    );
    // Reproject the current Boolean solid while a tool moves. A separately
    // drawn blueprint cannot track occlusion or a slot opening at the left end.
    addExample55PreciseEdges(body, construction);
    addToolComponent(root, cutterDefinition('cut-p'), specs['cut-p'], [-1.45, 1.2, 0]);
    addToolComponent(root, cutterDefinition('cut-q'), specs['cut-q'], [0, 1.05, 1.3]);
    addToolComponent(root, cutterDefinition('cut-slot'), specs['cut-slot'], [-1.2, -0.7, 1.35]);
    return root;
  }

  const EXAMPLE56_BASE = EXAMPLE56_DIMENSIONS.base;
  const EXAMPLE56_RING = EXAMPLE56_DIMENSIONS.ring;

  function example56BaseSlotConstruction() {
    return createExample56BaseSlot(cutterValues('cut-v'));
  }

  function example56CutterSpecs(slot) {
    const iii = cutterValues('cut-iii');
    const iv = cutterValues('cut-iv');
    const cutterTop = EXAMPLE56_RING.top + 0.25;
    const iiiFloor = iii.y - 0.525;
    const iiiHeight = cutterTop - iiiFloor;
    const ivStraightHeight = cutterTop - iv.y;
    return {
      'cut-iii': [geometrySpec(
        new THREE.BoxGeometry(0.7, iiiHeight, 1.3),
        [iii.x, (cutterTop + iiiFloor) / 2, 0.78]
      )],
      'cut-iv': [geometrySpec(
        extrudedGeometry(roundedBottomSlotShape(0.7, ivStraightHeight, 0.35), 1.32, 'z'),
        [iv.x, iv.y, -0.78]
      )],
      'cut-v': [geometrySpec(
        new THREE.BoxGeometry(slot.toolLength, slot.height, slot.toolWidth),
        [slot.toolCenterX, (slot.yMin + slot.yMax) / 2, slot.toolCenterZ]
      )]
    };
  }

  function addExample56ProjectionGuides(body, slot) {
    const blueprint = createExample56ProjectionBlueprint({
      appliedCutters: state.appliedCutters,
      cutterValues: {
        'cut-iii': cutterValues('cut-iii'),
        'cut-iv': cutterValues('cut-iv'),
        'cut-v': cutterValues('cut-v')
      },
      slot
    });
    addProjectionGuide(body, 'example56_front_visible', flattenProjectionSegments(blueprint.front.visible), { views: ['front'], style: 'visible' });
    addProjectionGuide(body, 'example56_front_hidden', flattenProjectionSegments(blueprint.front.hidden), { views: ['front'], style: 'hidden' });
    addProjectionGuide(body, 'example56_top_visible', flattenProjectionSegments(blueprint.top.visible), { views: ['top'], style: 'visible' });
    addProjectionGuide(body, 'example56_top_hidden', flattenProjectionSegments(blueprint.top.hidden), { views: ['top'], style: 'hidden-emphasis' });
    addProjectionGuide(body, 'example56_side_visible', flattenProjectionSegments(blueprint.side.visible), { views: ['side'], style: 'visible' });
    addProjectionGuide(body, 'example56_side_hidden', flattenProjectionSegments(blueprint.side.hidden), { views: ['side'], style: 'hidden' });
  }

  function addExample56PreciseEdges(body, slot) {
    if (!isApplied('cut-v')) return;
    const xMin = EXAMPLE56_BASE.xMin;
    const xMax = slot.xMax;
    const halfDepthLeft = example56BaseHalfDepthAt(xMin);
    const halfDepthStop = example56BaseHalfDepthAt(xMax);
    const points = [
      [xMin, slot.yMin, -halfDepthLeft], [xMax, slot.yMin, -halfDepthStop],
      [xMin, slot.yMin, halfDepthLeft], [xMax, slot.yMin, halfDepthStop],
      [xMin, slot.yMax, -halfDepthLeft], [xMax, slot.yMax, -halfDepthStop],
      [xMin, slot.yMax, halfDepthLeft], [xMax, slot.yMax, halfDepthStop],
      [xMax, slot.yMin, -halfDepthStop], [xMax, slot.yMin, halfDepthStop],
      [xMax, slot.yMax, -halfDepthStop], [xMax, slot.yMax, halfDepthStop],
      [xMax, slot.yMin, -halfDepthStop], [xMax, slot.yMax, -halfDepthStop],
      [xMax, slot.yMin, halfDepthStop], [xMax, slot.yMax, halfDepthStop]
    ];
    addPreciseEdgeOverlay(body, 'example56_base_slot_precise_edges', points, { linewidth: 4.2 });
  }

  function buildExample56() {
    const root = createRoot('example56');
    const slot = example56BaseSlotConstruction();
    const specs = example56CutterSpecs(slot);
    // Give the source primitives a small overlap before union so the result is
    // watertight instead of two tangent shells sharing a coplanar face.
    const ringHeight = EXAMPLE56_RING.top - EXAMPLE56_RING.bottom;
    const ringSpec = geometrySpec(
      extrudedGeometry(ringShape(EXAMPLE56_RING.outer, EXAMPLE56_RING.inner), ringHeight, 'y'),
      [EXAMPLE56_RING.x, (EXAMPLE56_RING.top + EXAMPLE56_RING.bottom) / 2, 0]
    );
    const baseSpec = geometrySpec(
      extrudedGeometry(basePlanShape(), EXAMPLE56_BASE.top, 'y'),
      [0, EXAMPLE56_BASE.top / 2, 0]
    );

    const activeCutterSpecs = ['cut-iii', 'cut-iv', 'cut-v']
      .filter(isApplied)
      .flatMap(id => specs[id]);
    const body = makeComponent(root, 'body', 'A·Ⅰ+Ⅱ并集整体', [0, 0, 0], 'base');
    addCsgComposite(
      body,
      'example56_watertight_body',
      [baseSpec, ringSpec],
      activeCutterSpecs,
      state.appliedCutters.length ? COLORS.result : COLORS.add,
      {
        castShadow: false,
        receiveShadow: false,
        material: { flatShading: false, roughness: 0.58, metalness: 0 }
      }
    );
    // Keep live views tied to this same cut mesh. Exact BRep/HLR replaces both
    // the mesh and these views together once the worker completes.
    addExample56PreciseEdges(body, slot);

    addToolComponent(root, cutterDefinition('cut-iii'), specs['cut-iii'], [0, 1.35, 1.35]);
    addToolComponent(root, cutterDefinition('cut-iv'), specs['cut-iv'], [0, 1.35, -1.35]);
    addToolComponent(root, cutterDefinition('cut-v'), specs['cut-v'], [-1.5, 0.8, 0]);
    return root;
  }

  const builders = {
    example51: buildExample51,
    example55: buildExample55,
    example56: buildExample56
  };

  function setComponentVisibility(component, visible) {
    component.visible = visible;
    component.traverse(child => {
      if (!child.isMesh) return;
      child.visible = visible;
      if (child.userData.booleanTool) {
        child.userData.excludeFromProjection = state.isolatedComponent !== component.userData.chapter5Id;
      }
    });
  }

  function applyExplode(root = latestModelRoot) {
    if (!root) return;
    root.children.forEach(component => {
      const componentId = component.userData.chapter5Id;
      const home = component.userData.homePosition || [0, 0, 0];
      const vector = component.userData.explodeVector || [0, 0, 0];
      const assembly = assemblyPartDefinition(componentId)
        ? currentAssemblyOffset(componentId)
        : { x: 0, y: 0, z: 0 };
      component.position.set(
        home[0] + vector[0] * explodeCurrent + assembly.x,
        home[1] + vector[1] * explodeCurrent + assembly.y,
        home[2] + vector[2] * explodeCurrent + assembly.z
      );
    });
    root.updateMatrixWorld(true);
  }

  function applyVisibility(root = latestModelRoot) {
    if (!root) return;
    const visibleIds = new Set(visibleIdsForState(lesson, state));
    root.children.forEach(component => {
      if (component.userData?.exactKernel) {
        component.visible = exactKernelResultReady();
        return;
      }
      setComponentVisibility(component, visibleIds.has(component.userData.chapter5Id));
    });
    applyExplode(root);
  }

  function displayToolsActive() {
    return ['example-5-1', 'example-5-5', 'example-5-6'].includes(lesson.id);
  }

  function pointPickingActive() {
    return lesson.id === 'example-5-5';
  }

  function updateEdgeResolution(force = false) {
    if (!latestModelRoot || !displayToolsActive()) return;
    const width = Math.max(1, rendererElement?.clientWidth || 1);
    const height = Math.max(1, rendererElement?.clientHeight || 1);
    if (!force && width === edgeResolution.width && height === edgeResolution.height) return;
    edgeResolution = { width, height };
    latestModelRoot.traverse(object => {
      if (!object.userData?.compoundEdgeOverlay || !object.material?.resolution) return;
      object.material.resolution.set(width, height);
    });
  }

  function applyDisplayStyle(root = latestModelRoot) {
    if (!root || !displayToolsActive()) return;
    const display = state.display || {};
    root.traverse(object => {
      if (object.userData?.compoundEdgeOverlay) {
        object.visible = Boolean(display.boldEdges)
          && !(display.transparent && object.userData.hideWhenTransparent);
        object.material.depthTest = object.userData.preciseEdgeOverlay ? !display.transparent : true;
        object.material.opacity = display.transparent ? 0.88 : 0.96;
        object.material.needsUpdate = true;
        return;
      }
      if (!object.isMesh || object.userData?.pickedPointMarker) return;
      object.castShadow = Boolean(display.shadows);
      object.receiveShadow = Boolean(display.shadows);
      if (object.userData?.booleanTool) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(item => {
        if (!item) return;
        item.transparent = Boolean(display.transparent) || Boolean(object.userData.baseTransparent);
        item.opacity = display.transparent ? 0.27 : object.userData.baseOpacity ?? 1;
        item.depthWrite = !display.transparent;
        item.needsUpdate = true;
      });
    });
    updateEdgeResolution(true);
  }

  function disposePointMarker() {
    if (!pointMarker) return;
    pointMarker.traverse(object => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach(item => item?.dispose?.());
      else object.material?.dispose?.();
    });
    pointMarker.parent?.remove(pointMarker);
    pointMarker = null;
  }

  function mountPointMarker() {
    disposePointMarker();
    if (!latestModelRoot || !state.pickedPoint || !pointPickingActive()) return;
    const localPoint = latestModelRoot.worldToLocal(new THREE.Vector3(...state.pickedPoint));
    const marker = new THREE.Group();
    marker.name = 'example55_picked_point_P';
    marker.position.copy(localPoint);
    marker.userData.excludeFromProjection = true;

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 18, 12),
      new THREE.MeshBasicMaterial({ color: 0xd20f68, depthTest: false, depthWrite: false })
    );
    sphere.renderOrder = 100;
    sphere.userData.excludeFromProjection = true;
    sphere.userData.pickedPointMarker = true;
    marker.add(sphere);

    const arm = 0.16;
    const crossGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-arm, 0, 0), new THREE.Vector3(arm, 0, 0),
      new THREE.Vector3(0, -arm, 0), new THREE.Vector3(0, arm, 0),
      new THREE.Vector3(0, 0, -arm), new THREE.Vector3(0, 0, arm)
    ]);
    const cross = new THREE.LineSegments(
      crossGeometry,
      new THREE.LineBasicMaterial({ color: 0xd20f68, depthTest: false, depthWrite: false })
    );
    cross.renderOrder = 99;
    cross.userData.excludeFromProjection = true;
    marker.add(cross);
    latestModelRoot.add(marker);
    pointMarker = marker;
  }

  function positionProjectionPoint(view, normalized) {
    const marker = doc?.querySelector(`[data-compound-point="${view}"]`);
    const image = doc?.querySelector(`[data-compound-image="${view}"]`);
    const frame = image?.parentElement;
    if (!marker || !image || !frame || !normalized) return;
    const width = frame.clientWidth;
    const height = frame.clientHeight;
    const naturalWidth = image.naturalWidth || 1024;
    const naturalHeight = image.naturalHeight || 1024;
    const scale = Math.min(width / naturalWidth, height / naturalHeight);
    const imageWidth = naturalWidth * scale;
    const imageHeight = naturalHeight * scale;
    const offsetX = (width - imageWidth) / 2;
    const offsetY = (height - imageHeight) / 2;
    marker.style.left = `${offsetX + normalized.x * imageWidth}px`;
    marker.style.top = `${offsetY + normalized.y * imageHeight}px`;
    marker.hidden = normalized.x < 0 || normalized.x > 1 || normalized.y < 0 || normalized.y > 1;
  }

  function syncProjectionPointMarkers() {
    const markers = doc?.querySelectorAll('[data-compound-point]') || [];
    if (!pointPickingActive() || !state.pickedPoint || !projectionPointProvider) {
      markers.forEach(marker => { marker.hidden = true; });
      return;
    }
    const positions = projectionPointProvider(state.pickedPoint);
    ['front', 'side', 'top'].forEach(view => positionProjectionPoint(view, positions?.[view]));
  }

  function clearPickedPoint(options = {}) {
    disposePointMarker();
    state.pickedPoint = null;
    if (options.keepPicking !== true) state.pointPickEnabled = false;
    rendererElement?.classList.remove('is-picking-point');
    syncProjectionPointMarkers();
    if (options.render !== false) renderObservationTools();
  }

  function renderObservationTools() {
    if (!dom.observationCard || !dom.observationTools) return;
    const enabled = displayToolsActive();
    dom.observationCard.hidden = !enabled;
    rendererElement?.classList.toggle('is-picking-point', enabled && state.pointPickEnabled);
    if (!enabled) {
      dom.observationTools.innerHTML = '';
      syncProjectionPointMarkers();
      return;
    }
    const display = state.display;
    const point = state.pickedPoint;
    const pointValue = index => Number(point?.[index] || 0).toFixed(2);
    const kernelFacts = exactKernelAudit.result?.facts;
    const kernelProjections = exactKernelAudit.result?.projections;
    const kernelNumber = (value, digits = 3) => Number.isFinite(Number(value))
      ? Number(value).toFixed(digits)
      : '—';
    const kernelStage = exactKernelAudit.stage === 'loading-kernel'
      ? '正在载入 OpenCascade WASM'
      : exactKernelAudit.stage === 'building-brep'
        ? '正在计算精确BRep与隐藏线'
        : '尚未运行';
    dom.observationTools.innerHTML = `
      <div class="compound-display-switches" aria-label="${lesson.label}显示选项">
        <button type="button" class="compound-display-switch" data-display-action="shadows" aria-pressed="${display.shadows}">阴影<span>${display.shadows ? '已开启' : '已关闭（推荐）'}</span></button>
        <button type="button" class="compound-display-switch" data-display-action="bold-edges" aria-pressed="${display.boldEdges}">工程粗边<span>${display.boldEdges ? '强化特征边' : '标准边线'}</span></button>
        <button type="button" class="compound-display-switch" data-display-action="transparent" aria-pressed="${display.transparent}">透明实体<span>${display.transparent ? '仅保留真实特征边' : '实体显示'}</span></button>
        <button type="button" class="compound-display-switch" data-display-action="hidden-lines" aria-pressed="${display.showHidden}">三视图虚线<span>${display.showHidden ? '显示遮挡边' : '仅显示可见边'}</span></button>
      </div>
      ${pointPickingActive() ? `<div class="compound-point-picker">
        <div><strong>空间点 P 联动</strong><span>点选蓝色结果体</span></div>
        <div class="compound-point-actions">
          <button type="button" data-point-action="toggle" aria-pressed="${state.pointPickEnabled}">${state.pointPickEnabled ? '正在点选·再点关闭' : '开始点选空间点'}</button>
          <button type="button" data-point-action="clear" ${point ? '' : 'disabled'}>清除P点</button>
        </div>
        ${point ? `
          <div class="compound-point-readout">
            <div>P = (${pointValue(0)}, ${pointValue(1)}, ${pointValue(2)})</div>
            <div>主视：X ${pointValue(0)} · Y ${pointValue(1)}</div>
            <div>左视：Z ${pointValue(2)} · Y ${pointValue(1)}</div>
            <div>俯视：X ${pointValue(0)} · Z ${pointValue(2)}</div>
          </div>
        ` : '<p class="compound-point-empty">启用后点击三维实体，P点会同时标到主视、左视和俯视图。</p>'}
      </div>` : ''}
      <div class="compound-point-picker compound-kernel-audit" data-kernel-status="${exactKernelAudit.status}">
        <div><strong>精确CAD内核</strong><span>同一BRep驱动三维与主三视图</span></div>
        <div class="compound-point-actions">
          <button type="button" data-kernel-action="audit" ${exactKernelAudit.status === 'running' ? 'disabled' : ''}>${exactKernelAudit.status === 'running' ? '正在重算' : '立即精算'}</button>
        </div>
        ${exactKernelAudit.status === 'running' ? `<p class="compound-point-empty">${kernelStage}</p>` : ''}
        ${exactKernelAudit.status === 'error' ? `<p class="compound-point-empty">校核失败：${exactKernelAudit.error}</p>` : ''}
        ${kernelFacts ? `<div class="compound-point-readout">
          <div>${kernelFacts.passed ? '通过' : '未通过'} · ${kernelFacts.kernel}</div>
          <div>合同：拓扑 ${kernelFacts.topologyValid ? '✓' : '×'} · 投影 ${kernelFacts.projectionsValid ? '✓' : '×'} · 方向 ${kernelFacts.viewDirectionsValid ? '✓' : '×'} · 对齐 ${kernelFacts.projectionAlignmentValid ? '✓' : '×'} · 语义 ${kernelFacts.semanticValid ? '✓' : '×'}</div>
          <div>实体：${kernelFacts.shapeType}（${kernelFacts.solidCount}个Solid）· ${kernelFacts.faceCount}面 / ${kernelFacts.edgeCount}边</div>
          <div>包围盒：${kernelFacts.bounds.size.map(value => kernelNumber(value, 1)).join(' × ')} mm</div>
          ${lesson.id === 'example-5-5' ? `<div>B3：${kernelNumber(state.parameters.slotLength, 1)} 格 / ${kernelNumber(kernelFacts.slotLength, 1)} mm · 中心材料 ${kernelNumber(kernelFacts.centerProbeMaterial)} mm³ · 腿部材料 ${kernelNumber(kernelFacts.legProbeMaterial)} mm³</div>` : ''}
          ${lesson.id === 'example-5-6' ? `<div>圆柱下段：环壁完整 ${kernelNumber(kernelFacts.lowerRingWallCoverage * 100, 1)}% · 内孔侵入 ${kernelNumber(kernelFacts.lowerBoreIntrusion)} mm³ · 底板越界 ${kernelNumber(kernelFacts.baseTangencyIntrusion)} mm³ ${kernelFacts.lowerRingWallComplete && kernelFacts.lowerBoreClear && kernelFacts.baseTangencyClear ? '✓' : '×'}</div>` : ''}
          ${kernelProjections ? `<div>隐藏线重算：主视 ${kernelProjections.front.visiblePaths}+${kernelProjections.front.hiddenPaths} · 左视 ${kernelProjections.side.visiblePaths}+${kernelProjections.side.hiddenPaths} · 俯视 ${kernelProjections.top.visiblePaths}+${kernelProjections.top.hiddenPaths}</div>` : ''}
          <div>三维回传：${kernelFacts.renderTriangleCount} 个三角片 / ${kernelFacts.renderEdgeSegmentCount} 条拓扑边段 · ${kernelFacts.visualInstalled ? '主视窗与三视图已接管' : '当前为交互预览'}</div>
        </div>` : ''}
        <p class="compound-point-empty">拖动时先显示快速预览；停止操作后自动由 OpenCascade 重建实体和隐藏线，不再另放一套重复的小三视图。</p>
      </div>
    `;
    requestAnimationFrame(syncProjectionPointMarkers);
  }

  function exactKernelStateKey() {
    const roundedValues = Object.fromEntries(Object.entries(state.cutterValues || {}).map(([id, values]) => [
      id,
      Object.fromEntries(Object.entries(values).map(([axis, value]) => [axis, Number(Number(value).toFixed(4))]))
    ]));
    return JSON.stringify({
      lessonId: lesson.id,
      stageIndex: state.stageIndex,
      appliedCutters: state.appliedCutters,
      visibleComponents: lesson.stages[state.stageIndex]?.visible || [],
      parameters: state.parameters,
      cutterValues: roundedValues
    });
  }

  function exactKernelPayload() {
    return {
      lessonId: lesson.id,
      slotLength: Number(state.parameters.slotLength || 5) * 10,
      appliedCutters: [...state.appliedCutters],
      visibleComponents: [...(lesson.stages[state.stageIndex]?.visible || [])],
      cutterValues: Object.fromEntries(Object.entries(state.cutterValues || {}).map(([id, values]) => [id, { ...values }]))
    };
  }

  function assemblyIsDisplaced() {
    if (explodeTarget > 0.001 || explodeCurrent > 0.001) return true;
    if ((state.detachedComponents || []).length) return true;
    if (Object.values(state.assemblyOffsets || {}).some(values => Math.hypot(values.x || 0, values.y || 0, values.z || 0) > 0.001)) return true;
    return [...assemblyCurrentOffsets.values()].some(vector => vector.length() > 0.001);
  }

  function exactKernelVisualEligible() {
    return ['example-5-1', 'example-5-5', 'example-5-6'].includes(lesson.id)
      && !state.isolatedComponent
      && !assemblyIsDisplaced();
  }

  function exactKernelResultReady() {
    return exactKernelAudit.status === 'passed'
      && exactKernelAudit.key === exactKernelStateKey()
      && exactKernelAudit.result?.facts?.passed
      && exactKernelVisualEligible();
  }

  function syncKernelStatus() {
    if (!dom.kernelStatus) return;
    let label = '精确内核待算';
    let tone = 'idle';
    if (!exactKernelVisualEligible()) {
      label = '移动中·实时预览';
      tone = 'preview';
    } else if (exactKernelAudit.status === 'running') {
      label = 'OpenCascade 重算中';
      tone = 'running';
    } else if (exactKernelResultReady()) {
      label = '精确 BRep / HLR';
      tone = 'passed';
    } else if (['failed', 'error'].includes(exactKernelAudit.status)) {
      label = '精确校核未通过';
      tone = 'error';
    }
    dom.kernelStatus.textContent = label;
    dom.kernelStatus.dataset.tone = tone;
  }

  function scheduleExactKernelAudit(delay = 360) {
    clearTimeout(exactKernelTimer);
    if (!active || !exactKernelVisualEligible()) {
      syncKernelStatus();
      return;
    }
    exactKernelTimer = setTimeout(() => {
      exactKernelTimer = 0;
      runExactKernelAudit({ automatic: true });
    }, delay);
  }

  async function runExactKernelAudit({ automatic = false } = {}) {
    if (!exactKernelVisualEligible()) {
      syncKernelStatus();
      return;
    }
    if (exactKernelAudit.status === 'running') {
      if (automatic) scheduleExactKernelAudit(240);
      return;
    }
    const requestKey = exactKernelStateKey();
    const requestToken = ++exactKernelRequestToken;
    exactKernelAudit = { status: 'running', stage: 'loading-kernel', key: requestKey, result: null, error: '' };
    renderObservationTools();
    syncKernelStatus();
    try {
      const result = await auditLessonWithExactKernel({
        ...exactKernelPayload(),
        onProgress: stage => {
          if (requestToken !== exactKernelRequestToken) return;
          exactKernelAudit.stage = stage;
          renderObservationTools();
          syncKernelStatus();
        }
      });
      if (requestToken !== exactKernelRequestToken) return;
      if (requestKey !== exactKernelStateKey() || !exactKernelVisualEligible()) {
        exactKernelAudit = { status: 'idle', stage: '', key: '', result: null, error: '' };
        scheduleExactKernelAudit(120);
        return;
      }
      exactKernelAudit = {
        status: result.facts.passed ? 'passed' : 'failed',
        stage: '',
        key: requestKey,
        result,
        error: ''
      };
      result.facts.visualInstalled = result.facts.passed
        ? installExactKernelVisual(result.renderMesh)
        : false;
      if (!automatic || !result.facts.passed) {
        setStatus?.(result.facts.passed
          ? `${lesson.label}精确内核通过：三维实体和主三视图已由同一BRep重算。`
          : `${lesson.label}精确内核未通过：当前继续显示实时预览，请检查语义合同。`);
      }
    } catch (error) {
      if (requestToken !== exactKernelRequestToken) return;
      exactKernelAudit = {
        status: 'error',
        stage: '',
        key: requestKey,
        result: null,
        error: error instanceof Error ? error.message : String(error)
      };
      if (!automatic) setStatus?.(`精确CAD内核校核失败：${exactKernelAudit.error}`);
    }
    syncProjectionImages();
    renderObservationTools();
    syncKernelStatus();
  }

  function disposeExactKernelVisual(root = latestModelRoot) {
    if (!root) return;
    const exact = root.children.find(child => child.userData?.exactKernel);
    if (exact) {
      exact.traverse(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(item => item?.dispose?.());
        else object.material?.dispose?.();
      });
      exact.parent?.remove(exact);
    }
    root.traverse(object => {
      if (!object.userData?.exactKernelSuppressed) return;
      delete object.userData.exactKernelSuppressed;
      object.visible = true;
    });
  }

  function installExactKernelVisual(renderMesh, root = latestModelRoot) {
    if (!root || !renderMesh?.faces || !renderMesh?.edges || !exactKernelVisualEligible()) return false;
    disposeExactKernelVisual(root);

    const facesGeometry = new THREE.BufferGeometry();
    const edgesGeometry = new THREE.BufferGeometry();
    syncFaces(facesGeometry, renderMesh.faces);
    syncLines(edgesGeometry, renderMesh.edges);
    // Replicad: X宽、Y深、Z高（mm）；Three.js教材场景：X宽、Y高、Z深（格）。
    facesGeometry.rotateX(-Math.PI / 2);
    edgesGeometry.rotateX(-Math.PI / 2);
    facesGeometry.scale(0.1, 0.1, 0.1);
    edgesGeometry.scale(0.1, 0.1, 0.1);

    const exact = new THREE.Group();
    exact.name = `${lesson.modelKey}_exact_kernel_result`;
    exact.userData.excludeFromProjection = true;
    exact.userData.exactKernel = true;
    exact.userData.chapter5Id = 'body';
    const faces = new THREE.Mesh(
      facesGeometry,
      new THREE.MeshStandardMaterial({ color: COLORS.result, roughness: 0.62, metalness: 0 })
    );
    faces.name = `${lesson.modelKey}_exact_kernel_faces`;
    faces.userData.excludeFromProjection = true;
    faces.userData.exactKernel = true;
    const edges = new THREE.LineSegments(
      edgesGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.dark, transparent: true, opacity: 0.9 })
    );
    edges.name = `${lesson.modelKey}_exact_kernel_edges`;
    edges.userData.excludeFromProjection = true;
    edges.userData.exactKernel = true;
    exact.add(faces, edges);
    root.traverse(object => {
      if (object === root || object.userData?.exactKernel || object.userData?.booleanTool || object.userData?.pickedPointMarker) return;
      if (!object.isMesh && !object.isLine && !object.isLineSegments) return;
      object.userData.exactKernelSuppressed = true;
      object.visible = false;
    });
    root.add(exact);
    applyDisplayStyle(root);
    return true;
  }

  function buildCurrentModel() {
    const builder = builders[lesson.modelKey] || buildExample51;
    latestModelRoot = builder(state.parameters);
    applyVisibility(latestModelRoot);
    if (exactKernelResultReady() && exactKernelAudit.result?.renderMesh) {
      exactKernelAudit.result.facts.visualInstalled = installExactKernelVisual(exactKernelAudit.result.renderMesh);
    }
    return latestModelRoot;
  }

  function syncProjectionImages() {
    if (!doc || !projectionImageProvider) return;
    const exactProjections = exactKernelResultReady() ? exactKernelAudit.result?.projections : null;
    ['front', 'side', 'top'].forEach(view => {
      const image = doc.querySelector(`[data-compound-image="${view}"]`);
      const exactProjection = exactProjections?.[view] || null;
      const src = exactProjection ? kernelProjectionDataUrl(exactProjection) : projectionImageProvider(view);
      if (image && src) {
        image.src = src;
        image.dataset.projectionSource = exactProjection ? 'exact-brep' : 'interactive-preview';
      }
    });
    syncAlignedProjectionLayout(exactProjections);
    syncKernelStatus();
    syncMobileProjectionView();
    requestAnimationFrame(syncProjectionPointMarkers);
  }

  function kernelProjectionDataUrl(item) {
    const hidden = state.display.showHidden
      ? item.hiddenPathData.map(path => `<path d="${path}" vector-effect="non-scaling-stroke"/>`).join('')
      : '';
    const visible = item.visiblePathData.map(path => `<path d="${path}" vector-effect="non-scaling-stroke"/>`).join('');
    const centerlines = (item.centerlinePathData || [])
      .map(path => `<path d="${path}" vector-effect="non-scaling-stroke"/>`)
      .join('');
    const visibleWidth = state.display.boldEdges ? 1.45 : 0.95;
    const hiddenWidth = state.display.boldEdges ? 0.82 : 0.62;
    const centerWidth = state.display.boldEdges ? 0.72 : 0.58;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${item.viewBox}" preserveAspectRatio="xMidYMid meet"><rect width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#83929d" stroke-width="${hiddenWidth}" stroke-dasharray="5 3.5">${hidden}</g><g fill="none" stroke="#667b89" stroke-width="${centerWidth}" stroke-dasharray="8 2.5 1.2 2.5">${centerlines}</g><g fill="none" stroke="#20384a" stroke-width="${visibleWidth}" stroke-linecap="round" stroke-linejoin="round">${visible}</g></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function projectionFrame(item) {
    const values = Array.isArray(item?.frame)
      ? item.frame.map(Number)
      : String(item?.viewBox || '').trim().split(/\s+/).map(Number);
    return values.length === 4 && values.every(Number.isFinite) ? values : null;
  }

  function syncAlignedProjectionLayout(projections) {
    if (!dom.projectionBoard) return;
    const front = projectionFrame(projections?.front);
    const side = projectionFrame(projections?.side);
    const top = projectionFrame(projections?.top);
    const aligned = Boolean(front && side && top
      && Math.abs(front[2] - top[2]) < 1e-5
      && Math.abs(front[3] - side[3]) < 1e-5
      && Math.abs(side[2] - top[3]) < 1e-5);
    dom.projectionBoard.classList.toggle('is-scale-aligned', aligned);
    dom.projectionBoard.dataset.alignment = aligned ? 'exact' : 'preview';
    if (!aligned) {
      [
        '--compound-front-track', '--compound-side-track',
        '--compound-elevation-track', '--compound-plan-track',
        '--compound-front-units', '--compound-side-units',
        '--compound-height-units', '--compound-width-units'
      ].forEach(name => dom.projectionBoard.style.removeProperty(name));
      dom.projectionBoard.style.removeProperty('--compound-elevation-ratio');
      return;
    }
    dom.projectionBoard.style.setProperty('--compound-front-track', `${front[2]}fr`);
    dom.projectionBoard.style.setProperty('--compound-side-track', `${side[2]}fr`);
    dom.projectionBoard.style.setProperty('--compound-elevation-track', `${front[3]}fr`);
    dom.projectionBoard.style.setProperty('--compound-plan-track', `${top[3]}fr`);
    dom.projectionBoard.style.setProperty('--compound-front-units', String(front[2]));
    dom.projectionBoard.style.setProperty('--compound-side-units', String(side[2]));
    dom.projectionBoard.style.setProperty('--compound-height-units', String(front[3]));
    dom.projectionBoard.style.setProperty('--compound-width-units', String(top[3]));
    dom.projectionBoard.style.setProperty('--compound-elevation-ratio', String(front[3] / (front[3] + top[3])));
  }

  function syncMobileProjectionView() {
    doc?.querySelectorAll('[data-compound-view-tab]').forEach(button => {
      const activeView = button.dataset.compoundViewTab === mobileProjectionView;
      button.classList.toggle('active', activeView);
      button.setAttribute('aria-selected', String(activeView));
    });
    doc?.querySelectorAll('.compound-view-card').forEach(card => {
      card.classList.toggle('is-mobile-active', card.classList.contains(mobileProjectionView));
    });
  }

  function stageStatus() {
    const stage = lesson.stages[state.stageIndex];
    const isolate = lesson.components.find(component => component.id === state.isolatedComponent);
    if (isolate) return `独立观察：${isolate.label}。再次点击可恢复当前组合步骤。`;
    const detachedVisible = (lesson.assembly?.parts || []).filter(part => assemblyPartAvailable(part) && isDetached(part.id));
    if (lesson.assembly && state.stageIndex >= 2 && detachedVisible.length) {
      return `${stage.label}：已拿开 ${detachedVisible.length} 个叠加构件；模型与三视图同步显示当前装配状态。`;
    }
    const count = state.appliedCutters.length;
    return `${stage.label}：${stage.note} 当前已执行 ${count}/${lesson.cutters.length} 个切除特征。`;
  }

  function renderLessonNavigation() {
    if (!dom.lessonNav) return;
    dom.lessonNav.innerHTML = COMPOUND_LESSONS.map((item, index) => `
      <button type="button" class="compound-lesson${item.id === lesson.id ? ' active' : ''}" data-compound-lesson="${item.id}" aria-current="${item.id === lesson.id ? 'step' : 'false'}">
        <span>${index + 1}</span><b>${item.label}</b><small>${item.shortTitle}</small>
      </button>
    `).join('');
    requestAnimationFrame(scrollActiveLessonIntoView);
  }

  function scrollActiveLessonIntoView() {
    dom.lessonNav?.querySelector('.compound-lesson.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function renderLessonHeader() {
    if (dom.source) dom.source.textContent = lesson.source;
    if (dom.sourceLabel) dom.sourceLabel.textContent = lesson.source;
    if (dom.title) dom.title.textContent = lesson.title;
    if (dom.titleLabel) dom.titleLabel.textContent = lesson.title;
    if (dom.objective) dom.objective.textContent = lesson.objective;
    if (dom.aiInput) dom.aiInput.textContent = lesson.aiInput;
    if (dom.operationTags) dom.operationTags.innerHTML = lesson.operations.map(operation => `<span>${operation}</span>`).join('');
    const assemblyMode = Boolean(lesson.assembly && state.stageIndex >= 2);
    if (dom.axisNote) dom.axisNote.textContent = assemblyMode ? '蓝色为装配构件 · 选中后可拖动移位' : '黄色为刀具 B · 蓝色为实体 A';
    if (dom.modelHelp) dom.modelHelp.textContent = assemblyMode
      ? '拖动蓝色构件 · 逐件拿开或装回 · 滚轮缩放 · 三视图同步'
      : '拖动黄色刀具 · 滚轮缩放 · 右侧执行 A−B · 三视图同步';
  }

  function renderSequence() {
    if (!dom.sequence) return;
    dom.sequence.innerHTML = lesson.stages.map((stage, index) => `
      <button type="button" class="compound-stage${index === state.stageIndex ? ' active' : ''}${index < state.stageIndex ? ' complete' : ''}" data-compound-stage="${index}">
        <span>${index + 1}</span><b>${stage.label}</b>
      </button>
    `).join('');
    if (dom.stageNote) dom.stageNote.textContent = stageStatus();
    if (dom.progress) dom.progress.textContent = `${state.stageIndex + 1} / ${lesson.stages.length}`;
    if (dom.cadAction) dom.cadAction.textContent = lesson.stages[state.stageIndex].action;
    if (dom.previous) dom.previous.disabled = state.stageIndex === 0;
    if (dom.next) {
      dom.next.disabled = state.stageIndex === lesson.stages.length - 1;
      dom.next.textContent = state.stageIndex === lesson.stages.length - 1 ? '已完成' : '进入下一步';
    }
  }

  function renderBooleanWorkbench() {
    if (!dom.booleanWorkbench) return;
    const assemblyMode = Boolean(lesson.assembly && state.stageIndex >= 2);
    if (dom.booleanCard) dom.booleanCard.hidden = assemblyMode;
    if (assemblyMode) return;
    const activeCutter = cutterDefinition(state.activeCutterId) || lesson.cutters[0];
    const values = cutterValues(activeCutter.id);
    const applied = isApplied(activeCutter.id);
    dom.booleanWorkbench.innerHTML = `
      <div class="compound-equation" aria-label="当前布尔运算">
        <span class="operand-a">A<br><small>${activeCutter.target}</small></span>
        <b>−</b>
        <span class="operand-b">${activeCutter.symbol}<br><small>${activeCutter.label}</small></span>
        <b>=</b>
        <span class="operand-result">A−B<br><small>${applied ? '差集已执行' : '等待执行'}</small></span>
      </div>
      <div class="compound-tool-shape"><span>当前刀具体</span><strong>${activeCutter.toolType || '封闭切除体'}</strong></div>
      <div class="compound-cutter-tabs" role="tablist" aria-label="选择切除体">
        ${lesson.cutters.map(cutter => `
          <button type="button" class="compound-cutter-tab${cutter.id === activeCutter.id ? ' active' : ''}${isApplied(cutter.id) ? ' applied' : ''}" data-compound-cutter="${cutter.id}">
            <b>${cutter.symbol}</b><span>${cutter.label}</span><i>${isApplied(cutter.id) ? '已切' : '待切'}</i>
          </button>
        `).join('')}
      </div>
      <div class="compound-cutter-axes">
        ${activeCutter.axes.map(axis => `
          <label class="compound-cutter-axis">
            <span>${axis.label}</span>
            <input type="range" min="${axis.min}" max="${axis.max}" step="${axis.step}" value="${values[axis.id]}" data-cutter-axis="${axis.id}" data-cutter-id="${activeCutter.id}">
            <output>${Number(values[axis.id]).toFixed(2)}</output>
          </label>
        `).join('')}
      </div>
      <p class="compound-drag-note"><i aria-hidden="true"></i>黄色体可在模型中直接拖动；滑杆用于精确定位。黄色只作刀具，三视图默认投影差集结果。</p>
      <div class="compound-boolean-actions">
        <button type="button" class="compound-primary-action" data-boolean-action="toggle-apply">${applied ? '撤销此切除' : '执行 A−B'}</button>
        <button type="button" class="compound-secondary-action" data-boolean-action="toggle-tool">${state.showCutter ? '隐藏刀具' : '显示刀具'}</button>
      </div>
      <details class="compound-boolean-more">
        <summary>批量与复位</summary>
        <div>
          <button type="button" class="compound-secondary-action" data-boolean-action="apply-all">直达最终切除</button>
          <button type="button" class="compound-secondary-action" data-boolean-action="reset-cutters">刀具恢复教材位置</button>
        </div>
      </details>
    `;
  }

  function renderAssemblyWorkbench() {
    if (!dom.assemblyCard || !dom.assemblyWorkbench) return;
    const config = lesson.assembly;
    const assemblyMode = Boolean(config && state.stageIndex >= 2);
    dom.assemblyCard.hidden = !assemblyMode;
    if (!assemblyMode) {
      dom.assemblyWorkbench.innerHTML = '';
      return;
    }

    const availableParts = config.parts.filter(assemblyPartAvailable);
    let activePart = assemblyPartDefinition(state.activeAssemblyId);
    if (!activePart || activePart.fixed || !assemblyPartAvailable(activePart)) {
      activePart = availableParts.find(part => !part.fixed) || null;
      state.activeAssemblyId = activePart?.id || null;
    }
    const attachedCount = availableParts.filter(part => !isDetached(part.id)).length;
    const values = activePart ? assemblyOffset(activePart.id) : { x: 0, y: 0, z: 0 };
    const activeDetached = activePart ? isDetached(activePart.id) : false;
    const detachable = availableParts.filter(part => !part.fixed);
    const canDetachNext = detachable.some(part => !isDetached(part.id));
    const canAttachNext = detachable.some(part => isDetached(part.id));

    dom.assemblyWorkbench.innerHTML = `
      <div class="compound-assembly-meter">
        <div><strong>${config.title}</strong><span>当前定位 ${attachedCount}/${availableParts.length} 件</span></div>
        <div class="compound-assembly-bar"><i style="width:${availableParts.length ? attachedCount / availableParts.length * 100 : 0}%"></i></div>
      </div>
      <div class="compound-assembly-parts" role="tablist" aria-label="选择装配构件" data-order-label="装配顺序 ${config.parts[0]?.symbol || 'A0'} → ${config.parts.at(-1)?.symbol || 'A0'}" style="--assembly-columns:${config.parts.length}">
        ${config.parts.map((part, index) => {
          const available = assemblyPartAvailable(part);
          const detached = isDetached(part.id);
          const status = part.fixed ? '基准固定' : !available ? '未装入' : detached ? '已拿开' : '已定位';
          return `
            <button type="button" class="compound-assembly-part${part.id === activePart?.id ? ' active' : ''}${detached ? ' detached' : ''}" data-assembly-part="${part.id}" ${part.fixed || !available ? 'disabled' : ''}>
              <b>${part.symbol}</b><span>${part.label}</span><i>${status}</i><em>${index}</em>
            </button>
          `;
        }).join('')}
      </div>
      ${activePart ? `
        <div class="compound-assembly-active">
          <span>当前构件</span><strong>${activePart.symbol} · ${activePart.label}</strong><i>${activeDetached ? '已离开教材位置' : '位于教材装配位置'}</i>
        </div>
        <div class="compound-assembly-axes">
          ${config.axes.map(axis => `
            <label>
              <span>${axis.label}</span>
              <input type="range" min="${axis.min}" max="${axis.max}" step="${axis.step}" value="${values[axis.id]}" data-assembly-axis="${axis.id}" data-assembly-id="${activePart.id}">
              <output>${Number(values[axis.id]).toFixed(2)}</output>
            </label>
          `).join('')}
        </div>
      ` : ''}
      <p class="compound-assembly-note"><i aria-hidden="true"></i>${config.note}</p>
      <div class="compound-assembly-actions">
        <button type="button" class="compound-primary-action" data-assembly-action="toggle-part" ${activePart ? '' : 'disabled'}>${activeDetached ? '装回此构件' : '拿开此构件'}</button>
        <button type="button" class="compound-secondary-action" data-assembly-action="detach-next" ${canDetachNext ? '' : 'disabled'}>逐件拿开</button>
        <button type="button" class="compound-secondary-action" data-assembly-action="attach-next" ${canAttachNext ? '' : 'disabled'}>按序装回</button>
        <button type="button" class="compound-secondary-action" data-assembly-action="restore-all" ${canAttachNext ? '' : 'disabled'}>全部归位</button>
      </div>
    `;
  }

  function operationClass(operation) {
    if (operation === 'subtract' || operation === 'tool') return 'subtract';
    if (operation === 'base') return 'base';
    if (operation === 'result') return 'result';
    return 'add';
  }

  function renderComponents() {
    if (!dom.components) return;
    dom.components.innerHTML = lesson.components.map(component => {
      const detached = isDetached(component.id);
      const status = component.operation === 'subtract'
        ? (isApplied(component.id) ? '已切' : '刀具')
        : detached ? '已拿开' : component.operation === 'base' ? '基体/结果' : '叠加';
      return `
        <button type="button" class="compound-component ${operationClass(component.operation)}${state.isolatedComponent === component.id ? ' isolated' : ''}${detached ? ' detached' : ''}" data-compound-component="${component.id}">
          <i aria-hidden="true"></i><span>${component.label}</span><small>${status}</small>
        </button>
      `;
    }).join('');
  }

  function renderParameters() {
    if (!dom.parameters) return;
    const parameters = lesson.parameters || [];
    if (!parameters.length) {
      dom.parameters.innerHTML = '<p class="compound-empty-parameters">本例按教材投影关系保持固定比例；切割位置请在上方布尔运算台调整。</p>';
      return;
    }
    dom.parameters.innerHTML = parameters.map(parameter => {
      const value = state.parameters[parameter.id];
      const changed = value !== parameter.textbook;
      const reference = parameter.referenceLabel || `教材 ${parameter.textbook}${parameter.unit}`;
      return `
        <label class="compound-parameter${changed ? ' changed' : ''}">
          <span>${parameter.label}<small>${reference}</small></span>
          <input type="range" min="${parameter.min}" max="${parameter.max}" step="${parameter.step}" value="${value}" data-compound-parameter="${parameter.id}">
          <output>${value}${parameter.unit}</output>
        </label>
      `;
    }).join('');
  }

  function renderQuestion() {
    const question = lesson.question;
    if (dom.questionPrompt) dom.questionPrompt.textContent = question.prompt;
    if (dom.answers) {
      dom.answers.innerHTML = question.options.map(option => {
        const selected = state.selectedAnswer === option.id;
        const correct = state.evaluated && option.id === question.answer;
        const wrong = state.evaluated && selected && option.id !== question.answer;
        return `<button type="button" class="compound-answer${selected ? ' selected' : ''}${correct ? ' correct' : ''}${wrong ? ' wrong' : ''}" data-compound-answer="${option.id}" ${state.evaluated ? 'disabled' : ''}>${option.label}</button>`;
      }).join('');
    }
    if (dom.feedback) {
      dom.feedback.hidden = !state.evaluated;
      if (state.evaluated) {
        const result = evaluateCompoundAnswer(lesson, state.selectedAnswer);
        dom.feedback.dataset.tone = result.exact ? 'success' : 'error';
        dom.feedback.textContent = `${result.exact ? '判断正确。' : '需要修正。'}${question.evidence}`;
      }
    }
    if (dom.submit) {
      dom.submit.disabled = !state.selectedAnswer && !state.evaluated;
      dom.submit.textContent = state.evaluated ? '重新判断' : '核对判断';
    }
  }

  function renderAll() {
    renderLessonNavigation();
    renderLessonHeader();
    renderSequence();
    renderBooleanWorkbench();
    renderObservationTools();
    renderAssemblyWorkbench();
    renderComponents();
    renderParameters();
    renderQuestion();
    syncKernelStatus();
    syncMobileProjectionView();
    if (dom.explode) dom.explode.value = String(Math.round(explodeTarget * 100));
    if (dom.explodeOutput) dom.explodeOutput.textContent = `${Math.round(explodeTarget * 100)}%`;
  }

  function rebuildCurrentModel(options = {}) {
    clearPickedPoint({ render: false });
    clearFocus?.();
    activateModel();
    applyDisplayStyle();
    refreshProjections();
    if (options.fullRender !== false) {
      renderSequence();
      renderBooleanWorkbench();
      renderObservationTools();
      renderAssemblyWorkbench();
      renderComponents();
    }
    setStatus?.(`第5章构形实验 · ${lesson.label}：${stageStatus()}`);
    if (options.exact !== false) scheduleExactKernelAudit(options.exactDelay ?? 360);
  }

  function scheduleRebuild(options = {}) {
    if (rebuildFrame) cancelAnimationFrame(rebuildFrame);
    rebuildFrame = requestAnimationFrame(() => {
      rebuildFrame = 0;
      rebuildCurrentModel(options);
    });
  }

  function invalidateExactKernel({ keepResult = false, schedule = false, delay = 360 } = {}) {
    clearTimeout(exactKernelTimer);
    exactKernelTimer = 0;
    exactKernelRequestToken += 1;
    disposeExactKernelVisual();
    if (!keepResult) exactKernelAudit = { status: 'idle', stage: '', key: '', result: null, error: '' };
    syncKernelStatus();
    if (schedule) scheduleExactKernelAudit(delay);
  }

  function syncStateWithStage(stage) {
    state.appliedCutters = [...(stage.appliedCutters || [])];
    if (stage.activeCutter) state.activeCutterId = stage.activeCutter;
    state.showCutter = stage.showCutter !== false;
  }

  function selectLesson(id) {
    invalidateExactKernel();
    lesson = getCompoundLesson(id);
    state = createCompoundLessonState(lesson);
    exactKernelAudit = { status: 'idle', stage: '', key: '', result: null, error: '' };
    setProjectionHidden?.(state.display.showHidden);
    assemblyCurrentOffsets.clear();
    explodeCurrent = 0;
    explodeTarget = 0;
    if (active) applyCamera();
    renderAll();
    rebuildCurrentModel();
  }

  function selectStage(index) {
    invalidateExactKernel();
    state.stageIndex = clampStageIndex(lesson, index);
    state.isolatedComponent = null;
    state.selectedAnswer = null;
    state.evaluated = false;
    syncStateWithStage(lesson.stages[state.stageIndex]);
    renderAll();
    rebuildCurrentModel();
  }

  function isolateComponent(id) {
    invalidateExactKernel();
    state.isolatedComponent = state.isolatedComponent === id ? null : id;
    applyVisibility();
    clearFocus?.();
    refreshProjections();
    renderSequence();
    renderComponents();
    syncProjectionImages();
    scheduleExactKernelAudit(180);
    setStatus?.(`第5章构形实验 · ${lesson.label}：${stageStatus()}`);
  }

  function selectCutter(id) {
    if (!cutterDefinition(id)) return;
    state.activeCutterId = id;
    state.showCutter = true;
    state.isolatedComponent = null;
    applyVisibility();
    refreshProjections();
    renderBooleanWorkbench();
    renderComponents();
  }

  function toggleActiveCut() {
    const id = state.activeCutterId;
    if (!id) return;
    state.appliedCutters = isApplied(id)
      ? state.appliedCutters.filter(cutterId => cutterId !== id)
      : [...state.appliedCutters, id];
    state.showCutter = true;
    invalidateExactKernel();
    scheduleRebuild();
  }

  function selectAssemblyPart(id) {
    const part = assemblyPartDefinition(id);
    if (!part || part.fixed || !assemblyPartAvailable(part)) return;
    state.activeAssemblyId = id;
    state.isolatedComponent = null;
    applyVisibility();
    renderAssemblyWorkbench();
    renderComponents();
  }

  function setAssemblyTarget(id, target, options = {}) {
    const part = assemblyPartDefinition(id);
    if (!part || part.fixed) return;
    state.assemblyOffsets[id] = {
      x: Number(target.x || 0),
      y: Number(target.y || 0),
      z: Number(target.z || 0)
    };
    const magnitude = Math.hypot(
      state.assemblyOffsets[id].x,
      state.assemblyOffsets[id].y,
      state.assemblyOffsets[id].z
    );
    markDetached(id, magnitude > 0.04);
    invalidateExactKernel();
    if (options.immediate) {
      currentAssemblyOffset(id).set(
        state.assemblyOffsets[id].x,
        state.assemblyOffsets[id].y,
        state.assemblyOffsets[id].z
      );
      applyExplode();
      refreshProjections();
    } else {
      explodeProjectionDirty = true;
    }
    renderSequence();
    renderAssemblyWorkbench();
    renderComponents();
    if (magnitude <= 0.04) scheduleExactKernelAudit(220);
  }

  function toggleAssemblyPart(id = state.activeAssemblyId) {
    const part = assemblyPartDefinition(id);
    if (!part || part.fixed || !assemblyPartAvailable(part)) return;
    state.activeAssemblyId = part.id;
    const target = isDetached(part.id)
      ? { x: 0, y: 0, z: 0 }
      : { x: part.parkOffset[0], y: part.parkOffset[1], z: part.parkOffset[2] };
    setAssemblyTarget(part.id, target);
  }

  function detachNextAssemblyPart() {
    const part = [...(lesson.assembly?.parts || [])]
      .reverse()
      .find(item => !item.fixed && assemblyPartAvailable(item) && !isDetached(item.id));
    if (part) toggleAssemblyPart(part.id);
  }

  function attachNextAssemblyPart() {
    const part = (lesson.assembly?.parts || [])
      .find(item => !item.fixed && assemblyPartAvailable(item) && isDetached(item.id));
    if (part) toggleAssemblyPart(part.id);
  }

  function restoreAssembly() {
    invalidateExactKernel();
    (lesson.assembly?.parts || []).filter(part => !part.fixed).forEach(part => {
      state.assemblyOffsets[part.id] = { x: 0, y: 0, z: 0 };
      markDetached(part.id, false);
    });
    explodeProjectionDirty = true;
    renderSequence();
    renderAssemblyWorkbench();
    renderComponents();
    scheduleExactKernelAudit(220);
  }

  function setExplode(value) {
    invalidateExactKernel();
    explodeTarget = clamp(Number(value) || 0, 0, 1);
    state.explode = explodeTarget;
    explodeProjectionDirty = true;
    if (dom.explode) dom.explode.value = String(Math.round(explodeTarget * 100));
    if (dom.explodeOutput) dom.explodeOutput.textContent = `${Math.round(explodeTarget * 100)}%`;
    if (explodeTarget <= 0.001) scheduleExactKernelAudit(420);
  }

  function resetCutterPositions() {
    invalidateExactKernel();
    lesson.cutters.forEach(cutter => {
      state.cutterValues[cutter.id] = { ...cutter.defaults };
    });
    scheduleRebuild();
  }

  function reset() {
    invalidateExactKernel();
    state = createCompoundLessonState(lesson);
    setProjectionHidden?.(state.display.showHidden);
    assemblyCurrentOffsets.clear();
    explodeCurrent = 0;
    explodeTarget = 0;
    explodeProjectionDirty = false;
    renderAll();
    rebuildCurrentModel();
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

  function applyCamera() {
    if (lesson.id === 'example-5-5') camera.position.set(10.2, 5.5, 5.1);
    else camera.position.set(7.8, 5.6, 8.8);
    camera.up.set(0, 1, 0);
    controls.target.set(0, 1.42, 0);
    controls.minDistance = 3;
    controls.maxDistance = 30;
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
    if (!active) {
      captureCamera();
      active = true;
    }
    setProjectionHidden?.(state.display.showHidden);
    if (options.resetCamera !== false) applyCamera();
    renderAll();
    rebuildCurrentModel();
    scheduleExactKernelAudit(80);
    return controller;
  }

  function leave(options = {}) {
    if (!active) return controller;
    endCutterDrag();
    clearPickedPoint({ render: false });
    if (options.restoreCamera !== false) restoreCamera();
    active = false;
    clearTimeout(exactKernelTimer);
    exactKernelTimer = 0;
    return controller;
  }

  function update() {
    updateEdgeResolution();
    const delta = explodeTarget - explodeCurrent;
    let moving = false;
    let transformChanged = false;
    if (Math.abs(delta) < 0.001) {
      explodeCurrent = explodeTarget;
    } else {
      explodeCurrent += delta * 0.16;
      moving = true;
      transformChanged = true;
    }

    (lesson.assembly?.parts || []).forEach(part => {
      const targetValues = assemblyOffset(part.id);
      const target = new THREE.Vector3(targetValues.x, targetValues.y, targetValues.z);
      const current = currentAssemblyOffset(part.id);
      if (current.distanceToSquared(target) < 0.000004) {
        current.copy(target);
        return;
      }
      current.lerp(target, 0.18);
      moving = true;
      transformChanged = true;
    });

    if (transformChanged) applyExplode();
    const now = performance.now();
    if (moving && now - lastExplodeProjectionSync > 120) {
      refreshProjections();
      lastExplodeProjectionSync = now;
      explodeProjectionDirty = true;
    } else if (!moving && explodeProjectionDirty) {
      applyExplode();
      refreshProjections();
      explodeProjectionDirty = false;
      syncKernelStatus();
      scheduleExactKernelAudit(180);
    }
  }

  function planeForCutter(cutter, component) {
    const origin = new THREE.Vector3();
    component.getWorldPosition(origin);
    if (cutter.dragPlane === 'xy') return new THREE.Plane(new THREE.Vector3(0, 0, 1), -origin.z);
    if (cutter.dragPlane === 'yz') return new THREE.Plane(new THREE.Vector3(1, 0, 0), -origin.x);
    return new THREE.Plane(new THREE.Vector3(0, 1, 0), -origin.y);
  }

  function pointerRay(event) {
    const rect = rendererElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
  }

  function componentForObject(object) {
    let current = object;
    while (current && current !== latestModelRoot) {
      if (current.userData?.chapter5Id) return current;
      current = current.parent;
    }
    return null;
  }

  function startCutterDrag(event) {
    if (!active || !latestModelRoot || event.button !== 0) return;
    pointerRay(event);
    const hit = raycaster.intersectObjects(latestModelRoot.children, true).find(candidate => {
      const component = componentForObject(candidate.object);
      if (!component?.visible || !candidate.object.visible) return false;
      if (candidate.object.userData?.booleanTool) return true;
      const part = assemblyPartDefinition(component.userData.chapter5Id);
      return Boolean(part && component.userData.assemblyPart && !component.userData.assemblyFixed && assemblyPartAvailable(part));
    });
    if (!hit) return;
    const component = componentForObject(hit.object);
    if (!component) return;
    const cutter = hit.object.userData?.booleanTool
      ? cutterDefinition(component.userData.chapter5Id)
      : null;
    const assemblyPart = cutter ? null : assemblyPartDefinition(component.userData.chapter5Id);
    if (!cutter && !assemblyPart) return;
    if (cutter) selectCutter(cutter.id);
    else selectAssemblyPart(assemblyPart.id);
    const definition = cutter || assemblyPart;
    const plane = planeForCutter(definition, component);
    const startPoint = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, startPoint)) return;
    invalidateExactKernel();
    drag = {
      kind: cutter ? 'cutter' : 'assembly',
      pointerId: event.pointerId,
      cutter,
      assemblyPart,
      plane,
      startPoint,
      startValues: cutter ? { ...cutterValues(cutter.id) } : { ...assemblyOffset(assemblyPart.id) }
    };
    controls.enabled = false;
    rendererElement.setPointerCapture?.(event.pointerId);
    rendererElement.classList.add(cutter ? 'is-dragging-cutter' : 'is-dragging-component');
    event.preventDefault();
  }

  function moveCutterDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    pointerRay(event);
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(drag.plane, point)) return;
    const delta = point.sub(drag.startPoint);
    if (drag.kind === 'assembly') {
      const values = state.assemblyOffsets[drag.assemblyPart.id];
      const planeAxes = drag.assemblyPart.dragPlane === 'xy' ? ['x', 'y'] : drag.assemblyPart.dragPlane === 'yz' ? ['y', 'z'] : ['x', 'z'];
      lesson.assembly.axes.filter(axis => planeAxes.includes(axis.id)).forEach(axis => {
        const axisDelta = axis.id === 'x' ? delta.x : axis.id === 'y' ? delta.y : delta.z;
        values[axis.id] = Number(clamp(drag.startValues[axis.id] + axisDelta, axis.min, axis.max).toFixed(3));
      });
      currentAssemblyOffset(drag.assemblyPart.id).set(values.x, values.y, values.z);
      markDetached(drag.assemblyPart.id, Math.hypot(values.x, values.y, values.z) > 0.04);
      applyExplode();
      const now = performance.now();
      if (now - lastExplodeProjectionSync > 90) {
        refreshProjections();
        lastExplodeProjectionSync = now;
      }
      renderAssemblyWorkbench();
      renderComponents();
      event.preventDefault();
      return;
    }
    const values = state.cutterValues[drag.cutter.id];
    drag.cutter.axes.forEach(axis => {
      const axisDelta = axis.id === 'x' ? delta.x : axis.id === 'y' ? delta.y : delta.z;
      const raw = drag.startValues[axis.id] + axisDelta;
      values[axis.id] = Number(clamp(raw, axis.min, axis.max).toFixed(3));
    });
    scheduleRebuild({ fullRender: false });
    renderBooleanWorkbench();
    event.preventDefault();
  }

  function endCutterDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    rendererElement?.releasePointerCapture?.(drag.pointerId);
    rendererElement?.classList.remove('is-dragging-cutter');
    rendererElement?.classList.remove('is-dragging-component');
    controls.enabled = true;
    drag = null;
    if (active) {
      renderSequence();
      renderBooleanWorkbench();
      renderAssemblyWorkbench();
      renderComponents();
      refreshProjections();
      syncProjectionImages();
      scheduleExactKernelAudit(180);
    }
  }

  function startPointPick(event) {
    if (!active || !pointPickingActive() || !state.pointPickEnabled || event.button !== 0 || drag) return;
    pointPickDown = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, time: performance.now() };
  }

  function endPointPick(event) {
    if (!pointPickDown || event.pointerId !== pointPickDown.pointerId) return;
    const start = pointPickDown;
    pointPickDown = null;
    if (!active || !pointPickingActive() || !state.pointPickEnabled || drag) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > 6 || performance.now() - start.time > 500) return;
    pointerRay(event);
    latestModelRoot?.updateMatrixWorld(true);
    const hit = raycaster.intersectObjects(latestModelRoot?.children || [], true).find(candidate => {
      if (!candidate.object?.isMesh || candidate.object.userData?.booleanTool) return false;
      if (candidate.object.userData?.compoundEdgeOverlay || candidate.object.userData?.pickedPointMarker) return false;
      const component = componentForObject(candidate.object);
      return component?.visible && component.userData.chapter5Id === 'body';
    });
    if (!hit) {
      setStatus?.('例5-5点投影：请点击蓝色差集结果体的表面。');
      return;
    }
    state.pickedPoint = hit.point.toArray();
    mountPointMarker();
    refreshProjections();
    renderObservationTools();
    setStatus?.(`例5-5点投影：已选P(${state.pickedPoint.map(value => value.toFixed(2)).join(', ')})，三视图已同步标点。`);
    event.preventDefault();
  }

  function handleClick(event) {
    const viewButton = event.target.closest?.('[data-compound-view-tab]');
    if (viewButton) {
      mobileProjectionView = viewButton.dataset.compoundViewTab;
      syncMobileProjectionView();
      return;
    }
    const lessonButton = event.target.closest?.('[data-compound-lesson]');
    if (lessonButton) return selectLesson(lessonButton.dataset.compoundLesson);
    const stageButton = event.target.closest?.('[data-compound-stage]');
    if (stageButton) return selectStage(Number(stageButton.dataset.compoundStage));
    const cutterButton = event.target.closest?.('[data-compound-cutter]');
    if (cutterButton) return selectCutter(cutterButton.dataset.compoundCutter);
    const booleanAction = event.target.closest?.('[data-boolean-action]')?.dataset.booleanAction;
    if (booleanAction === 'toggle-apply') return toggleActiveCut();
    if (booleanAction === 'toggle-tool') {
      state.showCutter = !state.showCutter;
      applyVisibility();
      refreshProjections();
      renderBooleanWorkbench();
      return;
    }
    if (booleanAction === 'apply-all') {
      invalidateExactKernel();
      state.appliedCutters = lesson.cutters.map(cutter => cutter.id);
      state.stageIndex = lesson.stages.length - 1;
      state.activeCutterId = lesson.stages.at(-1)?.activeCutter || state.activeCutterId;
      state.showCutter = false;
      return scheduleRebuild();
    }
    if (booleanAction === 'reset-cutters') return resetCutterPositions();
    const displayAction = event.target.closest?.('[data-display-action]')?.dataset.displayAction;
    if (displayAction && displayToolsActive()) {
      if (displayAction === 'shadows') state.display.shadows = !state.display.shadows;
      if (displayAction === 'bold-edges') state.display.boldEdges = !state.display.boldEdges;
      if (displayAction === 'transparent') state.display.transparent = !state.display.transparent;
      if (displayAction === 'hidden-lines') {
        state.display.showHidden = !state.display.showHidden;
        setProjectionHidden?.(state.display.showHidden);
      }
      applyDisplayStyle();
      refreshProjections();
      syncProjectionImages();
      renderObservationTools();
      return;
    }
    const pointAction = event.target.closest?.('[data-point-action]')?.dataset.pointAction;
    if (pointAction === 'toggle' && pointPickingActive()) {
      state.pointPickEnabled = !state.pointPickEnabled;
      rendererElement?.classList.toggle('is-picking-point', state.pointPickEnabled);
      renderObservationTools();
      return;
    }
    if (pointAction === 'clear' && pointPickingActive()) return clearPickedPoint();
    const kernelAction = event.target.closest?.('[data-kernel-action]')?.dataset.kernelAction;
    if (kernelAction === 'audit') return runExactKernelAudit();
    const assemblyPartButton = event.target.closest?.('[data-assembly-part]');
    if (assemblyPartButton) return selectAssemblyPart(assemblyPartButton.dataset.assemblyPart);
    const assemblyAction = event.target.closest?.('[data-assembly-action]')?.dataset.assemblyAction;
    if (assemblyAction === 'toggle-part') return toggleAssemblyPart();
    if (assemblyAction === 'detach-next') return detachNextAssemblyPart();
    if (assemblyAction === 'attach-next') return attachNextAssemblyPart();
    if (assemblyAction === 'restore-all') return restoreAssembly();
    const componentButton = event.target.closest?.('[data-compound-component]');
    if (componentButton) return isolateComponent(componentButton.dataset.compoundComponent);
    const answerButton = event.target.closest?.('[data-compound-answer]');
    if (answerButton && !state.evaluated) {
      state.selectedAnswer = answerButton.dataset.compoundAnswer;
      renderQuestion();
    }
  }

  function handleInput(event) {
    if (event.target.matches?.('[data-assembly-axis]')) {
      invalidateExactKernel();
      const partId = event.target.dataset.assemblyId;
      const axisId = event.target.dataset.assemblyAxis;
      const part = assemblyPartDefinition(partId);
      const axis = lesson.assembly?.axes?.find(item => item.id === axisId);
      if (!part || part.fixed || !axis || !state.assemblyOffsets[partId]) return;
      state.activeAssemblyId = partId;
      state.assemblyOffsets[partId][axisId] = Number(event.target.value);
      const values = state.assemblyOffsets[partId];
      currentAssemblyOffset(partId).set(values.x, values.y, values.z);
      markDetached(partId, Math.hypot(values.x, values.y, values.z) > 0.04);
      const output = event.target.parentElement?.querySelector('output');
      if (output) output.textContent = Number(event.target.value).toFixed(2);
      applyExplode();
      explodeProjectionDirty = true;
      const now = performance.now();
      if (now - lastExplodeProjectionSync > 90) {
        refreshProjections();
        lastExplodeProjectionSync = now;
      }
      renderComponents();
      return;
    }
    if (event.target.matches?.('[data-cutter-axis]')) {
      invalidateExactKernel();
      const cutterId = event.target.dataset.cutterId;
      const axisId = event.target.dataset.cutterAxis;
      if (!state.cutterValues[cutterId]) return;
      state.cutterValues[cutterId][axisId] = Number(event.target.value);
      const output = event.target.parentElement?.querySelector('output');
      if (output) output.textContent = Number(event.target.value).toFixed(2);
      scheduleRebuild({ fullRender: false });
      return;
    }
    if (event.target.matches?.('[data-compound-parameter]')) {
      invalidateExactKernel();
      const id = event.target.dataset.compoundParameter;
      state.parameters[id] = Number(event.target.value);
      const output = event.target.parentElement?.querySelector('output');
      const parameter = lesson.parameters?.find(item => item.id === id);
      if (output && parameter) output.textContent = `${state.parameters[id]}${parameter.unit}`;
      event.target.parentElement?.classList.toggle('changed', state.parameters[id] !== parameter?.textbook);
      scheduleRebuild({ fullRender: false });
      return;
    }
    if (event.target === dom.explode) setExplode(Number(event.target.value) / 100);
  }

  function bindDom() {
    rootElement?.addEventListener('click', handleClick, eventOptions);
    rootElement?.addEventListener('input', handleInput, eventOptions);
    rootElement?.addEventListener('change', event => {
      if (event.target.matches?.('[data-assembly-axis]')) {
        renderSequence();
        renderAssemblyWorkbench();
      }
    }, eventOptions);
    dom.reset?.addEventListener('click', reset, eventOptions);
    dom.previous?.addEventListener('click', () => selectStage(state.stageIndex - 1), eventOptions);
    dom.next?.addEventListener('click', () => selectStage(state.stageIndex + 1), eventOptions);
    dom.assemble?.addEventListener('click', () => setExplode(0), eventOptions);
    dom.explodeAll?.addEventListener('click', () => setExplode(1), eventOptions);
    dom.submit?.addEventListener('click', () => {
      if (state.evaluated) {
        state.selectedAnswer = null;
        state.evaluated = false;
      } else if (state.selectedAnswer) {
        state.evaluated = true;
      }
      renderQuestion();
    }, eventOptions);
    rendererElement?.addEventListener('pointerdown', startCutterDrag, eventOptions);
    rendererElement?.addEventListener('pointerdown', startPointPick, eventOptions);
    rendererElement?.addEventListener('pointermove', moveCutterDrag, eventOptions);
    rendererElement?.addEventListener('pointerup', endCutterDrag, eventOptions);
    rendererElement?.addEventListener('pointerup', endPointPick, eventOptions);
    rendererElement?.addEventListener('pointercancel', endCutterDrag, eventOptions);
    rendererElement?.addEventListener('pointercancel', () => { pointPickDown = null; }, eventOptions);
    doc?.querySelectorAll('[data-compound-image]').forEach(image => {
      image.addEventListener('load', syncProjectionPointMarkers, eventOptions);
    });
    globalThis.addEventListener?.('resize', syncProjectionPointMarkers, eventOptions);
  }

  function dispose() {
    if (rebuildFrame) cancelAnimationFrame(rebuildFrame);
    eventController?.abort();
    leave();
  }

  function centerAxesForLesson() {
    if (lesson.id === 'example-5-1') {
      const barrelY = 2.05;
      return [
        { from: [-1.28, barrelY, 0], to: [1.28, barrelY, 0] },
        { from: [0, 0.72, 0], to: [0, 3.38, 0] },
        { from: [0, barrelY, -1.52], to: [0, barrelY, 1.78] }
      ];
    }
    if (lesson.id === 'example-5-6') {
      return [
        { from: [0.55, 0.48, 0], to: [0.55, 3.2, 0] },
        { from: [-0.78, 1.81, 0], to: [1.88, 1.81, 0] },
        { from: [0.55, 1.81, -1.34], to: [0.55, 1.81, 1.34] }
      ];
    }
    return [];
  }

  const controller = {
    buildCurrentModel,
    enter,
    leave,
    reset,
    selectLesson,
    selectStage,
    selectCutter,
    syncProjectionImages,
    scrollActiveLessonIntoView,
    update,
    getCenterAxes: centerAxesForLesson,
    getProjectionStyle: () => ({
      boldEdges: displayToolsActive() && Boolean(state.display?.boldEdges),
      showHidden: state.display?.showHidden !== false,
      suppressCenterLines: lesson.id === 'example-5-5'
    }),
    getState: () => cloneState(state),
    getLesson: () => lesson,
    isActive: () => active,
    dispose
  };

  bindDom();
  renderAll();
  return controller;
}
