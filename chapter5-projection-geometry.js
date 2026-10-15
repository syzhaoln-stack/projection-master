// Textbook-grounded analytic projection geometry for Chapter 5.
//
// Three.js meshes remain useful for interaction and shaded presentation, but
// engineering views must not depend on triangulation or CSG edge extraction.
// Every segment below has a stable semantic id so omissions can be regression
// tested against figures 5-2, 5-15 and 5-17.

const EPSILON = 1e-7;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const interpolate = (input, aInput, aOutput, bInput, bOutput) => {
  const span = bInput - aInput;
  if (Math.abs(span) < EPSILON) return (aOutput + bOutput) / 2;
  return aOutput + (input - aInput) * (bOutput - aOutput) / span;
};

const appliedSet = applied => applied instanceof Set ? applied : new Set(applied || []);

const segment = (id, a, b) => ({ id, a, b });

const addSegment = (target, id, a, b) => {
  if (a.every((value, index) => Math.abs(value - b[index]) < EPSILON)) return;
  target.push(segment(id, a, b));
};

const frontPoint = (x, y) => [x, y, 0];
const sidePoint = (z, y) => [0, y, z];
const topPoint = (x, z) => [x, 0, z];

const emptyView = () => ({ visible: [], hidden: [] });

export const flattenProjectionSegments = segments => segments.flatMap(({ a, b }) => [a, b]);

export const EXAMPLE51_DIMENSIONS = Object.freeze({
  baseWidth: 4.4,
  baseDepth: 3.2,
  baseThickness: 0.32,
  uprightOuterRadius: 1.42,
  uprightThickness: 0.24,
  barrelOuterRadius: 1.05,
  barrelInnerRadius: 0.55,
  barrelCenterY: 2.05,
  ribTopY: 1.0
});

export const EXAMPLE55_BODY = Object.freeze({
  xMin: -2.2,
  xMax: 2.2,
  yMin: 0,
  yMax: 2.7,
  zMin: -1.4,
  zMax: 1.4
});

export function createExample55Construction({ cutterValues = {}, slotLength = 5 } = {}) {
  const p = cutterValues['cut-p'] || { x: 0, y: 0 };
  const q = cutterValues['cut-q'] || { z: 0, y: 0 };
  const slot = cutterValues['cut-slot'] || { x: 0, z: 0 };
  const length = clamp(Number(slotLength) || 5, 1.4, 5.4);
  const pLow = { x: -2.45 + p.x, y: 0.35 + p.y };
  const pHigh = { x: 0.45 + p.x, y: 2.95 + p.y };
  const qFrontLow = { z: 1.72 + q.z, y: 0.25 + q.y };
  const qFrontHigh = { z: 0.48 + q.z, y: 2.95 + q.y };
  const qRearLow = { z: -1.72 - q.z, y: 0.25 + q.y };
  const qRearHigh = { z: -0.48 - q.z, y: 2.95 + q.y };
  const pYAt = x => interpolate(x, pLow.x, pLow.y, pHigh.x, pHigh.y);
  const pXAt = y => interpolate(y, pLow.y, pLow.x, pHigh.y, pHigh.x);
  const qFrontYAt = z => interpolate(z, qFrontLow.z, qFrontLow.y, qFrontHigh.z, qFrontHigh.y);
  const qFrontZAt = y => interpolate(y, qFrontLow.y, qFrontLow.z, qFrontHigh.y, qFrontHigh.z);
  const qRearYAt = z => interpolate(z, qRearLow.z, qRearLow.y, qRearHigh.z, qRearHigh.y);
  const qRearZAt = y => interpolate(y, qRearLow.y, qRearLow.z, qRearHigh.y, qRearHigh.z);
  const qTopYAt = z => z >= 0 ? qFrontYAt(z) : qRearYAt(z);
  const b = EXAMPLE55_BODY;

  return {
    p,
    q,
    slot,
    slotLength: length,
    pLow,
    pHigh,
    pYAt,
    pXAt,
    qFrontYAt,
    qRearYAt,
    qTopYAt,
    pLeftY: clamp(pYAt(b.xMin), b.yMin, b.yMax),
    pTopX: clamp(pXAt(b.yMax), b.xMin, b.xMax),
    qFrontShoulderY: clamp(qFrontYAt(b.zMax), b.yMin, b.yMax),
    qRearShoulderY: clamp(qRearYAt(b.zMin), b.yMin, b.yMax),
    qFrontTopZ: clamp(qFrontZAt(b.yMax), b.zMin, b.zMax),
    qRearTopZ: clamp(qRearZAt(b.yMax), b.zMin, b.zMax),
    slotTopY: 1.05,
    slotXMin: clamp(slot.x - length / 2, b.xMin, b.xMax),
    slotXMax: clamp(slot.x + length / 2, b.xMin, b.xMax),
    slotZMin: clamp(slot.z - 0.8, b.zMin, b.zMax),
    slotZMax: clamp(slot.z + 0.8, b.zMin, b.zMax)
  };
}

function addExample55SlotTopEdge({ visible, hidden, construction, applied, z, suffix }) {
  const x0 = construction.slotXMin;
  const x1 = construction.slotXMax;
  const y = construction.slotTopY;
  if (x1 <= x0 + EPSILON) return;

  // A slot edge is visible wherever the P/Q cuts have removed all material
  // above its roof.  The remaining covered part stays a hidden line.  This is
  // the line-style transition shown in figure 5-15c and was previously lost.
  if (applied.has('cut-q') && construction.qTopYAt(z) <= y + EPSILON) {
    addSegment(visible, `slot-${suffix}-exposed`, topPoint(x0, z), topPoint(x1, z));
    return;
  }

  if (!applied.has('cut-p')) {
    addSegment(hidden, `slot-${suffix}-covered`, topPoint(x0, z), topPoint(x1, z));
    return;
  }

  const transition = clamp(construction.pXAt(y), x0, x1);
  addSegment(visible, `slot-${suffix}-exposed`, topPoint(x0, z), topPoint(transition, z));
  addSegment(hidden, `slot-${suffix}-covered`, topPoint(transition, z), topPoint(x1, z));
}

export function createExample55ProjectionBlueprint({ construction, appliedCutters = [] } = {}) {
  if (!construction) throw new TypeError('createExample55ProjectionBlueprint requires construction data.');
  const b = EXAMPLE55_BODY;
  const applied = appliedSet(appliedCutters);
  const pApplied = applied.has('cut-p');
  const qApplied = applied.has('cut-q');
  const slotApplied = applied.has('cut-slot');
  const front = emptyView();
  const side = emptyView();
  const top = emptyView();

  if (pApplied) {
    addSegment(front.visible, 'body-left-lower', frontPoint(b.xMin, b.yMin), frontPoint(b.xMin, construction.pLeftY));
    addSegment(front.visible, 'p-slope', frontPoint(b.xMin, construction.pLeftY), frontPoint(construction.pTopX, b.yMax));
    addSegment(front.visible, 'body-top', frontPoint(construction.pTopX, b.yMax), frontPoint(b.xMax, b.yMax));
  } else {
    addSegment(front.visible, 'body-left', frontPoint(b.xMin, b.yMin), frontPoint(b.xMin, b.yMax));
    addSegment(front.visible, 'body-top', frontPoint(b.xMin, b.yMax), frontPoint(b.xMax, b.yMax));
  }
  addSegment(front.visible, 'body-right', frontPoint(b.xMax, b.yMax), frontPoint(b.xMax, b.yMin));
  addSegment(front.visible, 'body-bottom', frontPoint(b.xMax, b.yMin), frontPoint(b.xMin, b.yMin));
  if (qApplied) {
    const shoulderY = (construction.qFrontShoulderY + construction.qRearShoulderY) / 2;
    const shoulderX = pApplied ? clamp(construction.pXAt(shoulderY), b.xMin, b.xMax) : b.xMin;
    addSegment(front.visible, 'q-shoulder', frontPoint(shoulderX, shoulderY), frontPoint(b.xMax, shoulderY));
  }
  if (slotApplied && construction.slotXMax > construction.slotXMin) {
    const roofStartX = pApplied
      ? clamp(construction.pXAt(construction.slotTopY), construction.slotXMin, construction.slotXMax)
      : construction.slotXMin;
    addSegment(front.hidden, 'slot-roof-hidden', frontPoint(roofStartX, construction.slotTopY), frontPoint(construction.slotXMax, construction.slotTopY));
    if (construction.slotXMin > b.xMin + EPSILON) {
      addSegment(front.hidden, 'slot-left-stop-hidden', frontPoint(construction.slotXMin, b.yMin), frontPoint(construction.slotXMin, construction.slotTopY));
    }
    if (construction.slotXMax < b.xMax - EPSILON) {
      addSegment(front.hidden, 'slot-right-stop-hidden', frontPoint(construction.slotXMax, b.yMin), frontPoint(construction.slotXMax, construction.slotTopY));
    }
  }

  const slotOpenAtViewedEnd = slotApplied && construction.slotXMax >= b.xMax - EPSILON;
  if (qApplied) {
    addSegment(side.visible, 'body-rear-lower', sidePoint(b.zMin, b.yMin), sidePoint(b.zMin, construction.qRearShoulderY));
    addSegment(side.visible, 'q-rear-slope', sidePoint(b.zMin, construction.qRearShoulderY), sidePoint(construction.qRearTopZ, b.yMax));
    addSegment(side.visible, 'body-top', sidePoint(construction.qRearTopZ, b.yMax), sidePoint(construction.qFrontTopZ, b.yMax));
    addSegment(side.visible, 'q-front-slope', sidePoint(construction.qFrontTopZ, b.yMax), sidePoint(b.zMax, construction.qFrontShoulderY));
    addSegment(side.visible, 'body-front-lower', sidePoint(b.zMax, construction.qFrontShoulderY), sidePoint(b.zMax, b.yMin));
    const shoulderYAt = z => interpolate(z, b.zMin, construction.qRearShoulderY, b.zMax, construction.qFrontShoulderY);
    if (slotOpenAtViewedEnd && construction.slotTopY > shoulderYAt((construction.slotZMin + construction.slotZMax) / 2)) {
      addSegment(side.visible, 'q-shoulder-rear', sidePoint(b.zMin, construction.qRearShoulderY), sidePoint(construction.slotZMin, shoulderYAt(construction.slotZMin)));
      addSegment(side.visible, 'q-shoulder-front', sidePoint(construction.slotZMax, shoulderYAt(construction.slotZMax)), sidePoint(b.zMax, construction.qFrontShoulderY));
    } else {
      addSegment(side.visible, 'q-shoulder', sidePoint(b.zMin, construction.qRearShoulderY), sidePoint(b.zMax, construction.qFrontShoulderY));
    }
  } else {
    addSegment(side.visible, 'body-rear', sidePoint(b.zMin, b.yMin), sidePoint(b.zMin, b.yMax));
    addSegment(side.visible, 'body-top', sidePoint(b.zMin, b.yMax), sidePoint(b.zMax, b.yMax));
    addSegment(side.visible, 'body-front', sidePoint(b.zMax, b.yMax), sidePoint(b.zMax, b.yMin));
  }
  if (slotOpenAtViewedEnd) {
    addSegment(side.visible, 'body-bottom-rear', sidePoint(b.zMin, b.yMin), sidePoint(construction.slotZMin, b.yMin));
    addSegment(side.visible, 'slot-rear-wall', sidePoint(construction.slotZMin, b.yMin), sidePoint(construction.slotZMin, construction.slotTopY));
    addSegment(side.visible, 'slot-roof', sidePoint(construction.slotZMin, construction.slotTopY), sidePoint(construction.slotZMax, construction.slotTopY));
    addSegment(side.visible, 'slot-front-wall', sidePoint(construction.slotZMax, construction.slotTopY), sidePoint(construction.slotZMax, b.yMin));
    addSegment(side.visible, 'body-bottom-front', sidePoint(construction.slotZMax, b.yMin), sidePoint(b.zMax, b.yMin));
  } else {
    addSegment(side.visible, 'body-bottom', sidePoint(b.zMin, b.yMin), sidePoint(b.zMax, b.yMin));
    if (slotApplied) {
      addSegment(side.hidden, 'slot-rear-wall-hidden', sidePoint(construction.slotZMin, b.yMin), sidePoint(construction.slotZMin, construction.slotTopY));
      addSegment(side.hidden, 'slot-roof-hidden', sidePoint(construction.slotZMin, construction.slotTopY), sidePoint(construction.slotZMax, construction.slotTopY));
      addSegment(side.hidden, 'slot-front-wall-hidden', sidePoint(construction.slotZMax, construction.slotTopY), sidePoint(construction.slotZMax, b.yMin));
    }
  }

  addSegment(top.visible, 'body-rear-edge', topPoint(b.xMin, b.zMin), topPoint(b.xMax, b.zMin));
  addSegment(top.visible, 'body-right-edge', topPoint(b.xMax, b.zMin), topPoint(b.xMax, b.zMax));
  addSegment(top.visible, 'body-front-edge', topPoint(b.xMax, b.zMax), topPoint(b.xMin, b.zMax));
  addSegment(top.visible, 'body-left-edge', topPoint(b.xMin, b.zMax), topPoint(b.xMin, b.zMin));
  if (pApplied) {
    const zStart = qApplied ? construction.qRearTopZ : b.zMin;
    const zEnd = qApplied ? construction.qFrontTopZ : b.zMax;
    addSegment(top.visible, 'p-top-boundary', topPoint(construction.pTopX, zStart), topPoint(construction.pTopX, zEnd));
  }
  if (qApplied) {
    const topStartX = pApplied ? construction.pTopX : b.xMin;
    addSegment(top.visible, 'q-rear-top-boundary', topPoint(topStartX, construction.qRearTopZ), topPoint(b.xMax, construction.qRearTopZ));
    addSegment(top.visible, 'q-front-top-boundary', topPoint(topStartX, construction.qFrontTopZ), topPoint(b.xMax, construction.qFrontTopZ));
    if (pApplied) {
      const rearStartX = clamp(construction.pXAt(construction.qRearShoulderY), b.xMin, b.xMax);
      const frontStartX = clamp(construction.pXAt(construction.qFrontShoulderY), b.xMin, b.xMax);
      addSegment(top.visible, 'p-q-rear-intersection', topPoint(rearStartX, b.zMin), topPoint(construction.pTopX, construction.qRearTopZ));
      addSegment(top.visible, 'p-q-front-intersection', topPoint(frontStartX, b.zMax), topPoint(construction.pTopX, construction.qFrontTopZ));
    }
  }
  if (slotApplied && construction.slotXMax > construction.slotXMin) {
    addExample55SlotTopEdge({ visible: top.visible, hidden: top.hidden, construction, applied, z: construction.slotZMin, suffix: 'rear' });
    addExample55SlotTopEdge({ visible: top.visible, hidden: top.hidden, construction, applied, z: construction.slotZMax, suffix: 'front' });
    if (construction.slotXMin > b.xMin + EPSILON) {
      addSegment(top.hidden, 'slot-left-stop-covered', topPoint(construction.slotXMin, construction.slotZMin), topPoint(construction.slotXMin, construction.slotZMax));
    }
    if (construction.slotXMax < b.xMax - EPSILON) {
      addSegment(top.hidden, 'slot-right-stop-covered', topPoint(construction.slotXMax, construction.slotZMin), topPoint(construction.slotXMax, construction.slotZMax));
    }
  }

  return { front, side, top, slotOpenAtViewedEnd };
}

// Proportions measured from the aligned views in figures 5-16a and 5-17:
// the left end is about 0.53 of the ring diameter, while the ring wall is
// roughly 0.29 grid units thick. These ratios are shared by all three views.
// Figure 5-17a shows the hollow cylinder extending all the way to the common
// bottom datum. The base meets its outside cylindrical face tangentially; it
// is not a pedestal that replaces the lower 0.9 units of the cylinder.
const EXAMPLE56_RING_BASE = Object.freeze({ x: 0.55, outer: 1.05, inner: 0.76, bottom: 0, top: 2.48 });
const EXAMPLE56_BASE_LEFT = Object.freeze({ x: -2.05, halfDepth: 0.56 });

function tangentFromUpperLeftToCircle(point, centerX, radius) {
  const vx = point.x - centerX;
  const vz = point.z;
  const distanceSquared = vx * vx + vz * vz;
  const baseScale = radius * radius / distanceSquared;
  const perpendicularScale = radius * Math.sqrt(distanceSquared - radius * radius) / distanceSquared;
  return {
    x: centerX + baseScale * vx + perpendicularScale * vz,
    z: baseScale * vz - perpendicularScale * vx
  };
}

const EXAMPLE56_UPPER_TANGENT = tangentFromUpperLeftToCircle(
  { x: EXAMPLE56_BASE_LEFT.x, z: EXAMPLE56_BASE_LEFT.halfDepth },
  EXAMPLE56_RING_BASE.x,
  EXAMPLE56_RING_BASE.outer
);

export const EXAMPLE56_DIMENSIONS = Object.freeze({
  base: Object.freeze({
    xMin: EXAMPLE56_BASE_LEFT.x,
    xMax: EXAMPLE56_RING_BASE.x + EXAMPLE56_RING_BASE.outer,
    leftHalfDepth: EXAMPLE56_BASE_LEFT.halfDepth,
    rightHalfDepth: EXAMPLE56_RING_BASE.outer,
    tangentX: EXAMPLE56_UPPER_TANGENT.x,
    tangentHalfDepth: EXAMPLE56_UPPER_TANGENT.z,
    top: 0.95
  }),
  ring: EXAMPLE56_RING_BASE
});

export function example56BaseHalfDepthAt(x) {
  const b = EXAMPLE56_DIMENSIONS.base;
  if (x <= b.tangentX) {
    return interpolate(
      clamp(x, b.xMin, b.tangentX),
      b.xMin,
      b.leftHalfDepth,
      b.tangentX,
      b.tangentHalfDepth
    );
  }
  return interpolate(
    clamp(x, b.tangentX, b.xMax),
    b.tangentX,
    b.tangentHalfDepth,
    b.xMax,
    0
  );
}

export function createExample56BaseSlot(values = {}) {
  const b = EXAMPLE56_DIMENSIONS.base;
  const xMax = clamp(Number.isFinite(values.x) ? values.x : -1.4, b.xMin + 0.35, b.tangentX - 0.45);
  const height = clamp(Number.isFinite(values.height) ? values.height : 0.36, 0.22, 0.5);
  const y = Number.isFinite(values.y) ? values.y : 0.475;
  const halfDepthAtStop = example56BaseHalfDepthAt(xMax);
  const toolXMin = b.xMin - 0.12;
  const toolHalfDepth = halfDepthAtStop + 0.08;
  return {
    xMin: b.xMin,
    xMax,
    yMin: y - height / 2,
    yMax: y + height / 2,
    zMin: -halfDepthAtStop,
    zMax: halfDepthAtStop,
    toolXMin,
    toolCenterX: (toolXMin + xMax) / 2,
    toolCenterZ: 0,
    toolLength: xMax - toolXMin,
    toolWidth: toolHalfDepth * 2,
    height,
    derivedWidth: halfDepthAtStop * 2
  };
}

function addCircleArcRange(target, idPrefix, center, radius, startAngle, endAngle, segmentCount) {
  for (let index = 0; index < segmentCount; index += 1) {
    const a0 = startAngle + (endAngle - startAngle) * index / segmentCount;
    const a1 = startAngle + (endAngle - startAngle) * (index + 1) / segmentCount;
    addSegment(
      target,
      `${idPrefix}-${index}`,
      topPoint(center[0] + Math.cos(a0) * radius, center[1] + Math.sin(a0) * radius),
      topPoint(center[0] + Math.cos(a1) * radius, center[1] + Math.sin(a1) * radius)
    );
  }
}

function addFrontArc(target, idPrefix, center, radius, startAngle, endAngle, segmentCount) {
  for (let index = 0; index < segmentCount; index += 1) {
    const a0 = startAngle + (endAngle - startAngle) * index / segmentCount;
    const a1 = startAngle + (endAngle - startAngle) * (index + 1) / segmentCount;
    addSegment(
      target,
      `${idPrefix}-${index}`,
      frontPoint(center[0] + Math.cos(a0) * radius, center[1] + Math.sin(a0) * radius),
      frontPoint(center[0] + Math.cos(a1) * radius, center[1] + Math.sin(a1) * radius)
    );
  }
}

export function createExample56ProjectionBlueprint({ appliedCutters = [], cutterValues = {}, slot } = {}) {
  const applied = appliedSet(appliedCutters);
  const b = EXAMPLE56_DIMENSIONS.base;
  const r = EXAMPLE56_DIMENSIONS.ring;
  const iii = cutterValues['cut-iii'] || { x: r.x, y: 2.4 };
  const iv = cutterValues['cut-iv'] || { x: r.x, y: 1.9 };
  const vSlot = slot || createExample56BaseSlot(cutterValues['cut-v']);
  const front = emptyView();
  const side = emptyView();
  const top = emptyView();

  // Front view: complete base outline, including the left-opening V slot.
  addSegment(front.visible, 'base-bottom', frontPoint(b.xMin, 0), frontPoint(b.xMax, 0));
  addSegment(front.visible, 'base-right-side', frontPoint(b.xMax, 0), frontPoint(b.xMax, b.top));
  // Figure 5-16a keeps the base top edge visible through the front opening up
  // to the cylinder axis; stopping it at the outer tangent loses that line.
  addSegment(front.visible, 'base-top-left', frontPoint(b.xMin, b.top), frontPoint(r.x, b.top));
  if (applied.has('cut-v')) {
    addSegment(front.visible, 'base-left-lower', frontPoint(b.xMin, 0), frontPoint(b.xMin, vSlot.yMin));
    addSegment(front.visible, 'base-left-upper', frontPoint(b.xMin, vSlot.yMax), frontPoint(b.xMin, b.top));
    addSegment(front.visible, 'base-slot-v-lower', frontPoint(b.xMin, vSlot.yMin), frontPoint(vSlot.xMax, vSlot.yMin));
    addSegment(front.visible, 'base-slot-v-upper', frontPoint(b.xMin, vSlot.yMax), frontPoint(vSlot.xMax, vSlot.yMax));
    addSegment(front.visible, 'base-slot-v-stop', frontPoint(vSlot.xMax, vSlot.yMin), frontPoint(vSlot.xMax, vSlot.yMax));
  } else {
    addSegment(front.visible, 'base-left-side', frontPoint(b.xMin, 0), frontPoint(b.xMin, b.top));
  }

  const ringXMin = r.x - r.outer;
  const ringXMax = r.x + r.outer;
  addSegment(front.visible, 'ring-left-side', frontPoint(ringXMin, b.top), frontPoint(ringXMin, r.top));
  addSegment(front.visible, 'ring-right-side', frontPoint(ringXMax, b.top), frontPoint(ringXMax, r.top));
  if (applied.has('cut-iii')) {
    const half = 0.35;
    const x0 = iii.x - half;
    const x1 = iii.x + half;
    const y0 = iii.y - 0.525;
    addSegment(front.visible, 'ring-top-left', frontPoint(ringXMin, r.top), frontPoint(x0, r.top));
    addSegment(front.visible, 'cut-iii-left-wall', frontPoint(x0, r.top), frontPoint(x0, y0));
    addSegment(front.visible, 'cut-iii-floor', frontPoint(x0, y0), frontPoint(x1, y0));
    addSegment(front.visible, 'cut-iii-right-wall', frontPoint(x1, y0), frontPoint(x1, r.top));
    addSegment(front.visible, 'ring-top-right', frontPoint(x1, r.top), frontPoint(ringXMax, r.top));
  } else {
    addSegment(front.visible, 'ring-top', frontPoint(ringXMin, r.top), frontPoint(ringXMax, r.top));
  }
  addSegment(front.hidden, 'bore-left-hidden', frontPoint(r.x - r.inner, r.bottom), frontPoint(r.x - r.inner, r.top));
  addSegment(front.hidden, 'bore-right-hidden', frontPoint(r.x + r.inner, r.bottom), frontPoint(r.x + r.inner, r.top));
  if (applied.has('cut-iv')) {
    const half = 0.35;
    const x0 = iv.x - half;
    const x1 = iv.x + half;
    addSegment(front.hidden, 'cut-iv-left-wall-hidden', frontPoint(x0, iv.y), frontPoint(x0, r.top));
    addSegment(front.hidden, 'cut-iv-right-wall-hidden', frontPoint(x1, iv.y), frontPoint(x1, r.top));
    addFrontArc(front.hidden, 'cut-iv-rounded-floor-hidden', [iv.x, iv.y], half, 0, -Math.PI, 32);
  }

  // Top view: deterministic base polygon plus both ring contours and slot walls.
  addSegment(top.visible, 'base-rear-edge', topPoint(b.xMin, -b.leftHalfDepth), topPoint(b.tangentX, -b.tangentHalfDepth));
  addSegment(top.visible, 'base-front-edge', topPoint(b.tangentX, b.tangentHalfDepth), topPoint(b.xMin, b.leftHalfDepth));
  addSegment(top.visible, 'base-left-edge', topPoint(b.xMin, b.leftHalfDepth), topPoint(b.xMin, -b.leftHalfDepth));

  const addRingContour = (radius, idPrefix, fullSegmentCount) => {
    const addRange = (suffix, startAngle, endAngle) => {
      const count = Math.max(2, Math.round(fullSegmentCount * (endAngle - startAngle) / (Math.PI * 2)));
      addCircleArcRange(top.visible, `${idPrefix}-${suffix}`, [r.x, 0], radius, startAngle, endAngle, count);
    };
    if (applied.has('cut-iii')) {
      const x0 = iii.x - 0.35;
      const x1 = iii.x + 0.35;
      const rightAngle = Math.acos(clamp((x1 - r.x) / radius, -1, 1));
      const leftAngle = Math.acos(clamp((x0 - r.x) / radius, -1, 1));
      addRange('front-right', 0, rightAngle);
      addRange('front-left', leftAngle, Math.PI);
    } else {
      addRange('front', 0, Math.PI);
    }
    if (applied.has('cut-iv')) {
      const x0 = iv.x - 0.35;
      const x1 = iv.x + 0.35;
      const leftAngle = Math.PI * 2 - Math.acos(clamp((x0 - r.x) / radius, -1, 1));
      const rightAngle = Math.PI * 2 - Math.acos(clamp((x1 - r.x) / radius, -1, 1));
      addRange('rear-left', Math.PI, leftAngle);
      addRange('rear-right', rightAngle, Math.PI * 2);
    } else {
      addRange('rear', Math.PI, Math.PI * 2);
    }
  };
  addRingContour(r.outer, 'ring-outer-arc', 144);
  addRingContour(r.inner, 'ring-inner-arc', 108);
  const circleDepthAtX = (radius, x) => Math.sqrt(Math.max(0, radius * radius - (x - r.x) ** 2));
  if (applied.has('cut-iii')) {
    const x0 = iii.x - 0.35;
    const x1 = iii.x + 0.35;
    addSegment(top.visible, 'cut-iii-left-radial-wall', topPoint(x0, circleDepthAtX(r.inner, x0)), topPoint(x0, circleDepthAtX(r.outer, x0)));
    addSegment(top.visible, 'cut-iii-right-radial-wall', topPoint(x1, circleDepthAtX(r.inner, x1)), topPoint(x1, circleDepthAtX(r.outer, x1)));
  }
  if (applied.has('cut-iv')) {
    const x0 = iv.x - 0.35;
    const x1 = iv.x + 0.35;
    addSegment(top.visible, 'cut-iv-left-radial-wall', topPoint(x0, -circleDepthAtX(r.inner, x0)), topPoint(x0, -circleDepthAtX(r.outer, x0)));
    addSegment(top.visible, 'cut-iv-right-radial-wall', topPoint(x1, -circleDepthAtX(r.inner, x1)), topPoint(x1, -circleDepthAtX(r.outer, x1)));
  }
  if (applied.has('cut-v')) {
    // V runs in from the left end and passes through the full local depth of
    // base II. Figure 5-17b therefore has one transverse hidden stop line in
    // plan, whose length is transferred to the side view as y3. Longitudinal
    // slot walls here would describe a front-side pocket and are incorrect.
    addSegment(top.hidden, 'base-slot-v-stop', topPoint(vSlot.xMax, vSlot.zMin), topPoint(vSlot.xMax, vSlot.zMax));
  }

  // Side view: complete outer profile; individual cuts add their own stable edges.
  addSegment(side.visible, 'base-bottom', sidePoint(-b.rightHalfDepth, 0), sidePoint(b.rightHalfDepth, 0));
  addSegment(side.visible, 'base-left-side', sidePoint(-b.rightHalfDepth, 0), sidePoint(-b.rightHalfDepth, b.top));
  addSegment(side.visible, 'base-right-side', sidePoint(b.rightHalfDepth, 0), sidePoint(b.rightHalfDepth, b.top));
  addSegment(side.visible, 'base-top', sidePoint(-b.rightHalfDepth, b.top), sidePoint(b.rightHalfDepth, b.top));
  addSegment(side.visible, 'ring-left-side', sidePoint(-r.outer, b.top), sidePoint(-r.outer, r.top));
  addSegment(side.visible, 'ring-right-side', sidePoint(r.outer, b.top), sidePoint(r.outer, r.top));
  addSegment(side.visible, 'ring-top', sidePoint(-r.outer, r.top), sidePoint(r.outer, r.top));
  addSegment(side.hidden, 'bore-left-hidden', sidePoint(-r.inner, r.bottom), sidePoint(-r.inner, r.top));
  addSegment(side.hidden, 'bore-right-hidden', sidePoint(r.inner, r.bottom), sidePoint(r.inner, r.top));

  if (applied.has('cut-iii')) {
    const y0 = iii.y - 0.525;
    addSegment(side.visible, 'cut-iii-inner-wall', sidePoint(r.inner, y0), sidePoint(r.inner, r.top));
    addSegment(side.visible, 'cut-iii-floor', sidePoint(r.inner, y0), sidePoint(r.outer, y0));
  }
  if (applied.has('cut-iv')) {
    const y0 = iv.y - 0.35;
    addSegment(side.visible, 'cut-iv-inner-wall', sidePoint(-r.inner, y0), sidePoint(-r.inner, r.top));
    addSegment(side.visible, 'cut-iv-floor', sidePoint(-r.outer, y0), sidePoint(-r.inner, y0));
  }
  if (applied.has('cut-v')) {
    addSegment(side.visible, 'base-slot-v-lower', sidePoint(vSlot.zMin, vSlot.yMin), sidePoint(vSlot.zMax, vSlot.yMin));
    addSegment(side.visible, 'base-slot-v-upper', sidePoint(vSlot.zMin, vSlot.yMax), sidePoint(vSlot.zMax, vSlot.yMax));
    addSegment(side.visible, 'base-slot-v-rear-wall', sidePoint(vSlot.zMin, vSlot.yMin), sidePoint(vSlot.zMin, vSlot.yMax));
    addSegment(side.visible, 'base-slot-v-front-wall', sidePoint(vSlot.zMax, vSlot.yMin), sidePoint(vSlot.zMax, vSlot.yMax));
  }

  return { front, side, top };
}
