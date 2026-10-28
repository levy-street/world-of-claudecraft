// The Anvil of the World's wall landmarks (phase 2M, design doc section
// 5.21): the pure half of heart_landmarks.ts. One great formation of each
// element stands past the platform's rim at the middle of its quarter,
// behind its altar (the Heart kit's Kit_Landmark* pieces, built by
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

/** The Breath's horns (landmark_pieces.py `horns`): foot (u, v), height,
 *  and the curl (per yard of height) toward their tips. */
const BREATH_HORNS: readonly { u: number; v: number; h: number; cu: number; cv: number }[] = [
  { u: 72, v: 0, h: 19, cu: -0.35, cv: 0 },
  { u: 69, v: -6, h: 14, cu: -0.25, cv: 0.35 },
  { u: 69.5, v: 6.2, h: 15, cu: -0.25, cv: -0.35 },
  { u: 76, v: -3.2, h: 11, cu: 0.1, cv: 0.2 },
  { u: 76, v: 4, h: 12, cu: 0.1, cv: -0.25 },
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
 *  pools: the Heat's crater and its lava's spill, the Hammer's great
 *  crystal and its shoulders, the Quench's spires' crowns, the Breath's
 *  horns' tips. */
export function heartLandmarkSpots(vein: SmithHeartVein): HeartLandmarkPoint[] {
  if (vein === 'heat')
    return [
      heartLandmarkPoint('heat', 71, 0, 8.5),
      heartLandmarkPoint('heat', 63.5, 0, 2.4),
      heartLandmarkPoint('heat', 61.5, -6, 0.6),
      heartLandmarkPoint('heat', 61.5, 6.8, 0.6),
    ];
  if (vein === 'hammer')
    return [
      heartLandmarkPoint('hammer', 63.5, 0.5, 5.5),
      heartLandmarkPoint('hammer', 70.5, -5.2, 9.0),
      heartLandmarkPoint('hammer', 69.5, 5.7, 7.6),
    ];
  if (vein === 'quench')
    return [
      heartLandmarkPoint('quench', 69.8, 0, 13.0),
      heartLandmarkPoint('quench', 68, -5.5, 9.5),
      heartLandmarkPoint('quench', 67.4, 6.4, 10.4),
      heartLandmarkPoint('quench', 64.5, -2.5, 4.2),
      heartLandmarkPoint('quench', 63.6, 3.4, 3.6),
    ];
  return heartBreathHornTips();
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
    [tips[0], tips[1]],
    [tips[0], tips[2]],
    [tips[1], tips[3]],
    [tips[2], tips[4]],
    [tips[3], tips[4]],
    [tips[0], heartLandmarkPoint('breath', 58.5, -3, 0.4)],
    [tips[2], heartLandmarkPoint('breath', 57.5, 5, 0.4)],
    [tips[1], heartLandmarkPoint('breath', 58, -8.5, 0.4)],
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
