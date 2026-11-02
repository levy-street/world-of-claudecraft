// The Quartered Isle (level 20). The island north of the Frostveil Reach
// that the Hammer Council's old rivalry tore four ways: the Hoarshelf (ice)
// to the south over the Hoarbridge from the Reach, the Cinderscar (fire) on
// the Drakelands side, the Heavestone Wilds (earth) on the Amberfall side,
// and the Gyre (wind) round the storm peak to the north. Rivalmoot, the
// challengers' town, stands on the hill at the island's heart, and at the
// hill's south-west foot lies the Challengers' Ring, the dedicated arena a
// King of the Hill rises in whenever it comes to the isle (hillArena).
//
// This first pass is the land, the town and the arena; the quarters' foes and
// quests follow in later content passes (docs/prd/quartered-isle-zone.md).
// Terrain shape: src/sim/quartered_isle_terrain.ts (the lobes, the hill, the
// arena floor). The four quarters' blend field: src/sim/quartered_quarters.ts.

import { paintedTownBuildingDefs, RIVALMOOT_LAYOUT } from '../painted_towns';
import { CHALLENGERS_RING } from '../quartered_isle_terrain';
import type { PortalDef, ZoneDef, ZonePropsDef } from '../types';
import { emptyZoneProps } from '../types';

export const QUARTERED_ISLE_ZONE: ZoneDef = {
  id: 'quartered_isle',
  name: 'The Quartered Isle',
  // No natural Rift portals in the northern row (maintainer decision, pinned in
  // tests/rift_portals.test.ts); the isle is the strip's new north end.
  zMin: 1960,
  zMax: 2420,
  levelRange: [20, 20],
  biome: 'quartered',
  // The Hoarbridge: the frozen land bridge off the Reach's north crown, the
  // one dry way over the strait that is the isle's south border (no ridge
  // rises along a water border, so the Reach's north shore keeps its shape)
  southPassX: 22,
  waterSouthBorder: true,
  // The side crossings into the two columns (src/sim/border_edges.ts takes
  // the pass that falls inside each shared edge): the cooling scar onto the
  // Drakelands' Snowline shoulders, the stone shelves onto the Amberfall's
  // Monolith heath. Both land on ground the neighbours already carry to the
  // border, so neither neighbour's coast moved.
  eastPassZ: 2080,
  westPassZ: 2274,
  hub: { x: 0, z: 2235, radius: 24, name: 'Rivalmoot' },
  graveyard: { x: -14, z: 2258 },
  lakes: [],
  // The King of the Hill arena at the hill's foot: when a hill rises on the
  // isle it always stands here (src/sim/pvp/hill.ts pickHillSpot).
  hillArena: { x: CHALLENGERS_RING.x, z: CHALLENGERS_RING.z },
  pois: [
    { x: 0, z: 2235, label: 'Rivalmoot', id: 'rivalmoot' },
    { x: -44, z: 2098, label: "The Challengers' Ring", id: 'the_challengers_ring' },
    { x: 22, z: 1975, label: 'The Hoarbridge', id: 'the_hoarbridge' },
    { x: 20, z: 2040, label: 'The Hoarshelf', id: 'the_hoarshelf' },
    { x: 120, z: 2190, label: 'The Cinderscar', id: 'the_cinderscar' },
    { x: -120, z: 2200, label: 'The Heavestone Wilds', id: 'the_heavestone_wilds' },
    { x: 0, z: 2330, label: 'The Gyre', id: 'the_gyre' },
  ],
  welcome:
    'An old rivalry broke this island four ways. On the hill at its heart, Rivalmoot keeps watch over the ring below.',
};

// The isle's roads. Every way meets at Rivalmoot's plaza on the hilltop; the
// hill road climbs the gentle south-east flank past the arena, the side roads
// run out through each quarter to its crossing, and the north road leaves by
// the town's north gate toward the Gyre.
export const QUARTERED_ISLE_ROADS: { x: number; z: number }[][] = [
  [
    { x: -2, z: 1866 },
    { x: -4, z: 1880 },
    { x: -4, z: 1905 },
    { x: 4, z: 1930 },
    { x: 12, z: 1946 },
    { x: 22, z: 1962 },
  ], // the Frostveil crown's north valley -> the Hoarbridge. It starts at the
  // valley head, past the rime elementals' and ice wisps' grounds: a road
  // calms the relief beside it, and a camp's ground must never move (its
  // idle wander draws the shared rng)
  [
    { x: 22, z: 1962 },
    { x: 24, z: 2000 },
    { x: 26, z: 2050 },
    { x: 34, z: 2100 },
    { x: 40, z: 2150 },
    { x: 30, z: 2195 },
    { x: 12, z: 2222 },
    { x: 0, z: 2235 },
  ], // the Hoarbridge -> past the Challengers' Ring -> up the hill to Rivalmoot
  [
    { x: 30, z: 2082 },
    { x: 15, z: 2097 },
  ], // the hill road -> the Challengers' Ring's east gate
  [
    { x: 0, z: 2235 },
    { x: 36, z: 2232 },
    { x: 84, z: 2196 },
    { x: 124, z: 2140 },
    { x: 152, z: 2098 },
    { x: 180, z: 2080 },
    { x: 214, z: 2078 },
    { x: 250, z: 2062 },
    { x: 276, z: 2044 },
  ], // Rivalmoot -> the Cinderscar -> over the crossing onto the Drakelands' Snowline road
  [
    { x: 0, z: 2235 },
    { x: -36, z: 2246 },
    { x: -86, z: 2262 },
    { x: -136, z: 2272 },
    { x: -180, z: 2274 },
    { x: -225, z: 2262 },
    { x: -272, z: 2226 },
  ], // Rivalmoot -> the Heavestone Wilds -> over the crossing to the Leaning Monolith road
  [
    { x: 0, z: 2235 },
    { x: -6, z: 2266 },
    { x: 4, z: 2300 },
    { x: 0, z: 2330 },
  ], // Rivalmoot's north gate -> the foot of the Gyre
];

// The Challengers' Ring's wall: the low KayKit stone wall run round the floor
// just inside the spectators' bank (CHALLENGERS_RING in
// quartered_isle_terrain.ts), in sixteen straight runs with four of them left
// open as gates, one on each side (the east gate meets the hill road's spur).
// A stone fence is a jumpable OBB, so the wall marks the ring without ever
// trapping anyone in or out of a contest.
const RING_WALL_RUNS = 16;
const RING_GATES = new Set([0, 4, 8, 12]);
function challengersRingWall(): ZonePropsDef['fences'] {
  const r = CHALLENGERS_RING.floorR + 1;
  const out: ZonePropsDef['fences'] = [];
  for (let i = 0; i < RING_WALL_RUNS; i++) {
    if (RING_GATES.has(i)) continue;
    const a0 = ((i - 0.5) / RING_WALL_RUNS) * Math.PI * 2;
    const a1 = ((i + 0.5) / RING_WALL_RUNS) * Math.PI * 2;
    const at = (a: number) => Math.round(a * 100) / 100;
    out.push({
      x1: at(CHALLENGERS_RING.x + Math.cos(a0) * r),
      z1: at(CHALLENGERS_RING.z + Math.sin(a0) * r),
      x2: at(CHALLENGERS_RING.x + Math.cos(a1) * r),
      z2: at(CHALLENGERS_RING.z + Math.sin(a1) * r),
      kind: 'stone',
    });
  }
  return out;
}

// No portals: the isle is walked into over its three crossings.
export const QUARTERED_ISLE_PORTALS: PortalDef[] = [];

export const QUARTERED_ISLE_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  buildings: [...paintedTownBuildingDefs(RIVALMOOT_LAYOUT)],
  fences: challengersRingWall(),
  // Rivalmoot's headstones, beside the Pale Keeper (content/graveyards.ts)
  graveyards: [{ x: -14, z: 2258 }],
};
