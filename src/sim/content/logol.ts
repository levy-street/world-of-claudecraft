// Logol, the mysterious stranger cloaked in infinity: a merchant who returns to
// the same fixed spot once a week and sells prestige COSMETICS priced solely in
// $WOC (docs/prd/woc/logol-merchant.md).
//
// This module is data-as-code only (no engine logic): the two NPC defs, the
// three-step "Seen and Unseen" quest chain that unlocks his shop, the prestige
// wares catalog with its weekly rotation, the fixed appearance spot, and a
// couple of pure helpers. The weekly appearance scheduling lives in
// src/sim/logol_roam.ts; the purchase/grant flow lives server-side
// (server/logol.ts). Everything Logol sells is cosmetic-only: no ware grants or
// scales a stat (the repo's non-negotiable no-pay-to-win invariant, root
// CLAUDE.md).
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
  // The weekly merchant himself. dynamic: true, so the Sim ctor's surface-
  // placement loop skips him; logol_roam.ts spawns exactly one at his fixed spot
  // for each weekly visit when the feature is enabled. He gives no quests, but
  // his questIds carry the final chain quest so the gossip dialog offers its
  // "speak with Logol" discussion entry (the interact objective's credit path);
  // trading with him is the $WOC wares shop, gated server-side on whether the
  // account finished the chain.
  [LOGOL_NPC_ID]: {
    id: LOGOL_NPC_ID,
    name: 'Logol',
    title: LOGOL_GUILD_TAG,
    pos: { x: 0, z: 0 },
    facing: 0,
    color: 0x2a2340,
    questIds: [LOGOL_UNLOCK_QUEST_ID],
    dynamic: true,
    greeting: 'You see me, then. Few do. I carry what gold cannot buy, stranger, only $WOC.',
  },
  // The lore NPC who gives the unlock chain, standing at a fixed starting-zone
  // hub spot so the chain is always startable even while Logol is away.
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

// The three-step "Seen and Unseen" chain, each step a distinct objective (the
// quest-dedup guard rejects same-giver quests with identical signatures):
// hear the rumor (interact Harbinger), attune the eye (cull starter wolves),
// then find Logol himself during a weekly visit and speak with him. Text and
// reward tuning are still a content pass (see the PRD TODOs). Turning in
// q_logol_seen marks the account and opens the shop.
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
    text: 'To see the unseen you must first look hard at the ordinary. Cull the wolves of the vale until your eye unclouds, then return to me.',
    completionText: 'The mark is set. Your eye is ready.',
    objectives: [
      {
        type: 'kill',
        targetMobId: 'forest_wolf',
        count: 6,
        label: 'Cull forest wolves',
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
    text: 'You are ready. The cloaked one keeps to the crossroads when he walks this realm at all. Find him, speak with him, and return to me.',
    completionText: 'Now you see him. His ledger is open to you. Spend wisely.',
    objectives: [
      {
        type: 'interact',
        targetNpcId: LOGOL_NPC_ID,
        count: 1,
        label: 'Find Logol and speak with him',
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

// The signature "infinity item": the always-offered flagship, priced in the
// hundreds of thousands of $WOC.
export const LOGOL_FLAGSHIP_WARE_ID = 'logol_flair_cloaked_in_infinity';

// The prestige wares catalog: the pool of "infinity items". COSMETIC-ONLY,
// account-bound. This draft ships `title` and `flair` (no new render system
// needed); `transmog` and `mount` are valid kinds (see LogolWareKind) but
// intentionally carry no entries yet, blocked on render work (PRD "Out of
// scope"). Prices are per-ware (data-as-code): most in the thousands of $WOC,
// with the flagship "Cloaked in Infinity" flair in the hundreds of thousands.
// Placeholders pending a tokenomics pass.
export const LOGOL_WARES: LogolWare[] = [
  {
    id: 'logol_title_unseen',
    kind: 'title',
    name: 'the Unseen',
    description:
      'A prestige title for those who have looked upon Logol and been looked upon in turn.',
    priceWoc: 5000,
    rarity: 'rare',
  },
  {
    id: 'logol_flair_driftmark',
    kind: 'flair',
    name: 'Driftmark',
    description: 'A drifting cloak-mark that trails the nameplate. Cosmetic only.',
    priceWoc: 8000,
    rarity: 'rare',
  },
  {
    id: 'logol_title_ledger_marked',
    kind: 'title',
    name: 'Ledger-Marked',
    description: 'A prestige title carried by patrons of the nameless order.',
    priceWoc: 15000,
    rarity: 'epic',
  },
  {
    id: 'logol_title_between_moments',
    kind: 'title',
    name: 'Who Walks Between Moments',
    description: 'A prestige title for those who caught the cloaked one more than once.',
    priceWoc: 25000,
    rarity: 'epic',
  },
  {
    id: 'logol_flair_hollow_halo',
    kind: 'flair',
    name: 'Hollow Halo',
    description: 'A faint, endless ring above the nameplate. Cosmetic only.',
    priceWoc: 40000,
    rarity: 'epic',
  },
  {
    id: LOGOL_FLAGSHIP_WARE_ID,
    kind: 'flair',
    name: 'Cloaked in Infinity',
    description:
      "Logol's signature nameplate adornment: an endless, drifting cloak of stars. Cosmetic only.",
    priceWoc: 250000,
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

// How many rotating (non-flagship) wares Logol offers in a given week. The
// flagship is offered every week on top of these.
export const LOGOL_ROTATION_SIZE = 3;

/**
 * The wares Logol offers in week `weekIndex`: the always-available flagship plus
 * a rotating window of LOGOL_ROTATION_SIZE from the rest of the pool, so each
 * weekly appearance brings "new infinity items". The window advances by a full
 * ROTATION_SIZE per week (not by one), so adjacent weeks overlap as little as
 * the pool allows. Pure and deterministic, so the server (offer gate) and any
 * client can share it. `weekIndex` may be any integer (negative-safe).
 */
export function logolOfferedWares(weekIndex: number): LogolWare[] {
  const flagship = LOGOL_WARES.filter((w) => w.id === LOGOL_FLAGSHIP_WARE_ID);
  const pool = LOGOL_WARES.filter((w) => w.id !== LOGOL_FLAGSHIP_WARE_ID);
  const n = pool.length;
  if (n === 0) return flagship;
  const size = Math.min(LOGOL_ROTATION_SIZE, n);
  const start = (((weekIndex * size) % n) + n) % n;
  const rotating: LogolWare[] = [];
  for (let i = 0; i < size; i++) rotating.push(pool[(start + i) % n]);
  return [...flagship, ...rotating];
}

/**
 * Whether a player whose completed account-quests are `completedQuestIds` has
 * unlocked Logol's shop (they finished the "Seen and Unseen" chain). Pure, so
 * both the server (purchase gate) and any client lock badge can share it.
 */
export function logolShopUnlocked(completedQuestIds: readonly string[]): boolean {
  return completedQuestIds.includes(LOGOL_UNLOCK_QUEST_ID);
}

// Logol's fixed appearance spot (overworld x/z): he returns to the SAME place
// each week (see src/sim/logol_roam.ts), snapped to terrain via ctx.groundPos.
// A play-feel pass may re-pick this scenic/hub-adjacent spot (PRD).
export const LOGOL_APPEAR_POS = { x: 0, z: 0, label: 'the crossroads' };
