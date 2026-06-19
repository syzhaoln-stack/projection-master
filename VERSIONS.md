# Projection Master Version Plan

## Current Stable Baseline

`Projection-master/`

- Git branch: `main`
- Snapshot tag: `snapshot-2026-06-19-current`
- Strengths:
  - Minimal runnable package: `index.html`, `projection-master.js`, local start script.
  - Built-in engineering drawing objects.
  - OBJ import.
  - First-angle projection unfold/merge.

## Source Versions To Consolidate

### v2

Files:

- `../projection-master-v2.html`
- `../projection-master-v2.js`

Strengths to preserve:

- Stronger hidden-line and depth-buffer logic.
- OBJ/STL import support.
- More explicit comments on first-angle projection plane unfolding.
- Better technical basis for projection accuracy.

Recommended merge target:

- Geometry/projection engine.
- Import pipeline.

### v3-codex

Files:

- `../projection-master-v3codex_.html`
- `../projection-master-v3codex_.js`
- `../spatial-intelligence-v3codex_.md`

Strengths to preserve:

- Spatial intelligence task ideas.
- Question modes: orthographic translation, mental rotation, hidden-line judgment, section/unfolding, assembly relation.
- Useful bridge between teaching demo and assessment tool.

Recommended merge target:

- Future quiz/assessment module.
- Documentation for learning design.

### v4

Files:

- `../projection-master-v4.html`
- `../projection-master-v4.js`
- `../ProjectionMasterV4/`

Strengths to preserve:

- Best mobile adaptation.
- Top navigation and mobile drawer.
- OBJ/STL import UI.
- More polished visual style.
- Quiz overlay scaffold.

Recommended merge target:

- Responsive layout.
- Mobile interaction model.
- Later UI redesign after core projection logic stabilizes.

## Branching Strategy

- `main`: stable classroom demo.
- `merge/version-consolidation-mobile-core`: current consolidation experiment.
- Future branches:
  - `feature/stl-import`
  - `feature/hidden-line-engine`
  - `feature/mobile-layout-v4`
  - `feature/spatial-quiz`

## Merge Priority

1. Preserve current stable package and Git history.
2. Add mobile core unfold/merge button.
3. Bring in v2 hidden-line/import improvements.
4. Bring in v4 responsive shell.
5. Build v3-inspired spatial intelligence quiz as a separate module.
