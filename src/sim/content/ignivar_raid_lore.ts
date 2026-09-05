// Development-only narrative content for the linked Ignivar raid rooms. The NPC is
// dynamic so the ordinary overworld bootstrap never places her; instances/dungeons.ts
// owns the explicit spawn inside the hidden raid. Quests are also non-shareable, so a
// player outside that room cannot receive this development chain from a groupmate.

import {
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  VARKHUL_BOSS_ID,
} from '../ignivar_raid_ids';
import type { NpcDef, QuestDef } from '../types';
import { IGNIVAR_BOSS_ID } from '../types';

export const IGNIVAR_MAELIN_NPC_ID = 'archivist_maelin_emberward';
export const IGNIVAR_MAELIN_PROJECTION_NPC_ID = 'archivist_maelin_ember_projection';

export const IGNIVAR_RECORD_IDS = {
  firstTempering: 'ignivar_record_first_tempering',
  livingMetal: 'ignivar_record_living_metal',
  heraldKey: 'ignivar_record_herald_key',
} as const;

export const IGNIVAR_LORE_OBJECTS = {
  [IGNIVAR_RECORD_IDS.firstTempering]: { name: 'First Tempering Record' },
  [IGNIVAR_RECORD_IDS.livingMetal]: { name: 'Living Metal Record' },
  [IGNIVAR_RECORD_IDS.heraldKey]: { name: 'Herald-Key Record' },
} as const;

export const IGNIVAR_LORE_QUEST_IDS = {
  echoesInIron: 'q_ignivar_echoes_in_iron',
  heraldsHeart: 'q_ignivar_heralds_heart',
  forgefather: 'q_ignivar_the_forgefather',
} as const;

export const CRUCIBLE_HAMMER_QUEST_IDS = {
  requiem: 'q_forgefathers_requiem',
  forging: 'q_requiem_at_the_forge',
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
    questIds: [IGNIVAR_LORE_QUEST_IDS.echoesInIron],
    greeting:
      'Every hammer mark in this place is a sentence. Help me read what Varkhul tried to hide.',
    dynamic: true,
  },
  [IGNIVAR_MAELIN_PROJECTION_NPC_ID]: {
    id: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    name: "Maelin's Ember Projection",
    title: 'Ember Projection',
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0xff6a2a,
    questIds: [
      ...Object.values(IGNIVAR_LORE_QUEST_IDS),
      ...Object.values(CRUCIBLE_HAMMER_QUEST_IDS),
    ],
    greeting: "The embers carry Maelin's voice forward through the forge.",
    dynamic: true,
  },
};

const DEV_RAID_QUEST = {
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
    giverNpcId: IGNIVAR_MAELIN_NPC_ID,
    turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    name: 'Echoes in Iron',
    text: 'These automata are not soldiers. They are drafts. Break each assembly line and listen when the final shell falls. The forge remembers what Varkhul tried to erase.',
    completionText:
      'The echoes agree. Varkhul bound water from the dying Last Spring into living metal. These automatons were failed temperings. Only Ignivar endured.',
    rev: 1,
    objectives: [
      {
        type: 'kill',
        targetMobId: IGNIVAR_EMBER_SENTINEL_ID,
        count: 2,
        label: 'Ember Sentinels destroyed',
      },
      {
        type: 'kill',
        targetMobId: IGNIVAR_CRUCIBLE_WARDEN_ID,
        count: 2,
        label: 'Crucible Wardens destroyed',
      },
    ],
  },
  [IGNIVAR_LORE_QUEST_IDS.heraldsHeart]: {
    ...DEV_RAID_QUEST,
    id: IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
    giverNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    name: "The Herald's Heart",
    text: 'The survivor named in every echo is Ignivar. Varkhul called him herald, seal, and key. Defeat him. If the records are true, his death will reveal what he was forged to guard.',
    completionText:
      'Ignivar was never merely a guardian. His heart was the key, and its final plates opened the sealed crucible below.',
    rev: 1,
    objectives: [
      {
        type: 'kill',
        targetMobId: IGNIVAR_BOSS_ID,
        count: 1,
        label: 'Ignivar defeated',
      },
    ],
    requiresQuest: IGNIVAR_LORE_QUEST_IDS.echoesInIron,
  },
  [IGNIVAR_LORE_QUEST_IDS.forgefather]: {
    ...DEV_RAID_QUEST,
    id: IGNIVAR_LORE_QUEST_IDS.forgefather,
    giverNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    name: 'The Forgefather',
    text: 'The path below leads to Varkhul, Forgefather of the Last Flame. He imprisoned the Last Spring to make metal live, then forged Ignivar to keep the crime sealed. Enter the Inner Crucible and end his work.',
    completionText:
      'The forge is silent at last. The spring may never recover, but Varkhul will shape no more lives into chains.',
    objectives: [
      {
        type: 'kill',
        targetMobId: VARKHUL_BOSS_ID,
        count: 1,
        label: 'Varkhul defeated',
      },
    ],
    requiresQuest: IGNIVAR_LORE_QUEST_IDS.heraldsHeart,
  },
  [CRUCIBLE_HAMMER_QUEST_IDS.requiem]: {
    ...DEV_RAID_QUEST,
    id: CRUCIBLE_HAMMER_QUEST_IDS.requiem,
    giverNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    name: "The Forgefather's Requiem",
    text: 'Varkhul kept an ember of the Last Spring at his heart. Recover it from him and bring it to me. With Weaponcrafting skill 125, you can learn to shape Forgebreaker yourself. His defeat on either difficulty will yield the ember while this task is active.',
    completionText:
      'It still sings. Keep the ember: your hammer will need its voice. I have taught you one shaping of Forgebreaker. The ember and the shaping are spent only when your craft succeeds.',
    rev: 1,
    objectives: [
      {
        type: 'collect',
        itemId: 'forgefathers_ember',
        count: 1,
        label: "Forgefather's Ember recovered",
      },
    ],
    requiresQuest: IGNIVAR_LORE_QUEST_IDS.forgefather,
    requiredClass: ['warrior', 'paladin', 'shaman', 'druid'],
    keepsCollectedItems: true,
    recipeReward: 'recipe_varkhul_forgebreaker',
  },
  [CRUCIBLE_HAMMER_QUEST_IDS.forging]: {
    ...DEV_RAID_QUEST,
    id: CRUCIBLE_HAMMER_QUEST_IDS.forging,
    giverNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    turnInNpcId: IGNIVAR_MAELIN_PROJECTION_NPC_ID,
    name: 'Requiem at the Forge',
    text: 'Take the ember, fifteen Cores of the Last Flame, Fine Osmium Ore and Fine Highpine Logs to a forge. Shape Forgebreaker yourself, then return to me with it in your bags or equipped. You keep the hammer, and it binds to you. This shaping can create only one hammer.',
    completionText:
      "The spring's voice carries through the iron. What Varkhul chained, your hands have set free. Carry Forgebreaker well, smith.",
    rev: 1,
    objectives: [
      {
        type: 'collect',
        itemId: 'varkhul_forgebreaker',
        count: 1,
        label: 'Forgebreaker forged and carried',
      },
    ],
    requiresQuest: CRUCIBLE_HAMMER_QUEST_IDS.requiem,
    requiredClass: ['warrior', 'paladin', 'shaman', 'druid'],
    keepsCollectedItems: true,
  },
};

export const IGNIVAR_RAID_LORE_QUEST_ORDER = [
  ...Object.values(IGNIVAR_LORE_QUEST_IDS),
  ...Object.values(CRUCIBLE_HAMMER_QUEST_IDS),
];
