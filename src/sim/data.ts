// Content merge layer. Actual game content lives in sim/content/* — one
// module per zone plus classes (abilities), shared items, and dungeons —
// so content can grow without everything colliding in one file. This module
// merges those records into the flat tables the rest of the engine consumes,
// and owns the world-layout constants.

import type {
  CampDef, DungeonDef, GroundObjectDef, ItemDef, MobTemplate, NpcDef,
  PlayerClass, QuestDef, QuestState, ZoneDef, ZonePropsDef,
} from './types';
import { BASE_ITEMS, FISHING_TABLES, FISHING_RARE_ID } from './content/items';
export { FISHING_TABLES, FISHING_RARE_ID };
export type { FishingEntry } from './content/items';
import {
  GRAVEYARD_POS, LAKE, TOWN_RADIUS, ZONE1_CAMPS, ZONE1_CHAPEL_CAMPS, ZONE1_MOBS, ZONE1_NPCS, ZONE1_OBJECTS,
  ZONE1_PROPS, ZONE1_QUESTS, ZONE1_QUEST_ORDER, ZONE1_ROADS, ZONE1_ZONE,
} from './content/zone1';
import {
  DEEPFEN_SHALLOWS_LAKE, ZONE2_CAMPS, ZONE2_ITEMS, ZONE2_MOBS, ZONE2_NPCS, ZONE2_OBJECTS, ZONE2_PROPS,
  ZONE2_QUESTS, ZONE2_QUEST_ORDER, ZONE2_ROADS, ZONE2_ZONE,
} from './content/zone2';
import {
  ZONE3_CAMPS, ZONE3_ITEMS, ZONE3_MOBS, ZONE3_NPCS, ZONE3_OBJECTS, ZONE3_PROPS,
  ZONE3_QUESTS, ZONE3_QUEST_ORDER, ZONE3_ROADS, ZONE3_ZONE,
} from './content/zone3';
import { DUNGEON_DEFS, DUNGEON_MOBS } from './content/dungeons';
import { WARLOCK_PET_MOBS } from './content/warlock_pets';
import { GROUND_PICKUP_LINES } from './content/ground_pickup_lines';
import {
  TEMPLE_CAMPS, TEMPLE_DUNGEON_DEFS, TEMPLE_DUNGEON_MOBS, TEMPLE_ITEMS, TEMPLE_MOBS,
  TEMPLE_NPCS, TEMPLE_OBJECTS, TEMPLE_PROPS, TEMPLE_QUEST_ORDER, TEMPLE_QUESTS,
} from './content/temple';

function mergeItems(...parts: Record<string, ItemDef>[]): Record<string, ItemDef> {
  const merged = Object.assign({}, ...parts);
  for (const [id, lines] of Object.entries(GROUND_PICKUP_LINES)) {
    if (merged[id]) {
      merged[id] = { ...merged[id], pickupDeny: lines.deny, pickupEnough: lines.enough };
    }
  }
  return merged;
}

export { CLASSES, ABILITIES, abilitiesKnownAt } from './content/classes';
export type { ClassDef } from './content/classes';
// Re-export content shapes so existing `from './data'` imports keep working.
export type {
  BiomeId, CampDef, DungeonDef, DungeonSpawn, GroundObjectDef, NpcDef, ZoneDef, ZonePropsDef,
} from './types';

// ---------------------------------------------------------------------------
// Merged content tables
// ---------------------------------------------------------------------------

export const ITEMS: Record<string, ItemDef> = mergeItems(BASE_ITEMS, ZONE2_ITEMS, ZONE3_ITEMS, TEMPLE_ITEMS);

export const MOBS: Record<string, MobTemplate> = {
  ...ZONE1_MOBS, ...ZONE2_MOBS, ...ZONE3_MOBS, ...DUNGEON_MOBS,
  ...WARLOCK_PET_MOBS, ...TEMPLE_MOBS, ...TEMPLE_DUNGEON_MOBS,
};

export const NPCS: Record<string, NpcDef> = {
  ...ZONE1_NPCS, ...ZONE2_NPCS, ...ZONE3_NPCS, ...TEMPLE_NPCS,
};

export const QUESTS: Record<string, QuestDef> = {
  ...ZONE1_QUESTS, ...ZONE2_QUESTS, ...ZONE3_QUESTS, ...TEMPLE_QUESTS,
};

export const QUEST_ORDER: string[] = [
  ...ZONE1_QUEST_ORDER, ...ZONE2_QUEST_ORDER, ...ZONE3_QUEST_ORDER, ...TEMPLE_QUEST_ORDER,
];

// Camps spawn in array order, each drawing world-gen RNG, so an entry inserted
// before others shifts their spawn positions. New rare-elite camps
// (ZONE1_CHAPEL_CAMPS) and the Eastbrook rare Grix are appended LAST so every
// existing zone camp keeps its exact draw order (determinism).
export const CAMPS: CampDef[] = [
  ...ZONE1_CAMPS, ...ZONE2_CAMPS, ...ZONE3_CAMPS, ...TEMPLE_CAMPS, ...ZONE1_CHAPEL_CAMPS,
  { mobId: 'grix_the_tunnelking', center: { x: -95, z: -78 }, radius: 4, count: 1 },
];

export const GROUND_OBJECTS: GroundObjectDef[] = [...ZONE1_OBJECTS, ...ZONE2_OBJECTS, ...ZONE3_OBJECTS, ...TEMPLE_OBJECTS];

export const ROADS: { x: number; z: number }[][] = [...ZONE1_ROADS, ...ZONE2_ROADS, ...ZONE3_ROADS];

export const PROPS: ZonePropsDef = mergeProps([ZONE1_PROPS, ZONE2_PROPS, ZONE3_PROPS, TEMPLE_PROPS]);

function mergeProps(sets: ZonePropsDef[]): ZonePropsDef {
  return {
    buildings: sets.flatMap((s) => s.buildings),
    wells: sets.flatMap((s) => s.wells),
    stalls: sets.flatMap((s) => s.stalls),
    mines: sets.flatMap((s) => s.mines),
    docks: sets.flatMap((s) => s.docks),
    tents: sets.flatMap((s) => s.tents),
    crates: sets.flatMap((s) => s.crates),
    campfires: sets.flatMap((s) => s.campfires),
    mudHuts: sets.flatMap((s) => s.mudHuts),
    ruinRings: sets.flatMap((s) => s.ruinRings),
    fences: sets.flatMap((s) => s.fences),
    graveyards: sets.flatMap((s) => s.graveyards),
  };
}

// Quest reward fallback by archetype: classes without an explicit entry use these.
export const REWARD_ARCHETYPE: Record<PlayerClass, PlayerClass> = {
  warrior: 'warrior', paladin: 'warrior', shaman: 'warrior',
  rogue: 'rogue', hunter: 'rogue',
  mage: 'mage', priest: 'mage', warlock: 'mage', druid: 'mage',
};

// Resolve the item a quest awards a given class: a class-specific reward if the
// quest lists one, else the reward for the class's archetype (rewards are
// authored per archetype — warrior/rogue/mage). The dialog preview and the
// turn-in grant MUST both call this so what the player is shown matches what
// they receive. Returns undefined when the quest has no item reward.
export function questRewardItem(quest: QuestDef, cls: PlayerClass): string | undefined {
  return quest.itemRewards[cls] ?? quest.itemRewards[REWARD_ARCHETYPE[cls]];
}

export const questRewardItemId = questRewardItem;


// Vanilla group XP multipliers by party size (1-5).
export const GROUP_XP_BONUS = [1, 1, 1.166, 1.3, 1.43];

// ---------------------------------------------------------------------------
// Zones. The world is a north-running strip of zone bands: x in
// [-WORLD_SIZE/2, WORLD_SIZE/2], z from WORLD_MIN_Z through the last zone's
// zMax. Each zone owns a hub settlement (terrain flattens there), a
// graveyard, its lakes, and a biome palette the renderer keys off.
// ---------------------------------------------------------------------------

export const ZONES: ZoneDef[] = [ZONE1_ZONE, ZONE2_ZONE, ZONE3_ZONE];

export const WORLD_SIZE = 360; // world width: x spans [-180, 180]
export const WORLD_MIN_X = -WORLD_SIZE / 2;
export const WORLD_MAX_X = WORLD_SIZE / 2;
export const WORLD_MIN_Z = ZONES[0].zMin;
export const WORLD_MAX_Z = ZONES[ZONES.length - 1].zMax;

export const PLAYER_START = { x: 2, z: -2 };

// Zone containing a world position (overworld only; clamps to the strip ends).
export function zoneAt(z: number): ZoneDef {
  for (const zone of ZONES) {
    if (z < zone.zMax) return zone;
  }
  return ZONES[ZONES.length - 1];
}

export function zoneWelcomeText(zone: ZoneDef, questState: (questId: string) => QuestState): string | null {
  if (zone.welcomeQuestId && questState(zone.welcomeQuestId) !== 'available') return null;
  return zone.welcome;
}

// Legacy single-zone exports (zone 1) — still referenced by tests and the
// starter-town logic.
export { GRAVEYARD_POS, LAKE, TOWN_RADIUS };
export { DEEPFEN_SHALLOWS_LAKE };
export const ZONE_NAME = ZONE1_ZONE.name;

// ---------------------------------------------------------------------------
// Dungeons — private party instances at far-off flat origins (see
// world.groundHeight). Each dungeon gets its own x-band of instance origins;
// slots stack along z.
// ---------------------------------------------------------------------------

export const INSTANCE_SLOT_COUNT = 6;
export const DUNGEON_X_THRESHOLD = 600; // x beyond this = inside an instance
export const DUNGEON_FLOOR_Y = 0;

export function instanceOrigin(dungeonIndex: number, slot: number): { x: number; z: number } {
  return { x: 900 + dungeonIndex * 600, z: -1250 + slot * 500 };
}

export const DUNGEONS: Record<string, DungeonDef> = { ...DUNGEON_DEFS, ...TEMPLE_DUNGEON_DEFS };

export const DUNGEON_LIST: DungeonDef[] = Object.values(DUNGEONS).sort((a, b) => a.index - b.index);

export function dungeonByIndex(index: number): DungeonDef | null {
  return DUNGEON_LIST.find((d) => d.index === index) ?? null;
}

// Which dungeon a far-off instance position belongs to, by x-band.
export function dungeonAt(x: number): DungeonDef | null {
  if (x <= DUNGEON_X_THRESHOLD || x >= ARENA_X_MIN) return null;
  return dungeonByIndex(Math.round((x - 900) / 600));
}

// ---------------------------------------------------------------------------
// The Ashen Coliseum — 1v1 ranked arena. Its match instances live in their own
// far-off flat-ground x-band, well past the dungeon bands (index 0/1/2 sit at
// x 900/1500/2100). Like dungeons, x beyond DUNGEON_X_THRESHOLD means flat
// ground (world.groundHeight) and instance-local collision (sim/colliders.ts);
// the band split below keeps arena positions from being read as a dungeon.
// ---------------------------------------------------------------------------

export const ARENA_X = 4200; // arena instances share this x; slots stack along z
export const ARENA_X_MIN = ARENA_X; // x at/after this = an arena instance, not a dungeon
export const ARENA_SLOT_COUNT = 4; // concurrent 1v1 matches the world can host
const ARENA_Z0 = -1250;
const ARENA_SLOT_SPACING = 120; // > the pit footprint (~44yd) so slots never overlap

export function arenaOrigin(slot: number): { x: number; z: number } {
  return { x: ARENA_X, z: ARENA_Z0 + slot * ARENA_SLOT_SPACING };
}

export function isArenaPos(x: number): boolean {
  return x >= ARENA_X_MIN;
}

// Nearest arena instance origin to a far-off position, matched by z-band (the
// x is shared across slots). Mirrors how the dungeon collider resolver maps a
// position back to its instance slot.
export function arenaOriginAt(z: number): { x: number; z: number; slot: number } {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < ARENA_SLOT_COUNT; i++) {
    const d = Math.abs(z - arenaOrigin(i).z);
    if (d < bestD) { bestD = d; best = i; }
  }
  const o = arenaOrigin(best);
  return { x: o.x, z: o.z, slot: best };
}

// Legacy aliases for the Hollow Crypt (tests + scripts reference these).
export const CRYPT_DOOR_POS = DUNGEONS.hollow_crypt.doorPos;
export const CRYPT_ENTRY = DUNGEONS.hollow_crypt.entry;
export const CRYPT_EXIT_OFFSET = DUNGEONS.hollow_crypt.exitOffset;
export const CRYPT_SPAWNS = DUNGEONS.hollow_crypt.spawns;
