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
// quests follow in later content passes (the zone design).
// Terrain shape: src/sim/quartered_isle_terrain.ts (the lobes, the hill, the
// arena floor). The four quarters' blend field: src/sim/quartered_quarters.ts.

import { paintedTownBuildingDefs, RIVALMOOT_LAYOUT } from '../painted_towns';
import { RIVALMOOT_NPC_PLACEMENTS_BY_ID } from '../painted_towns/rivalmoot';
import { CHALLENGERS_RING } from '../quartered_isle_terrain';
import { FIREICE_RIFT, GYRE_PEAK, gyrePathPoint, HAMMERS_CUT_CANYON } from '../quartered_landmarks';
import type { NpcDef, PortalDef, ZoneDef, ZonePropsDef } from '../types';
import { emptyZoneProps } from '../types';
import { QUARTERED_ISLE_LAKES } from './quartered_isle_ways';
import { RIVALMOOT_DRESSING } from './quartered_rivalmoot_dressing';

export const QUARTERED_ISLE_ZONE: ZoneDef = {
  id: 'quartered_isle',
  name: 'The Quartered Isle',
  // No natural Rift portals in the northern row (maintainer decision, pinned in
  // tests/rift_portals.test.ts); the isle is the strip's new north end.
  zMin: 1960,
  zMax: 2420,
  // Wider than the strip: the isle claims the inner 70yd of the Drakelands'
  // and the Amberfall's rects beside it (no camp or place of theirs stood
  // there), so the quarters fade into their mainlands well inside the isle
  // and the border ridges stand at x 250 and -250 (types.ts claimsOverlap).
  xMin: -250,
  xMax: 250,
  claimsOverlap: true,
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
  eastPassZ: 2064,
  westPassZ: 2244,
  hub: { x: 0, z: 2248, radius: 24, name: 'Rivalmoot' },
  graveyard: { x: -30, z: 2240 },
  // the Meltwater (quartered_isle_ways.ts)
  lakes: [...QUARTERED_ISLE_LAKES],
  // The King of the Hill arena on the great crater's floor, where the
  // council's war centred: when a hill rises on the isle it always stands
  // here (src/sim/pvp/hill.ts pickHillSpot).
  hillArena: { x: CHALLENGERS_RING.x, z: CHALLENGERS_RING.z },
  pois: [
    { x: 0, z: 2248, label: 'Rivalmoot', id: 'rivalmoot' },
    { x: 0, z: 2122, label: "The Challengers' Ring", id: 'the_challengers_ring' },
    { x: 22, z: 1975, label: 'The Hoarbridge', id: 'the_hoarbridge' },
    { x: 20, z: 2040, label: 'The Hoarshelf', id: 'the_hoarshelf' },
    { x: 120, z: 2190, label: 'The Cinderscar', id: 'the_cinderscar' },
    { x: -120, z: 2200, label: 'The Heavestone Wilds', id: 'the_heavestone_wilds' },
    { x: 0, z: 2356, label: 'The Gyre', id: 'the_gyre' },
    { x: 196, z: 2122, label: 'The Fireice Rift', id: 'the_fireice_rift' },
    { x: 72, z: 2036, label: 'The Crevasses', id: 'the_crevasses' },
    { x: -104, z: 2026, label: 'The Rimeglass', id: 'the_rimeglass' },
    { x: 200, z: 2236, label: 'The Burnways', id: 'the_burnways' },
    { x: 124, z: 2290, label: 'The Glassfield', id: 'the_glassfield' },
    { x: -166, z: 2172, label: "The Hammer's Cut", id: 'the_hammers_cut' },
    { x: -204, z: 2222, label: 'The Heaved Slabs', id: 'the_heaved_slabs' },
    { x: -122, z: 2306, label: 'The Fallen Giant', id: 'the_fallen_giant' },
  ],
  welcome:
    'An old rivalry shattered this island four ways. Rivalmoot keeps the foot of the Gyre, above the crater where the war was fought.',
};

// The isle's roads and lakes live in a leaf module (quartered_isle_ways.ts)
// so the terrain modules can read them without importing this file.
export { QUARTERED_ISLE_LAKES, QUARTERED_ISLE_ROADS } from './quartered_isle_ways';

// The Challengers' Ring's wall: the low KayKit stone wall run round the
// crater's floor (CHALLENGERS_RING in quartered_isle_terrain.ts), in sixteen
// straight runs with four of them left open as gates, one at the foot of
// each ramp.
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

type DecorProp = NonNullable<ZonePropsDef['decorProps']>[number];
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The Gyre's way-markers: a cairn on the path's outer lip every so often,
 *  so the switchbacks read from below, and standing stones round the crown
 *  about the crystal where the council's seat will open. */
function gyreMarkers(): DecorProp[] {
  const out: DecorProp[] = [];
  // one on each third of the climb: enough to read the path from below
  for (let i = 3; i <= 9; i += 3) {
    const p = gyrePathPoint(i / 10);
    const dx = p.x - GYRE_PEAK.x;
    const dz = p.z - GYRE_PEAK.z;
    const r = Math.hypot(dx, dz);
    const lip = (r + GYRE_PEAK.pathW / 2 - 0.9) / r;
    out.push({
      key: i % 3 === 0 ? 'rockTallH' : 'rockLargeD',
      x: round2(GYRE_PEAK.x + dx * lip),
      z: round2(GYRE_PEAK.z + dz * lip),
      rot: round2(i * 1.7),
      r: 0.7,
      h: 2,
    });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    out.push({
      key: 'rockTallA',
      x: round2(GYRE_PEAK.x + Math.cos(a) * 4),
      z: round2(GYRE_PEAK.z + Math.sin(a) * 4),
      rot: round2(a),
      scale: 1.6,
      r: 1,
      h: 4,
    });
  }
  out.push({ key: 'starHeartCrystal', x: GYRE_PEAK.x, z: GYRE_PEAK.z, rot: 0, r: 1.2, h: 2 });
  return out;
}

/** Basalt teeth along the Fireice Rift's lips, alternating sides, the
 *  causeway left open. */
function riftTeeth(): DecorProp[] {
  const out: DecorProp[] = [];
  const line = FIREICE_RIFT.line;
  const c = FIREICE_RIFT.causeway;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    // a tooth on every other stretch, so the rift reads as a scar, not a fence
    if (i % 2 === 1) continue;
    const side = i % 4 === 0 ? 1 : -1;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if (Math.hypot(mx - c.x, mz - c.z) < c.halfW + 8) continue;
    const off = (FIREICE_RIFT.topHalfW + 2) * side;
    out.push({
      key: i % 2 === 0 ? 'rockTallA' : 'rockTallH',
      x: round2(mx + (-(b.z - a.z) / len) * off),
      z: round2(mz + ((b.x - a.x) / len) * off),
      rot: round2(i * 2.1),
      scale: 1.4,
      r: 0.9,
      h: 3.4,
    });
  }
  return out;
}

/** Broken earth in the Hammer's Cut: shards fallen from the walls along the
 *  main cut, and a heap of riven slabs closing the blind branch. */
function canyonVeins(): DecorProp[] {
  const out: DecorProp[] = [];
  const main = HAMMERS_CUT_CANYON.main;
  const wall = HAMMERS_CUT_CANYON.floorHalfW + 1.2;
  // a shard off every other bend of the cut
  for (let i = 1; i + 1 < main.length; i += 2) {
    const a = main[i - 1];
    const b = main[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const side = i % 2 === 0 ? 1 : -1;
    out.push({
      key: 'rockTallA',
      x: round2(main[i].x + (-(b.z - a.z) / len) * wall * side),
      z: round2(main[i].z + ((b.x - a.x) / len) * wall * side),
      rot: round2(i * 1.3),
      scale: 2.6,
      r: 1.3,
      h: 4,
    });
  }
  const end = HAMMERS_CUT_CANYON.branch[HAMMERS_CUT_CANYON.branch.length - 1];
  out.push({ key: 'rockLargeD', x: end.x, z: end.z, rot: 2.4, scale: 6, r: 4, h: 5 });
  return out;
}

export const QUARTERED_ISLE_DECOR: DecorProp[] = [
  ...gyreMarkers(),
  ...riftTeeth(),
  ...canyonVeins(),
  ...RIVALMOOT_DRESSING.decorProps,
  // the Fallen Giant: an early, failed try at the council's colossus, its
  // head and broken trunk lying in the Wilds' north crags
  { key: 'statueHead', x: -122, z: 2306, rot: 2.4, scale: 5, r: 4, h: 11 },
  { key: 'statueBlock', x: -134, z: 2296, rot: 0.7, scale: 3, r: 4, h: 7 },
  { key: 'columnBroken', x: -110, z: 2294, rot: 1.9, scale: 2.4, r: 1.2, h: 5 },
  { key: 'columnBroken', x: -106, z: 2302, rot: 0.3, scale: 2, r: 1, h: 4 },
];

// Rivalmoot's townsfolk. The Gilded Strongbox keeps a bursar at its counting
// house door (the same vault as every town's branch). She is a singleton
// under a reserved id (dynamic, spawned by sim/rivalmoot_keepers.ts), so the
// world-init loop skips her and no shipped entity id moves.
export const RIVALMOOT_BURSAR_NPC_ID = 'bursar_maud_ashby';
export const RIVALMOOT_BURSAR_ENTITY_ID = 1_000_000_031;
export const QUARTERED_ISLE_NPCS: Record<string, NpcDef> = {
  [RIVALMOOT_BURSAR_NPC_ID]: {
    id: RIVALMOOT_BURSAR_NPC_ID,
    name: 'Bursar Maud Ashby',
    title: 'The Gilded Strongbox',
    // at the counting house's door
    pos: { ...RIVALMOOT_NPC_PLACEMENTS_BY_ID.bursar_maud_ashby.position },
    facing: RIVALMOOT_NPC_PLACEMENTS_BY_ID.bursar_maud_ashby.facing,
    color: 0xc9a227,
    // No questIds on purpose: clicking a banker opens the bank window.
    questIds: [],
    banker: true,
    dynamic: true,
    greeting: 'The Gilded Strongbox keeps your goods safe, even on the isle.',
  },
};

// No portals: the isle is walked into over its three crossings.
export const QUARTERED_ISLE_PORTALS: PortalDef[] = [];

export const QUARTERED_ISLE_PROPS: ZonePropsDef = {
  ...emptyZoneProps(),
  buildings: [...paintedTownBuildingDefs(RIVALMOOT_LAYOUT)],
  fences: challengersRingWall(),
  decorProps: QUARTERED_ISLE_DECOR,
  tents: [...RIVALMOOT_DRESSING.tents],
  campfires: [...RIVALMOOT_DRESSING.campfires],
  crates: [...RIVALMOOT_DRESSING.crates],
  wells: [...RIVALMOOT_DRESSING.wells],
  stalls: [...RIVALMOOT_DRESSING.stalls],
  // Rivalmoot's headstones, beside the Pale Keeper (content/graveyards.ts)
  graveyards: [{ x: -30, z: 2240 }],
};
