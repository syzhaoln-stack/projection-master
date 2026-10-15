# Bridge Engineering Spatial Lab

This branch adapts Projection Master's spatial-reasoning engine to bridge engineering drawing. It reuses projection, view matching, composite-solid decomposition, and assessment mechanics; it does not simply rename mechanical parts.

## Coordinate and representation contract

- `x`: bridge longitudinal direction
- `y`: transverse direction
- `z`: vertical direction
- Every exercise must connect a 3D state to at least one engineering drawing state: plan, elevation, transverse section, longitudinal section, or detail.
- Every assessed object exposes semantic parts rather than a single opaque mesh.

Suggested model contract:

```js
{
  id,
  family,
  parameters,
  semanticParts,
  sectionStations,
  projectionPoints,
  drawingViews,
  comparisonMetrics
}
```

## First component library

1. Reinforced/prestressed-concrete single-cell and multi-cell box girders: top slab, bottom slab, webs, diaphragms, ducts, and anchor zones.
2. T and I girders: flange, web, end block, diaphragm, bearing centerline, and reinforcement zones.
3. Hollow slabs: outer solid, longitudinal voids, minimum webs, and end solid zones.
4. Steel plate and box girders: flanges, webs, stiffeners, cross frames, splice plates, bolts, weld lines, and bearings.

## Learning sequence

1. **View alignment** — rotate a member without a standard-view shortcut until the requested axis collapses: `z` for plan, `y` for elevation, or `x` for transverse section. One pass is not mastery; repeat on a different bridge family or a different target view.
2. **Point projection** — project named corners, web breakpoints, bearing centers, and tendon control points between views.
3. **Section choice** — choose where to cut at midspan, support, diaphragm, splice, or anchor zone, then predict the resulting outline.
4. **Semantic decomposition** — split a girder into structural parts and rebuild it in the correct spatial relationship.
5. **Parameter reconstruction** — match a target width, depth, web slope, slab thickness, void pattern, or girder spacing from a hidden dimension set.
6. **Engineering interpretation** — compare area, self-weight, gross-section inertia, section modulus, and `I/A`, while explicitly separating these teaching indicators from code-level capacity checks.

## Assessment evidence

Retain the initial answer, action path, final error, elapsed time, and transfer result on a new component. Score geometry and reasoning separately. A visually correct model should not receive full engineering credit when the section position or explanation is wrong.

Each later step keeps a compact visual-memory panel from the previous step in the right-hand task card. It shows the bridge axes, the observation axis that must collapse, and the plane that remains. This support is available while the learner acts; the assessment tests whether the learner can use the principle, not whether they can first recite it from memory.

## Current prototype

The first working prototype is embedded in the companion Quarto textbook as `bridge-section-spatial-lab.html`. It covers four gross sections (solid rectangle, single-cell box, T girder, and hollow slab), interactive cutting/splitting, plan/elevation/transverse-section alignment, target-outline reconstruction, and elastic geometric comparisons. Projection Master's assessment bank on this branch now adds three bridge view-alignment transfer tasks and removes standard-view shortcuts while those tasks are active. The next implementation step is point projection and station-dependent sections.
