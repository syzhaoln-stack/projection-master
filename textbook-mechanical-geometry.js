import { BoundingBox, cast, draw, drawProjection, getOC, iterTopo, makeBox, makeCylinder, measureVolume } from 'replicad';
import contract from './textbook-mechanical-contract.json' with { type: 'json' };

const EPS = 1e-7;

function prism(points, plane, origin, distance, direction) {
  const sketch = draw(points[0]);
  for (const point of points.slice(1)) sketch.lineTo(point);
  return sketch.close().sketchOnPlane(plane, origin).extrude(distance, { extrusionDirection: direction });
}

function refine(shape) {
  const OC = getOC();
  const unifier = new OC.ShapeUpgrade_UnifySameDomain_2(shape.wrapped, true, true, false);
  unifier.AllowInternalEdges(false);
  unifier.Build();
  const result = cast(unifier.Shape()).clone();
  unifier.delete();
  const solids = Array.from(iterTopo(result.wrapped, 'solid'));
  return solids.length === 1 ? cast(solids[0]).clone() : result;
}

function obliqueCylinder(p) {
  const margin = p.radius + 2;
  const above = prism([
    [-margin, p.cutCenterHeight - p.cutSlope * margin],
    [margin, p.cutCenterHeight + p.cutSlope * margin],
    [margin, p.height + 2], [-margin, p.height + 2]
  ], 'XZ', [0, -margin, 0], margin * 2, [0, 1, 0]);
  return makeCylinder(p.radius, p.height).cut(above);
}

function slotCylinder(p) {
  const r = p.radius + 2, half = p.slotWidth / 2;
  const upper = makeBox([-half, -r, p.height - p.slotDepth], [half, r, p.height + 2]);
  const lowerLeft = makeBox([-r, -r, -2], [-half, r, p.tongueHeight]);
  const lowerRight = makeBox([half, -r, -2], [r, r, p.tongueHeight]);
  return makeCylinder(p.radius, p.height).cut(upper).cut(lowerLeft).cut(lowerRight);
}

function keyedShaft(p) {
  const radius = p.slotWidth / 2;
  const center = (p.slotLength - p.slotWidth) / 2;
  const floor = p.radius * 2 - p.slotDepth;
  const toolHeight = p.slotDepth + 2;
  const roundedSlot = makeBox([-center, -radius, floor], [center, radius, floor + toolHeight])
    .fuse(makeCylinder(radius, toolHeight, [-center, 0, floor]))
    .fuse(makeCylinder(radius, toolHeight, [center, 0, floor]));
  return makeCylinder(p.radius, p.length, [-p.length / 2, 0, p.radius], [1, 0, 0]).cut(roundedSlot);
}

function ribbedFlange(p) {
  let body = makeCylinder(p.baseRadius, p.baseThickness)
    .fuse(makeCylinder(p.hubRadius, p.totalHeight));
  for (let i = 0; i < 4; i++) {
    const rib = prism([
      [p.hubRadius - 1, p.baseThickness - 1],
      [p.ribOuterRadius, p.baseThickness - 1],
      [p.ribOuterRadius, p.baseThickness],
      [p.hubRadius - 1, p.ribTop]
    ], 'XZ', [0, -p.ribThickness / 2, 0], p.ribThickness, [0, 1, 0]);
    body = body.fuse(rib.rotate(p.ribPhaseDegrees + i * 90, [0, 0, 0], [0, 0, 1]));
  }
  body = body.cut(makeCylinder(p.boreRadius, p.totalHeight + 4, [0, 0, -2]));
  for (let i = 0; i < 4; i++) {
    const angle = p.holePhaseDegrees * Math.PI / 180 + i * Math.PI / 2;
    const x = Math.cos(angle) * p.holeCircleRadius;
    const y = Math.sin(angle) * p.holeCircleRadius;
    body = body.cut(makeCylinder(p.holeRadius, p.baseThickness + 4, [x, y, -2]));
    body = body.cut(makeCylinder(p.counterboreRadius, p.counterboreDepth + 2,
      [x, y, p.baseThickness - p.counterboreDepth]));
  }
  return body;
}

function valveAdapter(p) {
  const h = p.flangeSize / 2, r = p.flangeRadius, c = h - r, diagonal = r / Math.sqrt(2);
  const flange = draw([-c, -h]).lineTo([c, -h])
    .threePointsArcTo([h, -c], [c + diagonal, -c - diagonal])
    .lineTo([h, c]).threePointsArcTo([c, h], [c + diagonal, c + diagonal])
    .lineTo([-c, h]).threePointsArcTo([-h, c], [-c - diagonal, c + diagonal])
    .lineTo([-h, -c]).threePointsArcTo([-c, -h], [-c - diagonal, -c - diagonal])
    .close().sketchOnPlane('YZ', [p.flangeStart, 0, 0])
    .extrude(p.flangeThickness, { extrusionDirection: [1, 0, 0] });
  const cylinderX = (radius, start, length, y = 0, z = 0) => makeCylinder(radius, length, [start, y, z], [1, 0, 0]);
  const back = p.flangeStart + p.flangeThickness;
  let body = flange.fuse(cylinderX(p.frontRadius, 0, p.frontLength))
    .fuse(cylinderX(p.neckRadius, p.frontLength - 0.1, p.flangeStart - p.frontLength + 0.2))
    .fuse(cylinderX(p.rearBossRadius, back, p.rearBossThickness))
    .fuse(cylinderX(p.endBossRadius, back + p.rearBossThickness, p.endBossThickness));
  body = body.cut(cylinderX(p.boreRadius, -2, p.length + 4))
    .cut(cylinderX(p.rearBoreRadius, p.length - p.rearBoreDepth, p.rearBoreDepth + 2));
  for (const y of [-p.holePitch / 2, p.holePitch / 2]) {
    for (const z of [-p.holePitch / 2, p.holePitch / 2]) {
      body = body.cut(cylinderX(p.mountHoleRadius, p.flangeStart - 2, p.flangeThickness + 4, y, z));
    }
  }
  return body;
}

const BUILDERS = Object.freeze({
  textbookObliqueCylinder: obliqueCylinder,
  textbookSlotCylinder: slotCylinder,
  textbookKeyedShaft: keyedShaft,
  textbookFlange: ribbedFlange,
  textbookValveAdapter: valveAdapter
});

export function buildTextbookMechanicalShape(modelId) {
  const entry = contract.models.find(model => model.id === modelId);
  if (!entry || !BUILDERS[modelId]) throw new Error('Unknown textbook solid.');
  return refine(BUILDERS[modelId](entry.parameters));
}

function materialAt(shape, point, half = 0.1) {
  const probe = makeBox(point.map(value => value - half), point.map(value => value + half));
  try {
    const intersection = shape.intersect(probe);
    const volume = measureVolume(intersection);
    intersection.delete();
    return volume;
  } finally {
    probe.delete();
  }
}

function semanticChecks(shape, modelId, p) {
  const checks = [];
  const empty = (name, point) => checks.push({ name, passed: materialAt(shape, point) < EPS });
  const full = (name, point) => checks.push({ name, passed: materialAt(shape, point) > 0.007 });
  if (modelId === 'textbookObliqueCylinder') {
    for (const x of [-p.radius * 0.6, 0, p.radius * 0.6]) {
      const cutHeight = p.cutCenterHeight + p.cutSlope * x;
      empty(`斜截面上方无材料 ${x}`, [x, 0, cutHeight + 1]);
      full(`斜截面下方有材料 ${x}`, [x, 0, cutHeight - 1]);
    }
  } else if (modelId === 'textbookSlotCylinder') {
    for (const y of [-p.radius + 0.5, 0, p.radius - 0.5]) {
      empty(`顶槽前后贯穿 ${y}`, [0, y, p.height - p.slotDepth / 2]);
      full(`底舌沿前后保留 ${y}`, [0, y, p.tongueHeight / 2]);
    }
    for (const sign of [-1, 1]) {
      full(`顶部槽壁 ${sign}`, [sign * (p.slotWidth / 2 + 1), 0, p.height - 1]);
      empty(`底部侧切 ${sign}`, [sign * (p.slotWidth / 2 + 1), 0, p.tongueHeight / 2]);
    }
    full('槽底与舌上方连为整体', [0, 0, (p.tongueHeight + p.height - p.slotDepth) / 2]);
  } else if (modelId === 'textbookKeyedShaft') {
    const floor = p.radius * 2 - p.slotDepth;
    empty('键槽中心为真实空腔', [0, 0, floor + 1]);
    full('键槽底保留材料', [0, 0, floor - 0.5]);
    for (const sign of [-1, 1]) {
      full(`封闭键槽端部 ${sign}`, [sign * (p.slotLength / 2 + 0.5), 0, floor + 1]);
      empty(`键槽圆头内侧 ${sign}`, [sign * (p.slotLength / 2 - 0.5), 0, floor + 1]);
    }
    full('轴底完整', [0, 0, 0.5]);
  } else if (modelId === 'textbookFlange') {
    for (const z of [0.5, p.baseThickness + 1, p.totalHeight - 0.5]) {
      empty(`中央轴孔贯通 ${z}`, [0, 0, z]);
      full(`轮毂孔壁完整 ${z}`, [(p.boreRadius + p.hubRadius) / 2, 0, z]);
    }
    for (let i = 0; i < 4; i++) {
      const a = p.holePhaseDegrees * Math.PI / 180 + i * Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      empty(`第${i + 1}安装孔贯通`, [c * p.holeCircleRadius, s * p.holeCircleRadius, p.baseThickness / 2]);
      const annularRadius = p.holeCircleRadius + (p.holeRadius + p.counterboreRadius) / 2;
      empty(`第${i + 1}沉孔台阶上部`, [c * annularRadius, s * annularRadius, p.baseThickness - p.counterboreDepth / 2]);
      full(`第${i + 1}沉孔台阶下部`, [c * annularRadius, s * annularRadius, p.baseThickness - p.counterboreDepth - 1]);
      const ra = p.ribPhaseDegrees * Math.PI / 180 + i * Math.PI / 2, r = p.hubRadius + 5;
      full(`第${i + 1}径向肋真实连接`, [Math.cos(ra) * r, Math.sin(ra) * r, p.baseThickness + 5]);
    }
  } else if (modelId === 'textbookValveAdapter') {
    for (const x of [0.5, 30, p.length - 0.5]) empty(`主孔全长贯穿 ${x}`, [x, 0, 0]);
    full('细管颈孔壁保留', [30, (p.boreRadius + p.neckRadius) / 2, 0]);
    empty('背部扩大孔真实切除', [p.length - 1, (p.boreRadius + p.rearBoreRadius) / 2, 0]);
    full('背部扩大孔止端保留', [p.length - p.rearBoreDepth - 0.5, (p.boreRadius + p.rearBoreRadius) / 2, 0]);
    full('背面薄壁保留', [p.length - 1, (p.rearBoreRadius + p.endBossRadius) / 2, 0]);
    for (const y of [-p.holePitch / 2, p.holePitch / 2]) {
      for (const z of [-p.holePitch / 2, p.holePitch / 2]) {
        for (const x of [p.flangeStart + 0.5, p.flangeStart + p.flangeThickness - 0.5]) {
          empty(`安装孔贯穿法兰 ${x}/${y}/${z}`, [x, y, z]);
        }
      }
    }
  }
  return checks;
}

function projection(shape, view, bounds) {
  const [min, max] = bounds;
  const pad = Math.max(...max.map((v, i) => v - min[i])) * 0.04;
  const frames = {
    front: [min[0] - pad, -max[2] - pad, max[0] - min[0] + 2 * pad, max[2] - min[2] + 2 * pad],
    side: [-max[1] - pad, -max[2] - pad, max[1] - min[1] + 2 * pad, max[2] - min[2] + 2 * pad],
    top: [min[0] - pad, min[1] - pad, max[0] - min[0] + 2 * pad, max[1] - min[1] + 2 * pad]
  };
  const cameraPlane = { front: 'front', side: 'right', top: 'bottom' }[view];
  const { visible, hidden } = drawProjection(shape, cameraPlane);
  return {
    cameraPlane, frame: frames[view], viewBox: frames[view].join(' '),
    visiblePathData: visible.toSVGPaths().flat(Infinity).filter(Boolean),
    hiddenPathData: hidden.toSVGPaths().flat(Infinity).filter(Boolean), centerlinePathData: []
  };
}

export function auditTextbookMechanicalShape(modelId) {
  const entry = contract.models.find(model => model.id === modelId);
  const shape = buildTextbookMechanicalShape(modelId);
  const OC = getOC();
  const box = new BoundingBox();
  let analyzer;
  try {
    OC.BRepBndLib.AddOptimal(shape.wrapped, box.wrapped, false, false);
    const [min, max] = box.bounds;
    const projections = Object.fromEntries(['front', 'side', 'top'].map(view => [view, projection(shape, view, [min, max])]));
    const checks = semanticChecks(shape, modelId, entry.parameters);
    analyzer = new OC.BRepCheck_Analyzer(shape.wrapped, true, false);
    const facts = {
      modelId, kernel: 'Replicad / OpenCascade', solidCount: Array.from(iterTopo(shape.wrapped, 'solid')).length,
      volume: measureVolume(shape), bounds: { min, max, size: max.map((v, i) => v - min[i]) },
      brepValid: analyzer.IsValid_2(), semanticChecks: checks,
      projectionsValid: Object.values(projections).every(view => view.visiblePathData.length > 0)
    };
    facts.passed = facts.solidCount === 1 && facts.volume > EPS && facts.brepValid
      && facts.projectionsValid && checks.length > 0 && checks.every(check => check.passed);
    if (!facts.passed) throw new Error(`Textbook solid verification failed: ${modelId}`);
    return {
      facts, projections,
      renderMesh: {
        faces: shape.mesh({ tolerance: 0.035, angularTolerance: 0.08 }),
        edges: shape.meshEdges({ tolerance: 0.035, angularTolerance: 0.08 })
      }
    };
  } finally {
    analyzer?.delete();
    box.delete();
    shape.delete();
  }
}
