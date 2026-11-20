// Pure plan of the Masterless Strength's effects (final_fx.ts paints them;
// docs/design/raid/smith_heart.md sections 5.17 and 7.5). The boss is its
// own rigged model (final_body_core.ts, final_body_fx.ts) with the mountain's
// heart in its chest; its arrival is final_arrival_core.ts. Here: the sim's
// numbers read (Forge Fist's arc and reach, the Overload Burst's reach, the
// bars' casts), never changed; the gathering bars and the Overload Burst; the
// two-bone reach the Hammer Council's bodies borrow. Its death is
// final_death_core.ts.
//
// Three-free, DOM-free, deterministic.

import { SMITH_HEART_FINAL_BOSS, SMITH_HEART_MOBS } from '../../sim/content/smith_heart';
import { HEART_ROOM } from '../../sim/content/smith_heart_layout';
import { FINAL_CASTS } from '../../sim/encounters/smith_heart/final_ids';

/** The boss whose body this is. */
export const FINAL_BOSS = SMITH_HEART_FINAL_BOSS;
/** The arc cleave's cue (mob_swing.ts emits it as the cleave lands). */
export const FORGE_FIST_CUE = 'brood_cleave';

/** What the body does over each of its bars (final_ids.ts FINAL_CASTS):
 *  Basalt Fist and Weight of the Anvil raise both arms (the light gathering,
 *  the slam when the bar lands), Leaping Bolt cups the storm in its hands. */
export const FINAL_BODY_CASTS: Readonly<Record<string, { pose: 'wrath' | 'pour'; slam: boolean }>> =
  {
    [FINAL_CASTS.fist]: { pose: 'wrath', slam: true },
    [FINAL_CASTS.anvil]: { pose: 'wrath', slam: true },
    [FINAL_CASTS.bolt]: { pose: 'pour', slam: false },
  };

/** The sim's own numbers (read, never tuned here): Forge Fist's arc and
 *  reach, the Overload Burst's reach (the whole Anvil). */
export function finalBossKit(): {
  fistRange: number;
  fistArcDeg: number;
  burstRadius: number;
} {
  const m = SMITH_HEART_MOBS[FINAL_BOSS];
  return {
    fistRange: m?.arcCleave?.range ?? 9,
    fistArcDeg: m?.arcCleave?.arcDeg ?? 110,
    burstRadius: HEART_ROOM.r,
  };
}

/** The palette (linear 0..1): the heart's white-gold, its gold, the veins'
 *  four colours for the threads and the shockwave, dust. */
export const FINAL_FX_COLORS = {
  core: [1.0, 0.95, 0.8] as const,
  gold: [1.0, 0.76, 0.36] as const,
  dust: [0.42, 0.38, 0.36] as const,
  dustDark: [0.26, 0.23, 0.23] as const,
  spark: [1.0, 0.86, 0.55] as const,
  crust: [0.1, 0.085, 0.08] as const,
  /** The heart's glow on the seams (hex). */
  seam: 0xffdca0,
  ring: 0xffe6b8,
  /** The telegraphs' element accent (the threat colour is the kit's). */
  accent: 0xffe6c0,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

export interface V3 {
  x: number;
  y: number;
  z: number;
}

// ---- the arm (the Hammer Council's bodies reach with it) ----------------------------------

/** Two-bone reach: the elbow for a shoulder at `s` and a wrist target at
 *  `w` (the target pulled in to the arm's reach), the elbow bent out along
 *  `pole`. Returns the elbow and the wrist actually reached. */
export function colossusArmIk(
  s: V3,
  w: V3,
  l1: number,
  l2: number,
  pole: V3,
): { elbow: V3; wrist: V3 } {
  let dx = w.x - s.x;
  let dy = w.y - s.y;
  let dz = w.z - s.z;
  let d = Math.hypot(dx, dy, dz);
  const reach = (l1 + l2) * 0.999;
  const lo = Math.abs(l1 - l2) * 1.001 + 1e-6;
  const dd = Math.max(lo, Math.min(reach, d || lo));
  if (d < 1e-9) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1;
  }
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  const wrist = { x: s.x + ux * dd, y: s.y + uy * dd, z: s.z + uz * dd };
  // Along the line to the wrist, then out along the pole's part across it.
  const a = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = pole.x * ux + pole.y * uy + pole.z * uz;
  let px = pole.x - ux * pd;
  let py = pole.y - uy * pd;
  let pz = pole.z - uz * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  px /= pl;
  py /= pl;
  pz /= pl;
  return {
    elbow: { x: s.x + ux * a + px * h, y: s.y + uy * a + py * h, z: s.z + uz * a + pz * h },
    wrist,
  };
}

// ---- Forge Fist -----------------------------------------------------------------------------

/** Forge Fist's two-fisted slam takes this long; its floor strike lands
 *  this far into it (the model's Slam clip: the effects' own beat). */
export const COLOSSUS_FIST_SECONDS = 1.5;
export const COLOSSUS_FIST_IMPACT = 0.34;

// ---- the gathering bars and the Overload Burst ---------------------------------------------

/** A gathering bar (`progress` 0..1): how hard the light gathers into the
 *  heart, how far the pieces part (the body drawing breath). */
export function wrathGather(progress: number): { glow: number; part: number } {
  const p = clamp01(progress);
  return { glow: 0.3 + 0.7 * smooth(p / 0.9), part: 1.6 * smooth(p) };
}

/** The Overload Burst landing `elapsed` seconds ago: the flash, the wall of
 *  light riding out over the whole Anvil on the trash engine's wave clock
 *  (its front at `front` of the radius), the afterglow. */
export function wrathBlastLook(
  elapsed: number,
  front: number,
): {
  flash: number;
  wall: number;
  glow: number;
} {
  return {
    flash: Math.max(0, 1 - elapsed / 0.35),
    wall: clamp01(front) < 1 ? 1 : Math.max(0, 1 - (elapsed - 0.5) / 0.5),
    glow: Math.max(0, 1 - elapsed / 1.6),
  };
}

/** A cupped bar (Leaping Bolt): the storm gathering in the hands. */
export function pourGather(progress: number): number {
  return 0.2 + 0.8 * smooth(clamp01(progress) / 0.9);
}

/** The pools (fixed, allocated at build). */
export const FINAL_FX_POOLS = {
  particles: 900,
} as const;
