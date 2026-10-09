// The Gorgebloom, its Blender body measured (scripts/assets/wildheart_gorgebloom,
// its delivery notes, and the shipped GLB sampled bone by bone at each contact
// frame): the facts the look (characters/wildheart_creature_looks.ts), the body
// effects (gorgebloom_fx.ts) and the boss bursts (the seeds and the spit leaving
// its maw) all key on, so every effect leaves the model where the model is.
//
// Model space: yards at the authored size, glTF axes: +Y up, the bloom faces
// +Z, its LEFT is +X; the origin is the waterline under the middle of the bulb
// (in game: the root pool's surface on its dais). Clip times are seconds in the
// shipped clips, which key their first frame at 1/24 s: every authored beat of
// the notes sits KEY_LEAD later in the file, and that is the time the look
// lands on the bar's end.
//
// Three-free, DOM-free, deterministic.

/** The template's sim scale (sim/content/wildheart.ts the_gorgebloom). */
export const GORGEBLOOM_SIM_SCALE = 2.8;

/** In-game yards per model yard: drawn at its authored size, 13.75 yd to the
 *  top of its raised petal (a three-storey house beside a 2.6 yd player). */
export const GORGEBLOOM_DRAWN_SCALE = 1;

/** The clips key their first frame one 24 fps frame in. */
export const KEY_LEAD = 1 / 24;

/** A point in model space (x its left, y up, z forward). */
export interface ModelPoint {
  x: number;
  y: number;
  z: number;
}

export const GORGEBLOOM_MODEL = {
  url: 'models/creatures/wildheart_gorgebloom.glb',
  /** The Idle pose's skinned bounds (sampled where prepareVisual samples it,
   *  0.5 s in): the roots and rags dip to -0.845 under the waterline, the top
   *  of the raised petal stands at 13.753. */
  idleMin: -0.845,
  idleTop: 13.753,
  /** The bulb's radius and the root crown's reach round the origin. */
  bulbRadius: 3.15,
  rootCrown: 6,
  /** The maw (MawAnchor's head) at rest, in the mouth's centre. */
  maw: { x: 0, y: 7.79, z: 3.92 },
  /** The four pollen sacs (the TAILS of Sac_FL, Sac_FR, Sac_BL, Sac_BR) at rest. */
  sacs: [
    { x: 3.48, y: 4.3, z: 2.3 },
    { x: -3.48, y: 4.3, z: 2.3 },
    { x: 3.48, y: 4.3, z: -2.3 },
    { x: -3.48, y: 4.3, z: -2.3 },
  ],
  /** The lash vine's club (LashTip) at rest, floating on the water to its right. */
  lashTip: { x: -8.77, y: 0.63, z: 5.76 },
} as const;

/** The clips' beats (seconds in the shipped clips) and where the anchors stand
 *  on them (sampled from the GLB). */
export const GORGEBLOOM_CLIP = {
  /** SeedRain: the bulb swells and the petals curl shut through the bar, the
   *  pods leave the maw at 1.50 (aimed up and out), the maw held open to 1.64. */
  seedSpit: 1.5 + KEY_LEAD,
  seedMaw: { x: 0, y: 9.79, z: 1.96 },
  seedLength: 2.625,
  /** Pollinate: the sacs swell to 0.42 and burst at 0.55 (their tails pulled
   *  back in as they empty), a shudder to 1.1. */
  pollinateSwell: 0.42 + KEY_LEAD,
  pollinateBurst: 0.55 + KEY_LEAD,
  pollinateSacs: [
    { x: 3.35, y: 4.26, z: 2.28 },
    { x: -3.35, y: 4.26, z: 2.28 },
    { x: 3.35, y: 4.41, z: -2.14 },
    { x: -3.35, y: 4.41, z: -2.14 },
  ],
  pollinateLength: 1.833,
  /** VineLash: the right vine rears up and out (high by 1.15, the club about
   *  8.3 yd up), cocks at 1.36 and slams the lane at 1.50: the club lands on
   *  the lane's centre line 8.74 yd ahead, the vine flat behind it; it lies
   *  there to 1.80 and is withdrawn by 2.58. */
  lashHigh: 1.15 + KEY_LEAD,
  lashHighTip: { x: -8.05, y: 8.3, z: 1 },
  lashSlam: 1.5 + KEY_LEAD,
  lashTipImpact: { x: -0.5, y: 0.2, z: 8.74 },
  /** Where the vine's root leaves the bulb on the slam (R_Vine2). */
  lashVineRoot: { x: -1.98, y: 0.41, z: 1.51 },
  lashLiesUntil: 1.8 + KEY_LEAD,
  lashLength: 2.625,
  /** Gorge: rears and gapes to 1.25 (the maw high and back), the bite lands on
   *  the tank at 1.50 (the maw driven down and forward), shakes at 1.72 and
   *  1.92, the swallow at 2.2. */
  gorgeGape: 1.25 + KEY_LEAD,
  gorgeGapeMaw: { x: 0, y: 9.96, z: 1.27 },
  gorgeBite: 1.5 + KEY_LEAD,
  gorgeBiteMaw: { x: 0, y: 3.48, z: 4.65 },
  gorgeShakes: [1.72 + KEY_LEAD, 1.92 + KEY_LEAD],
  gorgeSwallow: 2.2 + KEY_LEAD,
  gorgeLength: 2.75,
  /** BloomSpit: the recoil to 0.3, the glob leaves the maw at 0.45. */
  spitGlob: 0.45 + KEY_LEAD,
  spitMaw: { x: 0, y: 6.92, z: 4.35 },
  /** Attack: the melee bite snaps shut at 0.50. */
  attackBite: 0.5 + KEY_LEAD,
  /** Roar: the petals flare fully open at 0.80. */
  roarPeak: 0.8 + KEY_LEAD,
  roarMaw: { x: 0, y: 9.81, z: 1.79 },
  /** Death: the shriek at 0.35, the wilt from 0.75 (petals droop, the bulb
   *  deflates), the neck folds at 2.25, the head hits the water at 2.70 (the
   *  maw 1.6 yd over it, 3.1 ahead), sunk and still from 3.4. */
  deathShriek: 0.35 + KEY_LEAD,
  deathWilt: 0.75 + KEY_LEAD,
  deathFold: 2.25 + KEY_LEAD,
  deathSplash: 2.7 + KEY_LEAD,
  deathSplashAt: { x: 0, y: 0, z: 3.6 },
  deathRest: 3.4 + KEY_LEAD,
  deathLength: 4.25,
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
