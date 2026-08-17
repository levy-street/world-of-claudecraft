// The Epic achievement mirror map: pins the deed-id to achievement-id table
// that the server-side mirror pushes to Epic Online Services. Achievement ids
// are permanent once shipped (D14), so these pins guard the launch set against
// a bulk regeneration that would scramble, drop, or rename an entry.
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_MAP, MAX_EPIC_ACHIEVEMENTS } from '../server/epic/achievement_map';
import { ACHIEVEMENT_MAP as STEAM_ACHIEVEMENT_MAP } from '../server/steam/achievement_map';
import { DEED_ORDER, DEEDS } from '../src/sim/content/deeds';

const ACH_NAME_RE = /^ACH_[A-Z0-9_]+$/;

describe('Epic achievement map', () => {
  it('has exactly the 84 registered entries (same launch set as Steam)', () => {
    expect(Object.keys(ACHIEVEMENT_MAP).length).toBe(84);
  });

  it('covers the whole Reliquary ladder: every col_reliquary_* deed in DEED_ORDER is mapped', () => {
    // Derived from the real catalog, not a hardcoded list: a tenth ladder
    // deed added to DEEDS without a mirror entry fails here by name.
    const ladder = DEED_ORDER.filter((id) => /^col_reliquary_/.test(id));
    expect(ladder.length).toBeGreaterThanOrEqual(9);
    for (const deedId of ladder) {
      expect(ACHIEVEMENT_MAP[deedId], deedId).toBeDefined();
    }
  });

  it('stays within the portal soft cap', () => {
    expect(MAX_EPIC_ACHIEVEMENTS).toBe(100);
    expect(Object.keys(ACHIEVEMENT_MAP).length).toBeLessThanOrEqual(MAX_EPIC_ACHIEVEMENTS);
  });

  it('gives every entry a well-formed ACH id', () => {
    for (const [deedId, ach] of Object.entries(ACHIEVEMENT_MAP)) {
      expect(ach, deedId).toMatch(ACH_NAME_RE);
    }
  });

  it('assigns a globally unique achievement id to each deed', () => {
    const names = Object.values(ACHIEVEMENT_MAP);
    expect(new Set(names).size).toBe(names.length);
  });

  it('maps only deed ids that exist in DEEDS', () => {
    for (const deedId of Object.keys(ACHIEVEMENT_MAP)) {
      expect(DEEDS[deedId], deedId).toBeDefined();
    }
  });

  it('pins load-bearing entries across catalog files', () => {
    expect(ACHIEVEMENT_MAP.prog_first_steps).toBe('ACH_FIRST_STEPS');
    expect(ACHIEVEMENT_MAP.dgn_deepward).toBe('ACH_DEEPWARD');
    expect(ACHIEVEMENT_MAP.pvp_vcup_golden_goal).toBe('ACH_VCUP_GOLDEN_GOAL');
    expect(ACHIEVEMENT_MAP.prog_crown_below).toBe('ACH_CROWN_BELOW');
    expect(ACHIEVEMENT_MAP.prog_guildsworn).toBe('ACH_GUILDSWORN');
  });

  it('carries the exact same table as the Steam twin (the shared launch set)', () => {
    // The LAUNCH SET is one id vocabulary across both storefronts (the Epic
    // header's claim), and each side carries its own independent 84-line
    // literal. The full-literal pins in each file already red any one-map
    // edit; what this cross-pin adds is the twin-awareness step in the
    // routine flow where a map and its own literal are updated together.
    // The storefronts are documented as independent (D21), so a deliberate
    // storefront-specific achievement is legal future content: when one
    // ships, scoping or retiring THIS pin is the reviewed act that records
    // the divergence.
    expect(ACHIEVEMENT_MAP).toEqual(STEAM_ACHIEVEMENT_MAP);
  });

  it('pins the full 84-entry registered map as a literal (permanent Epic achievement ids)', () => {
    expect(ACHIEVEMENT_MAP).toEqual({
      prog_first_steps: 'ACH_FIRST_STEPS',
      prog_double_digits: 'ACH_DOUBLE_DIGITS',
      prog_level_cap: 'ACH_LEVEL_CAP',
      prog_talented: 'ACH_TALENTED',
      prog_full_build: 'ACH_FULL_BUILD',
      prog_veteran: 'ACH_VETERAN',
      prog_eternal: 'ACH_ETERNAL',
      prog_prestige: 'ACH_PRESTIGE',
      prog_master_gatherer: 'ACH_MASTER_GATHERER',
      prog_crown_below: 'ACH_CROWN_BELOW',
      prog_mere_at_rest: 'ACH_MERE_AT_REST',
      prog_tools_of_the_trade: 'ACH_TOOLS_OF_THE_TRADE',
      prog_guildsworn: 'ACH_GUILDSWORN',
      prog_masterwright: 'ACH_MASTERWRIGHT',
      prog_master_angler: 'ACH_MASTER_ANGLER',
      cmb_first_blood: 'ACH_FIRST_BLOOD',
      cmb_slayer: 'ACH_SLAYER',
      cmb_first_fall: 'ACH_FIRST_FALL',
      dgn_hollow_crypt: 'ACH_HOLLOW_CRYPT',
      dgn_sunken_bastion: 'ACH_SUNKEN_BASTION',
      dgn_drowned_temple: 'ACH_DROWNED_TEMPLE',
      dgn_gravewyrm_sanctum: 'ACH_GRAVEWYRM_SANCTUM',
      dgn_nythraxis: 'ACH_NYTHRAXIS',
      dgn_nythraxis_heroic: 'ACH_NYTHRAXIS_HEROIC',
      dgn_nythraxis_crypt: 'ACH_NYTHRAXIS_CRYPT',
      dgn_thornpeak_rounds: 'ACH_THORNPEAK_ROUNDS',
      dgn_deepward: 'ACH_DEEPWARD',
      dgn_mark_circuit: 'ACH_MARK_CIRCUIT',
      dgn_korzul_flawless: 'ACH_KORZUL_FLAWLESS',
      dgn_sanctum_speed: 'ACH_SANCTUM_SPEED',
      dgn_nythraxis_wardens: 'ACH_NYTHRAXIS_WARDENS',
      dgn_nythraxis_deathless: 'ACH_NYTHRAXIS_DEATHLESS',
      cmb_thunzharr: 'ACH_THUNZHARR',
      cmb_thunzharr_unbroken: 'ACH_THUNZHARR_UNBROKEN',
      dlv_reliquary: 'ACH_RELIQUARY',
      dlv_litany: 'ACH_LITANY',
      dlv_lore_journal: 'ACH_DELVE_JOURNAL',
      dlv_solo_heroic: 'ACH_SOLO_HEROIC',
      dlv_tumbler_premium: 'ACH_TUMBLER_PREMIUM',
      dlv_nhalia_bells: 'ACH_NHALIA_BELLS',
      chr_vale_chapter_iii: 'ACH_VALE_CHAPTER_III',
      chr_marsh_chapter_iii: 'ACH_MARSH_CHAPTER_III',
      chr_peaks_chapter_iii: 'ACH_PEAKS_CHAPTER_III',
      col_discovery_25: 'ACH_DISCOVERY_25',
      col_discovery_250: 'ACH_DISCOVERY_250',
      col_first_epic: 'ACH_FIRST_EPIC',
      col_first_legendary: 'ACH_FIRST_LEGENDARY',
      col_seven_regalia: 'ACH_SEVEN_REGALIA',
      col_all_slots: 'ACH_ALL_SLOTS',
      col_glimmerfin: 'ACH_GLIMMERFIN',
      col_reliquary_rank_2: 'ACH_RELIQUARY_RANK_2',
      col_reliquary_rank_3: 'ACH_RELIQUARY_RANK_3',
      col_reliquary_rank_4: 'ACH_RELIQUARY_RANK_4',
      col_reliquary_rank_5: 'ACH_RELIQUARY_RANK_5',
      col_reliquary_complete: 'ACH_RELIQUARY_COMPLETE',
      col_reliquary_conquerors: 'ACH_RELIQUARY_CONQUERORS',
      col_reliquary_illum_nythraxis_heroic: 'ACH_RELIQUARY_ILLUM_NYTHRAXIS_HEROIC',
      col_reliquary_illum_thunzharr: 'ACH_RELIQUARY_ILLUM_THUNZHARR',
      col_reliquary_illum_gravewyrm_heroic: 'ACH_RELIQUARY_ILLUM_GRAVEWYRM_HEROIC',
      pvp_arena_1v1_1750: 'ACH_ARENA_1V1_1750',
      pvp_arena_1v1_1900: 'ACH_ARENA_1V1_1900',
      pvp_arena_2v2_1900: 'ACH_ARENA_2V2_1900',
      pvp_duel_first_win: 'ACH_DUEL_FIRST_WIN',
      pvp_vcup_first_win: 'ACH_VCUP_FIRST_WIN',
      pvp_vcup_wins_25: 'ACH_VCUP_WINS_25',
      pvp_vcup_hat_trick: 'ACH_VCUP_HAT_TRICK',
      pvp_vcup_golden_goal: 'ACH_VCUP_GOLDEN_GOAL',
      pvp_vcup_clean_sheet: 'ACH_VCUP_CLEAN_SHEET',
      pvp_fiesta_first_win: 'ACH_FIESTA_FIRST_WIN',
      pvp_fiesta_double: 'ACH_FIESTA_DOUBLE',
      pvp_fiesta_full_build: 'ACH_FIESTA_FULL_BUILD',
      soc_first_party: 'ACH_FIRST_PARTY',
      soc_full_house: 'ACH_FULL_HOUSE',
      soc_guild_joined: 'ACH_GUILD_JOINED',
      soc_first_trade: 'ACH_FIRST_TRADE',
      soc_first_sale: 'ACH_FIRST_SALE',
      soc_meet_bursar: 'ACH_MEET_BURSAR',
      soc_wyrms_hoard: 'ACH_WYRMS_HOARD',
      exp_world_traveler: 'ACH_WORLD_TRAVELER',
      feat_book_complete: 'ACH_BOOK_COMPLETE',
      hid_fall_death: 'ACH_FALL_DEATH',
      hid_roll_hundred: 'ACH_ROLL_HUNDRED',
      hid_bountiful_coffer: 'ACH_BOUNTIFUL_COFFER',
      hid_codfather: 'ACH_CODFATHER',
    });
  });
});
