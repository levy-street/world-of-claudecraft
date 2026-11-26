// The Masterless Strength's own model (the Quadrant Guardian; rebuilt as the
// four-element titan on 2026-11-26): the pure half of final_body_fx.ts. One
// rigged GLB, ONE mesh and UV set, five paintings: the base form with all
// four elements bound in one body (the Hammer's gold-ochre granite on its
// right arm, the Quench's glacier ice on its left, the Heat's molten basalt
// and the Breath's storm slate in its legs, round a white-gold heart), and
// one painting per element over the whole of it. A form change swaps the
// painting and its glow map, never the model: the GLB lists the body as five
// mesh nodes over the same vertex data, one per material, and the quarter
// the boss stands in (the state aura's zone, already on every client) names
// the one shown (the base form in the ring). Changing quarter is a set
// piece: the shell cracks and bleeds light, the strength gathers, the new
// element bursts out over the floor and the crown re-forms in its colour,
// then that element's aura settles round the body.
//
// What lives here: the gesture ids the rig's mesh toggles, stance swaps and
// glow pulses answer (characters/smith_heart_boss_looks.ts binds them, the fx
// module sends them), the clip beats, the form and the element of a zone, the
// transformation's timeline, each element's burst and aura recipe, and the
// body's anchor points as fractions of its drawn height. Node-only
// (RENDER_PURE_CORES): no three.js, no DOM, no allocation per call beyond the
// returned records the fx module reads into its own scratch.

import type { HeartQuarterZone } from '../../sim/content/smith_heart_quarters';

/** The four elements, one per quarter (their auras and bursts). */
export type FinalBodyElement = 'hammer' | 'breath' | 'heat' | 'quench';
export const FINAL_BODY_ELEMENTS: readonly FinalBodyElement[] = [
  'hammer',
  'breath',
  'heat',
  'quench',
];

/** The element a zone drinks: its own quarter's, the Hammer's in the ring
 *  (its aura of floating rock round the base form). */
export function finalBodyElement(zone: HeartQuarterZone): FinalBodyElement {
  return zone === 'ring' ? 'hammer' : zone;
}

/** The five paintings the one mesh wears: the base form (the four elements
 *  bound in one body, the approved concept sheet) and one per element. */
export type FinalBodyForm = 'four' | FinalBodyElement;
export const FINAL_BODY_FORMS: readonly FinalBodyForm[] = [
  'four',
  'hammer',
  'breath',
  'heat',
  'quench',
];

/** The form a zone shows: its own quarter's element over the whole body,
 *  the base form in the ring (the arrival, the pull, the walk between
 *  quarters). */
export function finalBodyForm(zone: HeartQuarterZone): FinalBodyForm {
  return zone === 'ring' ? 'four' : zone;
}

/** The element whose aura and burst a form wears (the base form: the
 *  ring's, finalBodyElement). */
export function finalFormElement(form: FinalBodyForm): FinalBodyElement {
  return form === 'four' ? 'hammer' : form;
}

/** The GLB's mesh node per form: five nodes over one set of vertex data,
 *  each with its own painting and glow map. */
export const FINAL_BODY_NODES: Readonly<Record<FinalBodyForm, readonly string[]>> = {
  four: ['Body_Four'],
  hammer: ['Body_Hammer'],
  breath: ['Body_Breath'],
  heat: ['Body_Heat'],
  quench: ['Body_Quench'],
};

/** Presentation gestures (the renderer's triggerAttack seam). Never sim ids. */
export const FINAL_BODY_GESTURES = {
  /** The whole model hidden (the heart asleep, the pieces still flying in). */
  hide: 'smith_heart_final_body_hide',
  show: 'smith_heart_final_body_show',
  /** One form's painting on or off (consumed, idempotent; re-sent for a
   *  rebuilt view). */
  on: {
    four: 'smith_heart_final_body_four_on',
    hammer: 'smith_heart_final_body_hammer_on',
    breath: 'smith_heart_final_body_breath_on',
    heat: 'smith_heart_final_body_heat_on',
    quench: 'smith_heart_final_body_quench_on',
  } as Readonly<Record<FinalBodyForm, string>>,
  off: {
    four: 'smith_heart_final_body_four_off',
    hammer: 'smith_heart_final_body_hammer_off',
    breath: 'smith_heart_final_body_breath_off',
    heat: 'smith_heart_final_body_heat_off',
    quench: 'smith_heart_final_body_quench_off',
  } as Readonly<Record<FinalBodyForm, string>>,
  /** The transformation: the roar (its Shift clip) and the cracks' flare. */
  shift: 'smith_heart_final_body_shift',
  charge: 'smith_heart_final_body_charge',
  /** The false death's stance (it kneels) and back on its feet. */
  kneel: 'smith_heart_final_body_kneel',
  stand: 'smith_heart_final_body_stand',
  /** The arrival (final_arrival_core.ts): the still knee it waits on, the
   *  push back to its feet (its Rise clip), and the cracks held black while
   *  it sleeps (a glow pulse to nothing, re-sent while dormant). */
  dormant: 'smith_heart_final_body_dormant',
  rise: 'smith_heart_final_body_rise',
  dark: 'smith_heart_final_body_dark',
  /** The Overload in its own body (final_overload_core.ts strainPulse): its
   *  cracks throbbing brighter, three steps as the bar fills. */
  strain: [
    'smith_heart_final_body_strain_1',
    'smith_heart_final_body_strain_2',
    'smith_heart_final_body_strain_3',
  ] as const,
} as const;

/** The clips' beats, seconds at 1x (30 fps authoring; the rebuilt body keeps
 *  the first model's beats, so every bar and cue lands where it did). */
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
  /** The Kneel: it holds its feet until the drop starts, and the knee is down. */
  kneelDrop: 12 / 30,
  kneelDown: 20 / 30,
  /** The Rise: it gathers on its knee until the push starts, and it stands. */
  risePush: 27 / 30,
  riseStood: 57 / 30,
  riseLength: 72 / 30,
} as const;

/** The model's drawn height in yards at scale 1 (the halo's top crystal to
 *  the soles): times the template's scale (3.6) its head and shoulders stand
 *  where the first model's did, the halo over them. */
export const FINAL_BODY_HEIGHT = 6;

/** Points on the body as fractions of its drawn height: [forward, left, up]
 *  (left = the body's own left), measured on the Idle's first pose of the
 *  bound mesh (the heart crystal's point, the crown's tines, the eyes, the
 *  pauldrons, the fists, the pelvis, the soles). */
export const FINAL_BODY_ANCHORS = {
  heart: [0.16, 0, 0.64],
  crown: [0.05, 0, 0.92],
  head: [0.07, 0, 0.8],
  shoulderL: [-0.02, 0.19, 0.72],
  shoulderR: [-0.02, -0.19, 0.72],
  fistL: [0.15, 0.31, 0.4],
  fistR: [0.15, -0.31, 0.4],
  hip: [0.0, 0, 0.44],
  footL: [0.025, 0.18, 0.03],
  footR: [0.025, -0.18, 0.03],
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

/** The heart and the eyes with the body on its knee (Dormant, KneelIdle, the
 *  Kneel's settled pose), as `FINAL_BODY_ANCHORS` has them standing: the
 *  kneel folds the chest forward and down further than it lowers the head,
 *  and leans the body over its right knee. Measured on the rig: the standing
 *  anchors carried by their bones (the chest, the head) into the Dormant
 *  pose (tests/smith_heart_final_body_clips.test.ts reads them off the GLB). */
export const FINAL_BODY_KNEEL_ANCHORS = {
  heart: [0.2, -0.05, 0.31],
  head: [0.205, -0.045, 0.475],
} as const satisfies Partial<Record<FinalBodyAnchor, readonly [number, number, number]>>;
export type FinalBodyKneelAnchor = keyof typeof FINAL_BODY_KNEEL_ANCHORS;

/** The same two points as sockets on the live rig (final_body_sockets.ts):
 *  each rides its bone at the offset its standing anchor has in that bone's
 *  frame (the model's own units, re-derived from the GLB by the same test),
 *  so the heart's glow and the eyes follow every clip, the Shift's fold and a
 *  strike's lunge included. The anchors stand in while no view is up. */
export const FINAL_BODY_SOCKETS: readonly {
  id: FinalBodyKneelAnchor;
  bone: string;
  local: readonly [number, number, number];
}[] = [
  { id: 'heart', bone: 'Chest', local: [-0.018, 0.188, 0.372] },
  { id: 'head', bone: 'Head', local: [-0.018, 0.053, 0.121] },
];
export type FinalBodySocketId = FinalBodyKneelAnchor;

/** `finalBodyPoint` for a body `kneel` of the way onto its knee (0 standing,
 *  1 knelt): the anchor slides between its two measured places. */
export function finalBodyKneelPoint(
  anchor: FinalBodyKneelAnchor,
  kneel: number,
  x: number,
  y: number,
  z: number,
  facing: number,
  height: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const k = kneel < 0 ? 0 : kneel > 1 ? 1 : kneel;
  const up = FINAL_BODY_ANCHORS[anchor];
  const down = FINAL_BODY_KNEEL_ANCHORS[anchor];
  const f = up[0] + (down[0] - up[0]) * k;
  const l = up[1] + (down[1] - up[1]) * k;
  const u = up[2] + (down[2] - up[2]) * k;
  const s = Math.sin(facing);
  const c = Math.cos(facing);
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
 *  forms of a body already seen whole (a first sight, a rebuilt view or the
 *  arrival just shows the right painting). */
export function finalShiftStarts(
  shown: FinalBodyForm | null,
  next: FinalBodyForm,
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
