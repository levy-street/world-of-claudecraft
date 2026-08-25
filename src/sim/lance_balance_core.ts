// The balance beam under a couched Shardpike: pure math, one function, no clock, no rng.
//
// The feel this implements is an INVERTED PENDULUM, which is what makes it a skill check
// rather than a dice roll: the further the pike tips off centre, the harder it pulls that
// way, so a player who reacts late needs a longer correction and a player who overcorrects
// hands the pendulum momentum in the other direction. Layered on top is a smooth wander
// (deterministic value noise, seeded per session, so the same brace replays identically on
// every host and draws NOTHING from the shared rng stream) and a ramp that makes the last
// seconds of the set genuinely tense. The counter-force is the player's own strafe axis,
// held rather than tapped, which is the whole Tony-Hawk-manual of it.
//
// Every constant is exported: the tests hold the tuning to a playability CONTRACT (a plain
// bang-bang controller must survive the set; no input must fail before it) instead of
// pinning magic numbers, so the numbers can be re-felt without rewriting the suite.

import { hash2, noise2 } from './rng';
import { DT } from './types';

/** Seconds a brace must stay inside the rails before the thrust window opens. */
export const LANCE_SET_SECONDS = 5;
/** Seconds the steadied window stays open to land the thrust. */
export const LANCE_WINDOW_SECONDS = 6;
/** Seconds the pike cannot be re-braced after a fumble or a thrust. */
export const LANCE_REST_SECONDS = 5;

/** Inverted-pendulum tip: acceleration per unit of off-centre displacement. */
/**
 * The thrust's damage, and the whole point of the number: it is FIXED. No attack power, no
 * level, no weapon roll touches it, so a level 6's poke is worth exactly a level 20's and
 * the job of opening the window belongs to whoever holds the nerve to do it.
 *
 * Lives in the pure core beside the timings, not in the system module, because the tooltip
 * has to quote it: a player-facing number the HUD cannot read is a number that gets copied
 * into a catalog string and then silently rots away from the mechanic.
 */
export const LANCE_FIXED_DAMAGE = 150;

/** Yards of reach on the thrust. Generous: the target is thirteen yards of granite. */
export const LANCE_THRUST_RANGE = 14;

export const LANCE_TIP_ACCEL = 2.6;
/** What a held lean is worth. Stronger than the tip at full displacement, so a
 *  correction always CAN win; the contest is reaction time, not arithmetic. */
export const LANCE_LEAN_ACCEL = 3.4;
/** Peak wander acceleration at brace start, before the ramp. */
export const LANCE_DRIFT_ACCEL = 1.15;
/** The wander's frequency in cycles per second: slow swells, not jitter. */
export const LANCE_DRIFT_HZ = 0.55;
/** How much harder the beam wanders per second under tension. */
export const LANCE_RAMP_PER_SECOND = 0.12;
/** Light damping so momentum decays instead of ringing forever. */
export const LANCE_DAMPING = 0.35;

export interface LanceBalance {
  /** Beam position, -1..1; either rail is a fumble. */
  balance: number;
  velocity: number;
  /** Seconds since the brace began (drives the wander phase and the ramp). */
  t: number;
}

/**
 * A new brace, already imperceptibly off-true.
 *
 * The seeded initial displacement (5 to 10 hundredths, either side) is what makes the idle
 * fail a MATHEMATICAL guarantee rather than a property of the noise: an inverted pendulum
 * grows any nonzero displacement exponentially, but from exactly zero with a wander that
 * happens to average out (one in a few dozen seeds does) it can coast a whole set. A pike
 * this long was never going to sit perfectly on its point.
 */
export function freshLanceBalance(seed: number): LanceBalance {
  const h = hash2(97, 131, seed);
  const side = h < 0.5 ? -1 : 1;
  return { balance: side * (0.05 + 0.05 * hash2(211, 61, seed)), velocity: 0, t: 0 };
}

/**
 * Advance the beam one tick under a held lean. Pure: same state + lean + seed in, same
 * state out, on every host. Returns the NEW state; the caller owns storage.
 */
export function stepLanceBalance(s: LanceBalance, lean: -1 | 0 | 1, seed: number): LanceBalance {
  const t = s.t + DT;
  const ramp = 1 + t * LANCE_RAMP_PER_SECOND;
  // Value noise in [-1, 1], sampled along one axis so the wander is a smooth 1D signal.
  const wander = (noise2(t * LANCE_DRIFT_HZ, 0.5, seed) * 2 - 1) * LANCE_DRIFT_ACCEL * ramp;
  const tip = s.balance * LANCE_TIP_ACCEL;
  const lean_ = -lean * LANCE_LEAN_ACCEL;
  const velocity = (s.velocity + (wander + tip + lean_) * DT) * (1 - LANCE_DAMPING * DT);
  const balance = clamp(s.balance + velocity * DT, -1.2, 1.2);
  return { balance, velocity, t };
}

/** Did this state fall off the beam? */
export function lanceFumbled(s: LanceBalance): boolean {
  return Math.abs(s.balance) >= 1;
}

/**
 * An external shock (a boss slam landing nearby) kicks the beam. `strength` is a signed
 * velocity impulse; the caller derives sign and falloff from the impact geometry so the
 * beam is kicked AWAY from the blast, which players read instantly.
 */
export function shockLanceBalance(s: LanceBalance, strength: number): LanceBalance {
  return { ...s, velocity: s.velocity + strength };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
