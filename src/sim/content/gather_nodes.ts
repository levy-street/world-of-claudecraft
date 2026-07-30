// Gatherable world nodes: ore veins, wood stands, herb patches. Placed as
// permanent, unowned world fixtures; visibility only (see G3 for harvesting).
// Adding a new node type or placement should touch only this file plus the
// render prop lookup that draws it (src/render/gather_nodes.ts).

import type { GatherNodeDef, GatherNodeType } from '../types';

export const GATHER_NODE_TYPES: readonly GatherNodeType[] = ['ore', 'wood', 'herb'];

// `level` (issue: profession XP) is a one-time snapshot of each node's zone
// levelRange midpoint (eastbrook_vale [1,7] -> 4; mirefen_marsh, zone2's
// levelRange [6,13] -> 10), not a live lookup: see types.ts GatherNodeDef.
export const GATHER_NODES: GatherNodeDef[] = [
  // Eastbrook Vale (eastbrook_vale), ore around the Copper Dig outcrops (the
  // zone's mine-themed POI, zone1.ts pois); moved here from Boar Meadow (a
  // wolf/boar mob area with no mining flavor and no discoverable landmark)
  // so q_prof_intro's ore veins actually sit somewhere players can find them.
  // Nudged toward the town-facing edge of the tunnel_rat camp (center -82,-62,
  // radius 20) so a level 1-2 miner picking up q_prof_intro can reach ore
  // without crossing all the way to the camp's interior first.
  {
    id: 'ore_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -70, z: -53 },
    level: 4,
    tier: 1,
  },
  {
    id: 'ore_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -73, z: -49 },
    level: 4,
    tier: 1,
  },
  {
    id: 'ore_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -67, z: -57 },
    level: 4,
    tier: 1,
  },

  // Eastbrook Vale, wood stands around Webwood
  {
    id: 'wood_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -62, z: 8 },
    level: 4,
    tier: 1,
  },
  {
    id: 'wood_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -57, z: -6 },
    level: 4,
    tier: 1,
  },
  {
    id: 'wood_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -68, z: 18 },
    level: 4,
    tier: 1,
  },

  // Eastbrook Vale, herb patches near Mirror Lake
  {
    id: 'herb_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -86, z: 90 },
    level: 4,
    tier: 1,
  },
  {
    id: 'herb_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -92, z: 80 },
    level: 4,
    tier: 1,
  },
  {
    id: 'herb_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -80, z: 95 },
    level: 4,
    tier: 1,
  },

  // Mirefen Marsh (mirefen_marsh)
  {
    id: 'ore_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 40, z: 340 },
    level: 10,
    tier: 1,
  },
  {
    id: 'ore_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: -30, z: 360 },
    level: 10,
    tier: 1,
  },
  {
    id: 'ore_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 35, z: 345 },
    level: 10,
    tier: 1,
  },

  {
    id: 'wood_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: 10, z: 330 },
    level: 10,
    tier: 1,
  },
  {
    id: 'wood_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -15, z: 355 },
    level: 10,
    tier: 1,
  },
  {
    id: 'wood_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -20, z: 315 },
    level: 10,
    tier: 1,
  },

  {
    id: 'herb_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 60, z: 385 },
    level: 10,
    tier: 1,
  },
  {
    id: 'herb_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: -45, z: 452 },
    level: 10,
    tier: 1,
  },
  {
    id: 'herb_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 30, z: 355 },
    level: 10,
    tier: 1,
  },

  // Thornpeak Heights (thornpeak_heights) had no gather nodes at all, forcing
  // higher-level players back down to zone 1 for every mining/logging/herb
  // trip. Ore sits by Deeprock Burrows (the zone's mine-themed POI, guarded by
  // the deeprock_kobold camp, matching the eastbrook_vale ore-vs-tunnel_rat
  // precedent); wood sits near The Glimmermere and herb near Highwatch.
  {
    id: 'ore_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 90, z: 608 },
    level: 17,
    tier: 1,
  },
  {
    id: 'ore_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 78, z: 630 },
    level: 17,
    tier: 1,
  },

  {
    id: 'wood_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -55, z: 765 },
    level: 17,
    tier: 1,
  },
  {
    id: 'wood_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -82, z: 782 },
    level: 17,
    tier: 1,
  },

  {
    id: 'herb_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: 18, z: 648 },
    level: 17,
    tier: 1,
  },
  {
    id: 'herb_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: -18, z: 678 },
    level: 17,
    tier: 1,
  },

  // Tool-tier ramp. Zone 1 (eastbrook_vale) stays ALL tier 1: every node
  // above keeps tier 1, so the 20-copper starter tools cover the whole zone
  // (#2343: every harvest needs its profession's tool, tier 1 included; the
  // starter tools are sold a few steps from spawn). The
  // ramp comes only from the NEW veins
  // below: mirefen_marsh gains one tier-2 node per type, thornpeak_heights
  // gains one tier-2 and one tier-3 node per type. Each sits a short walk
  // (5 to 20 yd) from the matching existing cluster of the same type, and
  // grants the zone's existing material via the zone-keyed
  // NODE_MATERIAL_TABLE: no new materials and no yield changes (deliberate;
  // rhythm and richer yields are handled separately).
  {
    id: 'ore_mirefen_t2',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    pos: { x: 48, z: 352 },
    level: 10,
    tier: 2,
  },
  {
    id: 'wood_mirefen_t2',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: 2, z: 342 },
    level: 10,
    tier: 2,
  },
  {
    id: 'herb_mirefen_t2',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 52, z: 396 },
    level: 10,
    tier: 2,
  },
  {
    id: 'ore_thornpeak_t2',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 102, z: 615 },
    level: 17,
    tier: 2,
  },
  {
    id: 'ore_thornpeak_t3',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 70, z: 640 },
    level: 17,
    tier: 3,
  },
  {
    id: 'wood_thornpeak_t2',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -45, z: 776 },
    level: 17,
    tier: 2,
  },
  {
    id: 'wood_thornpeak_t3',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -92, z: 793 },
    level: 17,
    tier: 3,
  },
  {
    id: 'herb_thornpeak_t2',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: 28, z: 658 },
    level: 17,
    tier: 2,
  },
  {
    id: 'herb_thornpeak_t3',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: -28, z: 690 },
    level: 17,
    tier: 3,
  },

  // The Veiled Hollow, around Eldergleam: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_veiled_hollow_1',
    zoneId: 'veiled_hollow',
    type: 'ore',
    pos: { x: -2, z: 1004 },
    level: 18,
    tier: 1,
  },
  {
    id: 'ore_veiled_hollow_2',
    zoneId: 'veiled_hollow',
    type: 'ore',
    pos: { x: 6, z: 1044 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_veiled_hollow_1',
    zoneId: 'veiled_hollow',
    type: 'wood',
    pos: { x: -82, z: 1052 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_veiled_hollow_2',
    zoneId: 'veiled_hollow',
    type: 'wood',
    pos: { x: -70, z: 992 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_veiled_hollow_1',
    zoneId: 'veiled_hollow',
    type: 'herb',
    pos: { x: -22, z: 1074 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_veiled_hollow_2',
    zoneId: 'veiled_hollow',
    type: 'herb',
    pos: { x: -54, z: 1082 },
    level: 18,
    tier: 1,
  },

  // The Drakelands, around Wyrmwatch: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_drakelands_1',
    zoneId: 'drakelands',
    type: 'ore',
    pos: { x: 442, z: 1874 },
    level: 18,
    tier: 1,
  },
  {
    id: 'ore_drakelands_2',
    zoneId: 'drakelands',
    type: 'ore',
    pos: { x: 450, z: 1914 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_drakelands_1',
    zoneId: 'drakelands',
    type: 'wood',
    pos: { x: 362, z: 1922 },
    level: 18,
    tier: 1,
  },
  {
    id: 'wood_drakelands_2',
    zoneId: 'drakelands',
    type: 'wood',
    pos: { x: 374, z: 1862 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_drakelands_1',
    zoneId: 'drakelands',
    type: 'herb',
    pos: { x: 422, z: 1944 },
    level: 18,
    tier: 1,
  },
  {
    id: 'herb_drakelands_2',
    zoneId: 'drakelands',
    type: 'herb',
    pos: { x: 390, z: 1952 },
    level: 18,
    tier: 1,
  },

  // The Frostveil Reach, around Icemantle: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_frostveil_1',
    zoneId: 'frostveil',
    type: 'ore',
    pos: { x: 8, z: 1534 },
    level: 19,
    tier: 1,
  },
  {
    id: 'ore_frostveil_2',
    zoneId: 'frostveil',
    type: 'ore',
    pos: { x: 16, z: 1574 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_frostveil_1',
    zoneId: 'frostveil',
    type: 'wood',
    pos: { x: -72, z: 1582 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_frostveil_2',
    zoneId: 'frostveil',
    type: 'wood',
    pos: { x: -60, z: 1522 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_frostveil_1',
    zoneId: 'frostveil',
    type: 'herb',
    pos: { x: -12, z: 1604 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_frostveil_2',
    zoneId: 'frostveil',
    type: 'herb',
    pos: { x: -44, z: 1612 },
    level: 19,
    tier: 1,
  },

  // The Amberfall, around Lanternmere: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_amberfall_1',
    zoneId: 'amberfall',
    type: 'ore',
    pos: { x: -322, z: 2046 },
    level: 19,
    tier: 1,
  },
  {
    id: 'ore_amberfall_2',
    zoneId: 'amberfall',
    type: 'ore',
    pos: { x: -314, z: 2086 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_amberfall_1',
    zoneId: 'amberfall',
    type: 'wood',
    pos: { x: -402, z: 2094 },
    level: 19,
    tier: 1,
  },
  {
    id: 'wood_amberfall_2',
    zoneId: 'amberfall',
    type: 'wood',
    pos: { x: -390, z: 2034 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_amberfall_1',
    zoneId: 'amberfall',
    type: 'herb',
    pos: { x: -342, z: 2116 },
    level: 19,
    tier: 1,
  },
  {
    id: 'herb_amberfall_2',
    zoneId: 'amberfall',
    type: 'herb',
    pos: { x: -374, z: 2124 },
    level: 19,
    tier: 1,
  },

  // The Willowfen, around Bridgemere: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_willowfen_1',
    zoneId: 'willowfen',
    type: 'ore',
    pos: { x: -322, z: 336 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_willowfen_2',
    zoneId: 'willowfen',
    type: 'ore',
    pos: { x: -314, z: 376 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_1',
    zoneId: 'willowfen',
    type: 'wood',
    pos: { x: -402, z: 384 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_willowfen_2',
    zoneId: 'willowfen',
    type: 'wood',
    pos: { x: -390, z: 324 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_1',
    zoneId: 'willowfen',
    type: 'herb',
    pos: { x: -342, z: 406 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_willowfen_2',
    zoneId: 'willowfen',
    type: 'herb',
    pos: { x: -374, z: 414 },
    level: 20,
    tier: 1,
  },

  // The Nightbloom, around Moonrest: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_nightbloom_1',
    zoneId: 'nightbloom',
    type: 'ore',
    pos: { x: -332, z: 1394 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_nightbloom_2',
    zoneId: 'nightbloom',
    type: 'ore',
    pos: { x: -324, z: 1434 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_nightbloom_1',
    zoneId: 'nightbloom',
    type: 'wood',
    pos: { x: -412, z: 1442 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_nightbloom_2',
    zoneId: 'nightbloom',
    type: 'wood',
    pos: { x: -400, z: 1382 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_nightbloom_1',
    zoneId: 'nightbloom',
    type: 'herb',
    pos: { x: -352, z: 1464 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_nightbloom_2',
    zoneId: 'nightbloom',
    type: 'herb',
    pos: { x: -384, z: 1472 },
    level: 20,
    tier: 1,
  },

  // The Wraithwood, around Gallowmere: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_wraithwood_1',
    zoneId: 'wraithwood',
    type: 'ore',
    pos: { x: 398, z: 1404 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_wraithwood_2',
    zoneId: 'wraithwood',
    type: 'ore',
    pos: { x: 406, z: 1444 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_wraithwood_1',
    zoneId: 'wraithwood',
    type: 'wood',
    pos: { x: 318, z: 1452 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_wraithwood_2',
    zoneId: 'wraithwood',
    type: 'wood',
    pos: { x: 330, z: 1392 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_wraithwood_1',
    zoneId: 'wraithwood',
    type: 'herb',
    pos: { x: 378, z: 1474 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_wraithwood_2',
    zoneId: 'wraithwood',
    type: 'herb',
    pos: { x: 346, z: 1482 },
    level: 20,
    tier: 1,
  },

  // The Galecrest, around Wickharbor: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_galecrest_1',
    zoneId: 'galecrest',
    type: 'ore',
    pos: { x: 458, z: 334 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_galecrest_2',
    zoneId: 'galecrest',
    type: 'ore',
    pos: { x: 466, z: 374 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_1',
    zoneId: 'galecrest',
    type: 'wood',
    pos: { x: 378, z: 382 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_galecrest_2',
    zoneId: 'galecrest',
    type: 'wood',
    pos: { x: 390, z: 322 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_1',
    zoneId: 'galecrest',
    type: 'herb',
    pos: { x: 438, z: 404 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_galecrest_2',
    zoneId: 'galecrest',
    type: 'herb',
    pos: { x: 406, z: 412 },
    level: 20,
    tier: 1,
  },

  // The Palmreach, around Drifthaven: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_palmreach_1',
    zoneId: 'palmreach',
    type: 'ore',
    pos: { x: -262, z: 794 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_palmreach_2',
    zoneId: 'palmreach',
    type: 'ore',
    pos: { x: -254, z: 834 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_palmreach_1',
    zoneId: 'palmreach',
    type: 'wood',
    pos: { x: -342, z: 842 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_palmreach_2',
    zoneId: 'palmreach',
    type: 'wood',
    pos: { x: -330, z: 782 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_palmreach_1',
    zoneId: 'palmreach',
    type: 'herb',
    pos: { x: -282, z: 864 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_palmreach_2',
    zoneId: 'palmreach',
    type: 'herb',
    pos: { x: -314, z: 872 },
    level: 20,
    tier: 1,
  },

  // The Evergarden, around Hedgewick: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_evergarden_1',
    zoneId: 'evergarden',
    type: 'ore',
    pos: { x: 358, z: 784 },
    level: 20,
    tier: 1,
  },
  {
    id: 'ore_evergarden_2',
    zoneId: 'evergarden',
    type: 'ore',
    pos: { x: 366, z: 824 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_evergarden_1',
    zoneId: 'evergarden',
    type: 'wood',
    pos: { x: 278, z: 832 },
    level: 20,
    tier: 1,
  },
  {
    id: 'wood_evergarden_2',
    zoneId: 'evergarden',
    type: 'wood',
    pos: { x: 290, z: 772 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_evergarden_1',
    zoneId: 'evergarden',
    type: 'herb',
    pos: { x: 338, z: 854 },
    level: 20,
    tier: 1,
  },
  {
    id: 'herb_evergarden_2',
    zoneId: 'evergarden',
    type: 'herb',
    pos: { x: 306, z: 862 },
    level: 20,
    tier: 1,
  },

  // The Farshore, around Gullhaven: hub-outskirt veins, stands, and patches so every
  // profession can gather without backtracking to an older zone.
  {
    id: 'ore_farshore_isle_1',
    zoneId: 'farshore_isle',
    type: 'ore',
    pos: { x: 343, z: 44 },
    level: 5,
    tier: 1,
  },
  {
    id: 'ore_farshore_isle_2',
    zoneId: 'farshore_isle',
    type: 'ore',
    pos: { x: 351, z: 84 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_1',
    zoneId: 'farshore_isle',
    type: 'wood',
    pos: { x: 263, z: 92 },
    level: 5,
    tier: 1,
  },
  {
    id: 'wood_farshore_isle_2',
    zoneId: 'farshore_isle',
    type: 'wood',
    pos: { x: 275, z: 32 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_1',
    zoneId: 'farshore_isle',
    type: 'herb',
    pos: { x: 323, z: 114 },
    level: 5,
    tier: 1,
  },
  {
    id: 'herb_farshore_isle_2',
    zoneId: 'farshore_isle',
    type: 'herb',
    pos: { x: 291, z: 122 },
    level: 5,
    tier: 1,
  },
];
