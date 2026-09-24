// Hoarfrost's ICE AGE, the pure half: every tunable, the one timeline both the
// authoritative sim and the renderer sample, where the pillars land, and the
// cover test. No rng, no DOM: the renderer imports this file so the lee it
// paints on the floor IS the lee the sim checks.
//
// The whole mechanic is one clock. A carrier cue and one cue per pillar are cast
// together with the SAME life, and everything is a fixed offset into it:
//
//   0 ........ impactAt ........ castAt ........ blastAt ... breakAt ... endAt
//   shadows    icicles land      Ice Age cast    the storm   pillars    gone
//                                                            shatter
//
// The hoard's rarity shortens only the cast, and that rides in the cue's life,
// so the wire carries nothing new.

export const ICE_AGE_CUE_VARIANTS = ['frost-iceage', 'frost-pillar'] as const;
export function isIceAgeVariant(variant: string | undefined): boolean {
  return (ICE_AGE_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

export const ICE_AGE = Object.freeze({
  // ---- how many pillars (shared cover, never one each)
  /** PILLAR_COUNT: what a small party gets. */
  pillarCount: 2,
  /** GROUP_SCALING_ENABLED: off pins the count at `pillarCount`. */
  groupScalingEnabled: true,
  /** PLAYER_COUNT_PER_PILLAR: a further pillar for each this many past the first group. */
  playersPerPillar: 4,
  minPillars: 1,
  maxPillars: 3,
  // ---- a pillar
  /** PILLAR_SCALE: the footprint radius in yards; the model is built to it. */
  pillarRadius: 2.6,
  /** PILLAR_SPAWN_WARNING: shadow on the floor before the icicle lands. */
  pillarWarningSec: 1.4,
  /** PILLAR_FALL_DURATION: the tail of the warning in which the icicle is in view. */
  pillarFallSec: 0.5,
  impactRadius: 4.2,
  impactDamageFraction: 0.3,
  impactKnockback: 5,
  // ---- where they land
  /** PILLAR_MIN_DISTANCE_FROM_BOSS. */
  pillarMinBossDistance: 11,
  pillarMaxBossDistance: 24,
  /** PILLAR_MIN_SEPARATION: far enough apart that a group has to choose. */
  pillarMinSeparation: 13,
  wallMargin: 5,
  // ---- the cast
  /** The beat between the icicles landing and the cast beginning. */
  settleSec: 1.3,
  /** ICE_AGE_CAST_TIME at the baseline rarity; a rarer hoard casts faster. */
  castSec: 4.5,
  minCastSec: 3.5,
  // ---- cover
  /** COVER_WIDTH_MULTIPLIER on the pillar's radius: the lee is a little kinder
   *  than the model so latency never kills someone who looked safe. */
  coverWidthMultiplier: 1.15,
  /** COVER_DISTANCE: how far behind the pillar its lee still holds. */
  coverDistance: 10,
  /** The lee widens away from the storm like a real shadow, up to this factor. */
  coverMaxSpread: 1.5,
  /** LETHAL_DAMAGE, as a multiple of the victim's maximum health. */
  lethalHealthMultiplier: 10,
  // ---- the aftermath
  /** PILLAR_BREAK_DELAY after the storm lands, then the break-up itself. */
  pillarBreakDelaySec: 0.35,
  pillarShatterSec: 1.5,
  /** BLIZZARD_DURATION: the storm's visible sweep. */
  blizzardSec: 1.8,
  /** How far the storm is drawn from the boss: past any hoard room. */
  stormReach: 70,
});

const TAIL_SEC = Math.max(
  ICE_AGE.blizzardSec,
  ICE_AGE.pillarBreakDelaySec + ICE_AGE.pillarShatterSec,
);

/** The whole sequence's life for a hoard whose rarity runs hazards at `speed`. */
export function iceAgeTotalSec(speed = 1): number {
  const cast = Math.max(ICE_AGE.minCastSec, ICE_AGE.castSec / Math.max(0.1, speed));
  return ICE_AGE.pillarWarningSec + ICE_AGE.settleSec + cast + TAIL_SEC;
}

export interface IceAgeTimeline {
  impactAt: number;
  castAt: number;
  castSec: number;
  blastAt: number;
  breakAt: number;
  endAt: number;
}

/** Every beat, recovered from a cue's life alone. */
export function iceAgeTimeline(total: number, out?: IceAgeTimeline): IceAgeTimeline {
  const line = out ?? { impactAt: 0, castAt: 0, castSec: 0, blastAt: 0, breakAt: 0, endAt: 0 };
  line.impactAt = ICE_AGE.pillarWarningSec;
  line.castAt = line.impactAt + ICE_AGE.settleSec;
  line.blastAt = Math.max(line.castAt, total - TAIL_SEC);
  line.castSec = line.blastAt - line.castAt;
  line.breakAt = line.blastAt + ICE_AGE.pillarBreakDelaySec;
  line.endAt = total;
  return line;
}

const PHASE_SCRATCH: IceAgeTimeline = {
  impactAt: 0,
  castAt: 0,
  castSec: 0,
  blastAt: 0,
  breakAt: 0,
  endAt: 0,
};

export type IceAgePhase = 'warning' | 'standing' | 'casting' | 'storm';
export function iceAgePhase(elapsed: number, total: number): IceAgePhase {
  const line = iceAgeTimeline(total, PHASE_SCRATCH);
  if (elapsed < line.impactAt) return 'warning';
  if (elapsed < line.castAt) return 'standing';
  if (elapsed < line.blastAt) return 'casting';
  return 'storm';
}

/** How many pillars fall. Sub-linear on purpose: a bigger group SHARES cover.
 *  `rarityExtra` is the hoard's hazard bonus (hoard_scaling.ts); for cover it
 *  cuts the other way, so a rarer hoard offers one pillar fewer. A common hoard
 *  gets nothing back: two pillars is already the kindest the mechanic is. */
export function icePillarCount(living: number, rarityExtra = 0): number {
  const heads = Math.max(1, Math.floor(living));
  const byGroup = ICE_AGE.groupScalingEnabled
    ? ICE_AGE.pillarCount + Math.ceil(heads / ICE_AGE.playersPerPillar) - 1
    : ICE_AGE.pillarCount;
  const count = byGroup - Math.max(0, rarityExtra);
  return Math.max(ICE_AGE.minPillars, Math.min(ICE_AGE.maxPillars, count));
}

/** The shape variant a pillar wears, from its cue id. */
export const ICE_PILLAR_VARIANTS = 3;
export function icePillarVariantOf(cueId: number): number {
  return Math.abs(Math.floor(cueId)) % ICE_PILLAR_VARIANTS;
}

function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Where the icicles land, in the boss's frame (`x` lateral, `f` forward into the
 *  room): fanned across the width so each guards a different bearing, staggered
 *  in depth, clear of the boss and the walls, and apart from one another. */
export function icePillarOffsets(
  count: number,
  seed: number,
  halfWidth: number,
  clearDepth: number,
): Array<{ x: number; f: number }> {
  const maxX = Math.max(0, halfWidth - ICE_AGE.wallMargin);
  const near = ICE_AGE.pillarMinBossDistance;
  const far = Math.max(
    near,
    Math.min(ICE_AGE.pillarMaxBossDistance, clearDepth - ICE_AGE.wallMargin),
  );
  const out: Array<{ x: number; f: number }> = [];
  for (let index = 0; index < count; index++) {
    const lane = count === 1 ? 0 : -1 + (2 * (index + 0.5)) / count;
    const jitter = (hash01(seed * 13 + index) - 0.5) * (count === 1 ? 1.2 : 0.5 / count);
    const depth = (index % 2 === 0 ? 0.1 : 0.55) + 0.4 * hash01(seed * 29 + index * 5);
    out.push({
      x: Math.max(-maxX, Math.min(maxX, (lane * 0.75 + jitter) * maxX)),
      f: near + (far - near) * depth,
    });
  }
  // Spread any pair that crowds: along the width first, the depth after.
  const gap = ICE_AGE.pillarMinSeparation;
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[j].x - out[i].x;
        const df = out[j].f - out[i].f;
        const d = Math.hypot(dx, df);
        if (d >= gap) continue;
        const push = (gap - d) / 2 + 0.01;
        const sign = dx >= 0 ? 1 : -1;
        out[i].x = Math.max(-maxX, Math.min(maxX, out[i].x - sign * push));
        out[j].x = Math.max(-maxX, Math.min(maxX, out[j].x + sign * push));
        const fSign = df >= 0 ? 1 : -1;
        out[i].f = Math.max(near, Math.min(far, out[i].f - fSign * push * 0.5));
        out[j].f = Math.max(near, Math.min(far, out[j].f + fSign * push * 0.5));
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

/** Half the lee's width `along` yards from the storm's origin, behind a pillar
 *  standing `pillarDistance` from it: the pillar's shadow from a point source,
 *  widening away from it, capped so it never grows into a wall of safety. */
export function iceCoverHalfWidth(along: number, pillarDistance: number): number {
  const base = ICE_AGE.pillarRadius * ICE_AGE.coverWidthMultiplier;
  const spread = Math.min(ICE_AGE.coverMaxSpread, along / Math.max(1e-6, pillarDistance));
  return base * Math.max(1, spread);
}

/** THE cover test. The storm blows outward from `origin`; a pillar shelters a
 *  point only if it stands BETWEEN them: the point is past the pillar along the
 *  origin's bearing to it, within the lee's reach, and inside the pillar's
 *  shadow across that bearing. Near a pillar but beside it, or in front of it,
 *  is not cover. */
export function icePillarCovers(
  originX: number,
  originZ: number,
  pillarX: number,
  pillarZ: number,
  pointX: number,
  pointZ: number,
): boolean {
  const dx = pillarX - originX;
  const dz = pillarZ - originZ;
  const pillarDistance = Math.hypot(dx, dz);
  if (pillarDistance < 1e-6) return false;
  const ux = dx / pillarDistance;
  const uz = dz / pillarDistance;
  const px = pointX - originX;
  const pz = pointZ - originZ;
  const along = px * ux + pz * uz;
  const behind = along - pillarDistance;
  if (behind < 0 || behind > ICE_AGE.coverDistance + ICE_AGE.pillarRadius) return false;
  const across = Math.abs(px * uz - pz * ux);
  return across <= iceCoverHalfWidth(along, pillarDistance);
}

/** Whether ANY of `pillars` shelters the point. */
export function iceAgeSheltered(
  originX: number,
  originZ: number,
  pillars: ReadonlyArray<{ x: number; z: number }>,
  pointX: number,
  pointZ: number,
): boolean {
  for (let i = 0; i < pillars.length; i++) {
    if (icePillarCovers(originX, originZ, pillars[i].x, pillars[i].z, pointX, pointZ)) return true;
  }
  return false;
}
