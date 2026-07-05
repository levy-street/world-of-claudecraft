// Logol, the mysterious stranger cloaked in infinity: a roaming merchant who
// appears at unpredictable points of interest for short windows and sells
// prestige COSMETICS priced solely in $WOC (docs/prd/woc/logol-merchant.md).
//
// This module is data-as-code only (no engine logic): the two NPC defs, the
// three-step "Seen and Unseen" quest chain that unlocks his shop, the prestige
// wares catalog, the roaming points-of-interest, and a couple of pure helpers.
// The deterministic roaming behavior lives in src/sim/logol_roam.ts; the
// purchase/grant flow lives server-side (server/logol.ts). Everything Logol
// sells is cosmetic-only: no ware grants or scales a stat (the repo's
// non-negotiable no-pay-to-win invariant, root CLAUDE.md).
import type { LogolWare, NpcDef, QuestDef } from '../types';

export const LOGOL_NPC_ID = 'logol';
export const LOGOL_HARBINGER_NPC_ID = 'logol_harbinger';

export const LOGOL_RUMOR_QUEST_ID = 'q_logol_rumor';
export const LOGOL_SIGN_QUEST_ID = 'q_logol_sign';
// Completing this final quest is the shop-unlock signal (the server persists it
// to accounts.cosmetics.completedQuestIds on turn-in; no separate unlock table).
export const LOGOL_UNLOCK_QUEST_ID = 'q_logol_seen';

// The nameless order Logol belongs to. Rendered verbatim as his title/guild
// string: a glyph-string, not a word, and not translated (a symbol string, like
// a brand, stays identical across locales).
export const LOGOL_GUILD_TAG = '{{,,,}}';

export const LOGOL_NPCS: Record<string, NpcDef> = {
  // The roaming merchant himself. dynamic: true, so the Sim ctor's surface-
  // placement loop skips him; logol_roam.ts spawns exactly one at a clock-chosen
  // POI when the feature is enabled. No questIds (the chain lives on the
  // Harbinger); interacting with him opens the $WOC wares shop, gated server-side
  // on whether the account finished the chain.
  [LOGOL_NPC_ID]: {
    id: LOGOL_NPC_ID,
    name: 'Logol',
    title: LOGOL_GUILD_TAG,
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0x2a2340,
    questIds: [],
    dynamic: true,
    greeting: 'You see me, then. Few do. I carry what gold cannot buy, stranger, only $WOC.',
  },
  // The lore NPC who gives the unlock chain, standing at a fixed starting-zone
  // hub spot so the chain is always startable without catching roaming Logol.
  // dynamic: true so the Sim ctor never surface-places it: the gated Logol
  // system (logol_roam.ts) spawns it, persistently, ONLY when logolEnabled, so a
  // feature-off world (offline, headless, every parity trace) is byte-identical
  // to before. Its fixed home is HARBINGER_POS in logol_roam.ts.
  [LOGOL_HARBINGER_NPC_ID]: {
    id: LOGOL_HARBINGER_NPC_ID,
    name: 'Harbinger of the Nameless Order',
    title: LOGOL_GUILD_TAG,
    pos: { x: 18, z: 8 },
    facing: Math.PI,
    color: 0x6b4a8a,
    questIds: [LOGOL_RUMOR_QUEST_ID, LOGOL_SIGN_QUEST_ID, LOGOL_UNLOCK_QUEST_ID],
    dynamic: true,
    greeting:
      'A cloaked one walks the realm, seen only by eyes that have learned to look. Would you learn?',
  },
};

// The three-step "Seen and Unseen" chain. Draft placeholders: every objective is
// an interact with the Harbinger so the chain is self-contained and always
// completable; real objective targets, text, and rewards are a content pass
// (see the PRD TODOs). Turning in q_logol_seen marks the account and opens the
// shop.
export const LOGOL_QUESTS: Record<string, QuestDef> = {
  [LOGOL_RUMOR_QUEST_ID]: {
    id: LOGOL_RUMOR_QUEST_ID,
    name: 'A Rumor of Logol',
    giverNpcId: LOGOL_HARBINGER_NPC_ID,
    turnInNpcId: LOGOL_HARBINGER_NPC_ID,
    text: 'They say a merchant walks between the moments. Sit with me, and I will tell you how to see him.',
    completionText: 'Good. The rumor is in you now. It will not leave.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: LOGOL_HARBINGER_NPC_ID,
        count: 1,
        label: 'Hear the Harbinger out',
      },
    ],
    xpReward: 100,
    copperReward: 50,
    itemRewards: {},
  },
  [LOGOL_SIGN_QUEST_ID]: {
    id: LOGOL_SIGN_QUEST_ID,
    name: 'The Sign in the Eye',
    giverNpcId: LOGOL_HARBINGER_NPC_ID,
    turnInNpcId: LOGOL_HARBINGER_NPC_ID,
    text: 'To see the unseen you must attune your eye. Walk a while, then return, and I will mark you.',
    completionText: 'The mark is set. Your eye is ready.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: LOGOL_HARBINGER_NPC_ID,
        count: 1,
        label: 'Return to the Harbinger to be marked',
      },
    ],
    xpReward: 150,
    copperReward: 75,
    itemRewards: {},
    requiresQuest: LOGOL_RUMOR_QUEST_ID,
  },
  [LOGOL_UNLOCK_QUEST_ID]: {
    id: LOGOL_UNLOCK_QUEST_ID,
    name: 'Seen and Unseen',
    giverNpcId: LOGOL_HARBINGER_NPC_ID,
    turnInNpcId: LOGOL_HARBINGER_NPC_ID,
    text: 'It is done. When next you cross paths with the cloaked one, he will trade with you. Go, and watch the edges of the world.',
    completionText: 'Now you see him. His ledger is open to you. Spend wisely.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: LOGOL_HARBINGER_NPC_ID,
        count: 1,
        label: 'Accept the Nameless Order sight',
      },
    ],
    xpReward: 250,
    copperReward: 100,
    itemRewards: {},
    requiresQuest: LOGOL_SIGN_QUEST_ID,
  },
};

export const LOGOL_QUEST_ORDER: string[] = [
  LOGOL_RUMOR_QUEST_ID,
  LOGOL_SIGN_QUEST_ID,
  LOGOL_UNLOCK_QUEST_ID,
];

// The prestige wares catalog. COSMETIC-ONLY, account-bound. This draft ships
// `title` and `flair` (no new render system needed); `transmog` and `mount` are
// valid kinds (see LogolWareKind) but intentionally carry no entries yet,
// blocked on render work (PRD "Out of scope"). Prices are placeholders pending a
// tokenomics pass; the server prices the whole catalog off one WOC_PRICE_LOGOL
// key for now (per-ware pricing is a follow-up).
export const LOGOL_WARES: LogolWare[] = [
  {
    id: 'logol_title_unseen',
    kind: 'title',
    name: 'the Unseen',
    description:
      'A prestige title for those who have looked upon Logol and been looked upon in turn.',
    priceWoc: 25000,
    rarity: 'rare',
  },
  {
    id: 'logol_title_ledger_marked',
    kind: 'title',
    name: 'Ledger-Marked',
    description: 'A prestige title carried by patrons of the nameless order.',
    priceWoc: 25000,
    rarity: 'epic',
  },
  {
    id: 'logol_flair_cloaked_in_infinity',
    kind: 'flair',
    name: 'Cloaked in Infinity',
    description:
      "Logol's signature nameplate adornment: an endless, drifting cloak-mark. Cosmetic only.",
    priceWoc: 50000,
    rarity: 'legendary',
  },
];

const LOGOL_WARE_BY_ID: Record<string, LogolWare> = Object.fromEntries(
  LOGOL_WARES.map((w) => [w.id, w]),
);

/** Resolve a ware by id, or undefined if it is not in the catalog. */
export function logolWare(id: string): LogolWare | undefined {
  return LOGOL_WARE_BY_ID[id];
}

/**
 * Whether a player whose completed account-quests are `completedQuestIds` has
 * unlocked Logol's shop (they finished the "Seen and Unseen" chain). Pure, so
 * both the server (purchase gate) and any client lock badge can share it.
 */
export function logolShopUnlocked(completedQuestIds: readonly string[]): boolean {
  return completedQuestIds.includes(LOGOL_UNLOCK_QUEST_ID);
}

// Candidate roaming points of interest (overworld x/z). logol_roam.ts snaps each
// to terrain height via ctx.groundPos and picks one per appearance window with a
// stateless hash (never the shared rng stream). Placeholder coordinates: a
// play-feel pass should replace these with hand-picked scenic/hub-adjacent spots
// (PRD "Roaming tuning").
export const LOGOL_POIS: { x: number; z: number; label: string }[] = [
  { x: 0, z: 0, label: 'the crossroads' },
  { x: 62, z: 40, label: 'the eastern rise' },
  { x: -54, z: 78, label: 'the marsh edge' },
  { x: 44, z: -34, label: 'the old road' },
  { x: -72, z: -58, label: 'the far cairn' },
];
