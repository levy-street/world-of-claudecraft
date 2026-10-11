// The Voracious Chest (a common/rare Buried Hoard cave boss, a mimic), the pure
// half: every tunable, the arc of its leap, and where its cursed coins land. No
// rng, no DOM: the renderer imports this file.
//
// The rule: it snaps at whatever stands in front of it; it crouches and leaps
// at one of the party, a circle showing where it will land; and on a rare map it
// spits cursed coins in a fan ahead of it, each leaving a small puddle that
// burns, always with room to move between them.
//
// Cues:
//   mimic-bite   its snap: a short frontal
//   mimic-leap   where it will land: its clock is the crouch and the flight
//   mimic-coins  one cursed coin: a short warning, then a small lingering puddle

export const HOARD_MIMIC_BOSS_TEMPLATE = 'hoard_boss_mimic';

export const MIMIC = Object.freeze({
  // ---- Bite
  biteFirstSec: 3,
  biteEverySec: 7.5,
  biteWindupSec: 1.6,
  biteRadius: 6,
  biteHalfAngle: Math.PI * 0.3,
  biteDamageFraction: 0.17,
  /** The snap it follows a landing with under pressure. */
  biteComboWindupSec: 0.8,
  // ---- Leap
  leapFirstSec: 9,
  leapEverySec: 16,
  /** It crouches, then flies: the circle's clock is both. */
  leapCrouchSec: 0.5,
  leapFlightSec: 1.4,
  leapRadius: 5,
  leapDamageFraction: 0.22,
  leapKnockback: 3,
  /** How high the arc peaks, in yards. */
  leapPeak: 5,
  // ---- Coin Spit (rare maps only)
  coinFirstSec: 14,
  coinEverySec: 20,
  coinCastSec: 1.2,
  coinRadius: 1.9,
  /** Long enough to watch the coins arc out of its mouth to where they land. */
  coinWindupSec: 1.1,
  coinImpactFraction: 0.05,
  coinHazardSec: 6,
  coinPulseFraction: 0.03,
  coinPulseEverySec: 0.75,
  coinCount: 4,
  coinMax: 7,
  coinSpacing: 5,
  /** The fan: this far ahead of it, this wide either side. */
  coinNear: 4,
  coinFar: 13,
  coinHalfAngle: Math.PI * 0.38,
});

/** How many coins one spit throws. */
export function mimicCoinCount(players: number): number {
  return Math.min(MIMIC.coinMax, MIMIC.coinCount + Math.floor(Math.max(0, players - 1) / 2));
}

/** Where the coins of one spit land: rows across the fan ahead of it, spread so
 *  no two are closer than coinSpacing. `turn` shifts the rows cast to cast. */
export function mimicCoinPoints(
  from: { x: number; z: number },
  facing: number,
  count: number,
  turn: number,
): Array<{ x: number; z: number }> {
  const candidates: Array<{ x: number; z: number }> = [];
  const rows = 4;
  const perRow = 6;
  for (let r = 0; r < rows; r++) {
    const reach = MIMIC.coinNear + ((MIMIC.coinFar - MIMIC.coinNear) * r) / (rows - 1);
    for (let c = 0; c < perRow; c++) {
      const shift = ((turn + r) % 2) * 0.5;
      const t = (c + shift) / (perRow - 1 + 0.5) - 0.5;
      const angle = facing + t * 2 * MIMIC.coinHalfAngle;
      candidates.push({ x: from.x + Math.sin(angle) * reach, z: from.z + Math.cos(angle) * reach });
    }
  }
  const out: Array<{ x: number; z: number }> = [];
  // The middle rows first, then near, then far: the fan fills from its heart.
  const order = [1, 2, 0, 3].flatMap((r) => candidates.slice(r * perRow, r * perRow + perRow));
  for (const point of order) {
    if (out.length >= count) break;
    if (out.some((p) => (p.x - point.x) ** 2 + (p.z - point.z) ** 2 < MIMIC.coinSpacing ** 2))
      continue;
    out.push(point);
  }
  return out;
}

/** Where it is along its leap: 0 still crouched, 1 landed. */
export function mimicLeapProgress(remaining: number, total: number): number {
  const flight = Math.max(1e-6, total - MIMIC.leapCrouchSec);
  const elapsed = total - remaining - MIMIC.leapCrouchSec;
  return Math.max(0, Math.min(1, elapsed / flight));
}

/** How high it is at a point along its leap (a parabola peaking mid-flight). */
export function mimicLeapHeight(progress: number): number {
  return 4 * MIMIC.leapPeak * progress * (1 - progress);
}
