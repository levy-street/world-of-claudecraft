// The Anvil of the World's wall landmarks (phases 2M and 2N, design doc
// section 5.21): the pure half of heart_landmarks.ts. One great formation of
// each element stands past the platform's rim (since phase 2N its quarter's
// outer wall, running along the rim from seam to seam, `HEART_LANDMARK_SPAN`),
// its heart behind its altar (the Heart kit's Kit_Landmark* pieces, built by
// docs/design/raid/kit/landmark_pieces.py): the Heat's molten outcrop, the
// Hammer's golden crystal-and-granite crag, the Quench's ice spires, the
// Breath's storm horns. The floor is one common stone; the element lives on
// the edges, and this is the outer edge.
//
//   - Where each stands and its signature spots (the crater, the great
//     crystal, the spires' tips, the horns' tips), room-local, the same
//     numbers as the Blender pieces (`HEART_LANDMARK_FRAME`).
//   - How awake it is (`heartLandmarkLit`): its quarter's flood reaching
//     the wall (the light runs out of the central circle along the seams
//     and the landmark erupts when it arrives), its quiet glow otherwise.
//   - The Breath's lightning (`heartBreathBolts`): jagged bolts between its
//     horns' tips and down into its quarter, deterministic.
//
// Pure and Three-free.

import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { HEART_QUARTERS } from '../../sim/content/smith_heart_quarters';
import { heartHash } from './heart_plan_core';
import type { HeartQuarterLight } from './heart_quarters_core';

/** A room-local point (yards from the platform's centre, `y` up). */
export interface HeartLandmarkPoint {
  x: number;
  y: number;
  z: number;
}

/** Each landmark's frame: its bearing (degrees clockwise from north, its
 *  altar's) and its centre's distance out (quarter_geom.py LANDMARKS,
 *  LANDMARK_R). */
export const HEART_LANDMARK_FRAME = {
  r: 70,
  bearing: { breath: 0, quench: 90, hammer: 180, heat: 270 } as Readonly<
    Record<SmithHeartVein, number>
  >,
} as const;

/** A point `u` yards out from the platform's centre along a landmark's
 *  bearing, `v` across (clockwise), `h` up: the Blender pieces' own frame
 *  (landmark_pieces.py Frame.at, Blender -Y the game's north). */
export function heartLandmarkPoint(
  vein: SmithHeartVein,
  u: number,
  v: number,
  h: number,
): HeartLandmarkPoint {
  const a = (HEART_LANDMARK_FRAME.bearing[vein] * Math.PI) / 180;
  return {
    x: Math.sin(a) * u + Math.cos(a) * v,
    y: h,
    z: Math.cos(a) * u - Math.sin(a) * v,
  };
}

/** Each landmark's run along the rim (phase 2N, landmark_pieces.py SPAN):
 *  degrees round from its altar's bearing (clockwise +), from just past
 *  the seam's horn behind it nearly to the next; the Hammer's stops short
 *  of the Heart Bridge. The landmark is its quarter's outer wall. */
export const HEART_LANDMARK_SPAN: Readonly<Record<SmithHeartVein, readonly [number, number]>> = {
  heat: [-18, 50],
  hammer: [-18, 35],
  quench: [-18, 50],
  breath: [-18, 50],
};

/** A point `r` yards out at `d` degrees round from a landmark's bearing,
 *  `h` up (landmark_pieces.py Frame.ad). */
export function heartLandmarkAt(
  vein: SmithHeartVein,
  d: number,
  r: number,
  h: number,
): HeartLandmarkPoint {
  const a = (d * Math.PI) / 180;
  return heartLandmarkPoint(vein, r * Math.cos(a), r * Math.sin(a), h);
}

/** The Breath's horns (landmark_pieces.py BREATH_HORNS): foot (u, v),
 *  height, and the curl (per yard of height) toward their tips; the first
 *  two rise either side of the storm's split and curl toward each other. */
const BREATH_HORNS: readonly { u: number; v: number; h: number; cu: number; cv: number }[] = [
  { u: 71.73, v: 6.28, h: 31, cu: -0.12, cv: 0.13 },
  { u: 69.81, v: 21.34, h: 29, cu: -0.12, cv: -0.13 },
  { u: 73.29, v: -10.3, h: 22, cu: -0.1, cv: 0.1 },
  { u: 64.29, v: 38.63, h: 24, cu: -0.05, cv: -0.12 },
  { u: 50.35, v: 48.63, h: 16, cu: 0, cv: -0.1 },
  { u: 64.72, v: -17.32, h: 14, cu: 0, cv: 0.08 },
];

/** The tips of the Breath's horns (the crystal's foot, room-local). */
export function heartBreathHornTips(): HeartLandmarkPoint[] {
  return BREATH_HORNS.map((s, j) =>
    heartLandmarkPoint(
      'breath',
      s.u + s.cu * s.h,
      s.v + s.cv * s.h + Math.sin(3 + j) * 0.5,
      -3 + s.h + 0.6,
    ),
  );
}

/** Each landmark's signature spots, where its air rises and its light
 *  pools (landmark_pieces.py): the Heat's crater and the heads of its five
 *  lava falls, the Hammer's four great crystals, the Quench's spires'
 *  crowns and its frozen falls, the Breath's horns' tips. */
export function heartLandmarkSpots(vein: SmithHeartVein): HeartLandmarkPoint[] {
  const at = (d: number, r: number, h: number) => heartLandmarkAt(vein, d, r, h);
  if (vein === 'heat')
    return [
      at(4, 74, 22),
      at(0, 61.6, 0.8),
      at(12, 61.6, 0.8),
      at(-10, 61.6, 0.8),
      at(25, 61.6, 0.8),
      at(-16.7, 65.5, 3),
      at(48.7, 65.5, 3),
      at(21, 76, 18),
    ];
  if (vein === 'hammer')
    // The first on the gold crack down the great hammer's head (the hammer round of
    // 2026-11-05 raised the head; the crystal that stood here moved off in the
    // weak-spots pass's second round).
    return [at(1.5, 73.5, 17.5), at(17, 71.2, 18), at(-10, 72.2, 16), at(29, 68.8, 13)];
  if (vein === 'quench')
    return [
      at(2, 73.6, 27),
      at(-4, 69.6, 19),
      at(8, 70.2, 21),
      at(4, 79.8, 23),
      at(31, 74.4, 19),
      at(37, 70.6, 14),
      at(-12, 62, 3),
      at(16, 62, 3),
      at(30, 62, 3),
      at(45, 62, 3),
    ];
  return heartBreathHornTips();
}

/** The spots a landmark's halo glows on: every signature spot, but the
 *  Heat's crater alone (the AAA pass's third round: its lava's feet wore
 *  discs that read as salmon globes in the air). */
export function heartLandmarkHaloSpots(vein: SmithHeartVein): HeartLandmarkPoint[] {
  const spots = heartLandmarkSpots(vein);
  return vein === 'heat' ? spots.slice(0, 1) : spots;
}

/** How awake a quarter's landmark is (0 to 1): its quarter's flood once it
 *  reaches the wall (the light runs out along the seams and the landmark
 *  erupts as it arrives), nothing while the quarter sleeps. */
export function heartLandmarkLit(q: HeartQuarterLight): number {
  const { rimR } = HEART_QUARTERS;
  const t = Math.max(0, Math.min(1, (q.front - (rimR - 14)) / 14));
  return q.awake * t * t * (3 - 2 * t);
}

/** One of the Breath's bolts: its points (room-local) and its phase. */
export interface HeartBolt {
  points: HeartLandmarkPoint[];
  phase: number;
}

/** The Breath's lightning: jagged bolts between its horns' tips and from
 *  the tallest down into its quarter's edge (deterministic). */
export function heartBreathBolts(): HeartBolt[] {
  const tips = heartBreathHornTips();
  const pairs: [HeartLandmarkPoint, HeartLandmarkPoint][] = [
    // The great arc across the storm's split, its twin a breath apart.
    [tips[0], tips[1]],
    [tips[1], tips[0]],
    [tips[0], tips[2]],
    [tips[1], tips[3]],
    [tips[3], tips[4]],
    [tips[2], tips[5]],
    // Strikes down into the quarter's edge.
    [tips[0], heartLandmarkAt('breath', 6, 58.5, 0.4)],
    [tips[1], heartLandmarkAt('breath', 16, 57.5, 0.4)],
    [tips[3], heartLandmarkAt('breath', 31, 58, 0.4)],
    [tips[2], heartLandmarkAt('breath', -8, 58, 0.4)],
  ];
  return pairs.map(([a, b], i) => {
    const n = 12;
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const points: HeartLandmarkPoint[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const j = k === 0 || k === n ? 0 : 1;
      const amp = len * 0.07 * Math.sin(Math.PI * t) + 0.25;
      points.push({
        x: a.x + (b.x - a.x) * t + (heartHash(8101 + i * 31, k) - 0.5) * amp * 2 * j,
        y: a.y + (b.y - a.y) * t + (heartHash(8102 + i * 31, k) - 0.5) * amp * 2 * j,
        z: a.z + (b.z - a.z) * t + (heartHash(8103 + i * 31, k) - 0.5) * amp * 2 * j,
      });
    }
    return { points, phase: heartHash(8111, i) };
  });
}
