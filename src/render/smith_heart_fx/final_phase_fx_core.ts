// Pure plan of the Masterless Strength's part 2 look (final_phase_fx.ts
// paints it; docs/design/raid/smith_heart.md section 7.5). Presentation only:
// every radius, timer and reach is read off the sim's own tuning and the
// objects' templates (encounters/smith_heart/final_phase_ids.ts), never
// tuned here.
//
//   - the Splinters' looks per vein (`SPLINTER_LOOKS`: their light, their
//     element's paint, their particles) and the cast footprints they paint
//     (`SPLINTER_SHEAR_KIND`);
//   - each footprint's threat colour on the shared floor telegraph
//     (`PHASE_FOOTPRINTS`) and the sim's reaches (`PHASE_REACH`);
//   - a Quenching Ring's front and fade (`quenchRingLook`, the sim's own
//     `quenchRingFront`), the shield's look (`shieldLook`), a rising column's
//     and a pour's timelines (`pillarLook`, `pourLook`), the poured marks'
//     orbits (`pouredOrbit`), Masterless Fury's flare (`furyLook`);
//   - the cues the painter claims, the floor rungs (`FINAL_PHASE_FLOOR`:
//     never tied with FinalKitFx's, FinalFx's particles or HeatFx's on the
//     same Anvil), the pools.
//
// Three-free, DOM-free, deterministic.

import {
  HEART_ROOM,
  SMITH_HEART_VEIN_COLORS,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import {
  FINAL_PHASE_AURAS,
  FINAL_PHASE_CUES,
  FINAL_PHASES as P,
  QUENCH_RING_LIFE,
  quenchRingFront,
} from '../../sim/encounters/smith_heart/final_phase_ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph';
import type { FinalElement, FinalTelegraphKind } from './final_telegraph_core';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** A hex colour as 0..1 rgb. */
export function rgbOf(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

// ---- the Splinters ------------------------------------------------------------------

export interface SplinterLook {
  /** Its light (hex): the vein's. */
  color: number;
  /** Its element's floor paint (the kit's telegraph looks). */
  element: FinalElement;
  /** Its particles' tint (0..1 rgb) and how they move: rising embers, frost
   *  falling, storm sparks, grit. */
  mote: readonly [number, number, number];
  rise: number;
  gravity: number;
}

export const SPLINTER_LOOKS: Readonly<Record<SmithHeartVein, SplinterLook>> = {
  heat: {
    color: SMITH_HEART_VEIN_COLORS.heat,
    element: 'fire',
    mote: [1, 0.66, 0.28],
    rise: 4,
    gravity: 0,
  },
  quench: {
    color: SMITH_HEART_VEIN_COLORS.quench,
    element: 'frost',
    mote: [0.78, 0.92, 1],
    rise: 0.6,
    gravity: 2,
  },
  breath: {
    color: SMITH_HEART_VEIN_COLORS.breath,
    element: 'storm',
    mote: [0.76, 0.7, 1],
    rise: 2.5,
    gravity: 0,
  },
  hammer: {
    color: SMITH_HEART_VEIN_COLORS.hammer,
    element: 'stone',
    mote: [0.86, 0.64, 0.32],
    rise: 1.5,
    gravity: 9,
  },
};

/** The element kind each Splinter's Shearing Blow cone paints in. */
export const SPLINTER_SHEAR_KIND: Readonly<Record<SmithHeartVein, FinalTelegraphKind>> = {
  heat: 'shearFire',
  quench: 'shearFrost',
  breath: 'shearStorm',
  hammer: 'shearStone',
};

/** How each part-2 footprint draws on the shared floor telegraph (every
 *  tier): its threat colour and its accent. Shearing Blow is lethal to all
 *  but its target; Bursting Coal's reach is the group's danger; the pounce's
 *  landing and the hunt's Buffeting Gale are danger. */
export const PHASE_FOOTPRINTS = {
  shear: { color: TELEGRAPH_THREAT_COLORS.lethal, accent: 0xfff0d0 },
  coal: { color: TELEGRAPH_THREAT_COLORS.lethal, accent: 0xff9a3a },
  pounce: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0xc8b8ff },
  buffet: { color: TELEGRAPH_THREAT_COLORS.danger, accent: 0x9ad8ff },
} as const;

/** The footprints' sim reaches (yards). */
export const PHASE_REACH = {
  shearArc: P.shearArcDeg,
  shear: P.shearRange,
  coal: P.coalReach,
  /** Gale Pounce's landing (where its quarry stands): a stride's width. */
  pounce: 3,
  buffet: P.buffetReach,
  /** A Splinter's ground sigil (cosmetic, its body's width). */
  sigil: 4.2,
  /** Gathered Strength's dome round the boss. */
  shield: 10,
} as const;

// ---- the timelines -------------------------------------------------------------------

/** A Quenching Ring `age` seconds old: its front (the sim's), its alpha
 *  (a blink in, a fade at its reach). Gone past its life. */
export function quenchRingLook(age: number): { front: number; alpha: number; alive: boolean } {
  if (age < 0 || age > QUENCH_RING_LIFE + 0.3) return { front: 0, alpha: 0, alive: false };
  const front = quenchRingFront(Math.min(age, QUENCH_RING_LIFE));
  const tail = clamp01((QUENCH_RING_LIFE + 0.3 - age) / 0.8);
  return { front, alpha: smooth(age / 0.15) * tail, alive: true };
}

/** Gathered Strength's dome: its alpha (it rises over `riseFor` seconds,
 *  a breath while it breaks) and how urgent its plates crackle (the call's
 *  last ten seconds). */
export function shieldLook(shownFor: number, callLeft: number): { alpha: number; urgent: number } {
  return {
    alpha: 0.9 * smooth(shownFor / 0.8),
    urgent: callLeft > 0 ? clamp01((10 - callLeft) / 10) : 0,
  };
}

/** A rising column of light `age` seconds into its `life`: its height scale
 *  (it shoots up, holds, sinks) and alpha. */
export function pillarLook(age: number, life: number): { height: number; alpha: number } {
  if (age < 0 || age > life) return { height: 0, alpha: 0 };
  const up = smooth(age / 0.35);
  const out = clamp01((life - age) / (life * 0.45));
  return { height: up * (0.6 + 0.4 * out), alpha: up * out };
}

/** An element pouring into the boss `age` seconds in: its width and alpha
 *  (it thickens, holds, thins). */
export const POUR_SECONDS = 1.6;
export function pourLook(age: number): { width: number; alpha: number } {
  if (age < 0 || age > POUR_SECONDS) return { width: 0, alpha: 0 };
  const k = age / POUR_SECONDS;
  return { width: 0.4 + 1.2 * Math.sin(Math.PI * k), alpha: Math.sin(Math.PI * k) ** 0.6 };
}

/** A poured element's ring round the boss's body (the `i`-th of `n`), at
 *  render time `t`: its tilt, its spin, its height (yards over the floor). */
export function pouredOrbit(
  i: number,
  n: number,
  t: number,
): { tilt: number; spin: number; height: number; radius: number } {
  const k = n > 0 ? i / n : 0;
  return {
    tilt: 0.55 + 0.35 * Math.sin(k * Math.PI * 2 + 0.7),
    spin: t * (0.9 + 0.25 * i) + k * Math.PI * 2,
    height: 7.5 + 2.2 * i,
    radius: 6.5 + 0.6 * i,
  };
}

/** Masterless Fury's flare on the boss at `stacks` and render time `t`:
 *  0..1, throbbing faster as it climbs. */
export function furyLook(stacks: number, t: number): number {
  if (stacks <= 0) return 0;
  const k = clamp01(stacks / 10);
  return (0.45 + 0.55 * k) * (0.7 + 0.3 * Math.sin(t * (6 + 8 * k)));
}

/** Where each quarter's column rises as the final phase wakes them: its
 *  quarter's spot (instance-local). */
export function awakenSpot(spot: { x: number; z: number }, r = 30): { x: number; z: number } {
  const dx = spot.x - HEART_ROOM.x;
  const dz = spot.z - HEART_ROOM.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: HEART_ROOM.x + (dx / d) * r, z: HEART_ROOM.z + (dz / d) * r };
}

// ---- the cues ------------------------------------------------------------------------

const CLAIMED: ReadonlySet<string> = new Set(Object.values(FINAL_PHASE_CUES));

/** The part-2 cues this painter draws itself (no generic burst, nova or beam
 *  doubles them). */
export function finalPhaseClaims(ability: string | null | undefined): boolean {
  return ability !== null && ability !== undefined && CLAIMED.has(ability);
}

// ---- the floor -----------------------------------------------------------------------

/** Part 2's encounter rungs on the Anvil, clear of FinalKitFx's
 *  (FINAL_KIT_FLOOR: 13, 15, 17, 20, 22, 24, 26 to 29), FinalFx's particles
 *  (the engine's 4, 6, 7, 8) and HeatFx's (4, 5, 8, 9, 12, 14, 16, 18,
 *  21): its element telegraphs' char under their glow, their curtains over
 *  them, the rings and sigils, the particles. */
export const FINAL_PHASE_FLOOR = {
  telegraphChar: 10,
  telegraphGlow: 11,
  telegraphCurtain: 19,
  sigil: 23,
  ring: 25,
  particles: { ring: 3, smoke: 1, fire: 2, glow: 0 },
} as const;

/** Every rung part 2 draws on (the tests pin them untied). */
export function finalPhaseRungs(): number[] {
  const F = FINAL_PHASE_FLOOR;
  return [
    F.telegraphChar,
    F.telegraphGlow,
    F.telegraphCurtain,
    F.sigil,
    F.ring,
    ...Object.values(F.particles),
  ];
}

/** The pools (fixed, allocated at build). */
export const FINAL_PHASE_POOLS = {
  /** Dressed fans per element (shear cones, coal reaches, pounce and
   *  buffet rings). */
  fans: { fire: 6, frost: 4, storm: 8, stone: 4 } as Record<FinalElement, number>,
  rings: 6,
  splinters: 6,
  pillars: 8,
  beams: 4,
  tethers: 4,
  tetherSegments: 6,
  coals: 4,
  poured: 4,
} as const;

/** The room's quarters awake through a call (the phase aura's mask) for the
 *  room's floor (FinalFx forwards it to ../smith_heart/heart_quarters_core.ts). */
export function finalPhaseMaskOf(boss: {
  auras: readonly { id: string; value2?: number }[];
}): number {
  for (const a of boss.auras)
    if (a.id === FINAL_PHASE_AURAS.phase) return Math.round(a.value2 ?? 0);
  return 0;
}
