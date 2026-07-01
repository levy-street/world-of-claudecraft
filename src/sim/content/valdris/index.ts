// The Valdris continent (v0.19): one module per zone (or contested ring
// group), merged here into single VALDRIS_* tables that sim/data.ts appends
// after the original three Landing zones. Strip order is load-bearing:
// ZONES must ascend by zMin, and CAMPS must keep a stable order because camp
// spawns draw world-gen RNG in array order (see data.ts).

import type {
  CampDef,
  GroundObjectDef,
  ItemDef,
  MobTemplate,
  NpcDef,
  QuestDef,
  ZoneDef,
  ZonePropsDef,
} from '../../types';
import { emptyZoneProps } from '../../types';
import {
  BREACH_CAMPS,
  BREACH_ITEMS,
  BREACH_MOBS,
  BREACH_NPCS,
  BREACH_OBJECTS,
  BREACH_PROPS,
  BREACH_QUEST_ORDER,
  BREACH_QUESTS,
  BREACH_ROADS,
  BREACH_ZONE,
} from './breach';
import {
  CONTESTED_NORTH_CAMPS,
  CONTESTED_NORTH_ITEMS,
  CONTESTED_NORTH_MOBS,
  CONTESTED_NORTH_NPCS,
  CONTESTED_NORTH_OBJECTS,
  CONTESTED_NORTH_PROPS,
  CONTESTED_NORTH_QUEST_ORDER,
  CONTESTED_NORTH_QUESTS,
  CONTESTED_NORTH_ROADS,
  CONTESTED_NORTH_ZONES,
} from './contested_north';
import {
  CONTESTED_SOUTH_CAMPS,
  CONTESTED_SOUTH_ITEMS,
  CONTESTED_SOUTH_MOBS,
  CONTESTED_SOUTH_NPCS,
  CONTESTED_SOUTH_OBJECTS,
  CONTESTED_SOUTH_PROPS,
  CONTESTED_SOUTH_QUEST_ORDER,
  CONTESTED_SOUTH_QUESTS,
  CONTESTED_SOUTH_ROADS,
  CONTESTED_SOUTH_ZONES,
} from './contested_south';
import {
  KAEL_CAMPS,
  KAEL_ITEMS,
  KAEL_MOBS,
  KAEL_NPCS,
  KAEL_OBJECTS,
  KAEL_PROPS,
  KAEL_QUEST_ORDER,
  KAEL_QUESTS,
  KAEL_ROADS,
  KAEL_ZONE,
} from './kael';
import {
  OSSARA_CAMPS,
  OSSARA_ITEMS,
  OSSARA_MOBS,
  OSSARA_NPCS,
  OSSARA_OBJECTS,
  OSSARA_PROPS,
  OSSARA_QUEST_ORDER,
  OSSARA_QUESTS,
  OSSARA_ROADS,
  OSSARA_ZONE,
} from './ossara';
import {
  VETH_CAMPS,
  VETH_ITEMS,
  VETH_MOBS,
  VETH_NPCS,
  VETH_OBJECTS,
  VETH_PROPS,
  VETH_QUEST_ORDER,
  VETH_QUESTS,
  VETH_ROADS,
  VETH_ZONE,
} from './veth';

// South to north: the three faction realms, the southern contested ring, the
// eternal war zone, the northern contested ring (docs/design/valdris-continent.md).
export const VALDRIS_ZONES: ZoneDef[] = [
  OSSARA_ZONE,
  VETH_ZONE,
  KAEL_ZONE,
  ...CONTESTED_SOUTH_ZONES,
  BREACH_ZONE,
  ...CONTESTED_NORTH_ZONES,
];

export const VALDRIS_MOBS: Record<string, MobTemplate> = {
  ...OSSARA_MOBS,
  ...VETH_MOBS,
  ...KAEL_MOBS,
  ...CONTESTED_SOUTH_MOBS,
  ...BREACH_MOBS,
  ...CONTESTED_NORTH_MOBS,
};

export const VALDRIS_NPCS: Record<string, NpcDef> = {
  ...OSSARA_NPCS,
  ...VETH_NPCS,
  ...KAEL_NPCS,
  ...CONTESTED_SOUTH_NPCS,
  ...BREACH_NPCS,
  ...CONTESTED_NORTH_NPCS,
};

export const VALDRIS_QUESTS: Record<string, QuestDef> = {
  ...OSSARA_QUESTS,
  ...VETH_QUESTS,
  ...KAEL_QUESTS,
  ...CONTESTED_SOUTH_QUESTS,
  ...BREACH_QUESTS,
  ...CONTESTED_NORTH_QUESTS,
};

export const VALDRIS_QUEST_ORDER: string[] = [
  ...OSSARA_QUEST_ORDER,
  ...VETH_QUEST_ORDER,
  ...KAEL_QUEST_ORDER,
  ...CONTESTED_SOUTH_QUEST_ORDER,
  ...BREACH_QUEST_ORDER,
  ...CONTESTED_NORTH_QUEST_ORDER,
];

// Appended AFTER every pre-Valdris camp in data.ts; order within this list is
// stable south-to-north so world-gen RNG draws stay deterministic.
export const VALDRIS_CAMPS: CampDef[] = [
  ...OSSARA_CAMPS,
  ...VETH_CAMPS,
  ...KAEL_CAMPS,
  ...CONTESTED_SOUTH_CAMPS,
  ...BREACH_CAMPS,
  ...CONTESTED_NORTH_CAMPS,
];

export const VALDRIS_OBJECTS: GroundObjectDef[] = [
  ...OSSARA_OBJECTS,
  ...VETH_OBJECTS,
  ...KAEL_OBJECTS,
  ...CONTESTED_SOUTH_OBJECTS,
  ...BREACH_OBJECTS,
  ...CONTESTED_NORTH_OBJECTS,
];

export const VALDRIS_ITEMS: Record<string, ItemDef> = {
  ...OSSARA_ITEMS,
  ...VETH_ITEMS,
  ...KAEL_ITEMS,
  ...CONTESTED_SOUTH_ITEMS,
  ...BREACH_ITEMS,
  ...CONTESTED_NORTH_ITEMS,
};

export const VALDRIS_ROADS: { x: number; z: number }[][] = [
  ...OSSARA_ROADS,
  ...VETH_ROADS,
  ...KAEL_ROADS,
  ...CONTESTED_SOUTH_ROADS,
  ...BREACH_ROADS,
  ...CONTESTED_NORTH_ROADS,
];

export const VALDRIS_PROPS: ZonePropsDef = mergeValdrisProps([
  OSSARA_PROPS,
  VETH_PROPS,
  KAEL_PROPS,
  CONTESTED_SOUTH_PROPS,
  BREACH_PROPS,
  CONTESTED_NORTH_PROPS,
]);

function mergeValdrisProps(sets: ZonePropsDef[]): ZonePropsDef {
  const out = emptyZoneProps();
  out.delveMarkers = [];
  for (const s of sets) {
    out.buildings.push(...s.buildings);
    out.wells.push(...s.wells);
    out.stalls.push(...s.stalls);
    out.mines.push(...s.mines);
    out.docks.push(...s.docks);
    out.tents.push(...s.tents);
    out.crates.push(...s.crates);
    out.campfires.push(...s.campfires);
    out.mudHuts.push(...s.mudHuts);
    out.ruinRings.push(...s.ruinRings);
    out.fences.push(...s.fences);
    out.graveyards.push(...s.graveyards);
    out.delveMarkers.push(...(s.delveMarkers ?? []));
  }
  return out;
}
