// Which ground decals are resident right now, and how far each has faded in.
// Pure maths (no THREE, no DOM) so the streaming rules — the whole point of
// the decal system's performance story — are testable directly; render/decals.ts
// turns the result into meshes.

/** Footprint-relative view range, in yards. */
export const DECAL_RANGE_BASE = 70;
export const DECAL_RANGE_PER_YARD = 4.5;
export const DECAL_RANGE_MAX = 420;
/** Fraction of the range over which a decal fades in, so nothing pops. */
export const DECAL_FADE_BAND = 0.16;
/** How far past its range a decal must go before its mesh is thrown away. */
export const DECAL_DROP_MARGIN = 12;
/** Most decals meshed at once; past this the NEAREST win. */
export const DECAL_MAX_RESIDENT = 96;

/** The minimum a decal record needs for the streaming decision. */
export interface DecalPoint {
  x: number;
  z: number;
  size: number;
}

export interface DecalPick {
  index: number;
  /** Distance from the camera to the footprint's near EDGE (0 = standing on it). */
  dist: number;
  /** The range this decal was judged against (already clamped to the fog). */
  range: number;
  /** 0..1 fade-in factor across the outer band of that range. */
  fade: number;
}

/**
 * How far away a decal of this footprint stays visible: a floor plus a multiple
 * of its own size, so a boot print streams in only when you are close enough to
 * see it at all while a 60-yard summoning circle is there from across the
 * valley. Never past the fog — drawing what fog hides is pure waste.
 */
export function decalViewRange(size: number, fogFar: number): number {
  const own = Math.min(DECAL_RANGE_MAX, DECAL_RANGE_BASE + size * DECAL_RANGE_PER_YARD);
  return fogFar > 0 ? Math.min(own, fogFar) : own;
}

/** Camera distance to the near edge of a decal's footprint (0 inside it). */
export function decalEdgeDistance(d: DecalPoint, camX: number, camZ: number): number {
  return Math.max(0, Math.hypot(d.x - camX, d.z - camZ) - d.size * 0.5);
}

/**
 * The decals that should be resident, nearest first, at most `max` of them.
 *
 * Ranking by EDGE distance (not centre) is what makes standing inside a big
 * circle work: its centre may be 30 yards off, but the decal is under your
 * feet, so it must outrank a small mark further away. The budget then degrades
 * an over-stamped area by distance rather than by document order.
 */
export function pickResidentDecals(
  decals: readonly DecalPoint[],
  camX: number,
  camZ: number,
  fogFar: number,
  max: number = DECAL_MAX_RESIDENT,
): DecalPick[] {
  const out: DecalPick[] = [];
  for (let i = 0; i < decals.length; i++) {
    const d = decals[i];
    const range = decalViewRange(d.size, fogFar);
    const dist = decalEdgeDistance(d, camX, camZ);
    if (dist > range) continue;
    const band = range * DECAL_FADE_BAND;
    const fade = band <= 0 ? 1 : Math.min(1, Math.max(0, (range - dist) / band));
    out.push({ index: i, dist, range, fade });
  }
  out.sort((a, b) => a.dist - b.dist || a.index - b.index);
  if (out.length > max) out.length = max;
  return out;
}

/**
 * Should a decal that is no longer picked keep its mesh for now? True inside
 * the hysteresis margin, so a camera hovering on the range boundary does not
 * thrash build/dispose every frame. Over budget, nothing is kept: the budget is
 * the harder constraint.
 */
export function keepDroppedDecal(
  d: DecalPoint,
  camX: number,
  camZ: number,
  fogFar: number,
  liveCount: number,
  max: number = DECAL_MAX_RESIDENT,
): boolean {
  if (liveCount > max) return false;
  const range = decalViewRange(d.size, fogFar);
  return decalEdgeDistance(d, camX, camZ) < range + DECAL_DROP_MARGIN;
}
