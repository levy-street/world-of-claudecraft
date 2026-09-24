// Emberforge's FORGE HAMMER, the pure half: every tunable, one strike's clock,
// and the ring of fire it throws (where it is, where its gaps are, whom it
// burns). No rng, no DOM: the renderer imports this file, so the ring on screen
// is the ring that burns and the gaps drawn are the gaps that are safe.
//
// A cast is a carrier cue (the beat clock) plus one cue per STRIKE, made when
// that strike's shadow appears, at a player's feet. A strike is one clock:
//
//   0 ............ impactAt ........................... endAt
//   the shadow,    the hammer lands    the ring spreads from it
//   the fall       (crush + knock)     (step through a gap)
//
// A strike cue's life is always warning + ring, so every beat is recovered from
// the cue alone and the wire carries nothing new. The gaps come from its id.

export const FORGE_HAMMER_CUE_VARIANTS = ['ember-hammer', 'ember-hammer-strike'] as const;
export function isForgeHammerVariant(variant: string | undefined): boolean {
  return (FORGE_HAMMER_CUE_VARIANTS as readonly string[]).includes(variant ?? '');
}

export const FORGE_HAMMER = Object.freeze({
  // ---- the cast
  /** HAMMER_STRIKE_COUNT at the baseline rarity with a small party; the hoard's
   *  hazard bonus adds to it, and so does a further strike for every this many
   *  players past the first (PLAYER_COUNT_SCALING). */
  strikes: 3,
  playersPerExtraStrike: 3,
  minStrikes: 2,
  maxStrikes: 6,
  /** STRIKE_INTERVAL: seconds from one hammer's shadow to ITS next. With two
   *  hammers they ALTERNATE, so a shadow appears every half of this. */
  beatSec: 2.8,
  /** A strike never lands this close to the one before it: two rings never start
   *  from one spot, and a hammer never falls into the door a player just used. */
  minStrikeSpacing: 9,
  // ---- one strike
  /** Shadow on the floor before the hammer lands. */
  warningSec: 1.5,
  /** The tail of the warning in which the hammer is in view, falling. */
  fallSec: 0.55,
  /** How far off its target's feet a strike may land, in yards. */
  scatter: 1.5,
  impactRadius: 4.5,
  impactDamageFraction: 0.34,
  impactKnockback: 6,
  // ---- the ring it throws (RING_START_RADIUS is ringSafeRadius, below)
  /** RING_SPEED: under a player's run, so a door is always reachable on foot. */
  ringSpeed: 6.2,
  ringMaxRadius: 27,
  /** The burning band's whole width, in yards. The drawn band is built to it. */
  ringThickness: 1.5,
  ringDamageFraction: 0.2,
  /** GAP_COUNT doors, each GAP_ANGLE_SIZE / 2 radians to either side of its
   *  middle: from anywhere on the ring's path a walking player can reach one
   *  before it arrives (pinned by tests/hoard_forge_hammer.test.ts). */
  gapHalfAngle: 0.55,
  gaps: 2,
  /** Inside this radius the ring is still forming under the hammer: the impact
   *  already judged whoever stands there, so the ring does not hit them twice. */
  ringSafeRadius: 5.2,
});

/** How long the ring takes to reach its full spread and go out. */
export const FORGE_RING_LIFE_SEC = FORGE_HAMMER.ringMaxRadius / FORGE_HAMMER.ringSpeed;

/** One strike's whole life: its warning, then its ring. */
export const FORGE_STRIKE_TOTAL_SEC = FORGE_HAMMER.warningSec + FORGE_RING_LIFE_SEC;

/** How many strikes EACH hammer makes: more for a rarer hoard and, slowly, for a
 *  bigger party. Never the damage: the dance gets longer, not deadlier. */
export function forgeStrikeCount(rarityExtra = 0, living = 1): number {
  const byParty = Math.floor(Math.max(0, living - 1) / FORGE_HAMMER.playersPerExtraStrike);
  return Math.max(
    FORGE_HAMMER.minStrikes,
    Math.min(FORGE_HAMMER.maxStrikes, FORGE_HAMMER.strikes + rarityExtra + byParty),
  );
}

/** Seconds between shadows: two hammers alternate, so they halve it. */
export function forgeBeatSec(hammers: number): number {
  return FORGE_HAMMER.beatSec / Math.max(1, hammers);
}

/** The carrier's life: every shadow (each hammer's strikes), then the last
 *  strike played out. */
export function forgeCastTotalSec(strikes: number, hammers = 1): number {
  return Math.max(0, strikes * hammers - 1) * forgeBeatSec(hammers) + FORGE_STRIKE_TOTAL_SEC;
}

function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Where a strike lands relative to its target's feet: a seeded nudge, so it is
 *  never a guaranteed dead-centre hit and never the same twice. */
export function forgeStrikeScatter(
  seed: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const angle = hash01(seed * 7 + 1) * Math.PI * 2;
  const reach = FORGE_HAMMER.scatter * Math.sqrt(hash01(seed * 13 + 5));
  out.x = Math.sin(angle) * reach;
  out.z = Math.cos(angle) * reach;
  return out;
}

/** The ring's radius `sinceImpact` seconds after the hammer lands. */
export function forgeRingRadius(sinceImpact: number): number {
  return Math.max(0, Math.min(FORGE_HAMMER.ringMaxRadius, sinceImpact * FORGE_HAMMER.ringSpeed));
}

/** The middle of gap `index` of the ring thrown by strike `cueId`, in radians
 *  (0 faces +z): seeded, and spread so the gaps are never side by side. */
export function forgeGapAngle(cueId: number, index: number): number {
  const first = hash01(cueId * 31 + 3) * Math.PI * 2;
  const step = (Math.PI * 2) / FORGE_HAMMER.gaps;
  return first + step * index + (hash01(cueId * 17 + index * 5) - 0.5) * step * 0.35;
}

/** Whether a bearing from the impact lies inside one of the ring's gaps. */
export function forgeBearingInGap(cueId: number, bearing: number): boolean {
  for (let gap = 0; gap < FORGE_HAMMER.gaps; gap++) {
    let off = bearing - forgeGapAngle(cueId, gap);
    off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
    if (Math.abs(off) <= FORGE_HAMMER.gapHalfAngle) return true;
  }
  return false;
}

/** Whether the ring burns a point THIS tick. The band is swept from where it
 *  was a tick ago to where it is now, so a thin band can never step over a
 *  player between ticks; a gap, and the ground under the hammer, are safe. */
export function forgeRingBurns(
  cueId: number,
  impactX: number,
  impactZ: number,
  radiusBefore: number,
  radiusNow: number,
  pointX: number,
  pointZ: number,
): boolean {
  const dx = pointX - impactX;
  const dz = pointZ - impactZ;
  const distance = Math.hypot(dx, dz);
  if (distance < FORGE_HAMMER.ringSafeRadius) return false;
  const half = FORGE_HAMMER.ringThickness / 2;
  if (distance < radiusBefore - half || distance > radiusNow + half) return false;
  // Spent: it has reached its full spread and gone out.
  if (radiusBefore >= FORGE_HAMMER.ringMaxRadius) return false;
  return !forgeBearingInGap(cueId, Math.atan2(dx, dz));
}
