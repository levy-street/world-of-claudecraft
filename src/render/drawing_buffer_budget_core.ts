// The drawing-buffer pixel budget: the ABSOLUTE bound on the WebGL drawing
// buffer (the scene canvas's backing store and the post targets sized off it),
// folded into the base pixel ratio beside the tier's relative DPR cap
// (gfx_aa_policy_core.ts). The cap alone binds only where the panel's DPR
// exceeds it (a Mac or phone case): a 1440p, ultrawide or 4K panel at DPR 1
// rasterized its full native area on every tier, and a 4K frame is four times
// a 1080p one before any post pass runs. With the budget the effective ratio is
// min(dpr, cap, sqrt(budget / css area)): a 1080p panel is untouched, a 4K
// panel on high allocates a 1440p-class buffer and the present path upscales
// the rest. The budget is in device pixels, so it also binds on a high-DPR
// panel whose capped buffer is still larger than the class (a Retina laptop on
// medium, a 5K iMac on any tier), not only at DPR 1. It bounds ONLY that
// buffer: the HUD, the nameplate canvas (its own 2D surface at the display
// DPR) and the pointer mapping are CSS-space and never see it.
//
// Fairness (docs/design/graphics-settings-fairness.md): the lever is sharpness.
// What follows the smaller buffer is exactly what already follows the Render
// Quality slider through renderPixelHeight: point-sprite VFX keep their
// CSS-space size, and the pixel-height-keyed scenery LOD (far-field grass
// density, scenery flame refresh; perceptual_lod_core.ts keeps gameplay
// visibility out of that key) reads the smaller extent. Nothing a player acts
// on changes size, position or timing. A perf A/B on a 1440p-plus panel must
// therefore read rendererFoliage, calls and triangles beside the frame time,
// so a fill-rate win is not confused with a scenery instance-count one.
//
// The user's Render Quality slider composes on top (renderer.ts
// applyResolution multiplies this ratio by the allocation scale): the budget
// bounds the allocation, the slider stays the player's choice below it.

/**
 * The budget never pushes the base ratio under this floor, whatever the panel:
 * text and the UI sprites sized off the ratio stay legible, and a 5K or 8K
 * panel simply runs over budget rather than turning to mush. The floor still
 * never exceeds the DPR itself (a page zoomed far out has a DPR under 0.5 and
 * keeps it, exactly as before the budget).
 */
export const MIN_DRAWING_BUFFER_RATIO = 0.5;

export interface DrawingBufferRatioInput {
  /** CSS viewport size the canvas covers. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /** The tier's relative cap (gfx_aa_policy_core.ts pixelRatioCap). */
  readonly pixelRatioCap: number;
  /** The tier's absolute budget in device pixels; Infinity (or 0) disables it. */
  readonly maxDrawingBufferPixels: number;
}

/** Which term settled the ratio: the DPR itself, the tier cap, the pixel budget,
 *  or the legibility floor (only ever reached under the budget). */
export type DrawingBufferBound = 'dpr' | 'cap' | 'budget' | 'floor';

export interface DrawingBufferRatio {
  /** Device pixels per CSS pixel before the Render Quality slider. */
  readonly ratio: number;
  readonly bound: DrawingBufferBound;
  /** True when the budget cut below what the DPR and the cap allowed, floored or not. */
  readonly budgetBound: boolean;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function drawingBufferRatio(input: DrawingBufferRatioInput): DrawingBufferRatio {
  const dpr = positive(input.devicePixelRatio, 1);
  const cap = positive(input.pixelRatioCap, dpr);
  const area = positive(input.cssWidth, 1) * positive(input.cssHeight, 1);
  const budget = input.maxDrawingBufferPixels;
  const budgetRatio =
    Number.isFinite(budget) && budget > 0 ? Math.sqrt(budget / area) : Number.POSITIVE_INFINITY;
  const capped = Math.min(dpr, cap);
  const budgetBound = budgetRatio < capped;
  const unfloored = Math.min(capped, budgetRatio);
  const ratio = Math.min(dpr, Math.max(MIN_DRAWING_BUFFER_RATIO, unfloored));
  // A DPR under the floor (a page zoomed far out) is its own bound, not the
  // floor's: the floor only ever raises a budget- or cap-cut ratio.
  const bound: DrawingBufferBound =
    ratio === dpr && dpr <= capped
      ? 'dpr'
      : ratio > unfloored
        ? 'floor'
        : budgetBound
          ? 'budget'
          : 'cap';
  return { ratio, bound, budgetBound };
}
