// The Guardian of the Quench's own model (docs/design/raid/smith_heart.md
// sections 5.20 and 7.3): the pure half of quench_body.ts. Jose's design, "the
// Quencher", built on the official pipeline (a T-pose turnaround, Tripo3D, a
// skeleton made for the mesh in Blender with hand-solved weights, every clip
// authored for it at 30 fps): a regal giantess of dark polished blue-slate
// stone who cooled every blade the Smith forged in this lake and has guarded it
// since. Fine frost cracks glow in her skin; her hair of deep lake-water blue
// falls to the floor in a few great locks; her gown is layered panels of ice
// with a wrap across the chest and over one shoulder; thick ice bracers on both
// forearms (she fights with her fists); bare feet; a crown of tall ice shards;
// glowing eyes and a star-shaped heart blazing in her chest. Stone, ice and the
// cold only: nothing metal, no weapon.
//
// The rig plays the motion (characters/smith_heart_boss_looks.ts binds the
// clips; her gown and her hair ride their own bone chains with a spring's
// follow-through baked in); this module plans what the effects layer adds on
// top: the gesture ids, the clip beats the bursts are timed to, the sockets the
// cold rides (points on the model at rest, carried by their bones), what each
// bar and blow does to her light, the rime her steps freeze into the lake, the
// Blades Wake's column and lines, the death's frost climbing her into a statue.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic (a hash,
// never rng).

import {
  QUENCH_AURAS,
  QUENCH_CASTS,
  QUENCH_GUARDIAN,
  QUENCH_TUNING,
} from '../../sim/encounters/smith_heart/quench_ids';
import type { V3 } from './final_fx_core';

export type { V3 };
export { QUENCH_GUARDIAN };

// ---- the model -------------------------------------------------------------------------

/** The shipped body (public/models/creatures). */
export const QUENCH_BODY_URL = 'models/creatures/smith_heart_quench_guardian.glb';

/** Every clip the GLB carries. */
export const QUENCH_BODY_CLIPS = [
  'Idle',
  'Move',
  'Attack',
  'Attack2',
  'Strike',
  'Breath',
  'Wake',
  'WakeHold',
  'Slash',
  'Taunt',
  'Death',
] as const;

/** The model's own height (her soles to the crown's tallest shard) in its
 *  authored units. */
export const QUENCH_MODEL_UNITS = 10;

/** The template's scale (content/smith_heart.ts heart_quench_guardian). */
export const QUENCH_BODY_SCALE = 3;

/** The drawn height at scale 1: her crown about eleven yards over the lake,
 *  near six players (the provisional body stood three and a half). */
export const QUENCH_BODY_HEIGHT = 3.6;

/** Yards a model unit is drawn at. */
export const QUENCH_YD_PER_UNIT = (QUENCH_BODY_HEIGHT * QUENCH_BODY_SCALE) / QUENCH_MODEL_UNITS;

/** The clips' beats, in seconds at a time scale of 1 (frame / 30). */
export const QUENCH_BODY_CLIP = {
  /** A swing's fist meets the tank (Attack: the right backhand; Attack2: the
   *  left hook). */
  attack: 16 / 30,
  /** Tempering Strike: both fists hammered down on the ice (Strike). */
  strike: 12 / 30,
  /** Quenching Breath: reared back through the bar, the cold thrown out of
   *  her mouth on the bar's end (Breath; its exhale plays out after it). */
  breath: 75 / 30,
  breathEnd: 112 / 30,
  /** The Blades Wake: both arms to the sky, thrown down on the bar's end. */
  wake: 120 / 30,
  wakeEnd: 150 / 30,
  /** A slash: her hand sweeps out and points at the blade's line. */
  slash: 12 / 30,
  /** The death: on her knees, then still (a statue). */
  deathKneel: 52 / 30,
  deathStill: 70 / 30,
} as const;

/** Presentation gestures (the renderer's triggerAttack seam). Never sim ids. */
export const QUENCH_BODY_GESTURES = {
  /** The pull: chin raised, arms opened, a beckoning hand (Taunt). */
  taunt: 'smith_heart_quench_body_taunt',
  /** She commands a blade: her hand sweeps out and points (Slash). */
  slash: 'smith_heart_quench_body_slash',
  /** Her eyes, crown and heart flare (the breath loosed, the blades thrown). */
  flare: 'smith_heart_quench_body_flare',
} as const;

/** The bars that play a clip timed onto the bar's end, and the beat that lands
 *  there (the Blades Hunt's long bar loops its held pose instead). */
export const QUENCH_SYNCED_CASTS: Readonly<Record<string, number>> = {
  [QUENCH_CASTS.breath]: QUENCH_BODY_CLIP.breath,
  [QUENCH_CASTS.wake]: QUENCH_BODY_CLIP.wake,
};

/** Seconds between two slash gestures (a round's lines show together). */
export const QUENCH_SLASH_GAP = 2.5;

// ---- the sockets: points on the model at rest, carried by their bones -------------------

export type QuenchSocketId =
  | 'heart'
  | 'core'
  | 'eyeL'
  | 'eyeR'
  | 'mouth'
  | 'crown'
  | 'crownL'
  | 'crownR'
  | 'shoulderL'
  | 'shoulderR'
  | 'bracerL'
  | 'bracerR'
  | 'handL'
  | 'handR'
  | 'footL'
  | 'footR'
  | 'hem0'
  | 'hem1'
  | 'hem2'
  | 'hem3'
  | 'hem4'
  | 'hem5'
  | 'hem6'
  | 'hem7'
  | 'tipL'
  | 'tipR'
  | 'tipB'
  | 'tipB2';

/** A socket: a point of the model at rest (`at`, its authored units, y up, her
 *  face toward +z: the fallback while a view loads) and the same point in the
 *  frame of the bone that carries it (`local`, read off the shipped GLB's rest
 *  pose; tests/smith_heart_quench_body.test.ts re-derives it from the file).
 *  Bone names as authored (the loader drops the dots: `hand.L` is `handL`). */
export interface QuenchSocket {
  id: QuenchSocketId;
  bone: string;
  at: readonly [number, number, number];
  local: readonly [number, number, number];
}

/** `at` authored in the Blender frame (x her left, y back, z up) and turned
 *  into the model's (x, z, -y) here, so the numbers read against the .blend. */
function sock(
  id: QuenchSocketId,
  bone: string,
  blender: readonly [number, number, number],
  local: readonly [number, number, number],
): QuenchSocket {
  const [x, y, z] = blender;
  return { id, bone, at: [x, z, -y], local };
}

export const QUENCH_SOCKETS: readonly QuenchSocket[] = [
  sock('heart', 'chest', [0.04, -0.98, 7], [0.04, 0.348, 1.049]),
  sock('core', 'chest', [0, 0.05, 7], [0, 0.4, 0.02]),
  sock('eyeL', 'head', [0.19, -0.56, 8.86], [0.19, 0.66, 0.56]),
  sock('eyeR', 'head', [-0.19, -0.56, 8.86], [-0.19, 0.66, 0.56]),
  sock('mouth', 'head', [0, -0.62, 8.42], [0, 0.22, 0.62]),
  sock('crown', 'head', [0, -0.25, 9.85], [0, 1.65, 0.25]),
  sock('crownL', 'head', [0.42, -0.15, 9.55], [0.42, 1.35, 0.15]),
  sock('crownR', 'head', [-0.42, -0.15, 9.55], [-0.42, 1.35, 0.15]),
  sock('shoulderL', 'clavicle.L', [1.1, 0.07, 7.5], [-0.08, 0.848, 0]),
  sock('shoulderR', 'clavicle.R', [-1.1, 0.07, 7.5], [0.08, 0.848, 0]),
  sock('bracerL', 'forearm.L', [3.5, 0.02, 7.2], [-0.044, 0.85, -0.016]),
  sock('bracerR', 'forearm.R', [-3.5, 0.02, 7.2], [0.044, 0.85, -0.016]),
  sock('handL', 'hand.L', [4.6, -0.25, 7.05], [0.027, 0.45, 0.042]),
  sock('handR', 'hand.R', [-4.6, -0.25, 7.05], [-0.027, 0.45, 0.042]),
  sock('footL', 'foot.L', [0.95, -0.6, 0.3], [0.005, 0.625, -0.083]),
  sock('footR', 'foot.R', [-0.95, -0.6, 0.3], [-0.005, 0.625, -0.083]),
  sock('hem0', 'skirt0.2', [0, -1.56, 0.35], [0, 1.713, 0]),
  sock('hem1', 'skirt1.2', [1.5, -1.45, 0.35], [-0.004, 1.773, 0.003]),
  sock('hem2', 'skirt2.2', [3.59, 0.05, 0.35], [-0.001, 2.405, 0]),
  sock('hem3', 'skirt3.2', [2.8, 2.85, 0.35], [-0.002, 2.407, -0.001]),
  sock('hem4', 'skirt4.2', [0, 3.73, 0.35], [0, 2.181, 0]),
  sock('hem5', 'skirt5.2', [-2.73, 2.78, 0.35], [-0.002, 2.271, 0.001]),
  sock('hem6', 'skirt6.2', [-3.5, 0.05, 0.35], [0.003, 2.214, 0]),
  sock('hem7', 'skirt7.2', [-1.3, -1.25, 0.35], [-0.001, 1.771, -0.001]),
  sock('tipL', 'lockL.3', [0.73, 2.74, 1.65], [-0.005, 2.282, -0.001]),
  sock('tipR', 'lockR.3', [-1.89, 0.54, 4.09], [-0.003, 1.106, -0.005]),
  sock('tipB', 'hairB.3', [0, 1.95, 3.4], [0, 1.346, 0]),
  sock('tipB2', 'lockB.2', [-1.91, 2.86, 1.47], [-0.003, 1.973, 0.003]),
];

/** A socket's index by id (the painter keeps its live points in this order). */
export function quenchSocketIndex(id: QuenchSocketId): number {
  return QUENCH_SOCKETS.findIndex((s) => s.id === id);
}

/** The gown's hem, round her (the mist rolls off these). */
export const QUENCH_HEM: readonly QuenchSocketId[] = [
  'hem0',
  'hem1',
  'hem2',
  'hem3',
  'hem4',
  'hem5',
  'hem6',
  'hem7',
];
/** Her hair's tips (frozen vapour trails off them). */
export const QUENCH_HAIR_TIPS: readonly QuenchSocketId[] = ['tipL', 'tipR', 'tipB', 'tipB2'];

// ---- what she is doing ---------------------------------------------------------------------

export type QuenchBodyAction = 'idle' | 'strike' | 'breath' | 'exhale' | 'wake' | 'thrown' | 'hunt';

/** The fight's state as the body reads it (mirrored entity state, plus the
 *  painter's own clocks of the cues it saw). */
export interface QuenchBodyInput {
  castId: string | null;
  castFill: number;
  /** Seconds since the breath was loosed (its bar's end), Infinity: never. */
  sinceBreath: number;
  /** Seconds since Tempering Strike's cue, Infinity: never. */
  sinceStrike: number;
  /** Seconds since the blades were thrown awake (the wake bar's end). */
  sinceWake: number;
}

export interface QuenchBodyActionState {
  action: QuenchBodyAction;
  k: number;
}

/** Seconds each aftermath reads for. */
export const QUENCH_EXHALE_SECONDS = 1.1;
export const QUENCH_THROWN_SECONDS = 1.4;
export const QUENCH_STRIKE_SECONDS = 1.0;

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/** The action and its clock (0..1), written into `out` (no allocation on the
 *  frame path). The bars first, then the aftermaths. */
export function quenchBodyAction(
  input: QuenchBodyInput,
  out: QuenchBodyActionState = { action: 'idle', k: 0 },
): QuenchBodyActionState {
  if (input.castId === QUENCH_CASTS.flurry) {
    out.action = 'hunt';
    out.k = clamp01(input.castFill);
  } else if (input.castId === QUENCH_CASTS.wake) {
    out.action = 'wake';
    out.k = clamp01(input.castFill);
  } else if (input.castId === QUENCH_CASTS.breath) {
    out.action = 'breath';
    out.k = clamp01(input.castFill);
  } else if (input.sinceWake < QUENCH_THROWN_SECONDS) {
    out.action = 'thrown';
    out.k = input.sinceWake / QUENCH_THROWN_SECONDS;
  } else if (input.sinceBreath < QUENCH_EXHALE_SECONDS) {
    out.action = 'exhale';
    out.k = input.sinceBreath / QUENCH_EXHALE_SECONDS;
  } else if (input.sinceStrike < QUENCH_STRIKE_SECONDS) {
    out.action = 'strike';
    out.k = input.sinceStrike / QUENCH_STRIKE_SECONDS;
  } else {
    out.action = 'idle';
    out.k = 0;
  }
  return out;
}

/** Her light for an action: the heart's blaze, the eyes, the crown, the
 *  bracers (all ~0.6 at rest, past 1 flaring), how much cold gathers into her
 *  mouth (0..1, the breath's draw), the frost plume of an out-breath (0..1),
 *  and the Blades Wake's column of cold light (0..1). */
export interface QuenchGlowLook {
  heart: number;
  eyes: number;
  crown: number;
  bracers: number;
  gather: number;
  plume: number;
  column: number;
}

export function newGlowLook(): QuenchGlowLook {
  return { heart: 0, eyes: 0, crown: 0, bracers: 0, gather: 0, plume: 0, column: 0 };
}

/** The idle's breath period (seconds; the clip's own loop is 4 s). */
export const QUENCH_BREATH_PERIOD = 4;

/** The look of `action` at `k`, on render time `t`, written into `out`. */
export function quenchGlowLook(
  action: QuenchBodyAction,
  k: number,
  t: number,
  awake: boolean,
  out: QuenchGlowLook = newGlowLook(),
): QuenchGlowLook {
  const beat = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1.6);
  out.heart = 0.75 + 0.25 * beat * beat;
  out.eyes = 0.8;
  out.crown = awake ? 1.15 + 0.2 * Math.sin(t * 2.3) : 0.65;
  out.bracers = 0.55 + 0.1 * beat;
  out.gather = 0;
  // A slow plume of frost on every out-breath.
  out.plume = clamp01(Math.sin((t * Math.PI * 2) / QUENCH_BREATH_PERIOD + 0.6)) ** 2 * 0.55;
  out.column = 0;
  const p = clamp01(k);
  switch (action) {
    case 'breath':
      // Rears back and fills with the cold: the heart blazing, the cold
      // pouring into her mouth, held tight just before the end.
      out.heart = 1 + 1.8 * ease(p);
      out.eyes = 0.9 + 0.9 * ease(p);
      out.gather = ease(Math.min(1, p * 1.25));
      out.plume = 0;
      break;
    case 'exhale':
      out.heart = 2.6 - 1.6 * p;
      out.eyes = 1.6 - 0.7 * p;
      out.plume = 0;
      break;
    case 'strike':
      out.bracers = 0.6 + 1.6 * (1 - p);
      out.heart = out.heart + 0.5 * (1 - p);
      break;
    case 'wake':
      // Arms to the sky: the crown and the heart blaze, the column climbs.
      out.heart = 1 + 2.2 * ease(p);
      out.crown = 0.8 + 2.6 * ease(p);
      out.eyes = 1 + 0.8 * ease(p);
      out.bracers = 0.6 + 1.2 * ease(p);
      out.column = ease(Math.min(1, p * 1.15));
      out.plume = 0;
      break;
    case 'thrown':
      out.heart = 3.2 - 2 * p;
      out.crown = 3.4 - 2 * p;
      out.eyes = 1.8 - 0.8 * p;
      out.column = Math.max(0, 1 - p * 2.2);
      out.plume = 0;
      break;
    case 'hunt':
      out.heart = 1.8 + 0.3 * beat;
      out.crown = 2.4 + 0.3 * Math.sin(t * 3.1);
      out.eyes = 1.5;
      out.column = 0.55;
      out.plume = 0;
      break;
    default:
      break;
  }
  return out;
}

// ---- the death: frost climbs her into a statue -----------------------------------------------

/** The death `t` seconds after she fell: how high the frost has climbed her
 *  (share of her height, past 1 her whole body), her light fading out, the
 *  mist breathing off the statue, the burst of crystals as the last of her
 *  freezes (`sealed`, 1 at the moment the frost reaches her crown). */
export function quenchDeathLook(t: number): {
  frost: number;
  glow: number;
  mist: number;
  sealed: number;
} {
  const from = QUENCH_BODY_CLIP.deathKneel - 0.4;
  const climb = 2.4;
  const frost = t < from ? 0 : Math.min(1.05, ((t - from) / climb) * 1.05);
  const end = from + climb;
  return {
    frost,
    glow: clamp01(1 - (t - from) / (climb + 0.6)) ** 1.3,
    mist: t < 0 ? 0 : clamp01(t / 1.2) * clamp01(1 - (t - end - 3) / 6),
    sealed: t < end ? 0 : clamp01(1 - (t - end) / 0.9),
  };
}

/** The statue's glaze on her own material (characters/surface_response.ts
 *  setGlaze, the program the cold already paints on the raid), written into
 *  `out`: the rime climbing from her feet with the death's frost, its cold rim
 *  bright as it climbs, held whole on the statue. */
export function quenchStatueGlaze(
  t: number,
  out: { height: number; glow: number; bite: number; alpha: number },
): { height: number; glow: number; bite: number; alpha: number } {
  const d = quenchDeathLook(t);
  out.height = d.frost;
  out.glow = 0.6 + 0.9 * clamp01(1.05 - d.frost) + 0.6 * d.sealed;
  out.bite = d.frost > 0.05 && d.frost < 1.04 ? 0.6 : 0;
  out.alpha = d.frost > 0 ? Math.min(1, 0.4 + d.frost) : 0;
  return out;
}

// ---- the rime her steps freeze into the lake -------------------------------------------------

/** A ring of new rime is frozen under her every this many yards she walks,
 *  and lingers this long (the lake freezing where she steps). */
export const QUENCH_RIME_STEP = 3.2;
export const QUENCH_RIME_LIFE = 7;
/** The rings' pool (the low tier keeps fewer). */
export const QUENCH_RIME_POOL = 14;
export const QUENCH_RIME_POOL_LOW = 6;

/** One rime ring `age` seconds after it froze: its radius (yards; it spreads
 *  quickly, then sets) and its strength (0..1, a slow thaw away). */
export function quenchRimeLook(
  age: number,
  out: { radius: number; alpha: number } = { radius: 0, alpha: 0 },
): { radius: number; alpha: number } {
  const R = 3.4 * QUENCH_YD_PER_UNIT;
  const k = clamp01(age / 0.7);
  out.radius = R * (0.45 + 0.55 * (1 - (1 - k) ** 3));
  out.alpha =
    age < 0 || age > QUENCH_RIME_LIFE
      ? 0
      : clamp01(age / 0.25) * clamp01((QUENCH_RIME_LIFE - age) / 3);
  return out;
}

// ---- the Blades Wake: the column and the lines to the blades ---------------------------------

/** The wake's throw `age` seconds after her arms come down: how far along
 *  (0..1) the bright line racing to each blade is, its brightness, and the
 *  frost wave's reach (share of the way to the blades). */
export function quenchWakeLineLook(age: number): { head: number; alpha: number; wave: number } {
  const run = 0.55;
  const head = clamp01(age / run);
  return {
    head: 1 - (1 - head) ** 2,
    alpha: age < 0 ? 0 : clamp01(1 - (age - run) / 0.9),
    wave: clamp01(age / 1.1),
  };
}

/** Seconds the throw's lines and wave read for. */
export const QUENCH_WAKE_LINE_SECONDS = 1.5;

/** Are the blades awake (the marker on the guardian)? */
export function bladesAwakeOn(auras: readonly { id: string }[]): boolean {
  for (const a of auras) if (a.id === QUENCH_AURAS.awake) return true;
  return false;
}

/** The breath's cone (the sim's own numbers): the exhale's snow fans to this
 *  half angle and reaches this far, so it never reads past the cone. */
export const QUENCH_BREATH_CONE = {
  range: QUENCH_TUNING.breathRange,
  halfArc: (QUENCH_TUNING.breathArcDeg * Math.PI) / 360,
} as const;

/** A deterministic 0..1 hash. */
export function quenchBodyHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2c1b3c6d) ^ Math.imul(b | 0, 0x1b873593)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- the palette ----------------------------------------------------------------------------

/** The lake's cold light (linear 0..1, hex for the glows). Never a threat
 *  colour: the telegraphs' own edges stay theirs. */
export const QUENCH_BODY_COLORS = {
  heart: 0xd8f6ff,
  heartHalo: 0x6fd2ff,
  eye: 0xbff2ff,
  crown: 0x9fe6ff,
  bracer: 0x7fdcff,
  flash: 0xcdeeff,
  ring: 0x9fdcff,
  column: [0.36, 0.7, 1.0] as const,
  /** The mist and the snow are drawn unlit and a touch dimmed by the smoke
   *  pool's own shading: kept cold blue-white over 1 so they never read warm
   *  against the lake's blue. */
  mist: [0.55, 0.78, 1.15] as const,
  snow: [0.8, 0.92, 1.15] as const,
  glitter: [0.7, 0.92, 1.0] as const,
  shard: [0.78, 0.93, 1.0] as const,
  rime: [0.86, 0.95, 1.0] as const,
} as const;

/** Bounded bursts (the Heat pass's lesson: a flash on its point only, never
 *  a white-out of the screen): the largest flash sprite (yards) and its peak. */
export const QUENCH_BURST = { flashMax: 9, flashPeak: 0.7 } as const;

/** Pools at full density. */
export const QUENCH_BODY_POOLS = {
  sockets: QUENCH_SOCKETS.length,
  flashes: 4,
  rime: QUENCH_RIME_POOL,
  lines: 4,
} as const;
