// Pure plan for the Great Saurian's body effects (saurian_fx.ts): which water
// and debris beats fire on which clip contact, where on the body (model space,
// saurian_model_core.ts), and the curves of the ford's splash primitives (the
// water crowns, the ripple rings, the howdah's splinters). The beats are
// offsets from the moment the fx learns of them: a strike's `nova` arrives on
// its bar's end (the clip's impact frame), the howdah's and the enrage's on
// their clip's first frame, the death on the corpse's first frame; the Tail
// Swipe's sweep starts off the bar itself, a little before the impact, so the
// spray crosses the rear cone left to right as the tail does.
//
// Three-free, DOM-free, deterministic.

import { SAURIAN_TUNING } from '../../sim/encounters/wildheart_basin/ids';
import {
  SAURIAN_CLIP,
  SAURIAN_MODEL,
  type SaurianFoot,
  saurianModelScale,
} from './saurian_model_core';

/** A body beat the fx plays. */
export type SaurianBeatKind =
  | 'stompCrouch'
  | 'stompSlam'
  | 'stompJolt'
  | 'clubWhip'
  | 'howdahRattle'
  | 'howdahBurst'
  | 'debrisSplash'
  | 'stamp'
  | 'deathBody'
  | 'deathNeck';

export interface SaurianBeat {
  kind: SaurianBeatKind;
  /** Seconds after the trigger. */
  at: number;
  /** The foot it lands (stamps), when one. */
  foot?: SaurianFoot;
  /** A model-space point on the ground (x its left, z forward), when one. */
  mx?: number;
  mz?: number;
}

export type SaurianTrigger = 'stompBar' | 'stomp' | 'tail' | 'howdah' | 'enrage' | 'death';

/** The beats one trigger schedules, in time order. */
export function saurianBeats(trigger: SaurianTrigger): SaurianBeat[] {
  const C = SAURIAN_CLIP;
  switch (trigger) {
    case 'stompBar':
      // The bar starts with the clip: the crouch plants the forefeet.
      return [{ kind: 'stompCrouch', at: 0.45 }];
    case 'stomp':
      // The nova IS the slam (the bar's end at 2.00); the jolt follows.
      return [
        { kind: 'stompSlam', at: 0 },
        { kind: 'stompJolt', at: C.stompJolt - C.stompSlam },
      ];
    case 'tail':
      // The nova lands as the tail crosses the cone's middle; the club whips
      // past on the right a beat later.
      return [{ kind: 'clubWhip', at: C.tailClub - C.tailHit }];
    case 'howdah': {
      const out: SaurianBeat[] = [
        { kind: 'howdahRattle', at: C.howdahRattle },
        { kind: 'howdahBurst', at: C.howdahBurst },
      ];
      // The canopy, posts and rails come down round its flanks over 1.4 to 1.9.
      for (const [i, p] of HOWDAH_PIECE_FALLS.entries())
        out.push({ kind: 'debrisSplash', at: 1.4 + i * 0.1, mx: p[0], mz: p[1] });
      return out;
    }
    case 'enrage':
      return [
        { kind: 'stamp', at: C.enrageStamps[0], foot: 'leftFore' },
        { kind: 'stamp', at: C.enrageStamps[1], foot: 'rightFore' },
      ];
    case 'death': {
      // It rolls onto its LEFT side: the barrel hits the water at 2.70, the
      // neck beyond its left shoulder at 2.85.
      const L = C.deathRollLeft;
      return [
        { kind: 'deathBody', at: C.deathBody, mx: L, mz: -3 },
        { kind: 'deathBody', at: C.deathBody + 0.04, mx: L + 0.4, mz: 1.5 },
        { kind: 'deathBody', at: C.deathBody + 0.08, mx: L - 0.4, mz: -7.5 },
        { kind: 'deathNeck', at: C.deathNeck, mx: L + 2.6, mz: 8 },
        { kind: 'deathNeck', at: C.deathNeck + 0.06, mx: L + 4, mz: 12.5 },
      ];
    }
  }
}

/** Where the howdah's big pieces come down (model space: its left is +x),
 *  in the order they land. */
export const HOWDAH_PIECE_FALLS: readonly (readonly [number, number])[] = [
  [6.5, 1.5],
  [-7, -1],
  [5, -6],
  [-5.5, 4],
  [8, -3.5],
  [-8.5, -5],
];

/** The howdah's deck (where it bursts from) at sim `scale`: height over the
 *  ground and offset forward of the centre, in yards. */
export function howdahDeck(scale: number): { up: number; forward: number } {
  const k = saurianModelScale(scale);
  return { up: SAURIAN_MODEL.deckTop * k, forward: SAURIAN_MODEL.deckZ * k };
}

// ---- the Tail Swipe's sweep ---------------------------------------------------------

/** The sweep's span: the tail enters the rear cone's left edge this long
 *  before the impact (the cone's middle) and leaves its right edge after. */
export const TAIL_SWEEP_LEAD = 0.16;
export const TAIL_SWEEP_SPAN = 0.32;

/** The tail's angle off straight behind (radians, + toward its left) at
 *  `t` seconds into the sweep: left edge to right edge of the cone, fast in
 *  the middle. */
export function tailSweepAngle(t: number): number {
  const half = (SAURIAN_TUNING.tailArcDeg * Math.PI) / 360;
  const u = Math.max(0, Math.min(1, t / TAIL_SWEEP_SPAN));
  const ease = u * u * (3 - 2 * u);
  return half * (1 - 2 * ease);
}

/** The bar's remaining seconds at which the sweep starts. */
export function tailSweepStartsAt(): number {
  return TAIL_SWEEP_LEAD;
}

/** The yards along the tail the spray rises from (hips to past the club), at
 *  sim `scale`: the reach stays inside the cone the sim tests. */
export function tailSprayReach(scale: number): { from: number; to: number } {
  const k = saurianModelScale(scale);
  return {
    from: SAURIAN_MODEL.hipsBack * k,
    to: Math.min(SAURIAN_TUNING.tailRange, -SAURIAN_MODEL.club.z * k),
  };
}

// ---- the ford's splash primitives ---------------------------------------------------

/** A water crown: a ring of torn water thrown up round an impact. */
export interface CrownSpec {
  /** Radius it rises from and spreads to (yards). */
  r0: number;
  r1: number;
  /** Peak height (yards) and seconds it lives. */
  height: number;
  life: number;
}

export const CROWN_LOOKS = {
  /** A wading footfall: a low skirt round the foot. */
  footfall: { r0: 0.7, r1: 2.1, height: 1.1, life: 0.7 },
  /** A running footfall. */
  footfallRun: { r0: 0.8, r1: 2.6, height: 1.7, life: 0.75 },
  /** Each forefoot of the Stomp's slam. */
  stompFoot: { r0: 1.5, r1: 5.4, height: 8.5, life: 1.35 },
  /** The Stomp's water wall racing out to the ring's edge. */
  stompWall: { r0: 3, r1: SAURIAN_TUNING.stompRadius, height: 2.6, life: 0.95 },
  /** An enrage stamp. */
  stamp: { r0: 1.2, r1: 3.6, height: 4, life: 1 },
  /** A howdah piece hitting the water. */
  debris: { r0: 0.5, r1: 1.8, height: 2.2, life: 0.8 },
  /** The rider landing in the ford. */
  rider: { r0: 0.6, r1: 2.4, height: 3.2, life: 0.9 },
  /** The barrel hitting the water as it dies. */
  deathBody: { r0: 2.6, r1: 7.5, height: 7.5, life: 1.6 },
  /** The neck coming down. */
  deathNeck: { r0: 1.6, r1: 4.8, height: 4.6, life: 1.3 },
  /** The tail's wake across the cone. */
  tailWake: { r0: 0.9, r1: 3, height: 3.6, life: 0.9 },
} as const satisfies Record<string, CrownSpec>;

/** A crown's shape `elapsed` seconds in: its radius, the height of its torn
 *  rim and its opacity (0 when spent). It shoots up fast, hangs, and falls back
 *  as it spreads. */
export function crownShape(
  spec: CrownSpec,
  elapsed: number,
  out: { radius: number; height: number; alpha: number } = { radius: 0, height: 0, alpha: 0 },
): { radius: number; height: number; alpha: number } {
  const t = Math.max(0, Math.min(1, elapsed / spec.life));
  const spread = 1 - (1 - t) ** 2.4;
  const rise = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.75;
  out.radius = spec.r0 + (spec.r1 - spec.r0) * spread;
  out.height = spec.height * rise;
  out.alpha = t >= 1 ? 0 : Math.min(1, (1 - t) * 1.8);
  return out;
}

/** A ripple: rings racing out across the water from an impact. */
export interface RippleSpec {
  /** Radius the leading ring reaches (yards) and seconds it lives. */
  reach: number;
  life: number;
  /** Rings in the train (1 to 4). */
  rings: number;
}

export const RIPPLE_LOOKS = {
  footfall: { reach: 4.5, life: 1.6, rings: 2 },
  stomp: { reach: SAURIAN_TUNING.stompRadius + 2.5, life: 1.8, rings: 4 },
  stamp: { reach: 7, life: 1.7, rings: 3 },
  debris: { reach: 4, life: 1.4, rings: 2 },
  rider: { reach: 5, life: 1.5, rings: 3 },
  death: { reach: 16, life: 2.6, rings: 4 },
  tail: { reach: 5, life: 1.4, rings: 2 },
} as const satisfies Record<string, RippleSpec>;

/** A ripple's leading radius and opacity `elapsed` seconds in. */
export function rippleShape(
  spec: RippleSpec,
  elapsed: number,
  out: { radius: number; alpha: number } = { radius: 0, alpha: 0 },
): { radius: number; alpha: number } {
  const t = Math.max(0, Math.min(1, elapsed / spec.life));
  out.radius = spec.reach * (0.08 + 0.92 * (1 - (1 - t) ** 2));
  out.alpha = t >= 1 ? 0 : (1 - t) ** 1.3;
  return out;
}

// ---- the howdah's splinters -----------------------------------------------------------

/** One splinter's material class (its colour in the instance palette). */
export type SplinterKind = 'bamboo' | 'bone' | 'cloth' | 'leather';

export const SPLINTER_COLORS: Readonly<Record<SplinterKind, number>> = {
  bamboo: 0xc8a85a,
  bone: 0xe8dcc0,
  cloth: 0x9a2420,
  leather: 0x6b4428,
};

/** The burst's mix: how many of each (scaled by the effects density). */
export const SPLINTER_MIX: Readonly<Record<SplinterKind, number>> = {
  bamboo: 34,
  bone: 12,
  cloth: 10,
  leather: 8,
};

/** Water a splinter sinks through before it is gone (yards), and how fast. */
export const SPLINTER_SINK = { depth: 0.6, speed: 0.55 } as const;

/** The splinters' gravity (yards per second squared): a touch under real, so
 *  the burst hangs long enough to read at the Saurian's size. */
export const SPLINTER_GRAVITY = 15;

/** Is a footfall in the water (the ford's bed is the instance floor)? */
export function wetFloor(groundY: number): boolean {
  return groundY < 0.6;
}
