import { describe, expect, it } from 'vitest';

import { COMMAND_FACETS, COMMAND_NAMES, DISPATCH_ONLY_COMMANDS } from '../src/world_api';

// W6: facet tags on the shared command table. COMMAND_FACETS is APPEND-ONLY
// metadata mapping each wire command to the IWorld facet whose method sends it; the
// protocol vocabulary stays COMMAND_NAMES (W0b). This pins the W6 cluster's tags
// (combat/targeting/loot/telemetry) and the table-consistency invariants without
// touching the W0b gate. It never loosens command_schema.test.ts: a renamed token
// surfaces there first; here it surfaces as an orphaned tag.

// The exact tags W6 lands. Append (never edit) a slice's block as later clusters
// (W7-W10) tag their facets' commands.
const W6_TAGS: Readonly<Record<string, string>> = {
  cast: 'IWorldCombat',
  castSlot: 'IWorldCombat',
  attack: 'IWorldCombat',
  stopattack: 'IWorldCombat',
  release: 'IWorldCombat',
  target: 'IWorldTargeting',
  tab: 'IWorldTargeting',
  targetNearestFriendly: 'IWorldTargeting',
  tabFriendly: 'IWorldTargeting',
  lootRoll: 'IWorldLoot',
  telemetry: 'IWorldTelemetry',
};

describe('command facet tags (W6)', () => {
  const names = new Set<string>(COMMAND_NAMES);
  const dispatchOnly = new Set<string>(DISPATCH_ONLY_COMMANDS);
  const tags = COMMAND_FACETS as Readonly<Record<string, string>>;

  it('tags only real wire tokens that exist in COMMAND_NAMES', () => {
    const orphans = Object.keys(tags)
      .filter((cmd) => !names.has(cmd))
      .sort();
    expect(orphans, `tagged commands missing from COMMAND_NAMES:\n${orphans.join('\n')}`).toEqual(
      [],
    );
  });

  it('never tags a dispatch-only token (those are not client sends)', () => {
    const leaked = Object.keys(tags)
      .filter((cmd) => dispatchOnly.has(cmd))
      .sort();
    expect(leaked, `dispatch-only tokens must not be facet-tagged:\n${leaked.join('\n')}`).toEqual(
      [],
    );
  });

  it('tags every W6 combat/targeting/loot/telemetry command with its facet', () => {
    for (const [cmd, facet] of Object.entries(W6_TAGS)) {
      expect(tags[cmd], `facet tag for '${cmd}'`).toBe(facet);
    }
  });

  it('does not tag targetNearest (RL/server-only) or activeLootRolls (no wire command)', () => {
    expect('targetNearest' in tags).toBe(false);
    expect('activeLootRolls' in tags).toBe(false);
  });
});

// W7: append the progression cluster's tags (prestige + talents + cosmetics). The
// table-consistency invariants in the W6 block above (no orphan tag, no dispatch-only
// leak) already cover these new entries; this block pins the exact facet per W7
// command and that the no-wire members stay untagged. Append-only: never edit a tag.
const W7_TAGS: Readonly<Record<string, string>> = {
  prestige: 'IWorldProgressionXp',
  applyTalents: 'IWorldTalents',
  respec: 'IWorldTalents',
  setSpec: 'IWorldTalents',
  saveLoadout: 'IWorldTalents',
  switchLoadout: 'IWorldTalents',
  deleteLoadout: 'IWorldTalents',
  change_skin: 'IWorldCosmetics',
  claim_event_skin: 'IWorldCosmetics',
  unequip_mech_chroma: 'IWorldCosmetics',
};

describe('command facet tags (W7)', () => {
  const tags = COMMAND_FACETS as Readonly<Record<string, string>>;

  it('tags every W7 progression/talents/cosmetics command with its facet', () => {
    for (const [cmd, facet] of Object.entries(W7_TAGS)) {
      expect(tags[cmd], `facet tag for '${cmd}'`).toBe(facet);
    }
  });

  it('preserves the snake_case cosmetics wire strings (never normalized to camelCase)', () => {
    expect('change_skin' in tags).toBe(true);
    expect('claim_event_skin' in tags).toBe(true);
    expect('unequip_mech_chroma' in tags).toBe(true);
    expect('changeSkin' in tags).toBe(false);
  });

  it('does not tag talentPoints or leaderboard (local compute / REST GET, no wire send)', () => {
    expect('talentPoints' in tags).toBe(false);
    expect('leaderboard' in tags).toBe(false);
  });
});

// W8: append the pet + party cluster's tags (hunter pets, party/raid, raid-target
// markers). The table-consistency invariants in the W6 block above (no orphan tag, no
// dispatch-only leak) already cover these new entries; this block pins the exact facet
// per W8 command and that the no-wire reads (partyInfo/markerFor) stay untagged. The
// raid markers belong to IWorldParty, not IWorldTargeting (the W6 exclusion).
// Append-only: never edit a tag.
const W8_TAGS: Readonly<Record<string, string>> = {
  pet_abandon: 'IWorldPet',
  pet_rename: 'IWorldPet',
  pet_revive: 'IWorldPet',
  pet_attack: 'IWorldPet',
  pet_taunt: 'IWorldPet',
  pet_auto_taunt: 'IWorldPet',
  pet_feed: 'IWorldPet',
  pet_heal: 'IWorldPet',
  pet_mode: 'IWorldPet',
  pinvite: 'IWorldParty',
  paccept: 'IWorldParty',
  pdecline: 'IWorldParty',
  pleave: 'IWorldParty',
  pkick: 'IWorldParty',
  praid: 'IWorldParty',
  punraid: 'IWorldParty',
  pmoveRaid: 'IWorldParty',
  setMarker: 'IWorldParty',
  clearMarker: 'IWorldParty',
};

describe('command facet tags (W8)', () => {
  const tags = COMMAND_FACETS as Readonly<Record<string, string>>;

  it('tags every W8 pet/party/marker command with its facet', () => {
    for (const [cmd, facet] of Object.entries(W8_TAGS)) {
      expect(tags[cmd], `facet tag for '${cmd}'`).toBe(facet);
    }
  });

  it('preserves the snake_case pet wire strings (never normalized to camelCase)', () => {
    expect('pet_abandon' in tags).toBe(true);
    expect('pet_auto_taunt' in tags).toBe(true);
    expect('pet_mode' in tags).toBe(true);
    expect('petAbandon' in tags).toBe(false);
    expect('petAutoTaunt' in tags).toBe(false);
  });

  it('tags the raid markers to IWorldParty, not IWorldTargeting (the W6 exclusion)', () => {
    expect(tags['setMarker']).toBe('IWorldParty');
    expect(tags['clearMarker']).toBe('IWorldParty');
  });

  it('does not tag partyInfo/markerFor (snapshot reads, no wire send)', () => {
    expect('partyInfo' in tags).toBe(false);
    expect('markerFor' in tags).toBe(false);
    expect('markersFor' in tags).toBe(false);
  });
});

// W9: append the social cluster's tags (trade + duel/arena/fiesta + social graph).
// The table-consistency invariants in the W6 block above (no orphan tag, no
// dispatch-only leak) already cover these new entries; this block pins the exact
// facet per W9 command and that the non-command members stay untagged. socialInfo
// rides the social/socialpos frames (no command), searchCharacters is a REST GET,
// and social_refresh stays a dispatch-only server push. Append-only: never edit a tag.
const W9_TAGS: Readonly<Record<string, string>> = {
  trade_req: 'IWorldTrade',
  trade_accept: 'IWorldTrade',
  trade_offer: 'IWorldTrade',
  trade_confirm: 'IWorldTrade',
  trade_cancel: 'IWorldTrade',
  duel_req: 'IWorldDuelArena',
  duel_accept: 'IWorldDuelArena',
  duel_decline: 'IWorldDuelArena',
  arena_queue: 'IWorldDuelArena',
  arena_leave: 'IWorldDuelArena',
  arena_augment: 'IWorldDuelArena',
  friend_add: 'IWorldSocialGraph',
  friend_remove: 'IWorldSocialGraph',
  block_add: 'IWorldSocialGraph',
  block_remove: 'IWorldSocialGraph',
  guild_create: 'IWorldSocialGraph',
  guild_invite: 'IWorldSocialGraph',
  guild_accept: 'IWorldSocialGraph',
  guild_decline: 'IWorldSocialGraph',
  guild_leave: 'IWorldSocialGraph',
  guild_kick: 'IWorldSocialGraph',
  guild_promote: 'IWorldSocialGraph',
  guild_demote: 'IWorldSocialGraph',
  guild_transfer: 'IWorldSocialGraph',
  guild_disband: 'IWorldSocialGraph',
};

describe('command facet tags (W9)', () => {
  const tags = COMMAND_FACETS as Readonly<Record<string, string>>;

  it('tags every W9 trade/duel-arena/social command with its facet', () => {
    for (const [cmd, facet] of Object.entries(W9_TAGS)) {
      expect(tags[cmd], `facet tag for '${cmd}'`).toBe(facet);
    }
  });

  it('keeps duel + arena (incl. the fiesta arena_augment) under the one IWorldDuelArena facet', () => {
    expect(tags['duel_req']).toBe('IWorldDuelArena');
    expect(tags['arena_queue']).toBe('IWorldDuelArena');
    expect(tags['arena_augment']).toBe('IWorldDuelArena');
  });

  it('does not tag social_refresh (dispatch-only), searchCharacters (REST) or socialInfo (frame)', () => {
    expect('social_refresh' in tags).toBe(false);
    expect('searchCharacters' in tags).toBe(false);
    expect('socialInfo' in tags).toBe(false);
  });
});

// W10: append the market + dungeons + delves cluster's tags. The table-consistency
// invariants in the W6 block above (no orphan tag, no dispatch-only leak) already
// cover these new entries; this block pins the exact facet per W10 command and that
// the non-command reads stay untagged. The wire-name skew matters: delveBuyShopItem
// sends `delve_buy`, so the tag is keyed on the WIRE string `delve_buy`, never
// `delve_buy_shop_item`. enter_crypt/leave_crypt stay dispatch-only (untagged).
// Append-only: never edit a tag.
const W10_TAGS: Readonly<Record<string, string>> = {
  market_search: 'IWorldMarket',
  market_list: 'IWorldMarket',
  market_buy: 'IWorldMarket',
  market_cancel: 'IWorldMarket',
  market_collect: 'IWorldMarket',
  enter_dungeon: 'IWorldDungeons',
  leave_dungeon: 'IWorldDungeons',
  set_dungeon_difficulty: 'IWorldDungeons',
  heroic_buy: 'IWorldDungeons',
  enter_delve: 'IWorldDelves',
  leave_delve: 'IWorldDelves',
  delve_interact: 'IWorldDelves',
  companion_upgrade: 'IWorldDelves',
  delve_buy: 'IWorldDelves',
  lockpick_engage: 'IWorldDelves',
  lockpick_action: 'IWorldDelves',
  lockpick_abort: 'IWorldDelves',
  collect_delve_chest_loot: 'IWorldDelves',
};

describe('command facet tags (W10)', () => {
  const tags = COMMAND_FACETS as Readonly<Record<string, string>>;

  it('tags every W10 market/dungeons/delves command with its facet', () => {
    for (const [cmd, facet] of Object.entries(W10_TAGS)) {
      expect(tags[cmd], `facet tag for '${cmd}'`).toBe(facet);
    }
  });

  it('tags delveBuyShopItem by its WIRE string delve_buy (not the method name)', () => {
    expect(tags['delve_buy']).toBe('IWorldDelves');
    expect('delve_buy_shop_item' in tags).toBe(false);
    expect('delveBuyShopItem' in tags).toBe(false);
  });

  it('preserves the snake_case market/delve wire strings (never normalized to camelCase)', () => {
    expect('market_search' in tags).toBe(true);
    expect('enter_dungeon' in tags).toBe(true);
    expect('collect_delve_chest_loot' in tags).toBe(true);
    expect('marketSearch' in tags).toBe(false);
    expect('enterDungeon' in tags).toBe(false);
  });

  it('does not tag enter_crypt/leave_crypt (dispatch-only legacy aliases, not IWorldDungeons)', () => {
    expect('enter_crypt' in tags).toBe(false);
    expect('leave_crypt' in tags).toBe(false);
  });

  it('does not tag the command-less reads (marketInfo/raidLockouts/delveShopOffers/lockpickState/delveRun/companionState/delveMarks/companionUpgrades/delveDaily)', () => {
    for (const read of [
      'marketInfo',
      'raidLockouts',
      'delveShopOffers',
      'lockpickState',
      'delveRun',
      'companionState',
      'delveMarks',
      'companionUpgrades',
      'delveDaily',
    ]) {
      expect(read in tags, `${read} should be untagged (no wire command)`).toBe(false);
    }
  });
});

// Bank: append the personal-bank cluster's tags. The table-consistency invariants in
// the W6 block above (no orphan tag, no dispatch-only leak) already cover these new
// entries; this block pins the exact facet per bank command, keyed on the WIRE strings
// (bank_deposit/bank_withdraw/bank_buy_slots), and that the proximity-gated bankInfo
// read stays untagged (no wire send). The tokens are personal-bank only forever; a
// future guild bank gets its own guild_bank_* tokens (state.md decision 16), never a
// reuse of these. Append-only: never edit a tag.
const BANK_TAGS: Readonly<Record<string, string>> = {
  bank_deposit: 'IWorldBank',
  bank_withdraw: 'IWorldBank',
  bank_buy_slots: 'IWorldBank',
};

describe('command facet tags (bank)', () => {
  const tags = COMMAND_FACETS as Readonly<Record<string, string>>;

  it('tags every personal-bank command with the IWorldBank facet', () => {
    for (const [cmd, facet] of Object.entries(BANK_TAGS)) {
      expect(tags[cmd], `facet tag for '${cmd}'`).toBe(facet);
    }
  });

  it('preserves the snake_case bank wire strings (never normalized to camelCase)', () => {
    expect('bank_deposit' in tags).toBe(true);
    expect('bank_withdraw' in tags).toBe(true);
    expect('bank_buy_slots' in tags).toBe(true);
    expect('bankDeposit' in tags).toBe(false);
    expect('bankBuySlots' in tags).toBe(false);
  });

  it('does not tag bankInfo (proximity-gated snapshot read, no wire command)', () => {
    expect('bankInfo' in tags).toBe(false);
  });
});

// Deeds: append the Book of Deeds cluster's tag. The table-consistency
// invariants in the W6 block above (no orphan tag, no dispatch-only leak)
// already cover the new entry; this block pins the exact facet for the one
// title-selection command and that the four snapshot reads stay untagged.
// Append-only: never edit a tag.
const DEEDS_TAGS: Readonly<Record<string, string>> = {
  deed_set_title: 'IWorldDeeds',
};

describe('command facet tags (deeds)', () => {
  const tags = COMMAND_FACETS as Readonly<Record<string, string>>;

  it('tags the title-selection command with the IWorldDeeds facet', () => {
    for (const [cmd, facet] of Object.entries(DEEDS_TAGS)) {
      expect(tags[cmd], `facet tag for '${cmd}'`).toBe(facet);
    }
  });

  it('preserves the snake_case wire string (never normalized to camelCase)', () => {
    expect('deed_set_title' in tags).toBe(true);
    expect('deedSetTitle' in tags).toBe(false);
    expect('setActiveTitle' in tags).toBe(false);
  });

  it('does not tag the snapshot reads (deedsEarned/deedStats/renown/activeTitle)', () => {
    for (const read of ['deedsEarned', 'deedStats', 'renown', 'activeTitle']) {
      expect(read in tags, `${read} should be untagged (no wire command)`).toBe(false);
    }
  });
});
