// Rivalmoot's townsfolk and the Quartered Isle's quest line, "The Moot Rolls".
//
// Keeper Ansel Morrow keeps the town's roll of challengers and means to write the isle's
// history to go with it. His six quests walk a player through what the council left
// behind: Captain Thessaly's challengers, the council's inscriptions in each scarred
// quarter, the servants and wardens that still keep their posts, the maker's mark on the
// Fallen Giant, and last the Remnant of the First Colossus, the council's first, failed
// try at the giant that would hold Korzul (docs/prd/quartered-isle-zone.md, the lore).
//
// The townsfolk are `dynamic` singletons spawned under reserved ids by
// rivalmoot_keepers.ts, so no shipped NPC, camp mob or ground object changes id. Their
// stands come from the painted town layout (painted_towns/rivalmoot.ts). Quest rewards
// follow the level-20 band Galecrest's chain sets: 2600 xp and 1000 copper to find
// someone, 4600 and 2200 to 2400 for a field task, 6200 and 3800 for a named elite.
import { RIVALMOOT_NPC_PLACEMENTS_BY_ID } from '../painted_towns/rivalmoot';
import type { GroundObjectDef, ItemDef, NpcDef, QuestDef } from '../types';

export const RIVALMOOT_KEEPER_NPC_ID = 'keeper_ansel_morrow';
export const RIVALMOOT_INNKEEPER_NPC_ID = 'innkeeper_bettany_quell';
export const RIVALMOOT_OUTFITTER_NPC_ID = 'outfitter_harl_bracken';
export const RIVALMOOT_THESSALY_NPC_ID = 'captain_thessaly_rivalmoot';

/** Reserved singleton entity ids (tests/reserved_singleton_entity_ids.test.ts), one per
 *  townsperson, in the band after Gyrefoot Rest's Pale Keeper. */
export const RIVALMOOT_TOWNSFOLK_ENTITY_IDS: Readonly<Record<string, number>> = Object.freeze({
  [RIVALMOOT_KEEPER_NPC_ID]: 1_000_000_033,
  [RIVALMOOT_INNKEEPER_NPC_ID]: 1_000_000_034,
  [RIVALMOOT_OUTFITTER_NPC_ID]: 1_000_000_035,
  [RIVALMOOT_THESSALY_NPC_ID]: 1_000_000_036,
});

export const QUARTERED_ISLE_QUEST_ORDER: string[] = [
  'q_qi_the_moot_rolls',
  'q_qi_words_in_stone',
  'q_qi_servants_at_their_posts',
  'q_qi_wardens_of_the_arts',
  'q_qi_the_fallen_giant',
  'q_qi_the_first_colossus',
];

const stand = (id: string) => ({
  pos: { ...RIVALMOOT_NPC_PLACEMENTS_BY_ID[id].position },
  facing: RIVALMOOT_NPC_PLACEMENTS_BY_ID[id].facing,
});

export const QUARTERED_ISLE_STORY_NPCS: Record<string, NpcDef> = {
  [RIVALMOOT_KEEPER_NPC_ID]: {
    id: RIVALMOOT_KEEPER_NPC_ID,
    name: 'Keeper Ansel Morrow',
    title: 'Keeper of the Moot Rolls',
    ...stand(RIVALMOOT_KEEPER_NPC_ID),
    color: 0x5a6a8a,
    questIds: [...QUARTERED_ISLE_QUEST_ORDER],
    dynamic: true,
    greeting:
      'Every challenger who climbs this hill wants to beat the council, $N. I want to know why they are worth beating.',
  },
  [RIVALMOOT_INNKEEPER_NPC_ID]: {
    id: RIVALMOOT_INNKEEPER_NPC_ID,
    name: 'Bettany Quell',
    title: 'Innkeeper',
    ...stand(RIVALMOOT_INNKEEPER_NPC_ID),
    color: 0x9a4a3a,
    questIds: [],
    vendorItems: ['trail_hardtack', 'roast_mountain_goat', 'meltwater_flask', 'glacier_melt'],
    dynamic: true,
    innkeeper: true,
    greeting:
      'Mind the boots by the door, the Hoarshelf sleet gets into everything. The fire is lit and the stew is hot, and a challenger who lost today still gets fed.',
  },
  [RIVALMOOT_OUTFITTER_NPC_ID]: {
    id: RIVALMOOT_OUTFITTER_NPC_ID,
    name: 'Harl Bracken',
    title: 'Outfitter',
    ...stand(RIVALMOOT_OUTFITTER_NPC_ID),
    color: 0x6a5a3a,
    questIds: [],
    // potions and the field kit; no gathering tools, which only the three original
    // zone tables' counters may stock (rule R37, tests/professions_zone_rollout.test.ts)
    vendorItems: ['healing_potion', 'mana_potion', 'field_kit'],
    dynamic: true,
    greeting:
      'Salves, tonics and a field kit for the road. The quarters break everything else, so carry your own tools.',
  },
  [RIVALMOOT_THESSALY_NPC_ID]: {
    id: RIVALMOOT_THESSALY_NPC_ID,
    name: 'Captain Thessaly',
    title: "Challengers' Leader",
    ...stand(RIVALMOOT_THESSALY_NPC_ID),
    color: 0x3a5a9a,
    // the Keeper's first quest is handed in to her
    questIds: ['q_qi_the_moot_rolls'],
    dynamic: true,
    greeting:
      'The council has sat on that peak unchallenged for longer than anyone remembers. My challengers mean to change that. Prove yourself on the scars first, $N.',
  },
};

export const QUARTERED_ISLE_STORY_QUESTS: Record<string, QuestDef> = {
  q_qi_the_moot_rolls: {
    id: 'q_qi_the_moot_rolls',
    name: 'The Moot Rolls',
    giverNpcId: RIVALMOOT_KEEPER_NPC_ID,
    turnInNpcId: RIVALMOOT_THESSALY_NPC_ID,
    text: 'Rivalmoot keeps a roll of every challenger who came to test the council, $N, and not one line on why the council is worth testing. I mean to write that history. Start with Captain Thessaly by the hall: her challengers have walked every quarter of this isle, and soldiers remember what scholars miss.',
    completionText:
      'Ansel sent you? Then he is finally asking the right people. My challengers have found carved stones in every quarter, older than this town, and nobody here can read them. Take that back to him.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: RIVALMOOT_THESSALY_NPC_ID,
        count: 1,
        label: 'Speak with Captain Thessaly',
      },
    ],
    xpReward: 2600,
    copperReward: 1000,
    itemRewards: {},
    minLevel: 20,
  },
  q_qi_words_in_stone: {
    id: 'q_qi_words_in_stone',
    name: 'Words in the Stone',
    giverNpcId: RIVALMOOT_KEEPER_NPC_ID,
    turnInNpcId: RIVALMOOT_KEEPER_NPC_ID,
    text: "Thessaly's stones are the council's own inscriptions, $N, I would stake my rolls on it. Three stand where the war scarred the land worst: one on the Hoarshelf, one by the Fireice Rift and one below the Hammer's Cut. Read each one and bring me every word.",
    completionText:
      'Ice, fire and stone, each claiming the isle for its own art, and all three signed by the same hand. The council was never four strangers, $N. It was one council at war with itself.',
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'council_inscription',
        count: 3,
        label: 'Council Inscription read',
      },
    ],
    xpReward: 4600,
    copperReward: 2200,
    itemRewards: {},
    minLevel: 20,
    requiresQuest: 'q_qi_the_moot_rolls',
  },
  q_qi_servants_at_their_posts: {
    id: 'q_qi_servants_at_their_posts',
    name: 'Servants at Their Posts',
    giverNpcId: RIVALMOOT_KEEPER_NPC_ID,
    turnInNpcId: RIVALMOOT_KEEPER_NPC_ID,
    text: "The inscriptions name the council's servants, sworn to hold each quarter until their masters returned. The masters never came back, and the servants never stopped holding. Thin them, $N: six Quench Shardlings on the Hoarshelf, six Heatsworn Embers in the Burnways and six Heaved Shardlings on the Heaved Slabs.",
    completionText:
      'Six of each, and the quarters a little quieter for it. Their cores were cut with the same mark as the inscriptions. Whoever made the servants made the stones too.',
    objectives: [
      { type: 'kill', targetMobId: 'quench_shardling', count: 6, label: 'Quench Shardling slain' },
      { type: 'kill', targetMobId: 'heatsworn_ember', count: 6, label: 'Heatsworn Ember slain' },
      { type: 'kill', targetMobId: 'heaved_shardling', count: 6, label: 'Heaved Shardling slain' },
    ],
    xpReward: 4600,
    copperReward: 2400,
    itemRewards: {},
    minLevel: 20,
    requiresQuest: 'q_qi_words_in_stone',
  },
  q_qi_wardens_of_the_arts: {
    id: 'q_qi_wardens_of_the_arts',
    name: 'Wardens of the Arts',
    giverNpcId: RIVALMOOT_KEEPER_NPC_ID,
    turnInNpcId: RIVALMOOT_KEEPER_NPC_ID,
    text: "Two of the council's wardens still stand, one in the Crevasses of the Hoarshelf and one sunk in the Glassfield of the Cinderscar. The inscriptions call them the keepers of their arts' secrets, and they will not share them willingly, $N. Bring down the Warden of the Quench and the Glassfield Brute.",
    completionText:
      "Both wardens broken, and each carried a seal-stone cut with a giant's outline. The council built something together after all, something larger than any of them. Every mark points to the Heavestone.",
    objectives: [
      {
        type: 'kill',
        targetMobId: 'warden_of_the_quench',
        count: 1,
        label: 'Warden of the Quench slain',
      },
      {
        type: 'kill',
        targetMobId: 'the_glassfield_brute',
        count: 1,
        label: 'The Glassfield Brute slain',
      },
    ],
    xpReward: 6200,
    copperReward: 3800,
    itemRewards: {},
    minLevel: 20,
    requiresQuest: 'q_qi_servants_at_their_posts',
  },
  q_qi_the_fallen_giant: {
    id: 'q_qi_the_fallen_giant',
    name: 'The Fallen Giant',
    giverNpcId: RIVALMOOT_KEEPER_NPC_ID,
    turnInNpcId: RIVALMOOT_KEEPER_NPC_ID,
    text: "A stone head the size of a house lies in the Heavestone Wilds, where the Fallen Giant fell. The challengers call it a statue. I think it is what the seal-stones point to. Find the maker's mark on it, $N, and tell me whose hand cut it.",
    completionText:
      "The four arts' runes, cut side by side into one mark. The council made the giant together, the first time they ever worked as one. It was meant to hold Korzul, and it fell before it was finished. Something of it still stands guard beside its own head.",
    objectives: [
      {
        type: 'interact',
        targetObjectItemId: 'colossus_makers_mark',
        count: 1,
        label: "Colossus Maker's Mark found",
      },
    ],
    xpReward: 4600,
    copperReward: 2200,
    itemRewards: {},
    minLevel: 20,
    requiresQuest: 'q_qi_wardens_of_the_arts',
  },
  q_qi_the_first_colossus: {
    id: 'q_qi_the_first_colossus',
    name: 'The First Colossus',
    giverNpcId: RIVALMOOT_KEEPER_NPC_ID,
    turnInNpcId: RIVALMOOT_KEEPER_NPC_ID,
    text: "The first colossus never held the beast. It fell, and the council built another that did. But what is left of the first still keeps its post at the Fallen Giant, half-carved and long forgotten, striking down anyone who comes near. Lay it to rest, $N. This isle's history should not end with a guard who never learned the war was over.",
    completionText:
      'Then the Remnant rests, and the rolls have their first true chapter: four rivals who could agree on nothing, until the day they had to build a giant together. Rivalmoot owes you a line in its history, $N, and I will write it myself.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'remnant_first_colossus',
        count: 1,
        label: 'Remnant of the First Colossus slain',
      },
    ],
    xpReward: 6200,
    copperReward: 3800,
    itemRewards: {},
    minLevel: 20,
    requiresQuest: 'q_qi_the_fallen_giant',
  },
};

export const QUARTERED_ISLE_STORY_ITEMS: Record<string, ItemDef> = {
  council_inscription: {
    id: 'council_inscription',
    name: 'Council Inscription',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_qi_words_in_stone',
    noVendorSell: true,
  },
  colossus_makers_mark: {
    id: 'colossus_makers_mark',
    name: "Colossus Maker's Mark",
    kind: 'quest',
    sellValue: 0,
    questId: 'q_qi_the_fallen_giant',
    noVendorSell: true,
  },
};

export const QUARTERED_ISLE_OBJECTS: GroundObjectDef[] = [
  {
    itemId: 'council_inscription',
    name: 'Council Inscription',
    // one in each scarred ground quarter, on dry plate ground off the roads: the
    // Hoarshelf by the Rimeglass, the Cinderscar by the Fireice Rift, the Heavestone
    // below the Hammer's Cut
    positions: [
      { x: -64, z: 2056 },
      { x: 170, z: 2126 },
      { x: -140, z: 2206 },
    ],
  },
  {
    itemId: 'colossus_makers_mark',
    name: "Colossus Maker's Mark",
    // on the Fallen Giant's flank, beside the statue head
    positions: [{ x: -112, z: 2310 }],
  },
];
