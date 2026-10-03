// Pure plan for the Calving Face, the Sanctum's showpiece (design section 3):
// the face's frame shared with the Blender kit (docs/design/dungeon-rework/
// kit/gravewyrm_face.py: every Face* piece, Kit_WyrmSilhouette and
// Kit_WyrmHeart share it), the shape functions ported from it (the foot's arc,
// the crest, the relief, the clear shell's window, the stage-4 calved hole,
// the stage-1 scar) so the procedural stand-in and the chain entries agree
// with the kit to the yard, where the frozen Korzul stands inside it (the
// swap seam: one URL and one placement), and every stage's timeline (the
// plate falling, the cracks racing, the chains falling out of the ice, the
// split, the calving, the collapse) as plain curves of the seconds since the
// stage rose. Staged swaps and short one-shots, never simulated.
//
// Three-free, DOM-free, deterministic.

import { KORZUL_BURST_AT } from '../gravewyrm_sanctum_bosses/boss_model_core';
import { faceStageLook, heartbeat } from './sanctum_plan_core';

// ---- the face's frame -------------------------------------------------------------

/** Where the face frame's origin (the front base centre, at the lake's level)
 *  stands in the instance frame. The face looks south over the lake: the kit
 *  frame is turned a half turn, so its +x runs west (game -x) and its depth
 *  (+y, into the ice) runs north (game +z). At z 256 the wings reach z 234. */
export const FACE_ORIGIN = { x: 0, y: 0, z: 256 } as const;

/** Kit face frame (x right as seen from the lake, y into the ice, z up) to the
 *  instance frame. */
export function faceToGame(fx: number, fy: number, fz: number): [number, number, number] {
  return [FACE_ORIGIN.x - fx, FACE_ORIGIN.y + fz, FACE_ORIGIN.z + fy];
}

export const FACE_HALF = 80;
export const FACE_TOP = 100;
/** Where Korgath's four chains run into the ice (face frame x, z). */
export const FACE_CHAIN_ENTRIES: readonly (readonly [number, number])[] = [
  [-56, 44],
  [-24, 72],
  [28, 70],
  [58, 46],
];
/** The clear shell over the hollow the wyrm is coiled in. */
export const WINDOW_C = [6, 29] as const;
export const WINDOW_R = [49, 28.5] as const;
/** The hole the face calves at stage 4 (over the head and the neck). */
export const CALVED_C = [-20, 31] as const;
export const CALVED_R = [21, 21] as const;
/** The stage-1 scar: centre x, z, half width, half height. */
export const SCAR = [46, 9, 13, 10] as const;

// The kit's noise (hckit.py _hash3, _vnoise, _fbm), so the relief matches.
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (i: number, j: number, k: number) => hash3(xi + i, yi + j, zi + k);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** Two octaves of smooth value noise in [0, 1) (the kit's _fbm). */
export function kitFbm(x: number, y: number, z: number): number {
  return (vnoise(x, y, z) * 2 + vnoise(x * 2.07 + 17, y * 2.07, z * 2.07)) / 3;
}

/** The foot's concave arc (face frame y; negative toward the lake). */
export function faceBaseY(x: number): number {
  return -22 * (x / FACE_HALF) ** 2;
}

/** The crest's height over the lake at face frame x. */
export function faceTop(x: number): number {
  const t = Math.abs(x) / FACE_HALF;
  return FACE_TOP - 30 * t ** 3 + 7 * (kitFbm(x * 0.06, 3, 1) - 0.5);
}

/** How far the ice stands proud toward the lake at (x, z). */
export function faceRelief(x: number, z: number): number {
  let b = 5 * Math.exp(-(((x + 34) / 22) ** 2) - ((z - 62) / 26) ** 2);
  b += 4 * Math.exp(-(((x - 44) / 18) ** 2) - ((z - 34) / 24) ** 2);
  b += 3 * Math.exp(-(((x - 6) / 30) ** 2) - ((z - 82) / 14) ** 2);
  b += 2.6 * Math.exp(-(((x + 62) / 12) ** 2) - ((z - 26) / 20) ** 2);
  b += 0.045 * z;
  const groove = Math.sin(x * 0.42 + kitFbm(x * 0.05, z * 0.02, 2) * 5);
  b -= 1.6 * Math.max(0, groove) ** 8;
  b += 0.9 * (kitFbm(x * 0.5, z * 0.035, 7) - 0.5);
  b += 0.6 * (kitFbm(x * 0.16, z * 0.16, 9) - 0.5);
  return b;
}

/** The face's front surface (face frame y) at (x, z). */
export function faceY(x: number, z: number): number {
  return faceBaseY(x) - faceRelief(x, z);
}

/** < 1 inside the clear shell over the hollow. */
export function windowR(x: number, z: number): number {
  const dx = (x - WINDOW_C[0]) / WINDOW_R[0];
  const dz = (z - WINDOW_C[1]) / WINDOW_R[1];
  const a = Math.atan2(dz, dx);
  const wob = 1 + 0.1 * Math.sin(a * 3 + 0.7) + 0.06 * Math.sin(a * 7 + 2.1);
  return Math.hypot(dx, dz) / wob;
}

/** < 1 where the shell has calved away at stage 4. */
export function calvedR(x: number, z: number): number {
  const dx = (x - CALVED_C[0]) / CALVED_R[0];
  const dz = (z - CALVED_C[1]) / CALVED_R[1];
  const a = Math.atan2(dz, dx);
  const jag =
    1 + 0.16 * Math.sin(a * 5 + 1.3) + 0.09 * Math.sin(a * 11 + 0.4) + 0.05 * Math.sin(a * 23);
  return Math.hypot(dx, dz) / jag;
}

/** The chain entries in the instance frame (on the face's surface). */
export function faceChainEntries(): [number, number, number][] {
  return FACE_CHAIN_ENTRIES.map(([x, z]) => faceToGame(x, faceY(x, z), z));
}

// ---- the wyrm in the ice (the swap seam) --------------------------------------------

/** The frozen Korzul (E:/woc/entregas/santuario/korzul, `korzul_frozen.glb`:
 *  the Frozen pose baked to plain meshes, glTF +Z his front, +X his left,
 *  origin on the ice under his body). Swap the model by changing the URL; a
 *  replacement in the same frame drops in. */
export const FROZEN_WYRM_URL = '/models/props/gravewyrm_sanctum_korzul_frozen.glb';

/**
 * Where the frozen Korzul stands in the instance frame: side-on to the lake,
 * facing east (his left flank toward the group), so his head, curled to his
 * left toward the lake, lies under the stage-4 calved hole and his chest at
 * the kit's heart. `scale` is the drawn scale: the ice of the face is a lens a
 * hundred yards thick and the coiled wyrm fills the hollow behind the shell
 * (the fighting Korzul on the lake keeps the model's own 1.0).
 */
export const FROZEN_WYRM = { x: -6, y: 3, z: 278.5, yaw: Math.PI / 2, scale: 1.7 } as const;

/** A point of the frozen model's own frame in the instance frame. */
export function frozenToGame(lx: number, ly: number, lz: number): [number, number, number] {
  const s = FROZEN_WYRM.scale;
  const c = Math.cos(FROZEN_WYRM.yaw);
  const n = Math.sin(FROZEN_WYRM.yaw);
  // Three's Y rotation: x' = x cos + z sin, z' = -x sin + z cos.
  return [
    FROZEN_WYRM.x + (lx * c + lz * n) * s,
    FROZEN_WYRM.y + ly * s,
    FROZEN_WYRM.z + (-lx * n + lz * c) * s,
  ];
}

/** Measured off the Frozen pose (model frame): the head's middle, his open
 *  eye (the left, toward the lake) and the shard in his sternum. */
export const FROZEN_HEAD_LOCAL = [5, 15, 15] as const;
export const FROZEN_EYE_LOCAL = [8, 15.4, 16.4] as const;
export const FROZEN_HEART_LOCAL = [1, 9, 10] as const;

export const WYRM_HEAD = frozenToGame(...FROZEN_HEAD_LOCAL);
export const WYRM_EYE = frozenToGame(...FROZEN_EYE_LOCAL);
export const WYRM_HEART = frozenToGame(...FROZEN_HEART_LOCAL);

/** The front plane the ice depth is measured from (instance z): the shell's
 *  surface lies a few yards proud of the face origin round the window. */
export const FACE_FRONT_Z = FACE_ORIGIN.z - 3;

// ---- the stage timelines -------------------------------------------------------------

/** Seconds each staged event plays (gameplay-neutral cosmetics, every tier). */
export const FACE_EVENT_SECONDS = {
  plateFall: 3.4,
  crackRace: 2.6,
  chainFall: 4.2,
  split: 3.2,
  calve: 4.5,
  collapse: 6,
} as const;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function easeIn(t: number): number {
  return t * t;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** A crack's reveal (0 unseen to 1 whole), racing from its start: quick at
 *  first, slowing as it reaches its ends. Snapped (1) when the stage was met
 *  already risen (`since` large). */
export function crackReveal(since: number, seconds: number = FACE_EVENT_SECONDS.crackRace): number {
  return easeOut(clamp01(since / seconds));
}

export interface PlateFallPose {
  /** 0 still on the face, 1 lying in the lake. */
  t: number;
  /** Yards dropped from its seat, and its forward pitch (radians). */
  drop: number;
  pitch: number;
  /** Offset toward the lake (yards; negative = back against the face). */
  out: number;
  /** The ice-dust burst at the foot (0..1, a one-shot). */
  dust: number;
  /** The boom's moment has passed (the ripple fires once at it). */
  landed: boolean;
}

/** The stage-1 plate: it shears off the foot, leans out, pitches and drops
 *  into the lake. The kit's fallen plate lies at its rest pose, so the pose
 *  here is an offset FROM rest (drop and pitch run back to 0). */
export function plateFallPose(since: number): PlateFallPose {
  const T = FACE_EVENT_SECONDS.plateFall;
  const t = clamp01(since / T);
  // Hang a beat (the crack opening round it), then fall.
  const fall = clamp01((t - 0.18) / 0.62);
  const g = easeIn(fall);
  const land = 0.8;
  return {
    t,
    drop: (1 - g) * 18,
    pitch: (1 - g) * -1.25,
    out: (1 - g) * -14,
    dust: t < land ? 0 : Math.sin(clamp01((t - land) / (1 - land)) * Math.PI),
    landed: t >= land,
  };
}

/** A chain falling out of the ice (0 taut into the face, 1 hanging slack
 *  from its pillar into the gulf): it tears out with a jolt, then falls
 *  with gravity. */
export function chainFall(since: number): number {
  const t = clamp01(since / FACE_EVENT_SECONDS.chainFall);
  const tear = clamp01(t / 0.12);
  const fall = clamp01((t - 0.12) / 0.88);
  return 0.04 * tear + 0.96 * (1 - (1 - fall) ** 2.2);
}

/** The frost spray where a chain tears out of the face (0..1 one-shot). */
export function chainSpray(since: number): number {
  if (since < 0) return 0;
  const t = since / 1.6;
  return t >= 1 ? 0 : Math.sin(Math.PI * Math.sqrt(t));
}

/** The calving (stage 4): the shell over the head breaks off and falls. */
export function calveProgress(since: number): number {
  return clamp01(since / FACE_EVENT_SECONDS.calve);
}

/** The moment the ice lets him go (seconds after stage 5 rose, his pull):
 *  Break Free's burst beat, when the live Korzul tears out at the face's
 *  foot (render/gravewyrm_sanctum_bosses/boss_model_core.ts). The face
 *  shudders up to it, then breaks and slumps; the frozen wyrm is gone the
 *  same frame the live body is shown, so there is never two of him. */
export const FACE_BURST_AT = KORZUL_BURST_AT;

/** Is the frozen Korzul still in the face, `since` seconds after stage 5
 *  rose (negative: the stage not risen)? */
export function frozenWyrmShown(since: number): boolean {
  return since < FACE_BURST_AT;
}

/** The collapse (stage 5): the face shudders until the ice bursts, then
 *  slumps forward and down into the lake and stays there as a broken ruin
 *  (the Quench behind it is never bared). Returns the drop (yards), the
 *  forward pitch and the share played. */
export function collapsePose(since: number): { drop: number; pitch: number; k: number } {
  const k = clamp01(since / FACE_EVENT_SECONDS.collapse);
  const burst = FACE_BURST_AT / FACE_EVENT_SECONDS.collapse;
  const shudder = k < burst ? Math.sin(since * 40) * 0.6 * (k / burst) : 0;
  const fall = easeIn(clamp01((k - burst) / (1 - burst)));
  return { drop: fall * COLLAPSE_DROP + shudder, pitch: fall * 0.14, k };
}

/** How far the collapsed face slumps (yards). */
export const COLLAPSE_DROP = 18;

/** One collapse chunk's flight (index-seeded): from a point on the face it
 *  tumbles out and down into the lake. Returns the offset (game frame,
 *  toward the lake is -z) and its spin. */
export function chunkFlight(
  i: number,
  since: number,
  delay: number,
): { x: number; y: number; z: number; spin: number; visible: boolean } {
  const t = since - delay;
  if (t < 0) return { x: 0, y: 0, z: 0, spin: 0, visible: false };
  const out = 4 + ((i * 37) % 9);
  const vy = 2 + ((i * 13) % 5);
  const fallT = Math.min(t, 5);
  const y = vy * fallT - 0.5 * 26 * fallT * fallT;
  return {
    x: ((((i * 53) % 11) - 5) / 5) * 3 * fallT,
    y,
    z: -out * fallT,
    spin: fallT * (0.6 + ((i * 7) % 5) * 0.25),
    visible: true,
  };
}

// ---- the heart -----------------------------------------------------------------------

/** The shard's glow this frame: the stage's level, its heartbeat, and a flare
 *  for a few seconds after the stage rose (the ice cracking lets it out). */
export function heartGlow(stage: number, t: number, since: number): number {
  const look = faceStageLook(stage);
  const beat = heartbeat(t, look.bpm);
  const flare = since < 6 ? (1 - since / 6) ** 2 * 1.2 : 0;
  return look.glow * (0.62 + 0.55 * beat) + flare;
}

/** The aurora's level this frame (the dome's uniform): the stage's level
 *  breathing with the heart, plus the stage-rise flare. */
export function auroraLevel(stage: number, t: number, since: number): number {
  const look = faceStageLook(stage);
  const beat = heartbeat(t, look.bpm);
  const flare = since < 8 ? (1 - since / 8) ** 2 * 0.5 : 0;
  return look.aurora * (0.85 + 0.22 * beat) + flare;
}

/** His eye at stage 4: it opens over two seconds after the calving settles. */
export function eyeOpen(stage: number, since: number): number {
  if (stage < 4) return 0;
  if (stage > 4) return 1;
  return clamp01((since - FACE_EVENT_SECONDS.calve * 0.6) / 2);
}
