// The Gorgebloom, its art-guide body measured (the designer's model guide:
// concept, Tripo, a rig built for the mesh, every clip animated at 30 fps,
// and the shipped GLB sampled bone by bone at each contact frame): the facts
// the look (characters/wildheart_creature_looks.ts), the body effects
// (gorgebloom_fx.ts) and the boss bursts (the seeds and the spit leaving its
// maw) all key on, so every effect leaves the model where the model is.
//
// Model space: yards at the authored size, glTF axes: +Y up, the bloom faces
// +Z, its LEFT is +X; the origin is the waterline under the middle of the
// bloom (in game: the root pool's surface on its dais). Clip times are seconds
// in the shipped clips, which key their first frame at 0.
//
// Three-free, DOM-free, deterministic.

/** The template's sim scale (sim/content/wildheart.ts the_gorgebloom). */
export const GORGEBLOOM_SIM_SCALE = 2.8;

/** In-game yards per model yard: drawn at its authored size, a rafflesia the
 *  size of a house: 6.1 yd to the tip of its raised back petal, its petals'
 *  edge 4.85 yd out (where the sim's 4.5 yd body lets melee reach it), its
 *  vines reaching nearly 8 yd across the pool. */
export const GORGEBLOOM_DRAWN_SCALE = 1;

/** The old Blender bodies' clips (the Lasher, the Sprout and the Basin trash,
 *  lasher_model_core.ts and basin_trash_model_core.ts) key their first frame
 *  one 24 fps frame in; the Gorgebloom's own clips start at 0. */
export const KEY_LEAD = 1 / 24;

/** A point in model space (x its left, y up, z forward). */
export interface ModelPoint {
  x: number;
  y: number;
  z: number;
}

export const GORGEBLOOM_MODEL = {
  url: 'models/creatures/woc_basin_gorgebloom.glb',
  /** The Idle pose's skinned bounds (sampled where prepareVisual samples it,
   *  0.5 s in): the vines lie on the waterline, the tip of the raised back
   *  petal stands at 6.101. */
  idleMin: 0,
  idleTop: 6.101,
  /** The bulb's radius (the maw's ring) and the vines' reach round the origin. */
  bulbRadius: 1.6,
  rootCrown: 7.96,
  /** The maw (MawAnchor's head) at rest, in the ring of teeth's centre. */
  maw: { x: 0, y: 3.42, z: 1.06 },
  /** The four pollen sacs (the TAILS of Sac_FL, Sac_FR, Sac_BL, Sac_BR) at rest. */
  sacs: [
    { x: 2.05, y: 3.77, z: 2.36 },
    { x: -2.2, y: 3.76, z: 2.36 },
    { x: 1.97, y: 4.97, z: -1.58 },
    { x: -2.12, y: 4.96, z: -1.58 },
  ],
  /** The lash vine's club (LashTip) at rest, lying on the water to its right. */
  lashTip: { x: -5.76, y: 0.89, z: 4.8 },
} as const;

/** The clips' beats (seconds in the shipped clips) and where the anchors stand
 *  on them (sampled from the GLB). Every bar lands its blow on the bar's end
 *  (1.5 s bars, so the clips play at 1x), with its weight before its speed. */
export const GORGEBLOOM_CLIP = {
  /** SeedRain: the bulb swells and the petals curl shut through the bar,
   *  trembling, the pods leave the maw on frame 46 (1.50, the maw thrust up),
   *  held open to 1.63. */
  seedSpit: 1.5,
  seedMaw: { x: 0, y: 3.74, z: -0.01 },
  seedLength: 2.633,
  /** Pollinate: the sacs swell to 0.40 and burst at 0.53 (their tails pulled
   *  back in as they empty), a shudder to 1.1. */
  pollinateSwell: 0.4,
  pollinateBurst: 0.533,
  pollinateSacs: [
    { x: 2.21, y: 3.84, z: 2.2 },
    { x: -2.33, y: 3.83, z: 2.16 },
    { x: 2.12, y: 4.0, z: -2.28 },
    { x: -2.27, y: 3.99, z: -2.27 },
  ],
  pollinateLength: 1.833,
  /** VineLash: the right vine swells and rears up beside it (high by 1.17,
   *  the club 6.9 yd up), cocks back at 1.37 and whips over to slam the lane
   *  at 1.50: the club lands on the lane's centre line 8.39 yd ahead, the vine
   *  lying flat behind it over the front petals; it lies there to 1.80 and is
   *  dragged back by 2.6. */
  lashHigh: 1.167,
  lashHighTip: { x: -3.36, y: 6.89, z: 1.37 },
  lashSlam: 1.5,
  lashTipImpact: { x: 0, y: 1.08, z: 8.39 },
  /** Where the vine's root leaves the bloom on the slam (R_Vine2). */
  lashVineRoot: { x: -0.7, y: 2.23, z: 1.39 },
  lashLiesUntil: 1.8,
  lashLength: 2.633,
  /** Gorge: rears and gapes to 1.23 (the maw high and back), then the maw-bulb
   *  strikes out of its petal cradle on its stalk and the bite lands on the
   *  tank at 1.50 (the maw 4.2 yd ahead), shakes at 1.73 and 1.93, the swallow
   *  at 2.2. */
  gorgeGape: 1.233,
  gorgeGapeMaw: { x: 0, y: 4.1, z: -0.33 },
  gorgeBite: 1.5,
  gorgeBiteMaw: { x: 0, y: 2.98, z: 4.21 },
  gorgeShakes: [1.733, 1.933],
  gorgeSwallow: 2.2,
  gorgeLength: 2.733,
  /** BloomSpit: the recoil to 0.30, the glob leaves the maw at 0.43. */
  spitGlob: 0.433,
  spitMaw: { x: 0, y: 3.21, z: 1.89 },
  /** Attack: coiled back, the maw strikes out and snaps shut on frame 18
   *  (0.567), a tearing shake after. 1.5 s at 1x. */
  attackBite: 0.567,
  /** Roar: the petals flare fully open at 0.80. */
  roarPeak: 0.8,
  roarMaw: { x: 0, y: 4.06, z: 0.14 },
  /** Death: the shriek at 0.33, the wilt from 0.73 (the petals droop, the bulb
   *  deflates), the bulb folds over at 2.23 and hits the water at 2.70 (its
   *  maw face down 1.8 yd ahead), the petals lying flat on the water and the
   *  sacs on them, still from 3.4. */
  deathShriek: 0.333,
  deathWilt: 0.733,
  deathFold: 2.233,
  deathSplash: 2.7,
  deathSplashAt: { x: 0, y: 0, z: 1.84 },
  deathRest: 3.4,
  deathLength: 4.233,
} as const;

/** The def height (pivot to the Idle bounds' top at sim scale 1, the roots'
 *  dip included) that draws the model at GORGEBLOOM_DRAWN_SCALE. */
export function gorgebloomLookHeight(): number {
  const m = GORGEBLOOM_MODEL;
  return ((m.idleTop - m.idleMin) * GORGEBLOOM_DRAWN_SCALE) / GORGEBLOOM_SIM_SCALE;
}

/** The def hover that seats the waterline (not the lowest root) on the pivot:
 *  the roots and rags sink under the root pool as authored. */
export function gorgebloomLookHover(): number {
  return (GORGEBLOOM_MODEL.idleMin * GORGEBLOOM_DRAWN_SCALE) / GORGEBLOOM_SIM_SCALE;
}

/** Its drawn height (the raised petal's top) per unit of sim scale. */
export function gorgebloomTopPerScale(): number {
  return (GORGEBLOOM_MODEL.idleTop * GORGEBLOOM_DRAWN_SCALE) / GORGEBLOOM_SIM_SCALE;
}

/** In-game yards per model yard for a Gorgebloom drawn at sim `scale`. */
export function gorgebloomModelScale(scale: number): number {
  return (
    (GORGEBLOOM_DRAWN_SCALE * (scale > 0 ? scale : GORGEBLOOM_SIM_SCALE)) / GORGEBLOOM_SIM_SCALE
  );
}

/** The rate a cast clip plays at so its contact frame `beat` lands on the
 *  end of a `bar`-second bar. */
export function castBeatTimeScale(beat: number, bar: number): number {
  return bar > 0 ? beat / bar : 1;
}

/** A model-space point to the world, for a Gorgebloom at `pos` (its pivot on
 *  the waterline) facing `facing` at sim `scale`. Writes `out`. */
export function gorgebloomModelToWorld(
  pos: { x: number; y: number; z: number },
  facing: number,
  scale: number,
  p: ModelPoint,
  out: ModelPoint,
): ModelPoint {
  const k = gorgebloomModelScale(scale);
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  // Forward is (sin f, cos f); the model's +x (its left) is (cos f, -sin f).
  out.x = pos.x + (p.z * s + p.x * c) * k;
  out.y = pos.y + p.y * k;
  out.z = pos.z + (p.z * c - p.x * s) * k;
  return out;
}
