const DEFAULT_TOLERANCE = 1e-9;

function toVec3(point, name = 'point') {
  if (Array.isArray(point) && point.length >= 3) {
    const [x, y, z] = point.map(Number);
    if ([x, y, z].every(Number.isFinite)) return { x, y, z };
  }

  if (point && typeof point === 'object') {
    const x = Number(point.x);
    const y = Number(point.y);
    const z = Number(point.z);
    if ([x, y, z].every(Number.isFinite)) return { x, y, z };
  }

  throw new TypeError(`${name} must contain finite x, y and z coordinates.`);
}

function toleranceValue(tolerance) {
  const value = Number(tolerance);
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('tolerance must be a positive finite number.');
  }
  return value;
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function multiply(a, scalar) {
  return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function norm(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function normalized(a) {
  const length = norm(a);
  return length > 0 ? multiply(a, 1 / length) : { x: 0, y: 0, z: 0 };
}

function scaledTolerance(tolerance, ...values) {
  return tolerance * Math.max(1, ...values.map(value => Math.abs(value)));
}

function projectedTriangleArea(a, b, c, view) {
  const [au, av] = projectPoint(a, view);
  const [bu, bv] = projectPoint(b, view);
  const [cu, cv] = projectPoint(c, view);
  return Math.abs((bu - au) * (cv - av) - (bv - av) * (cu - au)) / 2;
}

function planeNormal(a, b, c) {
  return cross(subtract(b, a), subtract(c, a));
}

/**
 * Maps textbook engineering coordinates to the Y-up world coordinates used
 * by Three.js. Keeping this conversion explicit prevents width Y and height Z
 * from being exchanged in rendered teaching geometry.
 */
export function engineeringToWorld(point) {
  const p = toVec3(point);
  return [p.x, p.z, p.y];
}

/**
 * Projects a 3D point onto a principal projection plane.
 *
 * Coordinate convention:
 * - x: length / left-right
 * - y: width / front-back
 * - z: height
 * - front (V): (x, z)
 * - top   (H): (x, y)
 * - side  (W): (y, z)
 *
 * @param {{x:number,y:number,z:number}|number[]} point
 * @param {'front'|'top'|'side'} view
 * @returns {[number, number]}
 */
export function projectPoint(point, view) {
  const p = toVec3(point);
  if (view === 'front') return [p.x, p.z];
  if (view === 'top') return [p.x, p.y];
  if (view === 'side') return [p.y, p.z];
  throw new RangeError(`Unknown projection view: ${view}`);
}

/**
 * Orients a principal projection for a first-angle three-view drawing.
 *
 * The top view is placed below the front view after the horizontal plane is
 * unfolded, so positive engineering width Y points downward on the sheet.
 * The front and left views retain positive engineering height Z upward.
 */
export function projectPointFirstAngle(point, view) {
  const [u, v] = projectPoint(point, view);
  return [u, view === 'top' ? -v : v];
}

/**
 * Returns the Euclidean length of a 3D line segment.
 */
export function lineLength(a, b) {
  return norm(subtract(toVec3(b, 'b'), toVec3(a, 'a')));
}

/**
 * Classifies a line segment in one orthographic view.
 *
 * classification is one of:
 * - true-length: the view shows the segment's real length
 * - foreshortened: the view shows a shorter segment
 * - collapsed: the segment accumulates to a point
 * - degenerate: the two endpoints coincide
 */
export function classifyLineProjection(a, b, view, tolerance = DEFAULT_TOLERANCE) {
  const epsilon = toleranceValue(tolerance);
  const start = toVec3(a, 'a');
  const end = toVec3(b, 'b');
  const trueLength = lineLength(start, end);
  const projectedStart = projectPoint(start, view);
  const projectedEnd = projectPoint(end, view);
  const projectedLength = Math.hypot(
    projectedEnd[0] - projectedStart[0],
    projectedEnd[1] - projectedStart[1]
  );
  const threshold = scaledTolerance(epsilon, trueLength);

  let classification;
  let label;
  if (trueLength <= threshold) {
    classification = 'degenerate';
    label = '退化';
  } else if (projectedLength <= threshold) {
    classification = 'collapsed';
    label = '积聚';
  } else if (Math.abs(projectedLength - trueLength) <= threshold) {
    classification = 'true-length';
    label = '实长';
  } else {
    classification = 'foreshortened';
    label = '缩短';
  }

  return {
    view,
    classification,
    label,
    trueLength,
    projectedLength,
    ratio: trueLength > threshold ? projectedLength / trueLength : 0
  };
}

/**
 * Returns the area of a 3D triangle.
 */
export function triangleArea3D(a, b, c) {
  const first = toVec3(a, 'a');
  const second = toVec3(b, 'b');
  const third = toVec3(c, 'c');
  return norm(planeNormal(first, second, third)) / 2;
}

/**
 * Classifies a triangular plane in one orthographic view.
 *
 * classification is one of:
 * - true-shape: the view shows the real shape and area
 * - foreshortened: the view shows a similar/foreshortened shape
 * - collapsed: the plane accumulates to a line
 * - degenerate: the three source points are collinear
 */
export function classifyPlaneProjection(a, b, c, view, tolerance = DEFAULT_TOLERANCE) {
  const epsilon = toleranceValue(tolerance);
  const first = toVec3(a, 'a');
  const second = toVec3(b, 'b');
  const third = toVec3(c, 'c');
  const trueArea = triangleArea3D(first, second, third);
  const projectedArea = projectedTriangleArea(first, second, third, view);
  const threshold = scaledTolerance(epsilon, trueArea);

  let classification;
  let label;
  if (trueArea <= threshold) {
    classification = 'degenerate';
    label = '退化';
  } else if (projectedArea <= threshold) {
    classification = 'collapsed';
    label = '积聚';
  } else if (Math.abs(projectedArea - trueArea) <= threshold) {
    classification = 'true-shape';
    label = '实形';
  } else {
    classification = 'foreshortened';
    label = '类似';
  }

  return {
    view,
    classification,
    label,
    trueArea,
    projectedArea,
    ratio: trueArea > threshold ? projectedArea / trueArea : 0
  };
}

/**
 * Tests whether a point lies on the infinite line through a and b.
 */
export function pointOnLine(point, a, b, tolerance = DEFAULT_TOLERANCE) {
  const epsilon = toleranceValue(tolerance);
  const p = toVec3(point, 'point');
  const start = toVec3(a, 'a');
  const end = toVec3(b, 'b');
  const direction = subtract(end, start);
  const directionLength = norm(direction);
  const offset = subtract(p, start);

  if (directionLength <= scaledTolerance(epsilon, norm(start), norm(end))) {
    return norm(offset) <= scaledTolerance(epsilon, norm(p), norm(start));
  }

  const distance = norm(cross(offset, direction)) / directionLength;
  return distance <= scaledTolerance(epsilon, norm(offset), directionLength);
}

/**
 * Tests whether a point lies in the infinite plane through a, b and c.
 */
export function pointInPlane(point, a, b, c, tolerance = DEFAULT_TOLERANCE) {
  const epsilon = toleranceValue(tolerance);
  const p = toVec3(point, 'point');
  const first = toVec3(a, 'a');
  const second = toVec3(b, 'b');
  const third = toVec3(c, 'c');
  const normal = planeNormal(first, second, third);
  const normalLength = norm(normal);
  if (normalLength <= scaledTolerance(epsilon, lineLength(first, second), lineLength(first, third))) {
    return false;
  }

  const offset = subtract(p, first);
  const distance = Math.abs(dot(offset, normal)) / normalLength;
  return distance <= scaledTolerance(epsilon, norm(offset), norm(first));
}

/**
 * Classifies two infinite 3D lines.
 *
 * Returns: coincident, parallel, intersecting, skew or degenerate.
 */
export function classifyLineLine(a1, a2, b1, b2, tolerance = DEFAULT_TOLERANCE) {
  const epsilon = toleranceValue(tolerance);
  const firstStart = toVec3(a1, 'a1');
  const firstEnd = toVec3(a2, 'a2');
  const secondStart = toVec3(b1, 'b1');
  const secondEnd = toVec3(b2, 'b2');
  const firstDirection = subtract(firstEnd, firstStart);
  const secondDirection = subtract(secondEnd, secondStart);
  const firstLength = norm(firstDirection);
  const secondLength = norm(secondDirection);
  if (
    firstLength <= scaledTolerance(epsilon, norm(firstStart), norm(firstEnd))
    || secondLength <= scaledTolerance(epsilon, norm(secondStart), norm(secondEnd))
  ) {
    return 'degenerate';
  }

  const firstUnit = normalized(firstDirection);
  const secondUnit = normalized(secondDirection);
  const directionCross = cross(firstUnit, secondUnit);
  const directionCrossLength = norm(directionCross);
  const betweenStarts = subtract(secondStart, firstStart);
  const positionScale = Math.max(firstLength, secondLength, norm(betweenStarts));

  if (directionCrossLength <= epsilon) {
    const separation = norm(cross(betweenStarts, firstUnit));
    return separation <= scaledTolerance(epsilon, positionScale) ? 'coincident' : 'parallel';
  }

  const lineDistance = Math.abs(dot(betweenStarts, directionCross)) / directionCrossLength;
  return lineDistance <= scaledTolerance(epsilon, positionScale) ? 'intersecting' : 'skew';
}

/**
 * Classifies an infinite line against an infinite plane.
 *
 * Returns: contained, parallel, perpendicular, intersecting or degenerate.
 */
export function classifyLinePlane(
  lineA,
  lineB,
  planeA,
  planeB,
  planeC,
  tolerance = DEFAULT_TOLERANCE
) {
  const epsilon = toleranceValue(tolerance);
  const start = toVec3(lineA, 'lineA');
  const end = toVec3(lineB, 'lineB');
  const first = toVec3(planeA, 'planeA');
  const second = toVec3(planeB, 'planeB');
  const third = toVec3(planeC, 'planeC');
  const direction = subtract(end, start);
  const directionLength = norm(direction);
  const normal = planeNormal(first, second, third);
  const normalLength = norm(normal);
  if (
    directionLength <= scaledTolerance(epsilon, norm(start), norm(end))
    || normalLength <= scaledTolerance(epsilon, lineLength(first, second), lineLength(first, third))
  ) {
    return 'degenerate';
  }

  const directionUnit = normalized(direction);
  const normalUnit = normalized(normal);
  const angleDot = Math.abs(dot(directionUnit, normalUnit));

  if (angleDot <= epsilon) {
    return pointInPlane(start, first, second, third, epsilon) ? 'contained' : 'parallel';
  }

  if (norm(cross(directionUnit, normalUnit)) <= epsilon) return 'perpendicular';
  return 'intersecting';
}

/**
 * Classifies two infinite planes.
 *
 * Returns: coincident, parallel, perpendicular, intersecting or degenerate.
 */
export function classifyPlanePlane(
  a1,
  b1,
  c1,
  a2,
  b2,
  c2,
  tolerance = DEFAULT_TOLERANCE
) {
  const epsilon = toleranceValue(tolerance);
  const firstA = toVec3(a1, 'a1');
  const firstB = toVec3(b1, 'b1');
  const firstC = toVec3(c1, 'c1');
  const secondA = toVec3(a2, 'a2');
  const secondB = toVec3(b2, 'b2');
  const secondC = toVec3(c2, 'c2');
  const firstNormal = planeNormal(firstA, firstB, firstC);
  const secondNormal = planeNormal(secondA, secondB, secondC);
  const firstNormalLength = norm(firstNormal);
  const secondNormalLength = norm(secondNormal);
  if (
    firstNormalLength <= scaledTolerance(epsilon, lineLength(firstA, firstB), lineLength(firstA, firstC))
    || secondNormalLength <= scaledTolerance(epsilon, lineLength(secondA, secondB), lineLength(secondA, secondC))
  ) {
    return 'degenerate';
  }

  const firstUnit = normalized(firstNormal);
  const secondUnit = normalized(secondNormal);
  const normalCrossLength = norm(cross(firstUnit, secondUnit));

  if (normalCrossLength <= epsilon) {
    return pointInPlane(secondA, firstA, firstB, firstC, epsilon) ? 'coincident' : 'parallel';
  }

  if (Math.abs(dot(firstUnit, secondUnit)) <= epsilon) return 'perpendicular';
  return 'intersecting';
}
