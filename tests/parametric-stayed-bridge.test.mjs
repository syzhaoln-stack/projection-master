import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildModel } from '../assets/textbook-bridges/model.js';
import { auditMobility } from '../assets/textbook-bridges/mobility.js';
import { validateEditPlan } from '../ai-edit-protocol.js';
import {
  STAYED_PARAMETER_DEFINITIONS, buildParametricStayedBridge, getStayedParameterContext,
  isParametricStayedBridge, normalizeStayedParameters
} from '../parametric-stayed-bridge.js';

const IDS = ['stayed_fan', 'stayed_harp'];
const byId = model => new Map(model.parts.map(part => [part.id, part]));
const close = (actual, expected, message = '') => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
function equalGeometry(actual, expected, path = '') {
  if (typeof actual === 'number' && typeof expected === 'number') close(actual, expected, path);
  else if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, path);
    expected.forEach((value, i) => equalGeometry(actual[i], value, `${path}[${i}]`));
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    for (const key of Object.keys(expected)) equalGeometry(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}
const geometry = part => Object.fromEntries(['shape', 'center', 'size', 'points', 'radius', 'axis'].filter(key => part[key] !== undefined).map(key => [key, part[key]]));

function verifyConstituents(model) {
  const { mainSpan: main, deckWidth: width, towerHeight: height, cablesPerSide: count } = model.parameters;
  const parts = byId(model), cableY = width / 2 - 0.5, cables = model.parts.filter(part => part.category === 'cable');
  assert.equal(parts.size, model.parts.length, 'component IDs are unique');
  assert.equal(cables.length, 8 * count);
  assert.equal(model.parts.filter(part => part.id.startsWith('comparison-anchor-crossbeam-')).length, 4 * count);
  assert.equal(model.geometryContract.groups.length, 8);
  assert.equal(new Set(model.geometryContract.groups.flatMap(group => group.cableIds)).size, cables.length);
  for (const group of model.geometryContract.groups) {
    assert.equal(group.cableIds.length, count);
    const groupCables = group.cableIds.map(id => parts.get(id));
    let slope;
    groupCables.forEach((cable, index) => {
      assert.ok(cable, 'every contract cable resolves');
      assert.equal(cable.tower, group.tower); assert.equal(cable.plane, group.plane); assert.equal(cable.side, group.side);
      close(cable.radius, 0.044, 'cable radius');
      const [a, b] = cable.points;
      close(a[1], group.plane * cableY, 'deck cable plane');
      close(b[1], a[1], 'tower and deck share cable plane');
      close(a[2], 7.3, 'deck anchor elevation');
      close(b[0], group.tower * main / 2 + group.side * 0.46, 'tower face anchor');
      assert.ok(b[2] > a[2] && b[2] < 7 + height, 'tower anchor is above deck and below tower top');
      const deckAnchor = parts.get(`${cable.id}-deck-anchor`), towerAnchor = parts.get(`${cable.id}-tower-anchor`);
      assert.deepEqual(deckAnchor.center, a); assert.deepEqual(towerAnchor.center, b);
      assert.deepEqual(deckAnchor.size, [0.44, 0.44, 0.44]); assert.deepEqual(towerAnchor.size, [0.4, 0.4, 0.4]);
      const seat = parts.get(deckAnchor.deckAttachment.seatId);
      assert.ok(seat); close(seat.center[0], a[0]); close(seat.center[1], a[1]);
      assert.ok(seat.center[2] - seat.size[2] / 2 < 7, 'seat penetrates physical deck plate');
      assert.ok(seat.center[2] + seat.size[2] / 2 > a[2] - 0.22, 'seat overlaps deck anchor');
      const crossbeam = parts.get(`comparison-anchor-crossbeam-${group.tower}-${group.side}-${index + 1}`);
      close(crossbeam.points[0][0], a[0]); close(crossbeam.points[1][0], a[0]);
      close(crossbeam.points[0][1], -cableY); close(crossbeam.points[1][1], cableY);
      close(crossbeam.radius, 0.2);
      assert.equal(crossbeam.stage, cable.stage); assert.equal(deckAnchor.stage, cable.stage);
      if (model.id === 'stayed_harp') {
        const currentSlope = (b[2] - a[2]) / (b[0] - a[0]);
        if (slope !== undefined) close(currentSlope, slope, 'harp cables stay parallel');
        slope = currentSlope;
      } else if (index) close(b[2] - groupCables[index - 1].points[1][2], 0.5, 'fan anchors retain physical clearance');
    });
  }
  for (const tower of [-1, 1]) {
    const bearing = parts.get(`comparison-tower-pier-${tower}-bearing`);
    const pier = parts.get(`comparison-tower-pier-${tower}`);
    close(pier.size[1], width + 1);
    for (const plane of [-1, 1]) {
      const column = parts.get(`comparison-tower-${tower}-${plane}`);
      assert.deepEqual(column.points, [[tower * main / 2, plane * cableY, 5.7], [tower * main / 2, plane * cableY, 7 + height]]);
      close(column.radius, 0.62);
      assert.ok(Math.abs(column.points[0][1]) - column.radius < bearing.size[1] / 2, 'tower foot overlaps bearing transversely');
      assert.ok(column.points[0][2] < bearing.center[2] + bearing.size[2] / 2, 'tower foot overlaps bearing vertically');
    }
  }
  for (const part of model.parts) {
    for (const value of [part.center, part.size, ...(part.points || []), part.axis].filter(Boolean).flat()) assert.ok(Number.isFinite(value), `${part.id} is finite`);
    if (part.size) assert.ok(part.size.every(size => size > 0), `${part.id} has positive section`);
  }
  for (const member of model.members) {
    const part = parts.get(member.id); assert.ok(part, 'member has physical constituent');
    if (part.points) assert.deepEqual(member.points, part.points, 'analytical centreline matches actual geometry');
  }
  for (const panel of model.panels) {
    assert.ok(parts.has(panel.id)); close(panel.corners[0][1], -width / 2); close(panel.corners[2][1], width / 2);
  }
  close(model.mobility.walkways[0].width, width - 2.6);
  close(model.transverseBudget.leftEdge + model.transverseBudget.pedestrianSpace + model.transverseBudget.rightEdge, width);
  assert.equal(auditMobility(model).pass, true, 'physical tower/cable/anchor geometry does not invade walkway');
}

test('default geometry is exactly the untouched source, including stages, connections and reference people', async () => {
  const sourceBytes = await readFile(new URL('../assets/textbook-bridges/model.js', import.meta.url));
  assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), '83adf2e2991e970428920a78ea183d2128d3b11f1555c5689e05572878704f7a');
  for (const id of IDS) {
    const source = buildModel(id), result = buildParametricStayedBridge(id);
    for (const key of ['parts', 'members', 'panels', 'people', 'mobility', 'stages', 'deckPath', 'axes', 'sourceIds', 'assumptions']) assert.deepEqual(result[key], source[key], key);
    assert.deepEqual(result.parameters, { mainSpan: 96, deckWidth: 8, towerHeight: 28, cablesPerSide: 7 });
    assert.equal(result.units, 'm'); assert.equal(result.display.memberThicknessFactor, 1);
    verifyConstituents(result);
  }
});

test('bridge width changes actual slab/web/rail/cable/tower/support spacing while retaining section thicknesses', () => {
  for (const id of IDS) for (const width of [6, 12, 16]) {
    const source = byId(buildModel(id)), model = buildParametricStayedBridge(id, { deckWidth: width });
    for (const part of model.parts) {
      const original = source.get(part.id); assert.ok(original);
      if (part.radius !== undefined) close(part.radius, original.radius, 'tube sections are not stretched');
      if (part.size) {
        close(part.size[0], original.size[0], 'width keeps longitudinal section');
        close(part.size[2], original.size[2], 'width keeps vertical section');
        if (/^deck-\d+$/.test(part.id)) close(part.size[1], width);
        if (part.id.endsWith('-bottom')) close(part.size[1], width - 0.8);
        if (/-web-/.test(part.id)) { close(part.size[1], 0.12); close(Math.abs(part.center[1]), width / 2 - 0.46); }
        if (part.id.includes('stay-comparison')) assert.deepEqual(part.size, original.size, 'anchorage blocks remain original size');
      }
    }
    close(model.girderDepth, 1.3); close(model.deckThickness, 0.18); close(model.deckZ, 7);
    verifyConstituents(model);
  }
});

test('tower height changes only towers, their top crossbeams and cable tower ends', () => {
  for (const id of IDS) for (const height of [18, 35, 45]) {
    const source = byId(buildModel(id)), model = buildParametricStayedBridge(id, { towerHeight: height });
    for (const part of model.parts) {
      const original = source.get(part.id); assert.ok(original);
      if (part.category === 'tower' || part.id.endsWith('-tower-anchor')) {
        if (part.radius !== undefined) close(part.radius, original.radius);
      } else if (part.category === 'cable') {
        assert.deepEqual(part.points[0], original.points[0], 'tower height does not move deck anchors');
        close(part.radius, original.radius);
      } else equalGeometry(geometry(part), geometry(original), part.id);
    }
    verifyConstituents(model);
  }
});

test('every allowed integer cable count creates real cables, both anchors, seats and shared crossbeams', () => {
  for (const id of IDS) for (let count = 4; count <= 12; count++) {
    const model = buildParametricStayedBridge(id, { cablesPerSide: count });
    assert.equal(model.parts.filter(part => part.id.endsWith('-deck-anchor')).length, 8 * count);
    assert.equal(model.parts.filter(part => part.id.endsWith('-tower-anchor')).length, 8 * count);
    assert.equal(model.parts.filter(part => part.id.endsWith('-deck-anchor-seat')).length, 8 * count);
    if (id === 'stayed_fan') close(model.geometryContract.fanAnchorZoneHeight, (count - 1) * 0.5);
    verifyConstituents(model);
  }
});

test('span rebuilds physical deck panels and tower stations without stretching their cross sections', () => {
  for (const id of IDS) for (const span of [72, 100.1, 144]) {
    const model = buildParametricStayedBridge(id, { mainSpan: span });
    assert.equal(model.span, span); assert.equal(model.length, span * 2);
    assert.deepEqual(model.spanArrangement, [span / 2, span, span / 2]);
    assert.equal(model.panels.length, Math.ceil(span * 2 / 3));
    close(model.deckPath[0][0], -span); close(model.deckPath.at(-1)[0], span);
    for (const part of model.parts.filter(part => part.category === 'deck')) { close(part.size[1], 8); close(part.size[2], 0.18); }
    for (const side of [-1, 1]) close(byId(model).get(`abutment-${side}`).center[0], side * span);
    for (const person of model.people) { close(person.height, 1.75); assert.equal(person.uniformScale, 1); }
    verifyConstituents(model);
  }
});

test('all simultaneous min/max combinations preserve real constituent connections and walkway clearance', () => {
  for (const id of IDS) for (let mask = 0; mask < 16; mask++) {
    const values = Object.fromEntries(STAYED_PARAMETER_DEFINITIONS.map((definition, i) => [definition.key, mask & (1 << i) ? definition.max : definition.min]));
    verifyConstituents(buildParametricStayedBridge(id, values));
  }
});

test('parameter context is accepted by real AI protocol and has stable, bounded state identity', () => {
  for (const id of IDS) {
    const context = getStayedParameterContext(id);
    assert.ok(context.targetId.length <= 160); assert.ok(context.description.length <= 1200);
    assert.equal(context.targetId, getStayedParameterContext(id, { mainSpan: 96 }).targetId);
    assert.notEqual(context.targetId, getStayedParameterContext(id, { deckWidth: 12 }).targetId);
    const plan = { targetId: context.targetId, summary: '调整桥面、塔高和拉索数量。', changes: [{ key: 'deckWidth', value: 12 }, { key: 'towerHeight', value: 35 }, { key: 'cablesPerSide', value: 9 }] };
    const checked = validateEditPlan(plan, context);
    const model = buildParametricStayedBridge(id, Object.fromEntries(checked.changes.map(change => [change.key, change.value])));
    verifyConstituents(model);
    assert.notEqual(context.targetId, getStayedParameterContext(id, model.parameters).targetId);
    assert.throws(() => validateEditPlan({ ...plan, changes: [{ key: 'cablesPerSide', value: 7.5 }] }, context));
  }
});

test('invalid keys, types, ranges, fractional cable counts and unsupported source IDs are rejected', () => {
  assert.equal(isParametricStayedBridge('stayed_fan'), true); assert.equal(isParametricStayedBridge('stayed_standard'), false);
  assert.throws(() => buildParametricStayedBridge('stayed_standard'));
  for (const invalid of [null, [], '12', { arbitraryCode: 'eval' }, { deckWidth: '12' }, { deckWidth: NaN }, { deckWidth: 16.1 }, { deckWidth: 5.9 }, { towerHeight: Infinity }, { mainSpan: 100.01 }, { cablesPerSide: 7.5 }, { cablesPerSide: 3 }, Object.create({ deckWidth: 12 }), JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => buildParametricStayedBridge('stayed_fan', invalid));
  }
  assert.throws(() => normalizeStayedParameters('stayed_fan', { [Symbol('parameter')]: 1 }));
});

test('model regeneration and reset do not mutate parameters, source data or another generated model', () => {
  const input = { deckWidth: 12, cablesPerSide: 9 }, first = buildParametricStayedBridge('stayed_fan', input);
  const second = buildParametricStayedBridge('stayed_fan', input);
  first.parts[0].center[0] = 999; first.geometryContract.groups[0].cableIds.length = 0;
  first.parameters.deckWidth = 6; first.sourceIds.length = 0;
  assert.deepEqual(input, { deckWidth: 12, cablesPerSide: 9 });
  assert.notEqual(second.parts[0].center[0], 999); assert.equal(second.geometryContract.groups[0].cableIds.length, 9);
  assert.ok(second.sourceIds.length); verifyConstituents(second);
  assert.deepEqual(buildParametricStayedBridge('stayed_fan').parts, buildModel('stayed_fan').parts);
});
