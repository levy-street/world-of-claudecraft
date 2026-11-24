// Rivalmoot's set dressing: what makes the town read as the isle's own and
// not three buildings on bare ground.
//
// - The waystones. A road leaves the paved top past one marker cut from the
//   quarter it leads to: a cinder column east, a sandstone stack west and a
//   slate fang on the north road onto the Gyre's path. The crater road south
//   has none: the Hoarshelf lies far beyond the crater, and snow has no
//   place on the town's warm ground. One stone a road, on the side that
//   stands clearer of the buildings: the town stands open, with no gate.
// - The challengers' camp on the south-west rim, behind the outfitter's:
//   tents, a fire and their crates, looking down into the crater they came
//   to fight in.
// - A well, two stalls and the town's stores on the square.
//
// Pure data built from the town's own roads and the isle kit's measured
// sizes, so a waystone moves with its road. No engine imports, no randomness.

import { RIVALMOOT_LAYOUT } from '../painted_towns';
import { RIVALMOOT_HILL } from '../quartered_isle_terrain';
import type { ZonePropsDef } from '../types';
import { QUARTERED_ISLE_ROADS } from './quartered_isle_ways';
import { ISLE_KIT } from './quartered_spires';

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];
const round2 = (v: number) => Math.round(v * 100) / 100;

/** How far out along its road each waystone stands, yards from the plaza's
 *  centre: past the buildings, on the paving's edge. */
export const RIVALMOOT_WAYSTONE_R = 30;
/** A waystone's distance from its road's centre line: the road and a rider's
 *  width stay clear beside it. */
export const RIVALMOOT_WAYSTONE_OFFSET = 5.5;
/** A collider inside the piece's ragged outline (the isle kit's own share). */
const COLLIDER_SHARE = 0.4;

export type RivalmootGate = 'ice' | 'fire' | 'earth' | 'wind';

/** The unit heading of the town road that leaves toward (dx, dz). */
function roadHeading(match: (dx: number, dz: number) => boolean): { x: number; z: number } {
  for (const road of QUARTERED_ISLE_ROADS) {
    for (const [a, b] of [
      [road[0], road[1]],
      [road[road.length - 1], road[road.length - 2]],
    ]) {
      if (a.x !== RIVALMOOT_HILL.x || a.z !== RIVALMOOT_HILL.z) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (match(dx / len, dz / len)) return { x: dx / len, z: dz / len };
    }
  }
  throw new Error('Rivalmoot road not found');
}

/** The four roads out of the plaza, by the quarter each leads to. */
export const RIVALMOOT_GATE_HEADINGS: Readonly<Record<RivalmootGate, { x: number; z: number }>> = {
  ice: roadHeading((_, dz) => dz < -0.7),
  fire: roadHeading((dx) => dx > 0.7),
  earth: roadHeading((dx) => dx < -0.7),
  wind: roadHeading((_, dz) => dz > 0.7),
};

function kitPost(key: keyof typeof ISLE_KIT, scale: number, x: number, z: number, rot: number) {
  const k = ISLE_KIT[key];
  return {
    key,
    scale,
    x: round2(x),
    z: round2(z),
    rot: round2(rot),
    r: round2(Math.max(0.6, k.w * scale * COLLIDER_SHARE)),
    h: round2(k.h * scale),
  } satisfies DecorProp;
}

/** One road's waystone, on whichever side of the road stands further from
 *  the nearest building. */
function waystone(gate: Exclude<RivalmootGate, 'ice'>): DecorProp[] {
  const d = RIVALMOOT_GATE_HEADINGS[gate];
  const spot = (side: number) => ({
    // the road's normal, pointing away from the road on this side
    nx: d.z * side,
    nz: -d.x * side,
    x: RIVALMOOT_HILL.x + d.x * RIVALMOOT_WAYSTONE_R + d.z * side * RIVALMOOT_WAYSTONE_OFFSET,
    z: RIVALMOOT_HILL.z + d.z * RIVALMOOT_WAYSTONE_R - d.x * side * RIVALMOOT_WAYSTONE_OFFSET,
  });
  const room = (p: { x: number; z: number }) =>
    Math.min(
      ...RIVALMOOT_LAYOUT.buildings.map((b) => Math.hypot(p.x - b.position.x, p.z - b.position.z)),
    );
  const [a, b] = [spot(1), spot(-1)];
  const { x: px, z: pz } = room(a) >= room(b) ? a : b;
  if (gate === 'fire') return [kitPost('cinderColumnsTall', 0.42, px, pz, 1.1)];
  if (gate === 'earth') return [kitPost('heaveStrataSmall', 0.72, px, pz, 0.8)];
  return [{ key: 'rockTallA', scale: 2, x: round2(px), z: round2(pz), rot: 1.4, r: 1.2, h: 5 }];
}

export const RIVALMOOT_WAYSTONES: readonly DecorProp[] = (
  ['fire', 'earth', 'wind'] as const
).flatMap(waystone);

const H = RIVALMOOT_HILL;

/** Everything the zone record takes for the town, one field per prop lane. */
export const RIVALMOOT_DRESSING = {
  decorProps: RIVALMOOT_WAYSTONES,
  // the challengers' camp, on the south-west rim behind the outfitter's
  tents: [
    { x: H.x - 6, z: H.z - 18.5, rot: -2.2, scale: 1 },
    { x: H.x - 6.5, z: H.z - 25.5, rot: -1.2, scale: 1 },
    { x: H.x - 14, z: H.z - 27.4, rot: 2.9, scale: 1 },
  ],
  campfires: [[H.x - 10.5, H.z - 24.3]] as [number, number][],
  crates: [
    [H.x - 17.5, H.z - 25],
    [H.x - 18.3, H.z - 24.2, 2],
    [H.x - 4.5, H.z - 29],
    // the inn's and the outfitter's stores, against their walls
    [H.x - 10, H.z + 10],
    [H.x - 10.5, H.z + 11.6, 2],
    [H.x - 8, H.z - 9],
  ] as [number, number, number?][],
  wells: [{ x: H.x - 7, z: H.z + 6, r: 1.5 }],
  stalls: [
    { x: H.x + 4.4, z: H.z - 13, rot: -1.9, r: 1.6 },
    { x: H.x - 9, z: H.z - 6, rot: 0.9, r: 1.6 },
  ],
} as const;
