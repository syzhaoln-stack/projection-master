import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { auditLessonWithExactKernel } from './replicad-kernel-client.js';
import { auditTextbookMechanicalModel } from './textbook-mechanical-kernel-client.js';
import contract from './textbook-mechanical-contract.json' with { type: 'json' };

const BOOK = '《现代机械制图》第3版';

export const TEXTBOOK_MECHANICAL_CATALOG = Object.freeze(contract.models.map(model => Object.freeze({
  id: model.id, name: model.name, chapter: model.chapter, figure: model.figure,
  page: model.page, pdfPage: model.pdfPage, note: model.note, topics: [...model.topics],
  source: `${BOOK} · 第${model.chapter}章 · ${model.figure} · 第${model.page}页`,
  units: model.units, dimensionStatus: model.dimensionStatus,
  simplifications: [...model.simplifications]
})));

function lessonRequest(entry) {
  const requests = {
    'example-5-1': { visibleComponents: ['base', 'upright', 'barrel', 'rib'], appliedCutters: ['bore', 'base-hole-left', 'base-hole-right'] },
    'example-5-5': { slotLength: 50, appliedCutters: ['cut-p', 'cut-q', 'cut-slot'] },
    'example-5-6': { appliedCutters: ['cut-v', 'cut-iii', 'cut-iv'] }
  };
  return { lessonId: entry.lessonId, ...requests[entry.lessonId] };
}

function displayTransform(result) {
  const { min, max, size } = result.facts.bounds;
  const scale = 5 / Math.max(...size);
  const centerX = (min[0] + max[0]) / 2;
  const centerY = (min[1] + max[1]) / 2;
  return {
    scale,
    point: ([x, y, z]) => [(x - centerX) * scale, (z - min[2]) * scale, -(y - centerY) * scale],
    scene: ([x, y, z]) => [(x - centerX) * scale, (y - min[2]) * scale, (z + centerY) * scale]
  };
}

function faceGeometry(result, transform) {
  const { faces } = result.renderMesh;
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex([...faces.triangles]);
  const positions = [];
  for (let i = 0; i < faces.vertices.length; i += 3) positions.push(...transform.point(faces.vertices.slice(i, i + 3)));
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (faces.normals?.length) {
    const normals = [];
    for (let i = 0; i < faces.normals.length; i += 3) normals.push(faces.normals[i], faces.normals[i + 2], -faces.normals[i + 1]);
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.faceGroups = (faces.faceGroups || []).map(group => ({ ...group }));
  // Use the BRep's HLR classification below. Mesh triangle edges and cylinder
  // seams must never be guessed into this model's engineering projections.
  geometry.userData.projectionAnalyticOnly = true;
  return geometry;
}

export function textbookProjectionSegments(pathData, view, transform = { scene: point => point }) {
  if (!pathData.length) return [];
  // These paths come only from our local OpenCascade worker, never user SVG.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg">${pathData.map(path => `<path d="${path}"/>`).join('')}</svg>`;
  const paths = new SVGLoader().parse(svg).paths;
  // SVGLoader retains SVG's Y coordinates. OpenCascade's `bottom` camera
  // already emits plan SVG Y = -kernel Y, which is positive scene Z; do not
  // mirror it a second time (symmetric bodies previously hid this mistake).
  const toScene = point => transform.scene(view === 'front'
    ? [point.x, -point.y, 0]
    : view === 'side' ? [0, -point.y, point.x] : [point.x, 0, point.y]);
  const positions = [], seenSegments = new Set(), ellipses = new Map();
  const tau = Math.PI * 2, epsilon = 1e-7;
  const wrapped = angle => ((angle % tau) + tau) % tau;
  const rounded = value => Math.round(value / epsilon);
  const append = (a, b) => {
    if (a.distanceToSquared(b) < 1e-16) return;
    const aKey = `${rounded(a.x)},${rounded(a.y)}`;
    const bKey = `${rounded(b.x)},${rounded(b.y)}`;
    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (seenSegments.has(key)) return;
    seenSegments.add(key);
    positions.push(...toScene(a), ...toScene(b));
  };
  const collectEllipse = curve => {
    let rx = curve.xRadius, ry = curve.yRadius, rotation = curve.aRotation;
    let start = curve.aStartAngle, delta = curve.aEndAngle - start;
    const samePoints = Math.abs(delta) < Number.EPSILON;
    while (delta < 0) delta += tau;
    while (delta > tau) delta -= tau;
    if (delta < Number.EPSILON) delta = samePoints ? 0 : tau;
    if (curve.aClockwise && !samePoints) delta = delta === tau ? -tau : delta - tau;
    if (Math.abs(delta) < epsilon) return;
    // Canonicalize the supporting ellipse before merging angular intervals.
    // OpenCascade may trace the same rear rim twice, or split it at different
    // seam angles. Point/segment de-duplication alone misses phase-shifted arcs.
    if (Math.abs(rx - ry) < epsilon) {
      start += rotation;
      rotation = 0;
    } else {
      if (rx < ry) {
        [rx, ry] = [ry, rx];
        rotation += Math.PI / 2;
        start -= Math.PI / 2;
      }
      const canonicalRotation = ((rotation % Math.PI) + Math.PI) % Math.PI;
      start += rotation - canonicalRotation;
      rotation = canonicalRotation;
    }
    const key = [curve.aX, curve.aY, rx, ry, rotation].map(rounded).join(',');
    if (!ellipses.has(key)) ellipses.set(key, { x: curve.aX, y: curve.aY, rx, ry, rotation, intervals: [] });
    const intervals = ellipses.get(key).intervals;
    const length = Math.abs(delta);
    if (length >= tau - epsilon) intervals.push([0, tau]);
    else {
      const low = wrapped(Math.min(start, start + delta)), high = low + length;
      if (high <= tau + epsilon) intervals.push([low, Math.min(high, tau)]);
      else intervals.push([low, tau], [0, high - tau]);
    }
  };
  for (const path of paths) {
    for (const subpath of path.subPaths) {
      for (const curve of subpath.curves) {
        if (curve.isEllipseCurve) collectEllipse(curve);
        else {
          const points = curve.getPoints(curve.isLineCurve ? 1 : 96);
          for (let i = 1; i < points.length; i++) append(points[i - 1], points[i]);
        }
      }
      if (subpath.autoClose && subpath.curves.length) append(subpath.curves.at(-1).getPoint(1), subpath.curves[0].getPoint(0));
    }
  }
  for (const ellipse of ellipses.values()) {
    const intervals = ellipse.intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1] + epsilon) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    const c = Math.cos(ellipse.rotation), s = Math.sin(ellipse.rotation);
    const at = angle => {
      const x = ellipse.rx * Math.cos(angle), y = ellipse.ry * Math.sin(angle);
      return new THREE.Vector2(ellipse.x + c * x - s * y, ellipse.y + s * x + c * y);
    };
    for (const [low, high] of merged) {
      const count = Math.max(1, Math.ceil((high - low) / tau * 384));
      for (let i = 1; i <= count; i++) append(at(low + (high - low) * (i - 1) / count), at(low + (high - low) * i / count));
    }
  }
  return positions;
}

function attachProjectionGuides(mesh, result, transform) {
  for (const view of ['front', 'top', 'side']) {
    for (const style of ['visible', 'hidden']) {
      const positions = textbookProjectionSegments(result.projections[view][`${style}PathData`] || [], view, transform);
      if (!positions.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const guide = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ visible: false }));
      guide.name = `textbook_${view}_${style}`;
      guide.userData = { projectionGuide: true, projectionViews: [view], projectionLineStyle: style, exactKernel: true };
      guide.raycast = () => {};
      mesh.add(guide);
    }
  }
}

function centerAxes(entry, result) {
  if (!result) return [];
  const p = entry.parameters || {}, { min, max } = result.facts.bounds;
  const axes = [];
  if (['textbookObliqueCylinder', 'textbookSlotCylinder', 'textbookFlange'].includes(entry.id)) axes.push([[0, 0, min[2]], [0, 0, max[2]]]);
  if (entry.id === 'textbookKeyedShaft') axes.push([[min[0], 0, p.radius], [max[0], 0, p.radius]]);
  if (entry.id === 'textbookValveAdapter') axes.push([[0, 0, 0], [p.length, 0, 0]]);
  if (entry.id === 'textbook51') {
    axes.push([[0, min[1], 20.5], [0, max[1], 20.5]]);
    for (const x of [-15.5, 15.5]) axes.push([[x, -10.5, 0], [x, -10.5, 3.2]]);
  }
  if (entry.id === 'textbook56') axes.push([[5.5, 0, 0], [5.5, 0, 24.8]]);
  const transform = displayTransform(result);
  return axes.map(([from, to]) => ({ from: transform.point(from), to: transform.point(to) }));
}

function buildModel(entry, result) {
  if (!result?.facts?.passed || result.facts.solidCount !== 1) throw new Error(`请先完成${entry.name}的精确构建。`);
  const transform = displayTransform(result);
  const root = new THREE.Group();
  root.name = entry.id;
  root.userData.label = entry.name;
  root.userData.exactKernel = true;
  root.userData.textbookSource = {
    book: BOOK, chapter: entry.chapter, figure: entry.figure, page: entry.page, pdfPage: entry.pdfPage,
    description: entry.note, units: entry.units, dimensionStatus: entry.dimensionStatus,
    sourceDimensions: entry.sourceDimensions.map(dimension => ({ ...dimension,
      evidence: dimension.label.includes('由') ? 'derived-from-source' : 'source' })),
    teachingParameters: entry.parameters ? { ...entry.parameters } : {},
    features: [...entry.features], simplifications: [...entry.simplifications]
  };
  root.userData.geometryContract = {
    source: 'textbook-mechanical-contract.json', modelId: entry.id, projectionConvention: 'first-angle',
    solidCount: 1, units: entry.units, dimensionStatus: entry.dimensionStatus,
    sourceDimensions: entry.sourceDimensions.map(dimension => ({ ...dimension })),
    normalizedDisplayExtent: 5, displayScale: transform.scale
  };
  root.userData.kernelAudit = structuredClone(result.facts);
  const mesh = new THREE.Mesh(faceGeometry(result, transform), new THREE.MeshStandardMaterial({
    color: entry.color, roughness: 0.58, metalness: 0.08,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  }));
  mesh.name = 'body';
  mesh.userData = {
    label: entry.name, componentId: entry.id, exactKernel: true,
    textbookSource: root.userData.textbookSource, centerAxes: centerAxes(entry, result)
  };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  attachProjectionGuides(mesh, result, transform);
  root.add(mesh);
  if (result.renderMesh.edges?.lines?.length) {
    const points = [];
    const lines = result.renderMesh.edges.lines;
    for (let i = 0; i < lines.length; i += 3) points.push(...transform.point(lines.slice(i, i + 3)));
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const edges = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x294354, transparent: true, opacity: 0.7 }));
    edges.name = `${entry.id}_brep_edges`;
    edges.userData = { exactKernel: true, excludeFromProjection: true };
    edges.raycast = () => {};
    root.add(edges);
  }
  return root;
}

export function createTextbookMechanicalModels({ auditLesson = auditLessonWithExactKernel, auditMechanical = auditTextbookMechanicalModel } = {}) {
  const results = new Map(), pending = new Map();
  const models = {};
  for (const entry of contract.models) {
    models[entry.id] = {
      name: entry.name, note: entry.note,
      get centerAxes() { return centerAxes(entry, results.get(entry.id)); },
      editContext: () => ({
        description: `${BOOK}，${entry.figure}。${entry.note} 当前可看图、讲解和追问，暂未开放本例独立尺寸修改。`,
        parameters: []
      }),
      async load() {
        if (results.has(entry.id)) return;
        if (!pending.has(entry.id)) {
          const request = Promise.resolve().then(() => entry.lessonId ? auditLesson(lessonRequest(entry)) : auditMechanical(entry.id))
            .then(result => {
              if (!result?.facts?.passed || result.facts.solidCount !== 1) throw new Error(`${entry.name}尚未通过实体校核。`);
              results.set(entry.id, result);
            }).finally(() => pending.delete(entry.id));
          pending.set(entry.id, request);
        }
        return pending.get(entry.id);
      },
      build: () => buildModel(entry, results.get(entry.id))
    };
  }
  return models;
}

export const TEXTBOOK_MECHANICAL_MODELS = Object.freeze(createTextbookMechanicalModels());
