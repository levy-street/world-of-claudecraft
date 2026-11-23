// Pure geometry for the ranged-punish kit (mob/boss_ranged_mechanics.ts): who counts as
// "far", which far players a boulder picks, and the shape of the glare's line.
//
// Split out so both halves of the mechanic read the same numbers: the sim decides damage
// with these functions and the renderer draws the same rectangle from the same event
// fields. No SimContext, no rng, no clock; a Vitest drives it directly.

/** The Barrow Burden soak mark (mob/boss_ranged_mechanics.ts), readable by any layer. */
export const BURDEN_AURA_ID = 'balgath_barrow_burden';

export interface RangedCandidate {
  id: number;
  dead: boolean;
  pos: { x: number; z: number };
}

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Living candidates standing at least `minRange` and at most `maxRange` from `from`,
 * FARTHEST first, ties broken by entity id so the order never depends on map iteration.
 */
export function farCandidates<T extends RangedCandidate>(
  candidates: Iterable<T>,
  from: { x: number; z: number },
  minRange: number,
  maxRange: number,
): T[] {
  const out: { c: T; d: number }[] = [];
  for (const c of candidates) {
    if (c.dead) continue;
    const d = dist2d(c.pos, from);
    if (d < minRange || d > maxRange) continue;
    out.push({ c, d });
  }
  out.sort((a, b) => b.d - a.d || a.c.id - b.c.id);
  return out.map((row) => row.c);
}

/** The `count` farthest of `farCandidates`: the boulder's victims. */
export function farthestCandidates<T extends RangedCandidate>(
  candidates: Iterable<T>,
  from: { x: number; z: number },
  minRange: number,
  maxRange: number,
  count: number,
): T[] {
  return farCandidates(candidates, from, minRange, maxRange).slice(0, Math.max(0, count));
}

/** How long the glare's line runs for a target `targetDist` away. */
export function glareLineLength(
  targetDist: number,
  overshoot: number,
  minLength: number,
  maxLength: number,
): number {
  return Math.min(maxLength, Math.max(minLength, targetDist + overshoot));
}

export interface GlareLine {
  originX: number;
  originZ: number;
  /** Unit direction. */
  dirX: number;
  dirZ: number;
  length: number;
  halfWidth: number;
}

/**
 * Where a point sits against the line: `along` is the distance down the line from its
 * origin, `across` the perpendicular distance off its centre.
 */
export function glareLocal(
  line: GlareLine,
  x: number,
  z: number,
): { along: number; across: number } {
  const dx = x - line.originX;
  const dz = z - line.originZ;
  const along = dx * line.dirX + dz * line.dirZ;
  const across = Math.abs(dx * line.dirZ - dz * line.dirX);
  return { along, across };
}

/**
 * Whether a point is inside the line's rectangle, cut short at `reach` (the distance the
 * beam travelled before something solid stopped it). The rectangle starts at the origin:
 * standing behind him is never inside it.
 */
export function insideGlare(line: GlareLine, x: number, z: number, reach = line.length): boolean {
  const { along, across } = glareLocal(line, x, z);
  return along >= 0 && along <= Math.min(reach, line.length) && across <= line.halfWidth;
}
