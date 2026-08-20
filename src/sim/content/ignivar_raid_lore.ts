// Development-only narrative content for the linked Ignivar raid rooms. The NPC is
// dynamic so the ordinary overworld bootstrap never places her; instances/dungeons.ts
// owns the explicit spawn inside the hidden raid. Quests are also non-shareable, so a
// player outside that room cannot receive this development chain from a groupmate.

import type { NpcDef, QuestDef } from '../types';

export const IGNIVAR_MAELIN_NPC_ID = 'archivist_maelin_emberward';

export const IGNIVAR_RECORD_IDS = {
  firstTempering: 'ignivar_record_first_tempering',
  livingMetal: 'ignivar_record_living_metal',
  heraldKey: 'ignivar_record_herald_key',
} as const;

export const IGNIVAR_HERALD_CORE_OBJECT_ID = 'ignivar_herald_core';

export const IGNIVAR_LORE_OBJECTS = {
  [IGNIVAR_RECORD_IDS.firstTempering]: { name: 'First Tempering Record' },
  [IGNIVAR_RECORD_IDS.livingMetal]: { name: 'Living Metal Record' },
  [IGNIVAR_RECORD_IDS.heraldKey]: { name: 'Herald-Key Record' },
  [IGNIVAR_HERALD_CORE_OBJECT_ID]: { name: "Ignivar's Shattered Core" },
} as const;

export const IGNIVAR_LORE_QUEST_IDS = {
  echoesInIron: 'q_ignivar_echoes_in_iron',
  heraldsHeart: 'q_ignivar_heralds_heart',
  forgefather: 'q_ignivar_the_forgefather',
} as const;

export const IGNIVAR_RAID_LORE_NPCS: Record<string, NpcDef> = {
  [IGNIVAR_MAELIN_NPC_ID]: {
    id: IGNIVAR_MAELIN_NPC_ID,
    name: 'Archivist Maelin Emberward',
    title: 'Crucible Archivist',
    // Dynamic NPCs use an authored instance-local spawn; this placeholder is never
    // read by the overworld placement loop.
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0xd9a35f,
    questIds: Object.values(IGNIVAR_LORE_QUEST_IDS),
    greeting:
      'Every hammer mark in this place is a sentence. Help me read what Varkhul tried to hide.',
    dynamic: true,
  },
};

const DEV_RAID_QUEST = {
  giverNpcId: IGNIVAR_MAELIN_NPC_ID,
  turnInNpcId: IGNIVAR_MAELIN_NPC_ID,
  xpReward: 0,
  copperReward: 0,
  itemRewards: {},
  minLevel: 20,
  suggestedPlayers: 10,
  shareable: false,
} as const;

export const IGNIVAR_RAID_LORE_QUESTS: Record<string, QuestDef> = {
  [IGNIVAR_LORE_QUEST_IDS.echoesInIron]: {
    ...DEV_RAID_QUEST,
    id: IGNIVAR_LORE_QUEST_IDS.echoesInIron,
    name: 'Echoes in Iron',
    text: 'These automata are not soldiers. They are drafts. Varkhul tempered shell after shell while the Last Spring failed around him. Read the three records and destroy the constructs guarding them. Each failed body may carry part of the answer.',
    completionText:
      'The records agree. Varkhul bound water from the dying Last Spring into living metal. These automatons were his failed temperings. Only one design endured.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: IGNIVAR_RECORD_IDS.firstTempering,
        count: 1,
        label: 'Read the First Tempering record',
      },
      {
        type: 'interact',
        targetObjectItemId: IGNIVAR_RECORD_IDS.livingMetal,
        count: 1,
        label: 'Read the Living Metal record',
      },
      {
        type: 'interact',
        targetObjectItemId: IGNIVAR_RECORD_IDS.heraldKey,
        count: 1,
        label: 'Read the Herald-Key record',
      },
      {
        type: 'kill',
        targetMobId: 'ignivar_ember_sentinel',
        count: 1,
        label: 'Ember Sentinel defeated',
      },
      {
        type: 'kill',
        targetMobId: 'ignivar_crucible_warden',
        count: 1,
        label: 'Crucible Warden defeated',
      },
      {
        type: 'kill',
        targetMobId: 'ignivar_cinder_artificer',
        count: 1,
        label: 'Cinder Artificer defeated',
      },
    ],
  },
  [IGNIVAR_LORE_QUEST_IDS.heraldsHeart]: {
    ...DEV_RAID_QUEST,
    id: IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
    name: "The Herald's Heart",
    text: 'The survivor named in every record is Ignivar. Varkhul called him herald, seal, and key. Defeat Ignivar, then examine the core that remains. It should tell us what the herald was made to guard.',
    completionText:
      'Ignivar was never merely a guardian. His heart is a key, and its final plates point toward the sealed crucible below.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'ignivar_herald_of_the_last_flame',
        count: 1,
        label: 'Ignivar defeated',
      },
      {
        type: 'interact',
        targetObjectItemId: IGNIVAR_HERALD_CORE_OBJECT_ID,
        count: 1,
        label: "Ignivar's core inspected",
      },
    ],
    requiresQuest: IGNIVAR_LORE_QUEST_IDS.echoesInIron,
  },
  [IGNIVAR_LORE_QUEST_IDS.forgefather]: {
    ...DEV_RAID_QUEST,
    id: IGNIVAR_LORE_QUEST_IDS.forgefather,
    name: 'The Forgefather',
    text: 'The path below leads to Varkhul, Forgefather of the Last Flame. He imprisoned the Last Spring to make metal live, then forged Ignivar to keep the crime sealed. Enter the Inner Crucible and end his work.',
    completionText:
      'The forge is silent at last. The spring may never recover, but Varkhul will shape no more lives into chains.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'varkhul_forgefather_of_the_last_flame',
        count: 1,
        label: 'Varkhul defeated',
      },
    ],
    requiresQuest: IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
  },
};

export const IGNIVAR_RAID_LORE_QUEST_ORDER = Object.values(IGNIVAR_LORE_QUEST_IDS);
