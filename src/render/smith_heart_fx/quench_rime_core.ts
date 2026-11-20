// Living Rime drawn on its carrier (quench_rime_fx.ts), the pure part: what
// the crust and its ring look like from the carrier's aura alone (`value` the
// healing left, `value2` its whole, `remaining` the seconds to its burst:
// encounters/smith_heart/quench_rime.ts). No three.js, no DOM.
//
//   the crust   jagged plates of lake ice standing out of the body, as many
//               as the healing left asks: the healers melt it plate by plate
//               (whole: every plate; half healed: half of them)
//   the ring    the burst's reach on the ice round them, filling as its clock
//               runs (the shatter's ring language: a filled ring is a burst
//               coming), pulsing faster through its last seconds
//
// Both are actionable (leave the group; heal this one), so both draw on every
// graphics tier; only the motes thin.

import { QUENCH_TUNING as T } from '../../sim/encounters/smith_heart/quench_ids';
import { fightHash } from './quench_fight_fx_core';

/** Pools. */
export const QUENCH_RIME_POOLS = {
  /** Carriers drawn at once (Mythic's three, and a leap's on the same tick). */
  carriers: 4,
  /** Crust plates on one carrier with the whole crust left. */
  platesPer: 10,
} as const;

/** The seconds left under which the ring's pulse quickens. */
export const RIME_URGENT_SECONDS = 3;

export interface RimeLook {
  /** Share of the crust left (0..1). */
  crust: number;
  /** Plates standing (0..platesPer). */
  plates: number;
  /** The ring's fill (0 fresh, 1 bursting). */
  fill: number;
  /** The ring's breathing (0..1), quicker through the last seconds. */
  pulse: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** The carrier's look from its aura at clock `t`. */
export function rimeLook(
  left: number,
  whole: number,
  remaining: number,
  t: number,
  out: RimeLook = { crust: 0, plates: 0, fill: 0, pulse: 0 },
): RimeLook {
  const full = whole > 0 ? whole : Math.max(1, left);
  out.crust = clamp01(left / full);
  // A crust with any healing left keeps one plate (never invisible while live).
  out.plates = out.crust > 0 ? Math.max(1, Math.ceil(out.crust * QUENCH_RIME_POOLS.platesPer)) : 0;
  out.fill = clamp01(1 - remaining / T.rimeSeconds);
  const rate = remaining <= RIME_URGENT_SECONDS ? 9 : 3.5;
  out.pulse = 0.5 + 0.5 * Math.sin(t * rate);
  return out;
}

export interface RimePlate {
  /** Bearing round the body (radians). */
  a: number;
  /** Height on the body (yards over its feet). */
  h: number;
  /** Out from the body's axis (yards). */
  r: number;
  /** Lean outward (radians) and length (yards). */
  lean: number;
  len: number;
  /** Thickness (yards). */
  w: number;
}

/** Plate `k` of carrier `id`: a fixed, hashed place on the body (shoulders,
 *  back, flanks, shins), so the crust never swims as it melts. */
export function rimePlate(
  id: number,
  k: number,
  out: RimePlate = { a: 0, h: 0, r: 0, lean: 0, len: 0, w: 0 },
): RimePlate {
  const n = QUENCH_RIME_POOLS.platesPer;
  out.a = (k / n) * Math.PI * 2 + (fightHash(id, k + 3) - 0.5) * 0.7;
  // Alternate high and low so a half-melted crust still covers the body.
  const band =
    k % 2 === 0 ? 0.55 + 0.35 * fightHash(id, k + 11) : 0.1 + 0.35 * fightHash(id, k + 17);
  out.h = 0.25 + band * 1.95;
  out.r = 0.32 + 0.12 * fightHash(id, k + 23);
  out.lean = 0.35 + 0.5 * fightHash(id, k + 29);
  out.len = 0.45 + 0.4 * fightHash(id, k + 31);
  out.w = 0.12 + 0.08 * fightHash(id, k + 37);
  return out;
}
