const VIEW_AXES = Object.freeze({ front: [0, 1], top: [0, 2], side: [2, 1] });

/** Fit all orthographic cards with one world-units-per-CSS-pixel value. */
export function computeTiledProjectionLayout(bounds, cardSizes, options = {}) {
  const min = bounds?.min;
  const max = bounds?.max;
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3) return null;
  if (![...min, ...max].every(Number.isFinite)) return null;
  const size = max.map((value, index) => value - min[index]);
  if (size.some(value => value < 0)) return null;
  const center = min.map((value, index) => (value + max[index]) / 2);
  const fillRatio = Math.min(1, Math.max(0.1, options.fillRatio ?? 0.86));
  let unitsPerPixel = 0;
  let largestCard = 1;
  for (const [view, [horizontalAxis, verticalAxis]] of Object.entries(VIEW_AXES)) {
    const card = cardSizes?.[view];
    if (!(card?.width > 0) || !(card?.height > 0)) return null;
    if (!Number.isFinite(card.width) || !Number.isFinite(card.height)) return null;
    unitsPerPixel = Math.max(unitsPerPixel,
      size[horizontalAxis] / (card.width * fillRatio),
      size[verticalAxis] / (card.height * fillRatio));
    largestCard = Math.max(largestCard, card.width, card.height);
  }
  unitsPerPixel ||= 1 / largestCard;
  const pixelRatio = Math.min(Math.max(1, options.pixelRatio || 1), (options.maxTargetSize || 2048) / largestCard);
  const frames = Object.fromEntries(Object.keys(VIEW_AXES).map(view => {
    const { width, height } = cardSizes[view];
    return [view, {
      halfWidth: width * unitsPerPixel / 2,
      halfHeight: height * unitsPerPixel / 2,
      renderWidth: Math.max(1, Math.round(width * pixelRatio)),
      renderHeight: Math.max(1, Math.round(height * pixelRatio))
    }];
  }));
  return { center, unitsPerPixel, pixelRatio, frames };
}
