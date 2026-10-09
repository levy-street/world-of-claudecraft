// The Great Saurian's Blender body, measured (scripts/assets/wildheart_great_saurian,
// its delivery notes): the facts the look (characters/wildheart_creature_looks.ts),
// the body effects (saurian_fx.ts) and the telegraph draw (basin_fx_core.ts
// SAURIAN_DRAW) all key on, so the ford's splashes land on the model's own feet
// and the howdah bursts where the model's howdah is.
//
// Model space: yards at the authored size, glTF axes: +Y up, the creature
// faces +Z, its LEFT is +X; the origin is on the ground under the middle of
// its barrel. Clip times are seconds at 1x (24 fps authoring).
//
// Three-free, DOM-free, deterministic.

/** The template's sim scale (sim/content/wildheart.ts great_saurian). */
export const SAURIAN_SIM_SCALE = 3.2;

/** In-game yards per model yard: 0.88 draws the head 13.4 yd over the ford
 *  (about five players), the size the ford's telegraphs were laid out for. */
export const SAURIAN_DRAWN_SCALE = 0.88;

export const SAURIAN_MODEL = {
  url: 'models/creatures/wildheart_great_saurian.glb',
  /** The Idle pose's skinned bounds, lowest vertex (-0.05) to the howdah's
   *  banner poles (15.86): what prepareVisual normalizes to the def height. */
  idleBoundsHeight: 15.91,
  /** The top of the head (the creature's own height). */
  headTop: 15.27,
  /** The howdah deck's top and its offset along the body (glTF z). */
  deckTop: 11.15,
  deckZ: 0.6,
  /** The tail root (the hips) behind the centre. */
  hipsBack: 3.4,
  /** The feet at rest: forefeet and hind feet, |x| out to each side, z along. */
  foreFoot: { x: 2.8, z: 3.3 },
  hindFoot: { x: 2.75, z: -3.2 },
  /** The tail club's centre at rest: behind, and over the ground. */
  club: { z: -16.8, y: 3.3 },
  /** Where the clip's rider lands (behind the RIGHT flank: -x is its right). */
  riderLand: { x: -6.2, z: -5.6 },
  /** The gaits' reference speeds (planted feet slide at these) and cycles. */
  walkRef: 2.2,
  walkCycle: 2.79,
  runRef: 5.4,
  runCycle: 1.29,
} as const;

/** The clips' contact beats (seconds at 1x): where the effects fire. */
export const SAURIAN_CLIP = {
  /** TailSwipe: windup to 0.72 (the 1 s bar), the tail crosses the rear cone
   *  at 1.00 (the hit and the spray), the club whips past at 1.16. */
  tailHit: 1.0,
  tailClub: 1.16,
  /** Stomp: rears 0.45 to 1.74 (the 2 s bar), both forefeet slam at 2.00, the
   *  body jolts at 2.12. */
  stompSlam: 2.0,
  stompJolt: 2.12,
  /** HowdahBreak: rattle from 0.5, the burst at 0.90, pieces in the water
   *  1.4 to 1.9, the rider lands at 1.80 and is gone at 1.84, everything gone
   *  by 3.30. */
  howdahRattle: 0.5,
  howdahBurst: 0.9,
  riderLands: 1.8,
  howdahGone: 3.3,
  /** Enrage: the stamps land at 0.85 (left fore) and 1.35 (right fore). */
  enrageStamps: [0.85, 1.35],
  /** Death: the body hits the water at 2.70, the neck at 2.85. */
  deathBody: 2.7,
  deathNeck: 2.85,
  /** The corpse lies this far to its LEFT of the origin (model yards). */
  deathRollLeft: 3.3,
} as const;

/** The def height (pivot to the Idle bounds' top at sim scale 1) that draws
 *  the model at SAURIAN_DRAWN_SCALE. */
export function saurianLookHeight(): number {
  return (SAURIAN_MODEL.idleBoundsHeight * SAURIAN_DRAWN_SCALE) / SAURIAN_SIM_SCALE;
}

/** In-game yards per model yard for a Saurian drawn at sim `scale`. */
export function saurianModelScale(scale: number): number {
  return (SAURIAN_DRAWN_SCALE * scale) / SAURIAN_SIM_SCALE;
}

/** A model-space point on the ground (x its left, z forward) to the world,
 *  for a Saurian at `pos` facing `facing` at sim `scale`. Writes `out`. */
export function saurianModelToWorld(
  pos: { x: number; z: number },
  facing: number,
  scale: number,
  mx: number,
  mz: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  const k = saurianModelScale(scale);
  const s = Math.sin(facing);
  const c = Math.cos(facing);
  // Forward is (sin f, cos f); the model's +x (its left) is (cos f, -sin f).
  out.x = pos.x + (mz * s + mx * c) * k;
  out.z = pos.z + (mz * c - mx * s) * k;
  return out;
}

/** The four feet, in footfall order of the gaits below. */
export type SaurianFoot = 'leftHind' | 'leftFore' | 'rightHind' | 'rightFore';

/** A foot's resting point in model space. */
export function saurianFootPoint(foot: SaurianFoot): { x: number; z: number } {
  const fore = foot === 'leftFore' || foot === 'rightFore';
  const left = foot === 'leftFore' || foot === 'leftHind';
  const p = fore ? SAURIAN_MODEL.foreFoot : SAURIAN_MODEL.hindFoot;
  return { x: left ? p.x : -p.x, z: p.z };
}

/** The gaits' footfalls as a share of the cycle (Walk: a lateral-sequence wade;
 *  Run: an amble). */
export const SAURIAN_FOOTFALLS: Readonly<
  Record<'walk' | 'run', readonly { foot: SaurianFoot; phase: number }[]>
> = {
  walk: [
    { foot: 'leftHind', phase: 0 },
    { foot: 'leftFore', phase: 0.7 / SAURIAN_MODEL.walkCycle },
    { foot: 'rightHind', phase: 1.4 / SAURIAN_MODEL.walkCycle },
    { foot: 'rightFore', phase: 2.09 / SAURIAN_MODEL.walkCycle },
  ],
  run: [
    { foot: 'leftHind', phase: 0 },
    { foot: 'rightFore', phase: 0.1 / SAURIAN_MODEL.runCycle },
    { foot: 'rightHind', phase: 0.65 / SAURIAN_MODEL.runCycle },
    { foot: 'leftFore', phase: 0.75 / SAURIAN_MODEL.runCycle },
  ],
};

/** The yards one gait cycle carries the Saurian at sim `scale` (its planted
 *  feet slide at the reference speed, so a cycle is ref x cycle seconds). */
export function saurianStride(gait: 'walk' | 'run', scale: number): number {
  const k = saurianModelScale(scale);
  return gait === 'walk'
    ? SAURIAN_MODEL.walkRef * SAURIAN_MODEL.walkCycle * k
    : SAURIAN_MODEL.runRef * SAURIAN_MODEL.runCycle * k;
}

/** The footfalls crossed when the cycle phase moves from `from` to `to`
 *  (both cycle counts, `to` >= `from`; whole cycles wrap). Writes the feet
 *  into `out` and returns how many. */
export function saurianFootfallsBetween(
  gait: 'walk' | 'run',
  from: number,
  to: number,
  out: SaurianFoot[],
): number {
  out.length = 0;
  if (!(to > from)) return 0;
  const falls = SAURIAN_FOOTFALLS[gait];
  // At most a cycle's worth per step (a long hitch would only flood the ford).
  const start = Math.max(from, to - 1);
  const c0 = Math.floor(start);
  for (let c = c0; c <= Math.floor(to); c++) {
    for (const f of falls) {
      const at = c + f.phase;
      if (at > start && at <= to) out.push(f.foot);
    }
  }
  return out.length;
}
