/**
 * Mechanical drawing display conventions, shared by WebGL and SVG previews.
 *
 * The paper-millimetre values describe the drawing, never the model's units.
 * A caller must supply its paper-to-screen and paper-to-projection mappings.
 * This is a display style, not a complete CAD/dimensioning certification.
 * Source: 现代机械制图 第3版, p6–8 (PDF13–15), GB/T 4457.4—2002.
 */
export const DRAWING_PAPER_STYLE = Object.freeze({
  color: '#000000',
  normalWidthMm: 0.5,
  boldWidthMm: 0.7,
  hiddenDashMm: Object.freeze([3, 1.5]),
  // Long stroke, gap, short dot-stroke, gap. The lengths below are a
  // consistent display choice; only the type and 2:1 weights are normative.
  centerDashMm: Object.freeze([8, 1.5, 0.35, 1.5]),
  centerExtensionMm: 3,
  previewPaperSpanMm: 160,
  previewWidthPx: 320
});

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
  return value;
}

export function createDrawingStyle({
  boldEdges = false,
  pixelsPerPaperMm = 96 / 25.4,
  drawingUnitsPerPaperMm = 1
} = {}) {
  positive(pixelsPerPaperMm, 'pixelsPerPaperMm');
  positive(drawingUnitsPerPaperMm, 'drawingUnitsPerPaperMm');
  const d = boldEdges ? DRAWING_PAPER_STYLE.boldWidthMm : DRAWING_PAPER_STYLE.normalWidthMm;
  const visibleWidth = d * pixelsPerPaperMm;
  return {
    color: DRAWING_PAPER_STYLE.color,
    visibleWidth,
    hiddenWidth: visibleWidth / 2,
    centerWidth: visibleWidth / 2,
    dimensionWidth: visibleWidth / 2,
    // Emphasis must be an independent teaching overlay, not a thicker hidden line.
    hiddenEmphasisWidth: visibleWidth / 2,
    hiddenDash: DRAWING_PAPER_STYLE.hiddenDashMm.map(value => value * drawingUnitsPerPaperMm),
    centerDash: DRAWING_PAPER_STYLE.centerDashMm.map(value => value * drawingUnitsPerPaperMm),
    hiddenDashPixels: DRAWING_PAPER_STYLE.hiddenDashMm.map(value => value * pixelsPerPaperMm),
    centerDashPixels: DRAWING_PAPER_STYLE.centerDashMm.map(value => value * pixelsPerPaperMm),
    centerExtension: DRAWING_PAPER_STYLE.centerExtensionMm * drawingUnitsPerPaperMm,
    paper: { visibleWidthMm: d, thinWidthMm: d / 2 }
  };
}

function pointCoordinates(point) {
  const result = Array.isArray(point) || ArrayBuffer.isView(point)
    ? Array.from(point).slice(0, 3) : [point?.x, point?.y, point?.z];
  if (result.length !== 3 || !result.every(Number.isFinite)) throw new TypeError('A centerline endpoint needs three finite coordinates');
  return result;
}

/**
 * Split independent 3D axis segments into real solid strokes (flat xyz pairs).
 * No Three.js dependency and no shader-dependent dash phase. Each axis is
 * symmetric about a long middle stroke and begins/ends with a long stroke.
 * We fit an even number of cycles, changing only long-stroke length; small
 * axes are a thin solid line, as permitted by the textbook. Input is unchanged.
 */
export function centerlineSegments(segments, { longDash, gap, dot } = {}) {
  positive(longDash, 'longDash');
  positive(gap, 'gap');
  positive(dot, 'dot');
  if (dot >= longDash) throw new RangeError('The centerline dot must be shorter than its long stroke');
  const positions = [];
  const nominalCycle = longDash + 2 * gap + dot;
  for (const pair of segments) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('A centerline must have two endpoints');
    const a = pointCoordinates(pair[0]), b = pointCoordinates(pair[1]);
    const delta = b.map((value, index) => value - a[index]);
    const length = Math.hypot(...delta);
    if (!Number.isFinite(length)) throw new RangeError('Centerline length must be finite');
    if (length <= Number.EPSILON) continue;
    const append = (start, end) => {
      if (end <= start) return;
      positions.push(...a.map((value, index) => value + delta[index] * start / length));
      positions.push(...a.map((value, index) => value + delta[index] * end / length));
    };
    if (length < 2 * nominalCycle) {
      append(0, length);
      continue;
    }
    let cycles = 2 * Math.max(1, Math.round(length / (2 * nominalCycle)));
    while (cycles > 2 && length / cycles - 2 * gap - dot <= dot) cycles -= 2;
    const cycle = length / cycles;
    const fittedLong = cycle - 2 * gap - dot;
    // Starting/ending at the centre of a long stroke also makes the middle
    // long when there are an even number of cycles, preserving crosshair joins.
    for (let index = 0; index <= cycles; index++) {
      const center = index * cycle;
      append(Math.max(0, center - fittedLong / 2), Math.min(length, center + fittedLong / 2));
      if (index < cycles) {
        const dotCenter = center + cycle / 2;
        append(dotCenter - dot / 2, dotCenter + dot / 2);
      }
    }
  }
  return positions;
}

const NUMBER = '(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)';
const STRAIGHT_PATH = new RegExp(`^\\s*M\\s*${NUMBER}[\\s,]+${NUMBER}\\s*L\\s*${NUMBER}[\\s,]+${NUMBER}\\s*$`);

/** Split the straight M…L centre axes emitted by our exact kernel. */
export function centerlineSvgPath(path, pattern) {
  const match = typeof path === 'string' && STRAIGHT_PATH.exec(path);
  if (!match) return null; // Other SVG commands need their own path parser.
  const [, x1, y1, x2, y2] = match.map(Number);
  const positions = centerlineSegments([[[x1, y1, 0], [x2, y2, 0]]], pattern);
  const paths = [];
  for (let index = 0; index < positions.length; index += 6) {
    paths.push(`M ${positions[index]} ${positions[index + 1]} L ${positions[index + 3]} ${positions[index + 4]}`);
  }
  return paths.join(' ');
}
