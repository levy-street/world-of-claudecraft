// PURE (RENDER_PURE_CORES): the Hammer Council's two boss-mechanic looks that
// are read from the bodies rather than painted on the floor, as numbers:
//
//  - Bond of the Stone (encounters/smith_heart/council_bond.ts): where it is
//    anchored on each member's real body (`BOND_BODY`, `bondAnchorY`), the
//    sigil and the column of light round each (`bondSigil`), the tether's
//    arch between them (`bondArch`: a quadratic arch from chest to chest that
//    climbs over both crowns when they stand together, so the link reads
//    shoulder to shoulder and from a raid camera far off, easing to a shallow
//    arc apart), a point on it (`bondArchPoint`), and its light
//    (`bondTetherLook`: thickness, glow, the sigils and the floor's chain,
//    growing with the bond's pulses and flaring on each one).
//  - Mountain's Rush (encounters/smith_heart/council_rush.ts): where its
//    wind-up and run stand at a moment after the wind-up's cue (`rushPhase`),
//    how far the scar it tears is revealed and how it fades (`rushScar`).
//
// Every number a player reacts to (the tether showing at all, the scar along the
// lane the run took) is drawn on every tier; only the motes, the shards and the
// dust thin (council_bond_fx.ts, council_rush_fx.ts).

import { SMITH_HEART_MOBS } from '../../sim/content/smith_heart';
import {
  bondPulseMult,
  type CouncilRole,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import { COUNCIL_BODY_HEIGHTS, COUNCIL_MODEL_HEIGHTS } from './council_bodies_core';

/** The Guardian's model height before its template's scale
 *  (characters/smith_heart_boss_looks.ts smith_heart_hammer_guardian). */
const GUARDIAN_MODEL_HEIGHT = COUNCIL_MODEL_HEIGHTS.guardian;

/** Each member's height feet to crown (yards: the model's height times the
 *  template's scale) and the share of it where the tether is anchored (the
 *  chest, high enough to clear the arms and the raid round its feet). */
export const BOND_BODY: Readonly<Record<CouncilRole, { height: number; chest: number }>> = {
  guardian: {
    height: GUARDIAN_MODEL_HEIGHT * (SMITH_HEART_MOBS.heart_hammer_guardian?.scale ?? 3.2),
    chest: 0.7,
  },
  singer: { height: COUNCIL_BODY_HEIGHTS.singer, chest: 0.72 },
};

/** Where a member's tether is anchored over its feet (yards). */
export function bondAnchorY(role: CouncilRole): number {
  return BOND_BODY[role].height * BOND_BODY[role].chest;
}

/** The sigil under a bonded member (yards: about its body's footprint) and
 *  how tall its column of light climbs (a little past its crown). */
export function bondSigil(role: CouncilRole): { radius: number; column: number } {
  return BOND_SIGILS[role];
}

const sigilOf = (role: CouncilRole) => {
  const h = BOND_BODY[role].height;
  return { radius: Math.max(2.6, h * 0.36), column: h * 1.1 } as const;
};
/** The sigils, built once (the painter reads them every frame). */
const BOND_SIGILS: Readonly<Record<CouncilRole, { radius: number; column: number }>> = {
  guardian: sigilOf('guardian'),
  singer: sigilOf('singer'),
};

/** How far the tether's middle climbs over the line between its anchors
 *  (yards): `close` with the two standing together (a tall loop that rises
 *  clear of the smaller member's crown, so it reads shoulder to shoulder),
 *  easing to `apart` (a shallow arc) as the span grows from `near` to `far`. */
export const BOND_ARCH = { close: 4, apart: 2.4, near: 5, far: 18 } as const;

/** The arch over a span of `span` yards (xz) between the two anchors. */
export function bondArch(span: number): number {
  const k = Math.min(1, Math.max(0, (span - BOND_ARCH.near) / (BOND_ARCH.far - BOND_ARCH.near)));
  const ease = k * k * (3 - 2 * k);
  return BOND_ARCH.close + (BOND_ARCH.apart - BOND_ARCH.close) * ease;
}

/** The point at `t` (0 at A, 1 at B) on the arch from A (the origin) to
 *  B = (bx, by, bz) rising `rise` over their line. The same quadratic the
 *  tether's vertex shader draws. Fills `out`. */
export function bondArchPoint(
  t: number,
  bx: number,
  by: number,
  bz: number,
  rise: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const u = 1 - t;
  const cx = 0.5 * bx;
  const cy = 0.5 * by + 2 * rise;
  const cz = 0.5 * bz;
  out.x = 2 * u * t * cx + t * t * bx;
  out.y = 2 * u * t * cy + t * t * by;
  out.z = 2 * u * t * cz + t * t * bz;
  return out;
}

/** The tether's light: its core and halo radii (yards), its brightness, the
 *  sigils' brightness and how fast the energy runs, from the seconds since
 *  its last raid pulse (a flare that settles in 0.6 s), the bond's pulses so
 *  far (it grows as the pulse does: the sim's own multiplier) and the clock
 *  (a slow breath). Fills `out`. */
export interface BondTetherLook {
  core: number;
  halo: number;
  glow: number;
  sigil: number;
  flow: number;
  flare: number;
}

export function bondTetherLook(
  sincePulse: number,
  pulses: number,
  clock: number,
  out: BondTetherLook,
): BondTetherLook {
  const flare = sincePulse >= 0 && sincePulse < 0.6 ? 1 - sincePulse / 0.6 : 0;
  const breath = 0.5 + 0.5 * Math.sin(clock * 3.1);
  // 0 on the first pulse, 1 at the sim's cap.
  const cap = bondPulseMult(99);
  const grow = cap > 1 ? Math.min(1, (bondPulseMult(Math.max(0, pulses)) - 1) / (cap - 1)) : 0;
  out.core = 0.42 + 0.14 * grow + 0.06 * breath + 0.35 * flare;
  out.halo = out.core * 3 + 0.5 * flare;
  out.glow = 0.75 + 0.35 * grow + 0.15 * breath + 0.9 * flare;
  out.sigil = 0.6 + 0.3 * grow + 0.1 * breath + 0.6 * flare;
  out.flow = 1.4 + 1.2 * grow;
  out.flare = flare;
  return out;
}

/** Where a Rush stands `since` seconds after its wind-up's cue, for a run of
 *  `run` seconds: the wind-up (k its share, 0 to 1), the run (k how far
 *  along the line, 0 to 1), or over. */
export type RushPhaseName = 'windup' | 'run' | 'over';

export function rushPhase(
  since: number,
  run: number,
  out: { phase: RushPhaseName; k: number },
): { phase: RushPhaseName; k: number } {
  if (since < 0 || since < T.rushWindup) {
    out.phase = 'windup';
    out.k = Math.max(0, since) / T.rushWindup;
    return out;
  }
  const r = since - T.rushWindup;
  if (run > 0 && r < run) {
    out.phase = 'run';
    out.k = r / run;
    return out;
  }
  out.phase = 'over';
  out.k = 1;
  return out;
}

/** How long the scar the run tears stays (seconds after the stop), and how
 *  long it takes to fade out of that. */
export const RUSH_SCAR = { hold: 3.5, fade: 2 } as const;

/** The scar along the run's line: how much of it is torn (0 to 1, following
 *  the Guardian's body) and how strong it still burns (1 fresh, 0 gone). */
export function rushScar(
  since: number,
  run: number,
  out: { reveal: number; heat: number; fade: number },
): { reveal: number; heat: number; fade: number } {
  const r = since - T.rushWindup;
  if (r <= 0) {
    out.reveal = 0;
    out.heat = 0;
    out.fade = 1;
    return out;
  }
  out.reveal = run > 0 ? Math.min(1, r / run) : 1;
  const after = Math.max(0, r - run);
  // Hot as it is torn, cooling to embers, then fading.
  out.heat = Math.max(0, 1 - after / 1.2);
  out.fade =
    after <= RUSH_SCAR.hold ? 1 : Math.max(0, 1 - (after - RUSH_SCAR.hold) / RUSH_SCAR.fade);
  return out;
}

/** Seconds after the stop by which every trace of a Rush is gone. */
export const RUSH_TRACE_SECONDS = RUSH_SCAR.hold + RUSH_SCAR.fade;
