// The Masterless Strength's own model (the Quadrant Guardian, phase 2O): the
// pure half of final_body_fx.ts. One rigged GLB carries four bodies on one
// mesh (the Hammer's amber-cracked basalt, the Breath's storm slate, the
// Heat's magma-veined black rock, the Quench's frost-white stone with its
// icicles); the quarter the boss stands in (the state aura's zone, already on
// every client) names the one shown. Changing quarter is a set piece: the
// shell cracks and bleeds light, the strength gathers, the new element bursts
// out over the floor and the crown re-forms in its colour, then that
// element's aura settles round the body.
//
// What lives here: the gesture ids the rig's mesh toggles, stance swaps and
// glow pulses answer (characters/smith_heart_boss_looks.ts binds them, the fx
// module sends them), the clip beats, the element of a zone, the
// transformation's timeline, each element's burst and aura recipe, and the
// body's anchor points as fractions of its drawn height. Node-only
// (RENDER_PURE_CORES): no three.js, no DOM, no allocation per call beyond the
// returned records the fx module reads into its own scratch.

import type { HeartQuarterZone } from '../../sim/content/smith_heart_quarters';

/** The four bodies, one per quarter. */
export type FinalBodyElement = 'hammer' | 'breath' | 'heat' | 'quench';
export const FINAL_BODY_ELEMENTS: readonly FinalBodyElement[] = [
  'hammer',
  'breath',
  'heat',
  'quench',
];

/** The body a zone shows: its own quarter's, the Hammer's basalt in the ring
 *  (the base form of the concept sheet, white-gold seams and all). */
export function finalBodyElement(zone: HeartQuarterZone): FinalBodyElement {
  return zone === 'ring' ? 'hammer' : zone;
}

/** The GLB's mesh nodes per element (the Quench's icicles ride with it). */
export const FINAL_BODY_NODES: Readonly<Record<FinalBodyElement, readonly string[]>> = {
  hammer: ['Body_Hammer'],
  breath: ['Body_Breath'],
  heat: ['Body_Heat'],
  quench: ['Body_Quench', 'Accent_Quench'],
};

/** Presentation gestures (the renderer's triggerAttack seam). Never sim ids. */
export const FINAL_BODY_GESTURES = {
  /** The whole model hidden (the heart asleep, the pieces still flying in). */
  hide: 'smith_heart_final_body_hide',
  show: 'smith_heart_final_body_show',
  /** One element's body on or off (consumed, idempotent; re-sent for a
   *  rebuilt view). */
  on: {
    hammer: 'smith_heart_final_body_hammer_on',
    breath: 'smith_heart_final_body_breath_on',
    heat: 'smith_heart_final_body_heat_on',
    quench: 'smith_heart_final_body_quench_on',
  } as Readonly<Record<FinalBodyElement, string>>,
  off: {
    hammer: 'smith_heart_final_body_hammer_off',
    breath: 'smith_heart_final_body_breath_off',
    heat: 'smith_heart_final_body_heat_off',
    quench: 'smith_heart_final_body_quench_off',
  } as Readonly<Record<FinalBodyElement, string>>,
  /** The transformation: the roar (its Shift clip) and the cracks' flare. */
  shift: 'smith_heart_final_body_shift',
  charge: 'smith_heart_final_body_charge',
  /** The false death's stance (it kneels) and back on its feet. */
  kneel: 'smith_heart_final_body_kneel',
  stand: 'smith_heart_final_body_stand',
} as const;

/** The clips' beats, seconds at 1x (30 fps authoring, work/bl/anim.py). */
export const FINAL_BODY_CLIP = {
  /** The hammer-fist reaches the floor ahead. */
  attack: 15 / 30,
  /** Forge Fist's two fists land (the effects' own beat is 0.51 s). */
  slam: 15 / 30,
  /** The raised fists come down on the bar's end. */
  wrath: 87 / 30,
  /** The cupped storm is hurled. */
  pour: 54 / 30,
  /** The roar bursts open (the transformation's burst). */
  shiftBurst: 22 / 30,
  shiftLength: 54 / 30,
} as const;

/** The model's drawn height in yards at scale 1 (crown tip to soles): times
 *  the template's scale (3.6) it stands where the colossus stood. */
export const FINAL_BODY_HEIGHT = 5.6;

/** Points on the body as fractions of its drawn height: [forward, left, up]
 *  (left = the body's own left), measured on the rest pose of the .blend. */
export const FINAL_BODY_ANCHORS = {
  heart: [0.125, 0, 0.69],
  crown: [0.04, 0, 0.97],
  head: [0.04, 0, 0.9],
  shoulderL: [0.0, 0.2, 0.79],
  shoulderR: [0.0, -0.2, 0.79],
  fistL: [0.08, 0.36, 0.42],
  fistR: [0.08, -0.36, 0.42],
  hip: [0.0, 0, 0.48],
  footL: [0.0, 0.13, 0.03],
  footR: [0.0, -0.13, 0.03],
} as const satisfies Record<string, readonly [number, number, number]>;
export type FinalBodyAnchor = keyof typeof FINAL_BODY_ANCHORS;

/** Room-local yards of an anchor: the body at (x, y, z) facing `facing`
 *  (sim convention: 0 = +z), drawn `height` yards tall. */
export function finalBodyPoint(
  anchor: FinalBodyAnchor,
  x: number,
  y: number,
  z: number,
  facing: number,
  height: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const [f, l, u] = FINAL_BODY_ANCHORS[anchor];
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  // forward (sin f, cos f); the body's left (cos f, -sin f).
  out.x = x + (f * s + l * c) * height;
  out.y = y + u * height;
  out.z = z + (f * c - l * s) * height;
  return out;
}

// ---- the transformation ---------------------------------------------------------------------

/** The set piece's beats (seconds after the quarter changed): the charge
 *  (the old shell cracking, light bleeding through, the strength drawn in),
 *  the burst on the roar's opening (the body swaps under the flash), the
 *  crown re-forming, the new aura settling. */
export const FINAL_SHIFT = {
  burst: FINAL_BODY_CLIP.shiftBurst,
  crownEnd: 1.45,
  settleEnd: 2.4,
} as const;

export type FinalShiftStage = 'charge' | 'burst' | 'crown' | 'settle' | 'done';

/** Where the transformation is `age` seconds in, and its share through that
 *  stage (0 to 1). */
export function finalShiftStage(age: number): { stage: FinalShiftStage; k: number } {
  if (age < 0) return { stage: 'done', k: 1 };
  if (age < FINAL_SHIFT.burst) return { stage: 'charge', k: age / FINAL_SHIFT.burst };
  if (age < FINAL_SHIFT.burst + 0.12)
    return { stage: 'burst', k: (age - FINAL_SHIFT.burst) / 0.12 };
  if (age < FINAL_SHIFT.crownEnd)
    return {
      stage: 'crown',
      k: (age - FINAL_SHIFT.burst - 0.12) / (FINAL_SHIFT.crownEnd - FINAL_SHIFT.burst - 0.12),
    };
  if (age < FINAL_SHIFT.settleEnd)
    return {
      stage: 'settle',
      k: (age - FINAL_SHIFT.crownEnd) / (FINAL_SHIFT.settleEnd - FINAL_SHIFT.crownEnd),
    };
  return { stage: 'done', k: 1 };
}

/** The ambient aura's strength through a transformation: the old element's
 *  dies through the charge, the new one floods in hot after the burst and
 *  settles to 1. Returns [old, new]. */
export function finalShiftAura(age: number): [number, number] {
  if (age < 0 || age >= FINAL_SHIFT.settleEnd) return [0, 1];
  if (age < FINAL_SHIFT.burst) return [1 - age / FINAL_SHIFT.burst, 0];
  const k = (age - FINAL_SHIFT.burst) / (FINAL_SHIFT.settleEnd - FINAL_SHIFT.burst);
  return [0, 1 + 1.6 * (1 - k) * (1 - k)];
}

/** The quarter changed: a transformation plays only between two different
 *  elements of a body already seen whole (a first sight, a rebuilt view or
 *  the arrival just shows the right body). */
export function finalShiftStarts(
  shown: FinalBodyElement | null,
  next: FinalBodyElement,
  bodyWhole: boolean,
): boolean {
  return bodyWhole && shown !== null && shown !== next;
}

// ---- each element's look -------------------------------------------------------------------

export interface FinalElementLook {
  /** The element's light (flash, ring, crown), hex. */
  light: number;
  /** A second, hotter or paler tone for the core of the flash. */
  core: number;
  /** Particle colours, rgb 0..1. */
  spark: readonly [number, number, number];
  mist: readonly [number, number, number];
  /** Arcs of lightning in its burst and aura (the Breath only: the Quench's
   *  cold must never read as the storm). */
  bolts: boolean;
  /** Floating rocks orbit the body (the Hammer only). */
  rocks: boolean;
}

export const FINAL_ELEMENT_LOOK: Readonly<Record<FinalBodyElement, FinalElementLook>> = {
  hammer: {
    light: 0xffb84a,
    core: 0xfff0c8,
    spark: [1.0, 0.78, 0.36],
    mist: [0.46, 0.4, 0.34],
    bolts: false,
    rocks: true,
  },
  breath: {
    light: 0x4c9cff,
    core: 0xe8f4ff,
    spark: [0.45, 0.72, 1.0],
    mist: [0.86, 0.9, 0.96],
    bolts: true,
    rocks: false,
  },
  heat: {
    light: 0xff5a14,
    core: 0xffd890,
    spark: [1.0, 0.5, 0.12],
    mist: [0.3, 0.22, 0.2],
    bolts: false,
    rocks: false,
  },
  quench: {
    light: 0x9ee8ff,
    core: 0xffffff,
    spark: [0.78, 0.95, 1.0],
    mist: [0.86, 0.95, 1.0],
    bolts: false,
    rocks: false,
  },
};

/** The burst's particle counts at full density (the low tier thins them;
 *  the body's colour carries the element on every tier). */
export const FINAL_BURST_COUNTS = {
  debris: 48,
  sparks: 60,
  mist: 26,
  flames: 56,
  bolts: 7,
} as const;

/** Ambient emission per second at full density, per element. */
export const FINAL_AURA_RATES: Readonly<Record<FinalBodyElement, number>> = {
  hammer: 14,
  breath: 22,
  heat: 30,
  quench: 18,
};

/** The pools the body module keeps (fixed, built once). */
export const FINAL_BODY_POOLS = {
  /** Bolt segments: arcs times segments each. */
  boltArcs: 10,
  boltSegments: 7,
  rocks: 9,
} as const;

/** A jagged bolt's joint `i` of `n` between a and b (seeded, stable for the
 *  arc's life): the straight line pushed sideways by a hashed offset that
 *  is zero at both ends. */
export function boltJoint(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  i: number,
  n: number,
  seed: number,
  jag: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const t = i / n;
  const env = Math.sin(t * Math.PI);
  const h1 = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  const h2 = Math.sin(seed * 39.3468 + i * 11.135) * 24634.6345;
  const h3 = Math.sin(seed * 73.156 + i * 52.235) * 12345.6789;
  const r1 = (h1 - Math.floor(h1)) * 2 - 1;
  const r2 = (h2 - Math.floor(h2)) * 2 - 1;
  const r3 = (h3 - Math.floor(h3)) * 2 - 1;
  out.x = ax + (bx - ax) * t + r1 * jag * env;
  out.y = ay + (by - ay) * t + r2 * jag * env;
  out.z = az + (bz - az) * t + r3 * jag * env;
  return out;
}

/** A floating rock's orbit at `clock`: round the body at a radius, bobbing,
 *  its scale riding the aura's strength (0 hides it). */
export function finalRockOrbit(
  i: number,
  clock: number,
  height: number,
): { angle: number; radius: number; up: number; size: number } {
  const n = FINAL_BODY_POOLS.rocks;
  const angle = (i / n) * Math.PI * 2 + clock * (0.18 + 0.05 * (i % 3));
  const radius = height * (0.38 + 0.08 * ((i * 7) % 3));
  const up =
    height * (0.25 + 0.3 * (((i * 5) % 4) / 3)) + Math.sin(clock * 0.9 + i * 1.7) * height * 0.03;
  const size = height * (0.016 + 0.008 * ((i * 3) % 4));
  return { angle, radius, up, size };
}
