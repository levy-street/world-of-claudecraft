// ---------------------------------------------------------------------------
// Unit-frame portrait core (pure: no DOM, no three.js)
//
// Geometry + crest-id resolution for the circular portrait shared by the player
// frame and the target frame. Kept DOM-free so it is unit-tested directly; the
// canvas painting that consumes it lives in unit_portrait_painter.ts.
//
// Two long-standing rough edges are addressed by this math:
//   * Crisp on HiDPI: the canvas backing store is scaled by devicePixelRatio
//     ({@link portraitBackingPx}) instead of being a fixed 54px bitmap the
//     browser then upscales.
//   * The art fills the disc: square crests carry a baked bevel + vignette that
//     read as a dark ring at the circular rim, so they are drawn slightly
//     overscanned ({@link overscanRect}) to push that rim outside the clip.
// ---------------------------------------------------------------------------

/** Logical (CSS) px size of a unit-frame portrait canvas: the `.portrait`
 *  content box in index.html (60px box minus the 3px border on each side). */
export const PORTRAIT_CSS_SIZE = 54;

/** Crest overscan: how much larger than the canvas a crest is drawn so its
 *  baked square bevel/vignette lands outside the circular clip. ~9% past the
 *  rim on each side hides the dark ring without visibly cropping the emblem.
 *  Headshots already frame head+shoulders with intentional headroom, so they
 *  draw 1:1; overscanning them would crop the face. */
export const CREST_OVERSCAN = 1.18;

/** Upper bound on the device-pixel scale we honour. Beyond ~3x the extra
 *  resolution is imperceptible and just costs canvas memory. */
export const MAX_PORTRAIT_DPR = 3;

/** Backing-store px for a portrait canvas at a given CSS size and device pixel
 *  ratio, clamped to [1, {@link MAX_PORTRAIT_DPR}]x and rounded to whole px. */
export function portraitBackingPx(cssSize: number, dpr: number): number {
  const scale = Math.min(MAX_PORTRAIT_DPR, Math.max(1, Number.isFinite(dpr) && dpr > 0 ? dpr : 1));
  return Math.max(1, Math.round(cssSize * scale));
}

export interface DrawRect { dx: number; dy: number; dw: number; dh: number; }

/** Centred draw rectangle for blitting a `size`x`size` image at `overscan`
 *  scale into a `size`x`size` canvas (negative offsets when overscan > 1). */
export function overscanRect(size: number, overscan: number): DrawRect {
  const dw = size * overscan;
  const off = (size - dw) / 2;
  return { dx: off, dy: off, dw, dh: dw };
}

/** Crest icon id for a non-player target: NPCs get the status emblem, mobs get
 *  their creature-family crest (humanoid when the family is unknown). */
export function crestIdForEntity(kind: string, family: string | undefined): string {
  if (kind === 'npc') return 'status_npc';
  return `family_${family ?? 'humanoid'}`;
}
