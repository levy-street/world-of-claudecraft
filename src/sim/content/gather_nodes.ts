// Gatherable world nodes: ore veins, wood stands, herb patches. Placed as
// permanent, unowned world fixtures; visibility only (see G3 for harvesting).
// Adding a new node type or placement should touch only this file plus the
// render prop lookup that draws it (src/render/gather_nodes.ts).

import type { GatherNodeDef, GatherNodeType } from '../types';

export const GATHER_NODE_TYPES: readonly GatherNodeType[] = ['ore', 'wood', 'herb'];

export const GATHER_NODES: GatherNodeDef[] = [
  // Eastbrook Vale (eastbrook_vale), ore near Boar Meadow's rocky outcrops
  { id: 'ore_eastbrook_1', zoneId: 'eastbrook_vale', type: 'ore', pos: { x: 72, z: 8 } },
  { id: 'ore_eastbrook_2', zoneId: 'eastbrook_vale', type: 'ore', pos: { x: 78, z: -6 } },
  { id: 'ore_eastbrook_3', zoneId: 'eastbrook_vale', type: 'ore', pos: { x: 66, z: 22 } },

  // Eastbrook Vale, wood stands around Webwood
  { id: 'wood_eastbrook_1', zoneId: 'eastbrook_vale', type: 'wood', pos: { x: -62, z: 8 } },
  { id: 'wood_eastbrook_2', zoneId: 'eastbrook_vale', type: 'wood', pos: { x: -57, z: -6 } },
  { id: 'wood_eastbrook_3', zoneId: 'eastbrook_vale', type: 'wood', pos: { x: -68, z: 18 } },

  // Eastbrook Vale, herb patches near Mirror Lake
  { id: 'herb_eastbrook_1', zoneId: 'eastbrook_vale', type: 'herb', pos: { x: -86, z: 90 } },
  { id: 'herb_eastbrook_2', zoneId: 'eastbrook_vale', type: 'herb', pos: { x: -92, z: 80 } },
  { id: 'herb_eastbrook_3', zoneId: 'eastbrook_vale', type: 'herb', pos: { x: -80, z: 95 } },

  // Mirefen Marsh (mirefen_marsh)
  { id: 'ore_mirefen_1', zoneId: 'mirefen_marsh', type: 'ore', pos: { x: 40, z: 340 } },
  { id: 'ore_mirefen_2', zoneId: 'mirefen_marsh', type: 'ore', pos: { x: -30, z: 360 } },

  { id: 'wood_mirefen_1', zoneId: 'mirefen_marsh', type: 'wood', pos: { x: 10, z: 330 } },
  { id: 'wood_mirefen_2', zoneId: 'mirefen_marsh', type: 'wood', pos: { x: -15, z: 355 } },

  { id: 'herb_mirefen_1', zoneId: 'mirefen_marsh', type: 'herb', pos: { x: 60, z: 385 } },
  { id: 'herb_mirefen_2', zoneId: 'mirefen_marsh', type: 'herb', pos: { x: -45, z: 452 } },
];
