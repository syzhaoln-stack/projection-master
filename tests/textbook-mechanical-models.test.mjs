import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { loadExactKernel } from './helpers/exact-kernel.mjs';
import { auditTextbookMechanicalShape, buildTextbookMechanicalShape } from '../textbook-mechanical-geometry.js';
import { createTextbookMechanicalModels, TEXTBOOK_MECHANICAL_CATALOG, textbookProjectionSegments } from '../textbook-mechanical-models.js';
import contract from '../textbook-mechanical-contract.json' with { type: 'json' };
import { makeBox, measureVolume } from 'replicad';
import { createFaceSelection, disposeFaceSelection } from '../projection-selection.js';

// Exercise Three's production SVG path parser with actual OpenCascade HLR
// strings. Only the browser's XML-node plumbing is replaced in this Node test.
class HlrXmlParser {
  parseFromString(text) {
    const element = (name, attributes = {}, childNodes = []) => ({
      nodeType: 1, nodeName: name, childNodes,
      hasAttribute: key => Object.hasOwn(attributes, key),
      getAttribute: key => attributes[key] ?? null
    });
    return { documentElement: element('svg', {}, [...text.matchAll(/<path d="([^"]*)"\/>/g)]
      .map(match => element('path', { d: match[1] }))) };
  }
}
globalThis.DOMParser = HlrXmlParser;

const kernel = await loadExactKernel();
const audits = new Map();
const models = createTextbookMechanicalModels({
  auditLesson: async payload => {
    const result = kernel.auditLesson(payload);
    audits.set(contract.models.find(entry => entry.lessonId === payload.lessonId).id, result);
    return result;
  },
  auditMechanical: async id => {
    const result = auditTextbookMechanicalShape(id);
    audits.set(id, result);
    return result;
  }
});
for (const entry of TEXTBOOK_MECHANICAL_CATALOG) await models[entry.id].load();

function dispose(root) {
  root.traverse(object => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
}

test('curated mechanical catalog ties eight models to checked figures across chapters 4, 5, 7 and 10', () => {
  assert.equal(TEXTBOOK_MECHANICAL_CATALOG.length, 8);
  assert.deepEqual([...new Set(TEXTBOOK_MECHANICAL_CATALOG.map(entry => entry.chapter))], [4, 5, 7, 10]);
  assert.equal(new Set(TEXTBOOK_MECHANICAL_CATALOG.map(entry => entry.id)).size, 8);
  for (const entry of TEXTBOOK_MECHANICAL_CATALOG) {
    assert.match(entry.source, /现代机械制图/);
    assert.equal(entry.pdfPage, entry.page + 7);
    assert.ok(entry.figure && entry.dimensionStatus && entry.topics.length);
    assert.deepEqual(models[entry.id].editContext().parameters, [], 'fixed source examples must not silently expose whole-model scaling');
  }
});

test('HLR guide conversion preserves real front, left and plan axes for an asymmetric solid', () => {
  // Kernel (2..5,-9..-4,3..8) maps to unscaled scene (2..5,3..8,4..9).
  // A symmetric model cannot detect the mistaken second mirror of the plan.
  const shape = makeBox([2, -9, 3], [5, -4, 8]);
  const cases = [
    ['front', 'front', 'front', 0, 1, [2, 5, 3, 8]],
    ['side', 'right', 'right', 2, 1, [4, 9, 3, 8]],
    ['top', 'top', 'bottom', 0, 2, [2, 5, 4, 9]]
  ];
  for (const [view, sheetView, camera, horizontal, vertical, expected] of cases) {
    const projection = kernel.projection(shape, sheetView, camera, 'example-5-6');
    const points = textbookProjectionSegments(projection.visiblePathData, view);
    const h = [], v = [];
    for (let i = 0; i < points.length; i += 3) { h.push(points[i + horizontal]); v.push(points[i + vertical]); }
    assert.deepEqual([Math.min(...h), Math.max(...h), Math.min(...v), Math.max(...v)], expected, view);
  }
});

test('example 5-1 front base holes align with the real solid in the top view rather than appearing behind it', () => {
  const root = models.textbook51.build();
  const mesh = root.getObjectByName('body');
  const projection = mesh.children.find(child => child.name === 'textbook_top_visible');
  const points = projection.geometry.attributes.position;
  const scale = root.userData.geometryContract.displayScale;
  for (const kernelX of [-15.5, 15.5]) {
    const x = kernelX * scale, z = 10.5 * scale, r = 1.8 * scale;
    let frontRim = 0, falseRearRim = 0;
    for (let i = 0; i < points.count; i++) {
      const px = points.getX(i), pz = points.getZ(i);
      if (Math.abs(Math.hypot(px - x, pz - z) - r) < 1e-5) frontRim++;
      if (Math.abs(Math.hypot(px - x, pz + z) - r) < 1e-5) falseRearRim++;
    }
    assert.ok(frontRim > 100, 'the front through-hole rim must be directly below the selected real hole');
    assert.equal(falseRearRim, 0, 'no reflected hole is drawn at the rear');
  }
  dispose(root);
});

for (const entry of TEXTBOOK_MECHANICAL_CATALOG) {
  test(`${entry.id}: one validated solid, finite display geometry and HLR-only aligned projections`, () => {
    const result = audits.get(entry.id);
    assert.equal(result.facts.solidCount, 1);
    assert.equal(result.facts.passed, true);
    const root = models[entry.id].build();
    const meshes = [];
    root.traverse(object => { if (object.isMesh) meshes.push(object); });
    assert.equal(meshes.length, 1, 'no overlapping parts or decorative fake holes');
    const mesh = meshes[0];
    assert.deepEqual(mesh.geometry.userData.faceGroups, result.renderMesh.faces.faceGroups,
      'the actual BRep face ranges must survive display normalization for picking');
    const firstFace = mesh.geometry.userData.faceGroups[0];
    const faceSelection = createFaceSelection(mesh, firstFace.start / 3);
    assert.equal(faceSelection.faceId, firstFace.faceId);
    assert.equal(faceSelection.geometry.index.count, firstFace.count);
    assert.ok(firstFace.count < mesh.geometry.index.count, 'a picked face must not select the entire solid');
    disposeFaceSelection(faceSelection);
    assert.deepEqual(mesh.userData.centerAxes, models[entry.id].centerAxes, 'selecting the body must preserve its explicit feature axes');
    assert.equal(mesh.geometry.userData.projectionAnalyticOnly, true);
    assert.ok(Array.from(mesh.geometry.attributes.position.array).every(Number.isFinite));
    const bounds = mesh.geometry.boundingBox;
    assert.ok(Math.abs(bounds.min.y) < 1e-5);
    assert.ok(Math.abs(Math.max(...bounds.getSize(new THREE.Vector3()).toArray()) - 5) < 1e-5);
    // Tessellated curved extrema can miss the exact BRep extrema by a fraction
    // of the 0.035 kernel-unit meshing tolerance. The datum uses exact bounds.
    assert.ok(Math.abs(bounds.min.x + bounds.max.x) < 0.001);
    assert.ok(Math.abs(bounds.min.z + bounds.max.z) < 0.001);
    const guides = mesh.children.filter(object => object.userData.projectionGuide);
    for (const view of ['front', 'top', 'side']) {
      const matching = guides.filter(guide => guide.userData.projectionViews.includes(view));
      assert.ok(matching.some(guide => guide.userData.projectionLineStyle === 'visible'));
      const viewBounds = new THREE.Box3();
      for (const guide of matching) {
        assert.equal(guide.material.visible, false, 'guides are drawn on projection planes, never through the 3D body');
        guide.geometry.computeBoundingBox();
        viewBounds.union(guide.geometry.boundingBox);
      }
      const axes = { front: ['x', 'y'], side: ['z', 'y'], top: ['x', 'z'] }[view];
      for (const axis of axes) {
        assert.ok(Math.abs(viewBounds.min[axis] - bounds.min[axis]) < 0.007, `${view} min ${axis} must align with the actual mesh`);
        assert.ok(Math.abs(viewBounds.max[axis] - bounds.max[axis]) < 0.007, `${view} max ${axis} must align with the actual mesh`);
      }
    }
    assert.ok(root.userData.textbookSource.sourceDimensions.every(d => ['source', 'derived-from-source'].includes(d.evidence)));
    assert.ok(root.userData.textbookSource.features.length > 1);
    dispose(root);
  });
}

test('four new chapter 4/7 shapes and chapter 10 adapter pass independent feature-opening probes', () => {
  for (const id of ['textbookObliqueCylinder', 'textbookSlotCylinder', 'textbookKeyedShaft', 'textbookFlange', 'textbookValveAdapter']) {
    const facts = audits.get(id).facts;
    assert.equal(facts.brepValid, true);
    assert.ok(facts.semanticChecks.length >= 6);
    assert.ok(facts.semanticChecks.every(check => check.passed));
  }
});

test('slot/tongue cylinder uses the same side planes and retains its central connecting web', () => {
  const shape = buildTextbookMechanicalShape('textbookSlotCylinder');
  const at = point => measureVolume(shape.intersect(makeBox(point.map(v => v - 0.05), point.map(v => v + 0.05))));
  assert.ok(at([0, 0, 43]) < 1e-8, 'upper slot is genuinely empty');
  assert.ok(at([0, 0, 6]) > 0.0009, 'lower central tongue remains');
  assert.ok(at([8, 0, 6]) < 1e-8, 'lower side is cut');
  assert.ok(at([8, 0, 43]) > 0.0009, 'upper side is retained');
  assert.ok(at([0, 0, 25]) > 0.0009, 'middle joins all parts into one solid');
  shape.delete();
});

test('the valve drawing is read as a half-section: 38 is the outer neck and the rear bore is 43', () => {
  const entry = contract.models.find(model => model.id === 'textbookValveAdapter');
  assert.equal(entry.parameters.neckRadius * 2, 38);
  assert.equal(entry.parameters.boreRadius * 2, 25);
  assert.equal(entry.parameters.rearBoreRadius * 2, 43);
  assert.equal(entry.parameters.length - entry.parameters.rearBoreDepth, 57);
  assert.deepEqual(audits.get(entry.id).facts.bounds.size, [63, 82, 82]);
  assert.match(entry.simplifications.join(' '), /M50×3/);
});

function segmentLength(positions, predicate = () => true) {
  let total = 0;
  for (let i = 0; i < positions.length; i += 6) {
    const a = positions.slice(i, i + 3), b = positions.slice(i + 3, i + 6);
    if (predicate(a, b)) total += Math.hypot(...a.map((value, axis) => value - b[axis]));
  }
  return total;
}

test('actual valve HLR rear rims produce one hidden circumference, avoiding filled dash gaps', () => {
  const raw = audits.get('textbookValveAdapter').projections.side.hiddenPathData;
  assert.ok(raw.some(path => (path.match(/A 27\.5 27\.5/g) || []).length === 4), 'fixture retains the observed twice-traced phi55 source rim');
  const positions = textbookProjectionSegments(raw, 'side');
  for (const radius of [19, 27.5, 22.5, 21.5]) {
    const length = segmentLength(positions, (a, b) =>
      Math.abs(Math.hypot(a[1], a[2]) - radius) < 1e-6
      && Math.abs(Math.hypot(b[1], b[2]) - radius) < 1e-6);
    assert.ok(Math.abs(length / (2 * Math.PI * radius) - 1) < 0.00002,
      `hidden diameter ${radius * 2} must be one circumference, not two superimposed dash phases`);
  }
});

test('projection deduplication merges reversed and shifted circle seams while retaining partial arcs', () => {
  const circlePaths = [
    'M 0 -10 A 10 10 0 0 1 0 10 A 10 10 0 0 1 0 -10 Z',
    'M 10 0 A 10 10 0 0 0 -10 0 A 10 10 0 0 0 10 0 Z'
  ];
  const oneCircle = textbookProjectionSegments(circlePaths, 'front');
  assert.ok(Math.abs(segmentLength(oneCircle) / (20 * Math.PI) - 1) < 0.00002);
  const half = textbookProjectionSegments([
    'M 10 0 A 10 10 0 0 1 -10 0',
    'M -10 0 A 10 10 0 0 0 10 0'
  ], 'front');
  assert.ok(Math.abs(segmentLength(half) / (10 * Math.PI) - 1) < 0.00002, 'duplicate half arcs must not become a full circle');
  const line = textbookProjectionSegments(['M 0 0 L 10 0', 'M 10 0 L 0 0'], 'front');
  assert.equal(line.length, 6);
  assert.equal(segmentLength(line), 10);
});

test('the keyway has the explicit 6 width and 14 centre spacing, not a through slot', () => {
  const entry = contract.models.find(model => model.id === 'textbookKeyedShaft');
  assert.equal(entry.parameters.slotWidth, 6);
  assert.equal(entry.parameters.slotLength - entry.parameters.slotWidth, 14);
  assert.equal(entry.parameters.slotDepth, 3.5);
  assert.ok(!entry.sourceDimensions.some(d => d.label === '轴总长'), 'unread shaft length must not become an asserted textbook dimension');
});

test('rebuilding does not share disposable geometry and concurrent loads reuse verified results', async () => {
  const a = models.textbookFlange.build(), b = models.textbookFlange.build();
  assert.notEqual(a.children[0].geometry, b.children[0].geometry);
  assert.notEqual(a.children[0].geometry.attributes.position.array, b.children[0].geometry.attributes.position.array);
  dispose(a);
  assert.ok(b.children[0].geometry.attributes.position.count > 0);
  dispose(b);
  let calls = 0;
  const cached = createTextbookMechanicalModels({ auditMechanical: async () => { calls++; return audits.get('textbookSlotCylinder'); } });
  await Promise.all([cached.textbookSlotCylinder.load(), cached.textbookSlotCylinder.load()]);
  await cached.textbookSlotCylinder.load();
  assert.equal(calls, 1);
});

test('failed kernel validation prevents display and can be retried', async () => {
  let calls = 0;
  const failed = createTextbookMechanicalModels({ auditMechanical: async () => {
    calls++;
    return calls === 1 ? { facts: { passed: false, solidCount: 2 } } : audits.get('textbookSlotCylinder');
  } });
  assert.throws(() => failed.textbookSlotCylinder.build(), /精确构建/);
  await assert.rejects(failed.textbookSlotCylinder.load(), /实体校核/);
  assert.throws(() => failed.textbookSlotCylinder.build(), /精确构建/);
  await failed.textbookSlotCylinder.load();
  const root = failed.textbookSlotCylinder.build();
  assert.equal(root.userData.kernelAudit.passed, true);
  dispose(root);
});
