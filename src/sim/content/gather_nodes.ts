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
  },
  {
    id: 'ore_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -73, z: -49 },
    level: 4,
  },
  {
    id: 'ore_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    pos: { x: -67, z: -57 },
    level: 4,
  },

  // Eastbrook Vale, wood stands around Webwood
  {
    id: 'wood_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -62, z: 8 },
    level: 4,
  },
  {
    id: 'wood_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -57, z: -6 },
    level: 4,
  },
  {
    id: 'wood_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    pos: { x: -68, z: 18 },
    level: 4,
  },

  // Eastbrook Vale, herb patches near Mirror Lake
  {
    id: 'herb_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -86, z: 90 },
    level: 4,
  },
  {
    id: 'herb_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -92, z: 80 },
    level: 4,
  },
  {
    id: 'herb_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    pos: { x: -80, z: 95 },
    level: 4,
  },

  // Mirefen Marsh (mirefen_marsh)
  { id: 'ore_mirefen_1', zoneId: 'mirefen_marsh', type: 'ore', pos: { x: 40, z: 340 }, level: 10 },
  { id: 'ore_mirefen_2', zoneId: 'mirefen_marsh', type: 'ore', pos: { x: -30, z: 360 }, level: 10 },
  { id: 'ore_mirefen_3', zoneId: 'mirefen_marsh', type: 'ore', pos: { x: 35, z: 345 }, level: 10 },

  {
    id: 'wood_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: 10, z: 330 },
    level: 10,
  },
  {
    id: 'wood_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -15, z: 355 },
    level: 10,
  },
  {
    id: 'wood_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    pos: { x: -20, z: 315 },
    level: 10,
  },

  {
    id: 'herb_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 60, z: 385 },
    level: 10,
  },
  {
    id: 'herb_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: -45, z: 452 },
    level: 10,
  },
  {
    id: 'herb_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    pos: { x: 30, z: 355 },
    level: 10,
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
  },
  {
    id: 'ore_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    pos: { x: 78, z: 630 },
    level: 17,
  },

  {
    id: 'wood_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -55, z: 765 },
    level: 17,
  },
  {
    id: 'wood_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    pos: { x: -82, z: 782 },
    level: 17,
  },

  {
    id: 'herb_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: 18, z: 648 },
    level: 17,
  },
  {
    id: 'herb_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    pos: { x: -18, z: 678 },
    level: 17,
  },
];
