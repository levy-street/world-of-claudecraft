import type { ForgeStationId, NpcDef, WorldQuestDef } from '../types';

// Preserve the original identity so relocation cannot repay completed quests.
export const FORGE_QUEST_ID = 'wq_evergarden_forging';
export const FORGE_NPC_ID = 2_146_800_010;
export const FORGE_INTERACT_RANGE = 22;

export const FORGE_NPC_DEF: NpcDef = {
  id: 'forge_instructor',
  name: 'Smith Mara',
  title: 'Wyrmwatch Smith',
  pos: { x: 428, z: 1889 },
  facing: -1.5,
  color: 0xb57d46,
  questIds: [],
  dynamic: true,
  greeting:
    'Help me finish a shield! Click the supplies I call for. Quick hands earn a better medal.',
};

/** Supplies surround the Wyrmwatch smithy; tools target its built-in anvil. */
export const FORGE_STATIONS: readonly {
  id: ForgeStationId;
  entityId: number;
  objectItemId: string;
  name: string;
  x: number;
  z: number;
}[] = [
  {
    id: 'fuel',
    entityId: 2_146_800_020,
    objectItemId: 'forge_fuel',
    name: 'Firewood',
    x: 431,
    z: 1883,
  },
  {
    id: 'metal',
    entityId: 2_146_800_021,
    objectItemId: 'forge_metal',
    name: 'Ingot Crate',
    x: 431,
    z: 1899,
  },
  {
    id: 'water',
    entityId: 2_146_800_022,
    objectItemId: 'forge_water',
    name: 'Water Well',
    x: 419,
    z: 1891,
  },
  {
    id: 'tools',
    entityId: 2_146_800_023,
    objectItemId: 'forge_tools',
    name: 'Anvil',
    x: 431.86,
    z: 1891.08,
  },
];

export const WORLD_QUEST_FORGING: WorldQuestDef = {
  id: FORGE_QUEST_ID,
  zoneId: 'drakelands',
  minLevel: 16,
  area: { x: 429, z: 1891, radius: 24 },
  objective: { type: 'forging', instructorNpcId: FORGE_NPC_DEF.id },
  count: 1,
  reward: { type: 'xp', rate: 0.12 },
};
