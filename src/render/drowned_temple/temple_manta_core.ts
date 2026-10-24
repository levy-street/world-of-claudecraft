// Pure plan for the Moonmantle Ray's effects (temple_manta_fx.ts): the mob id
// is still pearlguard_sentinel (frozen), its moves are the sentinel's own
// (content/temple.ts): the Lunar Glide is its charge, the Tidal Wingbeat its
// wing gust, the Nacre Cocoon its once-per-pull absorb ward. Everything here is
// a function of what IWorld mirrors (positions, the cast bar, the aura's
// value, the dead flag), so offline and online play the same.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';

/** The Moonmantle Ray's (frozen) template id. */
export const MANTA_ID = 'pearlguard_sentinel';

/** Where its body floats (the model glides a yard over the floor; the
 *  cocoon wraps the body there). */
export const MANTA_BODY_UP = 1.9;
/** The cocoon's radius round the body (its wings folded over it). */
export const MANTA_COCOON_R = 2.7;

/** The Wingbeat ring's life (seconds) and the Glide wake's fade. */
export const MANTA_WINGBEAT_SECONDS = 0.9;
export const MANTA_DISSOLVE_SECONDS = 3.2;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** How hard it is gliding (0 walking, 1 at its charge's full 3x dash), off
 *  its measured speed against its walk speed. */
export function mantaGlideStrength(speed: number, moveSpeed: number): number {
  if (moveSpeed <= 0) return 0;
  return clamp01((speed / moveSpeed - 1.6) / 1.0);
}

/** The Tidal Wingbeat's ring of water `age` seconds after the wings land: its
 *  radius as a share of the gust's reach, and its strength. */
export function mantaWingbeatRing(age: number): { reach: number; alpha: number } {
  const k = clamp01(age / MANTA_WINGBEAT_SECONDS);
  return { reach: 0.25 + 0.75 * (1 - (1 - k) ** 3), alpha: (1 - k) ** 1.4 };
}

/** The gust's reach (yards), from the template, so the ring the player sees
 *  ends where the shove does. */
export function mantaWingbeatRadius(): number {
  return MOBS[MANTA_ID]?.trashKit?.wingGust?.radius ?? 7;
}

/** The Nacre Cocoon's look off its ward: its glow (1 whole, 0 spent) and how
 *  far its cracks have opened (the reverse). `full` is the ward's starting
 *  size (the template's share of the ray's maximum health). */
export function mantaCocoonLook(value: number, full: number): { glow: number; crack: number } {
  const left = full > 0 ? clamp01(value / full) : 0;
  return { glow: 0.35 + 0.65 * left, crack: 1 - left };
}

/** The ward's starting size for a ray of `maxHp`. */
export function mantaCocoonFull(maxHp: number): number {
  const share = MOBS[MANTA_ID]?.trashKit?.carapace?.shieldPct ?? 0.25;
  return Math.max(1, Math.round(maxHp * share));
}

/** Its body melting into moonwater `age` seconds after it dies: the pool's
 *  spread (yards) and its light. */
export function mantaDissolve(age: number): { spread: number; alpha: number } {
  const k = clamp01(age / MANTA_DISSOLVE_SECONDS);
  return { spread: 1.5 + 4.5 * Math.sqrt(k), alpha: k < 0.15 ? k / 0.15 : (1 - k) ** 1.2 };
}
