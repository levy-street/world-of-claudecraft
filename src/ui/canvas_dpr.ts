// Device-pixel sizing for the HUD's Canvas-2D surfaces.
//
// The HUD's canvases shipped with their backing store equal to their CSS box
// (a 162px minimap, a 560px map window), which means every one of them was
// composited through a 2x upscale on a retina or fractionally-scaled display —
// a blur applied to the terrain image, the marker dots, the facing arrow and
// the disc edge alike, on top of whatever softness the source image already
// had. These two helpers give a canvas a real device-pixel backing store; which
// one to use depends on whether the painter's coordinates are hard-coded (the
// minimap's named constants) or derived from the canvas size (the map window's
// `const S = canvas.width`).

/** Backing-store scale to use. Capped: past 3x the extra pixels stop being
 *  visible and start being fill cost on a canvas that redraws ~10x a second. */
export function canvasDpr(): number {
  return Math.min(3, Math.max(1, window.devicePixelRatio || 1));
}

/**
 * Scale the backing store and bake the ratio into the context transform, so
 * every drawing coordinate keeps meaning CSS pixels.
 *
 * The transform (rather than simply letting a painter lay itself out at the
 * bigger size) is what keeps this a pure sharpening: both HUD map painters
 * write their fonts, dot radii and line widths as fixed pixel constants, so a
 * raw backing-store bump would leave every label and marker at half its
 * apparent size against a map that had grown. It also means the painters need
 * no changes at all — and the delve / maze / abyss painters that share the
 * minimap's context inherit it, since the transform persists on the context.
 *
 * `pinCssSize` writes the CSS box inline as well, for a canvas whose display
 * size comes from its intrinsic width (the minimap). Leave it off when a
 * stylesheet owns the size: the map window authors its display size in CSS
 * precisely so it can be overridden (`width: 100%` on mobile, and the frame
 * zoom-scales with `--ui-scale`), and an inline length would outrank all of it.
 *
 * Returns true when it actually resized: the first call, or later when the
 * ratio changed under us because the window moved to another display or the
 * browser zoom stepped.
 */
export function applyCanvasDpr(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  logicalSize: number,
  pinCssSize = false,
): boolean {
  const dpr = canvasDpr();
  const target = Math.round(logicalSize * dpr);
  if (canvas.width === target && canvas.height === target) return false;
  canvas.width = target;
  canvas.height = target;
  if (pinCssSize) {
    canvas.style.width = `${logicalSize}px`;
    canvas.style.height = `${logicalSize}px`;
  }
  // Resizing a canvas resets its context, so the transform is (re)applied here
  // and nowhere else.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}
