// The Fanglord's Great Jaguar, its Blender body measured (scripts/assets/
// wildheart_great_jaguar, its delivery notes): the facts the look
// (characters/wildheart_creature_looks.ts), the jade spirit overlay of Zulgar's
// hunt (zulgar_avatar_fx.ts) and the boss effects (the bond cord's anchor, the
// bite, the leap) key on.
//
// Model space: yards at the authored size, glTF axes: +Y up, the cat faces +Z,
// its LEFT is +X, the origin on the ground under the middle of its body. Clip
// times are seconds at 1x (24 fps authoring).
//
// Three-free, DOM-free, deterministic.

/** The template's sim scale (sim/content/wildheart.ts fanglord_jaguar). */
export const JAGUAR_SIM_SCALE = 2.4;

/** In-game yards per model yard: drawn at its authored size, 4.7 yd to its
 *  ears (a head over its 3 yd master, nearly two over a player). */
export const JAGUAR_DRAWN_SCALE = 1;

export const JAGUAR_MODEL = {
  url: 'models/creatures/wildheart_great_jaguar.glb',
  /** The jade spirit variant (same mesh, rig and clips, one glowing material). */
  spiritUrl: 'models/creatures/wildheart_great_jaguar_spirit.glb',
  /** The Idle pose's skinned bounds, lowest vertex (-0.01) to the ears (4.71). */
  idleBoundsHeight: 4.72,
  /** The withers (the back's highest point) and the collar's jade ring, where
   *  the Pack Bond's cord ties on (rest: up, forward). */
  withers: 3.4,
  bondAnchor: { up: 4.02, forward: 2.78 },
  /** The bite point (between the jaws) at rest: up, forward. */
  mouth: { up: 2.9, forward: 5 },
  /** The paws at rest: |x| out to each side, z along. */
  forePaw: { x: 0.8, z: 2.26 },
  hindPaw: { x: 0.8, z: -2.05 },
  /** The gaits' reference speeds (planted paws slide at these). */
  walkRef: 2.4,
  runRef: 9,
  stalkRef: 1.6,
} as const;

/** The clips' contact beats (seconds at 1x). */
export const JAGUAR_CLIP = {
  /** Bite: the jaws close (blood, the bleed) at 0.50, the tearing shake after. */
  biteClose: 0.5,
  /** Claw: the rake crosses the front, right to left, at 0.46. */
  clawRake: 0.46,
  /** Pounce: the takeoff at 1.00, the forepaws land at 1.50, the hind at 1.62. */
  pounceTakeoff: 1,
  pounceLand: 1.5,
  pounceHindLand: 1.62,
  /** Roar: its peak at 0.85. */
  roarPeak: 0.85,
  /** Death: the body hits the ground at 1.55, the head at 1.72. */
  deathBody: 1.55,
  deathHead: 1.72,
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
