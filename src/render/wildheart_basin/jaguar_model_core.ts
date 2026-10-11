// The Fanglord's Great Jaguar, its art-guide body measured (the designer's
// model guide: concept, Tripo, a rig built for the mesh, every clip animated at
// 30 fps): the facts the look (characters/wildheart_creature_looks.ts), the
// jade spirit overlay of Zulgar's hunt (zulgar_avatar_fx.ts) and the boss
// effects (the bond cord's anchor, the bite, the leap) key on.
//
// Model space: yards at the authored size, glTF axes: +Y up, the cat faces +Z,
// its LEFT is +X, the origin on the ground under the middle of its body. Clip
// times are seconds at 1x.
//
// Three-free, DOM-free, deterministic.

/** The template's sim scale (sim/content/wildheart.ts fanglord_jaguar). */
export const JAGUAR_SIM_SCALE = 2.4;

/** In-game yards per model yard: drawn at its authored size, 4.7 yd to its
 *  ears (a head over its master's shoulder, nearly two over a player), its
 *  feathered headdress rising to 6.2. */
export const JAGUAR_DRAWN_SCALE = 1;

export const JAGUAR_MODEL = {
  url: 'models/creatures/woc_basin_jaguar.glb',
  /** The jade spirit variant (same mesh, rig and clips, one glowing material). */
  spiritUrl: 'models/creatures/woc_basin_jaguar_spirit.glb',
  /** The Idle pose's skinned bounds, lowest vertex (0.004) to the headdress'
   *  plumes (6.197). */
  idleBoundsHeight: 6.193,
  /** The shoulders' top (the plumed headdress sweeps back over them) and the
   *  collar's ring on the nape under the plumes, where the Pack Bond's cord
   *  ties on (rest: up, forward). */
  withers: 4.37,
  bondAnchor: { up: 4.09, forward: 3.1 },
  /** The bite point (between the jaws) at rest: up, forward. */
  mouth: { up: 3.83, forward: 4.2 },
  /** The paws at rest: |x| out to each side, z along. */
  forePaw: { x: 0.55, z: 2.33 },
  hindPaw: { x: 0.55, z: -1.49 },
  /** The gaits' reference speeds (planted paws slide at these). */
  walkRef: 1.79,
  runRef: 11.58,
  stalkRef: 0.92,
} as const;

/** The clips' contact beats (seconds at 1x). */
export const JAGUAR_CLIP = {
  /** Bite: drawn back, the lunge, the jaws close on frame 18 (the blood, the
   *  bleed), the tearing shake after. 1.5 s at 1x. */
  biteClose: 0.567,
  /** Claw: reared, the rake crosses the front, right to left, on frame 18. */
  clawRake: 0.567,
  /** Pounce: the takeoff at 1.00, the forepaws land at 1.50, the hind at 1.63. */
  pounceTakeoff: 1,
  pounceLand: 1.5,
  pounceHindLand: 1.633,
  /** Roar: its peak at 0.83. */
  roarPeak: 0.833,
  /** Death: it rolls onto its side, the body hits the ground at 1.53, the
   *  head at 1.70. */
  deathBody: 1.533,
  deathHead: 1.7,
} as const;

/** The Heel! bar (2 s): the Pounce clip is slowed so its forepaws land on the
 *  bar's last frame, where the sim sets the jaguar down at its master's side. */
export function heelPounceTimeScale(heelCast: number): number {
  return JAGUAR_CLIP.pounceLand / heelCast;
}

/** The def height that draws the model at JAGUAR_DRAWN_SCALE at sim `scale`. */
export function jaguarLookHeight(scale = JAGUAR_SIM_SCALE): number {
  return (JAGUAR_MODEL.idleBoundsHeight * JAGUAR_DRAWN_SCALE) / scale;
}

/** In-game yards per model yard for the jaguar drawn at sim `scale`. */
export function jaguarModelScale(scale: number): number {
  return (JAGUAR_DRAWN_SCALE * scale) / JAGUAR_SIM_SCALE;
}

/** The collar's jade ring (the Pack Bond cord's end) for a jaguar at sim
 *  `scale`: yards up from its feet and forward of its centre. */
export function jaguarBondAnchor(scale: number): { up: number; forward: number } {
  const k = jaguarModelScale(scale);
  return { up: JAGUAR_MODEL.bondAnchor.up * k, forward: JAGUAR_MODEL.bondAnchor.forward * k };
}
