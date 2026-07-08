// Gatherable world nodes: ore veins, wood stands, herb patches. Placed as
// permanent, unowned world fixtures; visibility only (see G3 for harvesting).
// Adding a new node type or placement should touch only this file plus the
// render prop lookup that draws it (src/render/gather_nodes.ts).

import type { GatherNodeDef, GatherNodeType } from '../types';

export const GATHER_NODE_TYPES: readonly GatherNodeType[] = ['ore', 'wood', 'herb'];

export const GATHER_NODES: GatherNodeDef[] = [
  // Eastbrook Vale (eastbrook_vale), starter ore near Boar Meadow and Copper Dig.
  {
    id: 'ore_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    materialItemId: 'copper_ore',
    pos: { x: 72, z: 8 },
  },
  {
    id: 'ore_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    materialItemId: 'copper_ore',
    pos: { x: 78, z: -6 },
  },
  {
    id: 'ore_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    materialItemId: 'tin_ore',
    pos: { x: 66, z: 22 },
  },
  {
    id: 'ore_eastbrook_4',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    materialItemId: 'copper_ore',
    pos: { x: -78, z: -68 },
  },
  {
    id: 'ore_eastbrook_5',
    zoneId: 'eastbrook_vale',
    type: 'ore',
    materialItemId: 'tin_ore',
    pos: { x: -92, z: -52 },
  },

  // Eastbrook Vale, ashwood stands around Webwood and the old chapel.
  {
    id: 'wood_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    materialItemId: 'ashwood_log',
    pos: { x: -62, z: 8 },
  },
  {
    id: 'wood_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    materialItemId: 'ashwood_log',
    pos: { x: -57, z: -6 },
  },
  {
    id: 'wood_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    materialItemId: 'ashwood_log',
    pos: { x: -68, z: 18 },
  },
  {
    id: 'wood_eastbrook_4',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    materialItemId: 'ashwood_log',
    pos: { x: -38, z: 44 },
  },
  {
    id: 'wood_eastbrook_5',
    zoneId: 'eastbrook_vale',
    type: 'wood',
    materialItemId: 'ashwood_log',
    pos: { x: 92, z: 82 },
  },

  // Eastbrook Vale, starter herbs near Mirror Lake and Wolf Run.
  {
    id: 'herb_eastbrook_1',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    materialItemId: 'silverleaf_herb',
    pos: { x: -86, z: 90 },
  },
  {
    id: 'herb_eastbrook_2',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    materialItemId: 'silverleaf_herb',
    pos: { x: -92, z: 80 },
  },
  {
    id: 'herb_eastbrook_3',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    materialItemId: 'briarthorn_herb',
    pos: { x: -80, z: 95 },
  },
  {
    id: 'herb_eastbrook_4',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    materialItemId: 'silverleaf_herb',
    pos: { x: -24, z: 74 },
  },
  {
    id: 'herb_eastbrook_5',
    zoneId: 'eastbrook_vale',
    type: 'herb',
    materialItemId: 'briarthorn_herb',
    pos: { x: 72, z: 94 },
  },

  // Mirefen Marsh (mirefen_marsh), mid-tier deposits along the causeway.
  {
    id: 'ore_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    materialItemId: 'tin_ore',
    pos: { x: 40, z: 340 },
  },
  {
    id: 'ore_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    materialItemId: 'iron_ore',
    pos: { x: -30, z: 360 },
  },
  {
    id: 'ore_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    materialItemId: 'iron_ore',
    pos: { x: -88, z: 438 },
  },
  {
    id: 'ore_mirefen_4',
    zoneId: 'mirefen_marsh',
    type: 'ore',
    materialItemId: 'tin_ore',
    pos: { x: 52, z: 512 },
  },

  {
    id: 'wood_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    materialItemId: 'ashwood_log',
    pos: { x: 10, z: 330 },
  },
  {
    id: 'wood_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    materialItemId: 'elderwood_log',
    pos: { x: -15, z: 355 },
  },
  {
    id: 'wood_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    materialItemId: 'elderwood_log',
    pos: { x: -112, z: 304 },
  },
  {
    id: 'wood_mirefen_4',
    zoneId: 'mirefen_marsh',
    type: 'wood',
    materialItemId: 'elderwood_log',
    pos: { x: 98, z: 430 },
  },

  {
    id: 'herb_mirefen_1',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    materialItemId: 'briarthorn_herb',
    pos: { x: 60, z: 385 },
  },
  {
    id: 'herb_mirefen_2',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    materialItemId: 'goldleaf_herb',
    pos: { x: -45, z: 452 },
  },
  {
    id: 'herb_mirefen_3',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    materialItemId: 'briarthorn_herb',
    pos: { x: 84, z: 318 },
  },
  {
    id: 'herb_mirefen_4',
    zoneId: 'mirefen_marsh',
    type: 'herb',
    materialItemId: 'goldleaf_herb',
    pos: { x: 104, z: 438 },
  },

  // Thornpeak Heights (thornpeak_heights), high-tier coverage near the ridges.
  {
    id: 'ore_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    materialItemId: 'iron_ore',
    pos: { x: -50, z: 590 },
  },
  {
    id: 'ore_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    materialItemId: 'thorium_ore',
    pos: { x: 85, z: 615 },
  },
  {
    id: 'ore_thornpeak_3',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    materialItemId: 'iron_ore',
    pos: { x: -90, z: 700 },
  },
  {
    id: 'ore_thornpeak_4',
    zoneId: 'thornpeak_heights',
    type: 'ore',
    materialItemId: 'thorium_ore',
    pos: { x: 110, z: 760 },
  },

  {
    id: 'wood_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    materialItemId: 'elderwood_log',
    pos: { x: 20, z: 650 },
  },
  {
    id: 'wood_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    materialItemId: 'elderwood_log',
    pos: { x: -120, z: 730 },
  },
  {
    id: 'wood_thornpeak_3',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    materialItemId: 'elderwood_log',
    pos: { x: -70, z: 770 },
  },
  {
    id: 'wood_thornpeak_4',
    zoneId: 'thornpeak_heights',
    type: 'wood',
    materialItemId: 'elderwood_log',
    pos: { x: 50, z: 820 },
  },

  {
    id: 'herb_thornpeak_1',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    materialItemId: 'goldleaf_herb',
    pos: { x: -70, z: 760 },
  },
  {
    id: 'herb_thornpeak_2',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    materialItemId: 'sunpetal_herb',
    pos: { x: 118, z: 736 },
  },
  {
    id: 'herb_thornpeak_3',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    materialItemId: 'sunpetal_herb',
    pos: { x: -40, z: 830 },
  },
  {
    id: 'herb_thornpeak_4',
    zoneId: 'thornpeak_heights',
    type: 'herb',
    materialItemId: 'sunpetal_herb',
    pos: { x: 0, z: 880 },
  },
];
