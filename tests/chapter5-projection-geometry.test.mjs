import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXAMPLE51_DIMENSIONS,
  EXAMPLE55_BODY,
  EXAMPLE56_DIMENSIONS,
  createExample55Construction,
  createExample55ProjectionBlueprint,
  createExample56BaseSlot,
  createExample56ProjectionBlueprint,
  example56BaseHalfDepthAt
} from '../chapter5-projection-geometry.js';

const allExample55Cuts = new Set(['cut-p', 'cut-q', 'cut-slot']);
const allExample56Cuts = new Set(['cut-iii', 'cut-iv', 'cut-v']);
const example56TextbookCutters = {
  'cut-iii': { x: 0.55, y: 2.4 },
  'cut-iv': { x: 0.55, y: 1.9 },
  'cut-v': { x: -1.4, y: 0.475, height: 0.36 }
};

function byId(segments, id) {
  return segments.find(segment => segment.id === id);
}

function slotEdgeIntervals(blueprint, suffix) {
  return [...blueprint.top.visible, ...blueprint.top.hidden]
    .filter(segment => segment.id.startsWith(`slot-${suffix}-`))
    .map(segment => [segment.a[0], segment.b[0]])
    .sort((a, b) => a[0] - b[0]);
}

test('example 5-1 keeps the textbook upright arch outside the barrel circle', () => {
  assert.ok(EXAMPLE51_DIMENSIONS.uprightOuterRadius > EXAMPLE51_DIMENSIONS.barrelOuterRadius);
  assert.ok(EXAMPLE51_DIMENSIONS.barrelOuterRadius > EXAMPLE51_DIMENSIONS.barrelInnerRadius);
  assert.ok(Math.abs(
    EXAMPLE51_DIMENSIONS.barrelCenterY
      - EXAMPLE51_DIMENSIONS.barrelOuterRadius
      - EXAMPLE51_DIMENSIONS.ribTopY
  ) < 1e-9);
});

test('example 5-5 splits each through-slot edge into exposed solid and covered hidden parts', () => {
  const construction = createExample55Construction({
    cutterValues: {
      'cut-p': { x: 0, y: 0 },
      'cut-q': { z: 0, y: 0 },
      'cut-slot': { x: 0, z: 0 }
    },
    slotLength: 5
  });
  const blueprint = createExample55ProjectionBlueprint({
    construction,
    appliedCutters: allExample55Cuts
  });

  for (const suffix of ['rear', 'front']) {
    const exposed = byId(blueprint.top.visible, `slot-${suffix}-exposed`);
    const covered = byId(blueprint.top.hidden, `slot-${suffix}-covered`);
    assert.ok(exposed, `${suffix} slot edge must have a visible exposed segment`);
    assert.ok(covered, `${suffix} slot edge must retain a hidden covered segment`);
    assert.equal(exposed.b[0], covered.a[0], 'solid and hidden portions must meet without a gap');
    assert.ok(exposed.a[0] < exposed.b[0]);
    assert.ok(covered.a[0] < covered.b[0]);
  }
  const frontRoof = byId(blueprint.front.hidden, 'slot-roof-hidden');
  assert.equal(frontRoof.a[0], construction.pXAt(construction.slotTopY), 'front-view hidden roof must start on the P silhouette, not float outside the body');
  assert.equal(frontRoof.b[0], construction.slotXMax);
});

test('example 5-5 slot projection stays continuous throughout every interactive limit', () => {
  for (const slotLength of [1.4, 5, 5.4]) {
    for (const slotX of [-1.2, 0, 1.2]) {
      for (const slotZ of [-0.45, 0, 0.45]) {
        const construction = createExample55Construction({
          cutterValues: {
            'cut-p': { x: 0.45, y: -0.25 },
            'cut-q': { z: 0.3, y: 0.2 },
            'cut-slot': { x: slotX, z: slotZ }
          },
          slotLength
        });
        const blueprint = createExample55ProjectionBlueprint({
          construction,
          appliedCutters: allExample55Cuts
        });

        assert.ok(construction.slotXMin >= EXAMPLE55_BODY.xMin);
        assert.ok(construction.slotXMax <= EXAMPLE55_BODY.xMax);
        const frontRoof = byId(blueprint.front.hidden, 'slot-roof-hidden');
        assert.ok(frontRoof.a[0] >= construction.slotXMin);
        assert.ok(frontRoof.a[0] <= construction.slotXMax);
        assert.ok(frontRoof.b[0] >= frontRoof.a[0], 'front-view slot roof must never reverse');
        for (const suffix of ['rear', 'front']) {
          const intervals = slotEdgeIntervals(blueprint, suffix);
          assert.ok(intervals.length >= 1, `${suffix} slot edge disappeared at an interactive limit`);
          assert.equal(intervals[0][0], construction.slotXMin);
          assert.equal(intervals.at(-1)[1], construction.slotXMax);
          for (let index = 1; index < intervals.length; index += 1) {
            assert.equal(intervals[index - 1][1], intervals[index][0], `${suffix} slot edge developed a gap`);
          }
        }
      }
    }
  }
});

test('example 5-5 changes the end view from hidden slot to visible U only when B3 reaches it', () => {
  const local = createExample55Construction({
    cutterValues: { 'cut-slot': { x: -0.8, z: 0 } },
    slotLength: 1.4
  });
  const localBlueprint = createExample55ProjectionBlueprint({
    construction: local,
    appliedCutters: allExample55Cuts
  });
  assert.equal(localBlueprint.slotOpenAtViewedEnd, false);
  assert.ok(byId(localBlueprint.side.hidden, 'slot-roof-hidden'));
  assert.equal(byId(localBlueprint.side.visible, 'slot-roof'), undefined);

  const through = createExample55Construction({
    cutterValues: { 'cut-slot': { x: 0, z: 0 } },
    slotLength: 5
  });
  const throughBlueprint = createExample55ProjectionBlueprint({
    construction: through,
    appliedCutters: allExample55Cuts
  });
  assert.equal(throughBlueprint.slotOpenAtViewedEnd, true);
  assert.ok(byId(throughBlueprint.side.visible, 'slot-roof'));
  assert.equal(byId(throughBlueprint.side.hidden, 'slot-roof-hidden'), undefined);
});

test('example 5-6 final blueprint is complete without mesh-derived silhouettes', () => {
  const slot = createExample56BaseSlot({ x: -1.4, y: 0.475, height: 0.36 });
  const blueprint = createExample56ProjectionBlueprint({
    appliedCutters: allExample56Cuts,
    cutterValues: {
      ...example56TextbookCutters
    },
    slot
  });

  for (const id of ['base-bottom', 'base-left-lower', 'base-left-upper', 'base-slot-v-lower', 'base-slot-v-upper', 'base-slot-v-stop']) {
    assert.ok(byId(blueprint.front.visible, id), `front view is missing ${id}`);
  }
  for (const id of ['base-rear-edge', 'base-front-edge', 'base-left-edge']) {
    assert.ok(byId(blueprint.top.visible, id), `top view is missing ${id}`);
  }
  assert.equal(byId(blueprint.top.visible, 'base-right-edge'), undefined, 'the base must merge tangentially into the ring, without a spurious right edge');
  assert.ok(byId(blueprint.top.hidden, 'base-slot-v-stop'), 'top view needs the hidden V-slot stop edge');
  assert.equal(byId(blueprint.top.hidden, 'base-slot-v-rear-edge'), undefined, 'a full-depth V slot must not create a longitudinal pocket wall');
  for (const id of ['base-bottom', 'base-left-side', 'base-right-side', 'ring-left-side', 'ring-right-side', 'ring-top']) {
    assert.ok(byId(blueprint.side.visible, id), `side view is missing ${id}`);
  }

  assert.equal(EXAMPLE56_DIMENSIONS.base.xMax, EXAMPLE56_DIMENSIONS.ring.x + EXAMPLE56_DIMENSIONS.ring.outer);
  assert.equal(EXAMPLE56_DIMENSIONS.ring.bottom, 0, 'figure 5-17a places the full cylinder on the common bottom datum');
  assert.equal(byId(blueprint.front.hidden, 'bore-left-hidden').a[1], 0, 'front-view bore must continue to the common bottom');
  assert.equal(byId(blueprint.side.hidden, 'bore-left-hidden').a[1], 0, 'side-view bore must continue to the common bottom');
  const tangentDx = EXAMPLE56_DIMENSIONS.base.tangentX - EXAMPLE56_DIMENSIONS.ring.x;
  const tangentDz = EXAMPLE56_DIMENSIONS.base.tangentHalfDepth;
  assert.ok(Math.abs(Math.hypot(tangentDx, tangentDz) - EXAMPLE56_DIMENSIONS.ring.outer) < 1e-9);
  assert.ok(blueprint.top.visible.length > 150, 'top view must include complete sampled inner/outer ring arcs');
  for (const id of ['cut-iii-left-radial-wall', 'cut-iii-right-radial-wall', 'cut-iv-left-radial-wall', 'cut-iv-right-radial-wall']) {
    const wall = byId(blueprint.top.visible, id);
    const innerDistance = Math.hypot(wall.a[0] - EXAMPLE56_DIMENSIONS.ring.x, wall.a[2]);
    const outerDistance = Math.hypot(wall.b[0] - EXAMPLE56_DIMENSIONS.ring.x, wall.b[2]);
    assert.ok(Math.abs(innerDistance - EXAMPLE56_DIMENSIONS.ring.inner) < 1e-9, `${id} must meet the inner circle`);
    assert.ok(Math.abs(outerDistance - EXAMPLE56_DIMENSIONS.ring.outer) < 1e-9, `${id} must meet the outer circle`);
    const innerArcs = blueprint.top.visible.filter(segment => segment.id.startsWith('ring-inner-arc'));
    const outerArcs = blueprint.top.visible.filter(segment => segment.id.startsWith('ring-outer-arc'));
    const hasEndpoint = (segments, point) => segments.some(segment => [segment.a, segment.b].some(endpoint => Math.hypot(endpoint[0] - point[0], endpoint[2] - point[2]) < 1e-9));
    assert.ok(hasEndpoint(innerArcs, wall.a), `${id} must join an inner-circle arc without a gap`);
    assert.ok(hasEndpoint(outerArcs, wall.b), `${id} must join an outer-circle arc without a gap`);
  }
  const iiiFloor = example56TextbookCutters['cut-iii'].y - 0.525;
  const ivArcBottom = example56TextbookCutters['cut-iv'].y - 0.35;
  assert.ok(ivArcBottom < iiiFloor, 'textbook IV arc bottom must be lower than the III flat floor');
});

test('example 5-6 adds each cutter to all affected views at the correct stage', () => {
  const cutterValues = example56TextbookCutters;
  const stages = [
    { applied: [], absent: ['cut-iii-floor', 'cut-iv-rounded-floor-hidden', 'base-slot-v-stop'] },
    { applied: ['cut-v'], present: [['front', 'visible', 'base-slot-v-stop'], ['top', 'hidden', 'base-slot-v-stop'], ['side', 'visible', 'base-slot-v-upper']], absent: ['cut-iii-floor', 'cut-iv-rounded-floor-hidden', 'base-slot-v-rear-edge'] },
    { applied: ['cut-v', 'cut-iii'], present: [['front', 'visible', 'cut-iii-floor'], ['top', 'visible', 'cut-iii-left-radial-wall'], ['side', 'visible', 'cut-iii-floor']], absent: ['cut-iv-rounded-floor-hidden'] },
    { applied: ['cut-v', 'cut-iii', 'cut-iv'], present: [['front', 'hidden', 'cut-iv-rounded-floor-hidden-0'], ['top', 'visible', 'cut-iv-left-radial-wall'], ['side', 'visible', 'cut-iv-floor']], absent: [] }
  ];

  for (const stage of stages) {
    const blueprint = createExample56ProjectionBlueprint({
      appliedCutters: stage.applied,
      cutterValues,
      slot: createExample56BaseSlot(cutterValues['cut-v'])
    });
    for (const view of ['front', 'top', 'side']) {
      assert.ok(byId(blueprint[view].visible, view === 'top' ? 'base-left-edge' : 'base-bottom'), `${view} outer profile disappeared at stage ${stage.applied.length}`);
    }
    for (const [view, style, id] of stage.present || []) {
      assert.ok(byId(blueprint[view][style], id), `${id} is missing at stage ${stage.applied.length}`);
    }
    for (const id of stage.absent || []) {
      const found = ['front', 'top', 'side'].some(view => byId(blueprint[view].visible, id) || byId(blueprint[view].hidden, id));
      assert.equal(found, false, `${id} appeared before its Boolean cut`);
    }
  }
});

test('example 5-6 V-slot dimensions stay aligned in all three views at parameter extremes', () => {
  for (const x of [-1.7, -1.05]) {
    for (const y of [0.38, 0.57]) {
      for (const height of [0.22, 0.5]) {
        const values = { x, y, height };
        const slot = createExample56BaseSlot(values);
        const blueprint = createExample56ProjectionBlueprint({
          appliedCutters: allExample56Cuts,
          cutterValues: {
            'cut-iii': example56TextbookCutters['cut-iii'],
            'cut-iv': example56TextbookCutters['cut-iv'],
            'cut-v': values
          },
          slot
        });
        const frontStop = byId(blueprint.front.visible, 'base-slot-v-stop');
        const topStop = byId(blueprint.top.hidden, 'base-slot-v-stop');
        const sideLower = byId(blueprint.side.visible, 'base-slot-v-lower');
        const sideUpper = byId(blueprint.side.visible, 'base-slot-v-upper');

        assert.equal(frontStop.a[0], slot.xMax);
        assert.equal(frontStop.b[0], slot.xMax);
        assert.equal(topStop.a[0], slot.xMax);
        assert.equal(topStop.b[0], slot.xMax);
        assert.deepEqual([topStop.a[2], topStop.b[2]], [slot.zMin, slot.zMax]);
        assert.equal(slot.zMin, -slot.zMax, 'V must pass symmetrically through the local base width');
        assert.equal(slot.derivedWidth, example56BaseHalfDepthAt(slot.xMax) * 2);
        assert.deepEqual([sideLower.a[2], sideLower.b[2]], [slot.zMin, slot.zMax]);
        assert.deepEqual([sideUpper.a[2], sideUpper.b[2]], [slot.zMin, slot.zMax]);
        assert.equal(sideLower.a[1], slot.yMin);
        assert.equal(sideUpper.a[1], slot.yMax);
        assert.ok(Math.abs((slot.yMax - slot.yMin) - height) < 1e-12);
        assert.ok(slot.toolXMin < EXAMPLE56_DIMENSIONS.base.xMin, 'the cutter must enter through the left end at every length setting');
        assert.ok(slot.zMin < slot.zMax);
      }
    }
  }
});
