import opencascade from 'replicad-opencascadejs/src/replicad_single.js';
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url';
import {
  BoundingBox,
  cast,
  Compound,
  CompSolid,
  Shell,
  Solid,
  draw,
  drawProjection,
  getOC,
  iterTopo,
  makeBox,
  makeCylinder,
  measureVolume,
  setOC
} from 'replicad';

const SCALE = 10;
const EPSILON = 1e-7;
let loaded = false;

async function init() {
  if (loaded) return;
  const OC = await opencascade({ locateFile: () => opencascadeWasm });
  setOC(OC);
  loaded = true;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function valueAt(values, id, axis, fallback = 0) {
  const value = values?.[id]?.[axis];
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function prism(points, plane, origin, distance, direction) {
  const pen = draw(points[0]);
  points.slice(1).forEach(point => pen.lineTo(point));
  return pen
    .close()
    .sketchOnPlane(plane, origin)
    .extrude(distance, { extrusionDirection: direction });
}

function unifyEngineeringShape(shape) {
  const OC = getOC();
  const unifier = new OC.ShapeUpgrade_UnifySameDomain_2(shape.wrapped, true, true, false);
  unifier.AllowInternalEdges(false);
  unifier.SetLinearTolerance(1e-7);
  unifier.SetAngularTolerance(1e-7);
  unifier.Build();
  const refined = cast(unifier.Shape()).clone();
  unifier.delete();
  const solids = Array.from(iterTopo(refined.wrapped, 'solid'));
  return solids.length === 1 ? cast(solids[0]).clone() : refined;
}

const TEXTBOOK_ENVELOPES = Object.freeze({
  'example-5-1': Object.freeze({ min: [-22, -16, 0], max: [22, 16, 34.7] }),
  'example-5-5': Object.freeze({ min: [-22, -14, 0], max: [22, 14, 27] }),
  'example-5-6': Object.freeze({ min: [-20.5, -10.5, 0], max: [16, 10.5, 24.8] })
});

// The scene and kernel use the same right-handed model: scene (X,Y,Z)
// becomes kernel (10X,-10Z,10Y). Positive scene Z is the textbook front.
// Replicad passes the plane normal directly to OpenCascade's HLR projector.
// For the textbook's top-down plan, the projector axis must point toward the
// observer above +Z; in Replicad's named planes that is `bottom`, not `top`.
// Keep the sheet-view name separate from the HLR camera plane so the drawing
// remains a conventional first-angle top view placed below the front view.
const TEXTBOOK_PROJECTION_CAMERAS = Object.freeze({
  front: 'front',
  side: 'right',
  top: 'bottom'
});

// These cameras already match the scene's front (+Z), left (-X), and top
// (+Y) observers. No image mirroring may substitute for the correct observer.
const TEXTBOOK_PROJECTION_HORIZONTAL_MIRRORS = Object.freeze({
  front: false,
  side: false,
  top: false
});

function textbookProjectionFrame(lessonId, view, padding = 2) {
  const envelope = TEXTBOOK_ENVELOPES[lessonId];
  if (!envelope) throw new Error(`Missing textbook projection envelope: ${lessonId}`);
  const [xMin, yMin, zMin] = envelope.min;
  const [xMax, yMax, zMax] = envelope.max;
  if (view === 'front') {
    return [xMin - padding, -zMax - padding, xMax - xMin + padding * 2, zMax - zMin + padding * 2];
  }
  if (view === 'left' || view === 'right') {
    const horizontalMin = view === 'right' ? -yMax : yMin;
    return [horizontalMin - padding, -zMax - padding, yMax - yMin + padding * 2, zMax - zMin + padding * 2];
  }
  return [xMin - padding, yMin - padding, xMax - xMin + padding * 2, yMax - yMin + padding * 2];
}

function linePath(a, b) {
  return `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`;
}

function addCross(target, center, halfWidth, halfHeight = halfWidth) {
  target.push(linePath([center[0] - halfWidth, center[1]], [center[0] + halfWidth, center[1]]));
  target.push(linePath([center[0], center[1] - halfHeight], [center[0], center[1] + halfHeight]));
}

function textbookCenterlines(lessonId, payload = {}) {
  const result = { front: [], side: [], top: [] };
  if (lessonId === 'example-5-1') {
    const visible = new Set(payload.visibleComponents || []);
    const applied = new Set(payload.appliedCutters || []);
    const hasUpright = visible.has('upright');
    const hasBarrel = visible.has('barrel');
    if (hasUpright || hasBarrel) {
      result.front.push(linePath([-16.2, -20.5], [16.2, -20.5]));
      result.front.push(linePath([0, 1.5], [0, -36.2]));
    } else {
      result.front.push(linePath([0, 1.2], [0, -4.4]));
    }
    result.top.push(linePath([0, -17.5], [0, 17.5]));
    if (hasBarrel) {
      result.side.push(linePath([-13.2, -20.5], [17.5, -20.5]));
    }
    if (applied.has('base-hole-left') || applied.has('base-hole-right')) {
      for (const id of ['base-hole-left', 'base-hole-right']) {
        if (!applied.has(id)) continue;
        const fallbackX = id === 'base-hole-left' ? -1.55 : 1.55;
        const x = valueAt(payload.cutterValues, id, 'x', fallbackX) * SCALE;
        const y = valueAt(payload.cutterValues, id, 'z', 1.05) * SCALE;
        addCross(result.top, [x, y], 3.2);
        result.front.push(linePath([x, 1.2], [x, -4.4]));
      }
    }
  }
  if (lessonId === 'example-5-6') {
    result.front.push(linePath([RING56.x, 1.2], [RING56.x, -26.4]));
    result.side.push(linePath([0, 1.2], [0, -26.4]));
    result.top.push(linePath([RING56.x - RING56.outer - 1.7, 0], [RING56.x + RING56.outer + 1.7, 0]));
    result.top.push(linePath([RING56.x, -RING56.outer - 1.7], [RING56.x, RING56.outer + 1.7]));
  }
  return result;
}

function projection(shape, sheetView, cameraPlane, lessonId, centerlinePathData = []) {
  let { visible, hidden } = drawProjection(shape, cameraPlane);
  const horizontalMirrored = TEXTBOOK_PROJECTION_HORIZONTAL_MIRRORS[sheetView] === true;
  if (horizontalMirrored) {
    visible = visible.mirror([0, 1], [0, 0], 'plane');
    hidden = hidden.mirror([0, 1], [0, 0], 'plane');
  }
  const visiblePathData = visible.toSVGPaths().flat(Infinity).filter(Boolean);
  const hiddenPathData = hidden.toSVGPaths().flat(Infinity).filter(Boolean);
  const frame = textbookProjectionFrame(lessonId, sheetView);
  return {
    sheetView,
    cameraPlane,
    horizontalMirrored,
    viewBox: frame.join(' '),
    frame,
    visiblePathData,
    hiddenPathData,
    centerlinePathData,
    visiblePaths: visiblePathData.length,
    hiddenPaths: hiddenPathData.length,
    centerlinePaths: centerlinePathData.length
  };
}

function semanticShapeType(shape) {
  if (shape instanceof Solid) return 'Solid';
  if (shape instanceof CompSolid) return 'CompSolid';
  if (shape instanceof Compound) return 'Compound';
  if (shape instanceof Shell) return 'Shell';
  return 'Shape3D';
}

function roundedBase51() {
  const radius = 4.2;
  const corner = 16 - radius;
  const diagonal = radius / Math.sqrt(2);
  return draw([-22, -16])
    .lineTo([22, -16])
    .lineTo([22, corner])
    .threePointsArcTo([22 - radius, 16], [22 - radius + diagonal, corner + diagonal])
    .lineTo([-22 + radius, 16])
    .threePointsArcTo([-22, corner], [-22 + radius - diagonal, corner + diagonal])
    .close()
    .sketchOnPlane('XY')
    .extrude(3.2)
    .mirror('XZ');
}

function upright51() {
  return draw([-14.2, 3.1])
    .lineTo([-14.2, 20.5])
    .threePointsArcTo([14.2, 20.5], [0, 34.7])
    .lineTo([14.2, 3.1])
    .close()
    .sketchOnPlane('XZ', [0, 14, 0])
    .extrude(2.5, { extrusionDirection: [0, -1, 0] });
}

function buildExample51({ visibleComponents = [], appliedCutters = [], cutterValues = {} } = {}) {
  const visible = new Set(visibleComponents);
  const applied = new Set(appliedCutters);
  let result = roundedBase51();

  if (visible.has('upright')) result = result.fuse(upright51());
  if (visible.has('barrel')) {
    const barrelOuter = makeCylinder(10.5, 27.7, [0, 11.7, 20.5], [0, -1, 0]);
    result = result.fuse(barrelOuter);
  }
  if (visible.has('rib')) {
    const rib = makeBox([-1.7, -16, 3.1], [1.7, 11.7, 10]);
    result = result.fuse(rib);
  }

  if (applied.has('bore')) {
    const x = valueAt(cutterValues, 'bore', 'x', 0) * SCALE;
    const z = valueAt(cutterValues, 'bore', 'y', 2.05) * SCALE;
    result = result.cut(makeCylinder(5.5, 36, [x, -18, z], [0, 1, 0]));
  }
  for (const [id, fallbackX] of [['base-hole-left', -1.55], ['base-hole-right', 1.55]]) {
    if (!applied.has(id)) continue;
    const x = valueAt(cutterValues, id, 'x', fallbackX) * SCALE;
    const y = -valueAt(cutterValues, id, 'z', 1.05) * SCALE;
    result = result.cut(makeCylinder(1.8, 8, [x, y, -2], [0, 0, 1]));
  }
  return result;
}

function buildExample55({ slotLength = 50, appliedCutters = [], cutterValues = {} } = {}) {
  const applied = new Set(appliedCutters);
  const pX = valueAt(cutterValues, 'cut-p', 'x') * SCALE;
  const pZ = valueAt(cutterValues, 'cut-p', 'y') * SCALE;
  const qY = valueAt(cutterValues, 'cut-q', 'z') * SCALE;
  const qZ = valueAt(cutterValues, 'cut-q', 'y') * SCALE;
  const slotX = valueAt(cutterValues, 'cut-slot', 'x') * SCALE;
  const slotY = -valueAt(cutterValues, 'cut-slot', 'z') * SCALE;
  const normalizedLength = clamp(slotLength, 14, 54);

  let result = makeBox([-22, -14, 0], [22, 14, 27]);
  if (applied.has('cut-p')) {
    const cutterP = prism(
      [[-24.5 + pX, 29.5 + pZ], [-24.5 + pX, 3.5 + pZ], [4.5 + pX, 29.5 + pZ]],
      'XZ',
      [0, -16.25, 0],
      32.5,
      [0, 1, 0]
    );
    result = result.cut(cutterP);
  }
  if (applied.has('cut-q')) {
    const cutterQFront = prism(
      [[17.2 + qY, 29.5 + qZ], [17.2 + qY, 2.5 + qZ], [4.8 + qY, 29.5 + qZ]],
      'YZ',
      [-24.25, 0, 0],
      48.5,
      [1, 0, 0]
    );
    const cutterQRear = prism(
      [[-17.2 - qY, 29.5 + qZ], [-17.2 - qY, 2.5 + qZ], [-4.8 - qY, 29.5 + qZ]],
      'YZ',
      [-24.25, 0, 0],
      48.5,
      [1, 0, 0]
    );
    result = result.cut(cutterQFront).cut(cutterQRear);
  }
  if (applied.has('cut-slot')) {
    const cutterSlot = makeBox(
      [slotX - normalizedLength / 2, slotY - 8, -4.5],
      [slotX + normalizedLength / 2, slotY + 8, 10.5]
    );
    result = result.cut(cutterSlot);
  }
  return result;
}

// Figure 5-17a places the hollow cylinder and base on the same z=0 datum.
// Starting the ring at the base top creates a false empty chamber below it.
const RING56 = Object.freeze({ x: 5.5, outer: 10.5, inner: 7.6, bottom: 0, top: 24.8 });
const BASE56 = Object.freeze({ xMin: -20.5, leftHalfDepth: 5.6, top: 9.5 });
const SLOT56_HALF_WIDTH = 3.5;
// Match the interactive tool's full depth, including at off-centre X limits.
// A depth based only on the centred slot's circle intersection leaves a shelf
// when the user moves that slot sideways.
const SLOT56_INNER_DEPTH = 1.3;
const SLOT56_OUTER_DEPTH = 14.3;
const SLOT56_REAR_INNER_DEPTH = 1.2;
const SLOT56_REAR_OUTER_DEPTH = 14.4;

function tangent56() {
  const vx = BASE56.xMin - RING56.x;
  const vy = BASE56.leftHalfDepth;
  const distanceSq = vx * vx + vy * vy;
  const baseScale = RING56.outer ** 2 / distanceSq;
  const perpendicularScale = RING56.outer * Math.sqrt(distanceSq - RING56.outer ** 2) / distanceSq;
  return [
    RING56.x + baseScale * vx + perpendicularScale * vy,
    baseScale * vy - perpendicularScale * vx
  ];
}

const [TANGENT56_X, TANGENT56_DEPTH] = tangent56();
const BASE56_X_MAX = RING56.x + RING56.outer;

function base56HalfDepthAt(x) {
  if (x <= TANGENT56_X) {
    const ratio = (x - BASE56.xMin) / (TANGENT56_X - BASE56.xMin);
    return BASE56.leftHalfDepth + ratio * (TANGENT56_DEPTH - BASE56.leftHalfDepth);
  }
  const ratio = (x - TANGENT56_X) / (BASE56_X_MAX - TANGENT56_X);
  return TANGENT56_DEPTH * (1 - ratio);
}

function base56() {
  return draw([BASE56.xMin, -BASE56.leftHalfDepth])
    .lineTo([TANGENT56_X, -TANGENT56_DEPTH])
    .threePointsArcTo(
      [TANGENT56_X, TANGENT56_DEPTH],
      [RING56.x - RING56.outer, 0]
    )
    .lineTo([BASE56.xMin, BASE56.leftHalfDepth])
    .close()
    .sketchOnPlane('XY')
    .extrude(BASE56.top);
}

function roundedRearCutter56(cutterValues) {
  const centerX = valueAt(cutterValues, 'cut-iv', 'x', 0.55) * SCALE;
  const arcCenterZ = valueAt(cutterValues, 'cut-iv', 'y', 1.9) * SCALE;
  const half = SLOT56_HALF_WIDTH;
  const top = RING56.top + 2.5;
  return draw([centerX - half, top])
    .lineTo([centerX + half, top])
    .lineTo([centerX + half, arcCenterZ])
    .threePointsArcTo([centerX - half, arcCenterZ], [centerX, arcCenterZ - half])
    .close()
    .sketchOnPlane('XZ', [0, SLOT56_REAR_INNER_DEPTH, 0])
    .extrude(SLOT56_REAR_OUTER_DEPTH - SLOT56_REAR_INNER_DEPTH, { extrusionDirection: [0, 1, 0] });
}

function buildExample56({ appliedCutters = [], cutterValues = {} } = {}) {
  const applied = new Set(appliedCutters);
  const ringOuter = makeCylinder(RING56.outer, RING56.top - RING56.bottom, [RING56.x, 0, RING56.bottom]);
  const ringInner = makeCylinder(RING56.inner, RING56.top - RING56.bottom + 1.6, [RING56.x, 0, RING56.bottom - 0.8]);
  let result = base56().fuse(ringOuter.cut(ringInner));

  if (applied.has('cut-iii')) {
    const x = valueAt(cutterValues, 'cut-iii', 'x', 0.55) * SCALE;
    const floor = (valueAt(cutterValues, 'cut-iii', 'y', 2.4) - 0.525) * SCALE;
    result = result.cut(makeBox(
      [x - SLOT56_HALF_WIDTH, -SLOT56_OUTER_DEPTH, floor],
      [x + SLOT56_HALF_WIDTH, -SLOT56_INNER_DEPTH, RING56.top + 2.5]
    ));
  }
  if (applied.has('cut-iv')) result = result.cut(roundedRearCutter56(cutterValues));
  if (applied.has('cut-v')) {
    const stopX = valueAt(cutterValues, 'cut-v', 'x', -1.4) * SCALE;
    const centerZ = valueAt(cutterValues, 'cut-v', 'y', 0.475) * SCALE;
    const height = valueAt(cutterValues, 'cut-v', 'height', 0.36) * SCALE;
    const xMin = BASE56.xMin - 1.2;
    const halfDepth = base56HalfDepthAt(stopX) + 0.8;
    result = result.cut(makeBox([xMin, -halfDepth, centerZ - height / 2], [stopX, halfDepth, centerZ + height / 2]));
  }
  return unifyEngineeringShape(result);
}

const BUILDERS = Object.freeze({
  'example-5-1': buildExample51,
  'example-5-5': buildExample55,
  'example-5-6': buildExample56
});

function commonFacts(shape, lessonId, projections) {
  // Replicad's standard boundingBox uses BRepBndLib.Add with triangulation.
  // A moved curved cut can inflate that conservative box by ~0.0023 kernel
  // units despite an unchanged cylinder radius. Query exact surface extrema
  // without triangulation instead; retain the strict dimensional tolerances.
  const bounds = new BoundingBox();
  let min, max;
  try {
    getOC().BRepBndLib.AddOptimal(shape.wrapped, bounds.wrapped, false, false);
    [min, max] = bounds.bounds;
  } finally {
    bounds.delete();
  }
  const size = max.map((value, index) => value - min[index]);
  const renderMesh = {
    faces: shape.mesh({ tolerance: 0.05, angularTolerance: 0.1 }),
    edges: shape.meshEdges({ tolerance: 0.05, angularTolerance: 0.1 })
  };
  const facts = {
    lessonId,
    kernel: 'Replicad 0.23.1 / OpenCascade WASM',
    shapeType: semanticShapeType(shape),
    bounds: { min, max, size },
    boundsMethod: 'BRepBndLib.AddOptimal (no triangulation)',
    volume: measureVolume(shape),
    solidCount: Array.from(iterTopo(shape.wrapped, 'solid')).length,
    faceCount: shape.faces.length,
    edgeCount: shape.edges.length,
    renderTriangleCount: renderMesh.faces.triangles.length / 3,
    renderEdgeSegmentCount: renderMesh.edges.lines.length / 6
  };
  facts.topologyValid = facts.solidCount === 1
    && facts.volume > EPSILON
    && facts.faceCount > 0
    && facts.edgeCount > 0;
  facts.viewDirectionsValid = projections.front.cameraPlane === TEXTBOOK_PROJECTION_CAMERAS.front
    && projections.side.cameraPlane === TEXTBOOK_PROJECTION_CAMERAS.side
    && projections.top.cameraPlane === TEXTBOOK_PROJECTION_CAMERAS.top
    && !projections.front.horizontalMirrored
    && !projections.side.horizontalMirrored
    && !projections.top.horizontalMirrored;
  facts.projectionsValid = facts.viewDirectionsValid
    && Object.values(projections).every(item => item.visiblePaths > 0);
  facts.projectionAlignmentValid = Math.abs(projections.front.frame[2] - projections.top.frame[2]) < EPSILON
    && Math.abs(projections.front.frame[3] - projections.side.frame[3]) < EPSILON
    && Math.abs(projections.side.frame[2] - projections.top.frame[3]) < EPSILON;
  return { facts, renderMesh };
}

function addLessonChecks(shape, facts, payload) {
  if (facts.lessonId === 'example-5-5') {
    const applied = new Set(payload.appliedCutters || []);
    const slotLength = clamp(payload.slotLength, 14, 54);
    const slotX = valueAt(payload.cutterValues, 'cut-slot', 'x') * SCALE;
    const slotY = -valueAt(payload.cutterValues, 'cut-slot', 'z') * SCALE;
    const slotCoversFullX = applied.has('cut-slot')
      && slotX - slotLength / 2 <= -22 + EPSILON
      && slotX + slotLength / 2 >= 22 - EPSILON;
    const centerProbe = makeBox([-21.5, slotY - 0.5, 4.5], [21.5, slotY + 0.5, 5.5]);
    const legProbes = [
      makeBox([-21.5, -12.5, 4.5], [21.5, -11.5, 5.5]),
      makeBox([-21.5, 11.5, 4.5], [21.5, 12.5, 5.5])
    ];
    const centerMaterial = measureVolume(shape.intersect(centerProbe));
    const legMaterials = legProbes.map(probe => measureVolume(shape.intersect(probe)));
    const centerStateMatches = slotCoversFullX ? centerMaterial < EPSILON : centerMaterial > 1;
    facts.slotLength = slotLength;
    facts.throughExpected = slotCoversFullX;
    facts.centerStateMatches = centerStateMatches;
    facts.centerProbeMaterial = centerMaterial;
    facts.legProbeMaterials = legMaterials;
    facts.legProbeMaterial = Math.max(...legMaterials);
    facts.boundsValid = facts.bounds.size.every((value, index) => Math.abs(value - [44, 28, 27][index]) < 1e-6);
    facts.semanticValid = facts.boundsValid && centerStateMatches && facts.legProbeMaterial > 1;
  } else if (facts.lessonId === 'example-5-6') {
    const applied = new Set(payload.appliedCutters || []);
    const stopX = valueAt(payload.cutterValues, 'cut-v', 'x', -1.4) * SCALE;
    const centerZ = valueAt(payload.cutterValues, 'cut-v', 'y', 0.475) * SCALE;
    const height = valueAt(payload.cutterValues, 'cut-v', 'height', 0.36) * SCALE;
    const vSlotProbeX = (BASE56.xMin + stopX) / 2;
    const lowerRingProbeHeight = BASE56.top - 1;
    const lowerBoreProbe = makeCylinder(
      RING56.inner - 0.2,
      lowerRingProbeHeight,
      [RING56.x, 0, 0.5]
    );
    const lowerRingWallProbe = makeCylinder(
      RING56.outer - 0.2,
      lowerRingProbeHeight,
      [RING56.x, 0, 0.5]
    ).cut(makeCylinder(
      RING56.inner + 0.2,
      lowerRingProbeHeight,
      [RING56.x, 0, 0.5]
    ));
    const baseTangencyProbe = makeCylinder(
      RING56.outer - 0.2,
      lowerRingProbeHeight,
      [RING56.x, 0, 0.5]
    );
    const frontX = valueAt(payload.cutterValues, 'cut-iii', 'x', 0.55) * SCALE;
    const frontFloor = (valueAt(payload.cutterValues, 'cut-iii', 'y', 2.4) - 0.525) * SCALE;
    const rearX = valueAt(payload.cutterValues, 'cut-iv', 'x', 0.55) * SCALE;
    const rearArcCenter = valueAt(payload.cutterValues, 'cut-iv', 'y', 1.9) * SCALE;
    // Sample within the actual wall at each current cutter centre, rather than
    // assuming the slots remain at the cylinder axis. A 0.4-unit cube is much
    // smaller than the minimum remaining radial wall thickness (~2.9 units).
    const wallProbe = (x, side, z) => {
      const dx = x - RING56.x;
      const depth = (Math.sqrt(RING56.outer ** 2 - dx ** 2) + Math.sqrt(RING56.inner ** 2 - dx ** 2)) / 2;
      return makeBox([x - 0.2, side * depth - 0.2, z - 0.2], [x + 0.2, side * depth + 0.2, z + 0.2]);
    };
    const frontWallProbe = wallProbe(frontX, -1, (frontFloor + RING56.top) / 2);
    const rearWallProbe = wallProbe(rearX, 1, (rearArcCenter + RING56.top) / 2);
    const frontFloorSupportProbe = wallProbe(frontX, -1, frontFloor - 0.4);
    const rearArcProbe = wallProbe(rearX, 1, rearArcCenter - SLOT56_HALF_WIDTH / 2);
    // This far-right wall is outside both tools' entire allowed X range, even
    // with an off-centre slot. The old diagonal probe could be legitimately cut.
    const sideWallProbe = makeBox(
      [RING56.x + RING56.outer - 0.8, -0.2, 21.6],
      [RING56.x + RING56.outer - 0.4, 0.2, 22.4]
    );
    const vSlotProbe = makeBox(
      [vSlotProbeX - 0.2, -0.2, centerZ - Math.min(0.2, height / 4)],
      [vSlotProbeX + 0.2, 0.2, centerZ + Math.min(0.2, height / 4)]
    );
    facts.lowerBoreIntrusion = measureVolume(shape.intersect(lowerBoreProbe));
    facts.lowerRingWallExpected = measureVolume(lowerRingWallProbe);
    facts.lowerRingWallMaterial = measureVolume(shape.intersect(lowerRingWallProbe));
    facts.lowerRingWallCoverage = facts.lowerRingWallExpected > EPSILON
      ? facts.lowerRingWallMaterial / facts.lowerRingWallExpected
      : 0;
    facts.baseTangencyIntrusion = measureVolume(base56().intersect(baseTangencyProbe));
    facts.frontWallProbeMaterial = measureVolume(shape.intersect(frontWallProbe));
    facts.rearWallProbeMaterial = measureVolume(shape.intersect(rearWallProbe));
    facts.frontFloorSupportMaterial = measureVolume(shape.intersect(frontFloorSupportProbe));
    facts.rearArcProbeMaterial = measureVolume(shape.intersect(rearArcProbe));
    facts.sideWallProbeMaterial = measureVolume(shape.intersect(sideWallProbe));
    facts.vSlotProbeMaterial = measureVolume(shape.intersect(vSlotProbe));
    facts.lowerBoreClear = facts.lowerBoreIntrusion < EPSILON;
    facts.lowerRingWallComplete = facts.lowerRingWallCoverage > 0.999;
    facts.baseTangencyClear = facts.baseTangencyIntrusion < EPSILON;
    facts.frontWallStateMatches = applied.has('cut-iii')
      ? facts.frontWallProbeMaterial < EPSILON
      : facts.frontWallProbeMaterial > 0.01;
    facts.rearWallStateMatches = applied.has('cut-iv')
      ? facts.rearWallProbeMaterial < EPSILON
      : facts.rearWallProbeMaterial > 0.01;
    facts.frontFloorSupportValid = facts.frontFloorSupportMaterial > 0.01;
    facts.rearArcStateMatches = applied.has('cut-iv')
      ? facts.rearArcProbeMaterial < EPSILON
      : facts.rearArcProbeMaterial > 0.01;
    facts.vSlotStateMatches = applied.has('cut-v')
      ? facts.vSlotProbeMaterial < EPSILON
      : facts.vSlotProbeMaterial > 0.01;
    facts.boundsValid = facts.bounds.size.every((value, index) => Math.abs(value - [36.5, 21, 24.8][index]) < 1e-5);
    facts.semanticValid = facts.boundsValid
      && facts.shapeType === 'Solid'
      && facts.lowerBoreClear
      && facts.lowerRingWallComplete
      && facts.baseTangencyClear
      && facts.frontWallStateMatches
      && facts.rearWallStateMatches
      && facts.frontFloorSupportValid
      && facts.rearArcStateMatches
      && facts.vSlotStateMatches
      && facts.sideWallProbeMaterial > 0.01;
  } else {
    facts.boundsValid = facts.bounds.size.every(value => value > 0);
    facts.semanticValid = facts.boundsValid;
  }
  facts.passed = facts.topologyValid
    && facts.projectionsValid
    && facts.projectionAlignmentValid
    && facts.semanticValid;
}

function auditLesson(payload = {}) {
  const lessonId = payload.lessonId || 'example-5-5';
  const builder = BUILDERS[lessonId];
  if (!builder) throw new Error(`Unsupported exact-kernel lesson: ${lessonId}`);
  const shape = builder(payload);
  const centerlines = textbookCenterlines(lessonId, payload);
  const projections = {
    front: projection(shape, 'front', TEXTBOOK_PROJECTION_CAMERAS.front, lessonId, centerlines.front),
    side: projection(shape, 'right', TEXTBOOK_PROJECTION_CAMERAS.side, lessonId, centerlines.side),
    top: projection(shape, 'top', TEXTBOOK_PROJECTION_CAMERAS.top, lessonId, centerlines.top)
  };
  const { facts, renderMesh } = commonFacts(shape, lessonId, projections);
  addLessonChecks(shape, facts, payload);
  return { facts, renderMesh, projections };
}

self.addEventListener('message', async event => {
  const { id, action, payload } = event.data || {};
  try {
    self.postMessage({ id, type: 'progress', stage: 'loading-kernel' });
    await init();
    self.postMessage({ id, type: 'progress', stage: 'building-brep' });
    if (!['audit-lesson', 'audit-example55'].includes(action)) {
      throw new Error(`Unknown exact-kernel action: ${action}`);
    }
    const result = auditLesson(action === 'audit-example55' ? { ...payload, lessonId: 'example-5-5' } : payload);
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
