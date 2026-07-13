/*
 * Maps a Book of Deeds deed id to its Steam achievement API name for the
 * server-side mirror that pushes unlocks to Steamworks.
 *
 * Stability contract: once an ACH name has shipped to Steamworks App Admin it
 * is PERMANENT. Renaming one orphans every player's existing Steam unlock for
 * that achievement, so entries here may be ADDED but never renamed or reused.
 * Treat a shipped ACH name the way you treat a persisted id.
 *
 * At most 100 entries: the App Admin achievement cap until an unpublished
 * threshold is raised. Hidden deeds may legitimately appear in this map; they
 * are registered as Steam-hidden achievements in App Admin.
 */

export const ACHIEVEMENT_MAP: Record<string, string> = {
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
};

export const MAX_STEAM_ACHIEVEMENTS = 100;
