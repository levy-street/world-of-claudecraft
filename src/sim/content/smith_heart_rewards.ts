// The Smith's Heart's rewards (docs/design/raid/smith_heart.md, section 8): the five encounter
// feats and the meta that crowns them (Book of Deeds records in content/deeds.ts, detected by
// encounters/smith_heart/feats.ts, paid by src/sim/smith_heart_feat_rewards.ts), and the
// entrance's essence quest with its chest (opened by src/sim/smith_heart_essence_chest.ts).
// Data only: no engine logic lives here.
//
// Every player-visible name here and on the raid's seven deeds was IP-checked on 2026-11-11
// (exact phrase plus the major game wikis); the verdicts live in docs/design/naming-audit.md.
// The deed names stay out of this file on purpose: it is Guide-reachable, and the deeds are
// hidden while the raid is dev-gated (tests/guide.test.ts spoiler containment).

import type { ItemDef, NpcDef, PlayerClass, QuestDef } from '../types';
import { SMITH_HEART_ANCHORS } from './smith_heart_layout';
import type { SmithsHeartEncounter } from './weapon_skins';

// ---- the feats ------------------------------------------------------------------------------

/** One skill feat per encounter, in encounter order. Each deed is `manual` (granted by
 *  encounters/smith_heart/feats.ts at the boss's fall) and pays that encounter's weapon
 *  appearance (SMITHS_HEART_WEAPON_SKINS). Ids are frozen. */
export const SMITH_HEART_FEAT_DEEDS: Readonly<Record<SmithsHeartEncounter, string>> = {
  hammer_council: 'dgn_heart_council_feat',
  breath: 'dgn_heart_breath_feat',
  quench: 'dgn_heart_quench_feat',
  heat: 'dgn_heart_heat_feat',
  masterless: 'dgn_heart_final_feat',
};

/** The encounters in the order the feats are listed. */
export const SMITH_HEART_FEAT_ORDER: readonly SmithsHeartEncounter[] = [
  'hammer_council',
  'breath',
  'quench',
  'heat',
  'masterless',
];

/** The meta: all five feats, paying the Quarryheart Charger (SMITHS_HEART_META_MOUNT). */
export const SMITH_HEART_META_DEED = 'dgn_heart_meta';

/** The raid's clear deed: the Masterless Strength defeated on any difficulty. */
export const SMITH_HEART_CLEAR_DEED = 'dgn_smith_heart';

/** Every Book of Deeds record the raid owns (the launch guard and the dev command read it). */
export const SMITH_HEART_DEED_IDS: readonly string[] = [
  SMITH_HEART_CLEAR_DEED,
  ...SMITH_HEART_FEAT_ORDER.map((e) => SMITH_HEART_FEAT_DEEDS[e]),
  SMITH_HEART_META_DEED,
];

/** The encounter a feat deed belongs to, or null. */
export function smithHeartFeatEncounter(deedId: string): SmithsHeartEncounter | null {
  for (const e of SMITH_HEART_FEAT_ORDER) if (SMITH_HEART_FEAT_DEEDS[e] === deedId) return e;
  return null;
}

// ---- the entrance's essence quest ----------------------------------------------------------

export const SMITH_HEART_ESSENCE_NPC = 'heart_warden_ada_collier';
export const SMITH_HEART_ESSENCE_QUEST = 'q_heart_what_the_heart_let_go';
/** The fragment the Masterless Strength leaves behind (a personal quest drop, chance 1). */
export const SMITH_HEART_ESSENCE_ITEM = 'remnant_of_the_masterless_strength';
/** The turn-in's reward: one Normal raid piece the opener's class can use. */
export const SMITH_HEART_CHEST_ITEM = 'coffer_of_the_highwatch_vigil';

/** The raid's NORMAL loot table, the chest's pool: every Normal-difficulty item id the five
 *  encounters drop. EMPTY until the raid's Normal items are authored; the chest then opens
 *  with no change to its code (src/sim/smith_heart_essence_chest.ts reads this table, filters
 *  it by what the opener's class can equip and draws one through the sim's Rng). While it is
 *  empty the chest refuses to open and is kept (never consumed). */
export const SMITH_HEART_NORMAL_LOOT_ITEM_IDS: readonly string[] = [];

/** Warden Collier's post: a few strides into the Cleft from the entry, off the walk in. */
export const SMITH_HEART_ESSENCE_NPC_SPOT = {
  x: SMITH_HEART_ANCHORS.entry.x + 5,
  z: SMITH_HEART_ANCHORS.entry.z + 4,
  /** Facing the entry (sim convention: 0 = +z). */
  facing: Math.atan2(-5, -4),
} as const;

export const SMITH_HEART_REWARD_NPCS: Record<string, NpcDef> = {
  [SMITH_HEART_ESSENCE_NPC]: {
    id: SMITH_HEART_ESSENCE_NPC,
    name: 'Warden Ada Collier',
    title: 'Vigil of Highwatch',
    // Dynamic: spawned with each claim at SMITH_HEART_ESSENCE_NPC_SPOT, never on the overworld.
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0x7f8c8d,
    questIds: [SMITH_HEART_ESSENCE_QUEST],
    greeting:
      'Forty generations of the Vigil watched this mountain without knowing why. Now we know, $C. Mind what you wake in there.',
    dynamic: true,
  },
};

const ALL_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

/** The chest for every class (a fixed, non-gear grant at the turn-in). */
const CHEST_FOR_EVERY_CLASS: Partial<Record<PlayerClass, string>> = Object.fromEntries(
  ALL_CLASSES.map((cls) => [cls, SMITH_HEART_CHEST_ITEM]),
);

export const SMITH_HEART_REWARD_QUESTS: Record<string, QuestDef> = {
  [SMITH_HEART_ESSENCE_QUEST]: {
    id: SMITH_HEART_ESSENCE_QUEST,
    name: 'What the Heart Let Go',
    giverNpcId: SMITH_HEART_ESSENCE_NPC,
    turnInNpcId: SMITH_HEART_ESSENCE_NPC,
    text: 'The strength in the Heart has no master and no mind, $N, but it has a shape. When it falls, it will not die: its essence will tear loose and flee back into the stone. Something always stays behind. Bring me what remains of it, and the Vigil will pay you from its own coffers.',
    completionText:
      'Still warm. The four strengths, bound in one splinter, and it does not want to be held. The Vigil keeps its word: take this coffer, and may it hold something worth the climb.',
    objectives: [
      {
        type: 'collect',
        itemId: SMITH_HEART_ESSENCE_ITEM,
        count: 1,
        label: 'Remnant of the Masterless Strength',
      },
    ],
    xpReward: 0,
    copperReward: 5000,
    itemRewards: CHEST_FOR_EVERY_CLASS,
    minLevel: 20,
    suggestedPlayers: 10,
    shareable: false,
    // Once a week, on the raid lockout's own reset (classic raid quests repeat with the
    // lockout: one kill a week, one remnant, one coffer).
    repeatable: true,
    weeklyReset: true,
  },
};

export const SMITH_HEART_REWARD_QUEST_ORDER: readonly string[] = [SMITH_HEART_ESSENCE_QUEST];

export const SMITH_HEART_REWARD_ITEMS: Record<string, ItemDef> = {
  [SMITH_HEART_ESSENCE_ITEM]: {
    id: SMITH_HEART_ESSENCE_ITEM,
    name: 'Remnant of the Masterless Strength',
    kind: 'quest',
    quality: 'epic',
    questId: SMITH_HEART_ESSENCE_QUEST,
    stackSize: 1,
    soulbound: true,
    noVendorSell: true,
    noMarketList: true,
    sellValue: 0,
  },
  [SMITH_HEART_CHEST_ITEM]: {
    id: SMITH_HEART_CHEST_ITEM,
    name: 'Coffer of the Highwatch Vigil',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'container', container: 'smith_heart_coffer' },
    stackSize: 1,
    sellValue: 0,
    soulbound: true,
    noVendorSell: true,
    noMarketList: true,
  },
};
