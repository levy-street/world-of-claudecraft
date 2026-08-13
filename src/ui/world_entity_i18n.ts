import {
  GUILD_TREND_LETTERS,
  HEROIC_MARK_LETTER,
  type LetterDef,
  MASTER_TIER_LETTERS,
  MASTERY_RESET_LETTER,
  QUEST_LETTERS,
  WELCOME_LETTER,
} from '../sim/content/letters';
import { DELVES, DUNGEONS, MOBS, NPCS, QUESTS, ZONES } from '../sim/data';

// English world-entity names + narratives (mobs, NPCs, quests, zones, dungeons).
//
// This module is the SINGLE English source for those entities: makeEnglishWorldEntities()
// reads the canonical sim data and shapes it into the `en` slice that src/ui/i18n.catalog
// spreads into the authoritative nested `en` (imported there as `worldNames.en`). The
// build then overlays each per-locale flat overlay (src/ui/i18n.locales/<lang>.ts) onto
// that `en` to produce the dense resolved table.
//
// Non-English entity names are NOT here. The flatten migration inlined every entity key into the
// flat overlays, which left this module's non-English datasets dead (zero runtime
// consumers - tEntity resolves through the resolved table, not this object). A later cleanup
// removed those dead datasets along with the `{} as WorldEntityTranslations` casts that
// faked es_ES->es / fr_CA->fr_FR dialect inheritance here; dialect inheritance is now a
// declared-base merge in the build resolver (scripts/i18n_build.mjs). Only `.en` is
// consumed, so this object carries only `en`.

const MOB_IDS = [
  'yumi_cat',
  'forest_wolf',
  'old_greyjaw',
  'wild_boar',
  'webwood_spider',
  'mudfin_murloc',
  'tunnel_rat',
  'vale_bandit',
  'restless_bones',
  'gorrak',
  'mire_prowler',
  'deepfen_murloc',
  'mire_widow',
  'mirefen_broodmother',
  'drowned_dead',
  'fen_troll',
  'grubjaw',
  'gravecaller_cultist',
  'gravecaller_summoner',
  'gravecaller_mender',
  'deacon_voss',
  'training_dummy',
  'ridge_stalker',
  'deeprock_kobold',
  'thornpeak_ogre',
  'ogre_crusher',
  'warlord_drogmar',
  'stormcrag_elemental',
  'shardlord_kazzix',
  'wyrmcult_zealot',
  'wyrmcult_necromancer',
  'boneclad_revenant',
  'crypt_shambler',
  'hollow_acolyte',
  'bonechill_widow',
  'sexton_marrow',
  'morthen',
  'bastion_revenant',
  'tidebound_acolyte',
  'drowned_thrall',
  'knight_commander_olen',
  'vael_the_mistcaller',
  'sanctum_boneguard',
  'sanctum_drakonid',
  'raised_bonewalker',
  'korgath_the_bound',
  'grand_necromancer_velkhar',
  'korzul_the_gravewyrm',
  'bog_bloat',
  'fallen_captain_aldren',
  'corrupted_priest_malric',
  'deathstalker_voss',
  'vision_aldren_warrior',
  'vision_malric_mage',
  'vision_deathstalker_voss',
  'bound_guardian',
  'nythraxis_skeleton_warrior',
  'nythraxis_heroic_warrior_add',
  'nythraxis_heroic_priest_add',
  'nythraxis_heroic_rogue_add',
  'nythraxis_scourge_of_thornpeak',
  // Collapsed Reliquary delve mobs
  'reliquary_ledger_wraith',
  'reliquary_funeral_ringer',
  'reliquary_gravecall_acolyte',
  'reliquary_bonewalker',
  'reliquary_saintless_effigy',
  'deacon_varric',
  'acolyte_tessa',
  // Drowned Litany delve mobs (Mirefen Marsh)
  'drowned_cantor',
  'reedbound_acolyte',
  'deepfen_spearjaw',
  'mirefen_widowling',
  'spider_egg_sac',
  // Quest-dedupe pass (zones 1 to 3): the Broodmother clutch and the new elites.
  'spider_egg',
  'widow_hatchling',
  'drowned_warlord',
  'brakka_wallbreaker',
  'threnos_first_voice',
  'grave_silt_bulwark',
  'sump_troll_devourer',
  'choir_thrall',
  'sister_nhalia_drowned_canticle',
  'edda_reedhand',
  'tolling_bell',
  'vale_cup_ball',
  // Thornpeak Heights world boss + its summoned adds
  'thunzharr_waking_peak',
  'thunzharr_stormling',
  // Ambient Highwatch Stables horse (zone 3)
  'stable_horse',
  // Procedural Rift creature pool (src/sim/content/rift/mobs.ts). Dev/endless
  // content; English names come from the MOBS table like every other id here.
  'rift_spawnling',
  'rift_bonewalker',
  'rift_frost_revenant',
  'rift_rime_elemental',
  'rift_ember_fiend',
  'rift_magma_brute',
  'rift_venom_weaver',
  'rift_thornback',
  'rift_boneclad',
  'rift_marrow_troll',
  'rift_void_acolyte',
  'rift_dread_stalker',
  'rift_storm_caller',
  'rift_stormscale',
  'rift_tide_thrall',
  'rift_deep_lurker',
  'rift_stone_ogre',
  'rift_boss_frost',
  'rift_boss_ember',
  'rift_boss_venom',
  'rift_boss_necro',
  'rift_boss_brute',
  'rift_boss_arcane',
  'rift_boss_storm',
  'rift_boss_tide',
  // the Veiled Hollow
  'glimmerwisp',
  'duskwisp',
  'veiled_stag',
  'veiled_doe',
  'gleamstag',
  'sporeling_gatherer',
  'corrupted_sporeling',
  'mushroom_pixie',
  'treant_elder',
  'ancient_guardian',
  'waking_warden',
  'old_marrowshell',
  'aurelhorn',
  'snowdrift_wolf',
  'ice_wisp',
  'rime_elemental',
  'fen_sprite',
  'frostmane_yeti',
  'terrace_howler',
  'apprentice_wren',
  'emberwing_drake',
  'ashbone_raider',
  'ashbone_warcaller',
  'dune_troll',
  'cindraleth_maw_matriarch',
  'dragonkin_egg',
  'dragonkin_whelp',
  'dragonkin_broodguard',
  'drakemaw_broodlord',
  'gilded_stag',
  'gloam_fox',
  'orchard_treant',
  'the_meredark',
  'harvest_sprite',
  'mere_lurker',
  'bogtoad',
  'drowsy_croaker',
  'lily_wisp',
  'willow_sprite',
  'moonfleece_grazer',
  'gloam_strider',
  'nightkin_stargazer',
  'barrow_king',
  'barrow_wight',
  'widowsilk_spinner',
  'wood_wraith',
  'gravenbark_shambler',
  'pale_huntsman',
  'gravedigger_mosley',
  'tide_scuttler',
  'thicket_boar',
  'canopy_weaver',
  'idol_guardian',
  'castaway_navigator',
  'topiary_stag',
  'topiary_wolf',
  'hedge_gnome',
  'hedge_knight',
  'the_topiary_bull',
  'moor_ram',
  'gale_wisp',
  'shoal_scuttler',
  'downs_bandit',
  'wreck_thief',
  'the_wreck_warden',
  'drowned_deckhand',
  'riftspawn',
  'breach_wretch',
  'void_stalker',
  'sundered_horror',
  'fisher_bram',
  // The Infernal Citadel set-piece (src/sim/content/rift/infernal_citadel.ts).
  'rift_hellguard',
  'rift_pact_acolyte',
  'rift_boss_ritualist',
  'rift_boss_pitlord',
  // The Wildheart Basin jungle dungeon (src/sim/content/wildheart.ts).
  'wildheart_stalker',
  'wildheart_ravager',
  'wildheart_hexcaller',
  'wildheart_beastmaster',
  'wildheart_high_priest',
] as const;

const NPC_IDS = [
  'the_merchant',
  'marshal_redbrook',
  'trader_wilkes',
  'apothecary_lin',
  'brother_aldric',
  'smith_haldren',
  'fisherman_brandt',
  'foreman_odell',
  'stablemaster_marla', // the stablemaster: teaches riding lessons (Highwatch, zone 3)
  'warden_fenwick',
  'brother_aldric_fen',
  'provisioner_hale',
  'herbalist_yara',
  'scout_maren',
  'captain_thessaly',
  'brother_aldric_highwatch',
  'scout_maren_highwatch',
  'quartermaster_bree',
  'armorer_hode',
  'heroic_quartermaster', // Heroic Marks vendor (Highwatch, zone 3)
  'fury', // Honor Quartermaster and WARFARE vendor (Eastbrook, zone 1)
  'warmarshal_draven_kole', // Master of the Warfare Stores, the WARFARE vendor (Highwatch, zone 3)
  'loremaster_caddis',
  'auctioneer_voss', // second World Market auctioneer (Highwatch, zone 3)
  'bursar_fernando', // Gilded Strongbox banker (Eastbrook, zone 1)
  'card_master', // Card Duel minigame queue desk (Eastbrook, zone 1)
  'bursar_petra_vell', // Gilded Strongbox banker (Fenbridge, zone 2)
  'bursar_aldous_crane', // Gilded Strongbox banker (Highwatch, zone 3)
  'brother_aldric_raid', // dynamically-spawned raid turn-in NPC (Crypt of Nythraxis)
  'brother_halven', // Collapsed Reliquary delve board NPC
  'brother_halven_marsh', // Drowned Litany delve board NPC (same character, marsh camp)
  'spirit_healer', // the graveyard angel (spawned at every graveyard + dungeon entry)
  'groundskeeper_bram', // Vale Cup queue master at the Sowfield gate (docs/prd/vale-cup.md)
  'chronicler_saul', // Book of Deeds Chronicler (Eastbrook, zone 1)
  'chronicler_osric_fenn', // Book of Deeds Chronicler (Fenbridge, zone 2)
  'chronicler_edda_hartwell', // Book of Deeds Chronicler (Highwatch, zone 3)
  // Eldergleam, the Veiled Hollow
  'keeper_saelwyn',
  'loremother_bryn',
  'provisioner_fenna',
  'wardsmith_orun',
  'archivist_tullo',
  'huntsman_deral',
  // Icemantle, the Frostveil Reach
  'warden_kaldra',
  'hearthkeeper_maeve',
  'scout_einna',
  'aurorist_veyla',
  'trapper_brosk',
  // Wyrmwatch, the Drakelands
  'gatecaptain_brannoc',
  'quartermaster_sela',
  'scout_yerrin',
  // Lanternmere, the Amberfall
  'reeve_ottoline',
  'waywatcher_sorrel',
  'ferrymaster_caddow',
  'orchardist_pomeline',
  // Bridgemere, the Willowfen
  'waykeeper_pell',
  'bridgewright_alden',
  'netter_maris',
  'mother_sedge',
  // Moonrest, the Nightbloom
  'lamplighter_sorrel',
  'lira_dewsong',
  'weaver_amelle',
  'astronomer_cassian',
  // Gallowmere, the Wraithwood
  'lampman_cobb',
  'sexton_marrow',
  'widow_tansy',
  'vicar_creel',
  // Drifthaven, the Palmreach
  'strandwatcher_pell',
  'salvage_boss_ryna',
  'pearlmother_isha',
  'hermit_okku',
  // Hedgewick, the Evergarden
  'gatewarden_pell',
  'head_gardener_amaranth',
  'wickmother_sorrel',
  'gardener_yew',
  // Wickharbor, the Galecrest
  'watcher_maren',
  'harbormaster_odile',
  'keeper_bram',
  'salvager_edda',
  // Gullhaven, the Farshore redoubt
  'warden_coalfast',
  'riftwatch_ollun',
  'quartermaster_edda',
  'mender_saul',
  'bellkeeper_tam',
  'fisher_nell',
  'forgemistress_darva', // crafting-station master: forge (Eastbrook, zone 1)
  'cook_marlow', // crafting-station master: kitchens (Eastbrook, zone 1)
  'weaver_ottilie', // crafting-station master: loom (Eastbrook, zone 1)
  'tinker_gizzel', // crafting-station master: toolworks (Eastbrook, zone 1)
  'tanner_hesk', // crafting-station master: tannery (Fenbridge, zone 2)
  'alchemist_verane', // crafting-station master: apothecary (Highwatch, zone 3)
] as const;

const QUEST_IDS = [
  'q_prof_intro',
  'q_wolves',
  'q_greyjaw',
  'q_boars',
  'q_spiders',
  'q_murlocs',
  'q_mine',
  'q_bones',
  'q_supplies',
  'q_whispers',
  'q_names_of_the_dead',
  'q_silence_the_call',
  'q_rite',
  'q_hollow',
  'q_sexton',
  'q_gravecallers_trail',
  'q_divine_tome',
  'q_bandits',
  'q_ringleader',
  'q_fenbridge_muster',
  'q_prowlers',
  'q_prowler_pelts',
  'q_fen_supplies',
  'q_deepfen',
  'q_idols',
  'q_aldrics_fallen_star',
  'q_deepfen_purge',
  'q_widows',
  'q_broodmother',
  'q_drowned',
  'q_drowned_censers',
  'q_no_rest',
  'q_rite_of_redemption',
  'q_trolls',
  'q_troll_fetishes',
  'q_grubjaw',
  'q_cult_camp',
  'q_summoners',
  'q_deacon',
  'q_bastion_door',
  'q_olen',
  'q_mistcaller',
  'q_highwatch_summons',
  'q_stalkers',
  'q_stalker_pelts',
  'q_stalkers_return',
  'q_stalker_cloaks',
  'q_old_cragmaw',
  'q_kobold_tunnels',
  'q_glowing_wax',
  'q_ogre_edges',
  'q_ogre_totems',
  'q_ogre_bounty',
  'q_crushers',
  'q_drogmar',
  'q_elementals',
  'q_shard_cores',
  'q_kazzix',
  'q_zealots',
  'q_cult_orders',
  'q_necromancers',
  'q_revenants',
  'q_revenant_vanguard',
  'q_wyrm_sigils',
  'q_breaking_the_seal',
  'q_voice_below',
  'q_sanctum_gate',
  'q_korgath',
  'q_velkhar',
  'q_gravewyrm',
  'q_the_codfather',
  'q_nythraxis_restless_dead',
  'q_nythraxis_graves',
  'q_nythraxis_sealed_crypt',
  'q_nythraxis_bound_guardian',
  'q_nythraxis_scourges_end',
  'q_mogger',
  'q_prof_attune_smith',
  'q_prof_attune_outfitter',
  'q_prof_attune_apothecary',
  'q_prof_attune_bombardier',
  'q_prof_amends_smith',
  'q_prof_amends_outfitter',
  'q_prof_amends_apothecary',
  'q_prof_amends_bombardier',
  'q_prof_workorder_forge',
  'q_prof_workorder_kitchens',
  'q_prof_workorder_loom',
  'q_prof_workorder_toolworks',
  'q_prof_workorder_tannery',
  'q_prof_workorder_apothecary',
  'q_riding_lessons',
  // the Veiled Hollow
  'q_veil_thinned',
  'q_gleaming_antlers',
  'q_wisp_lights',
  'q_calming_the_deep',
  'q_spore_hearts',
  'q_monument_tour',
  'q_grove_menace',
  'q_shards_of_starfall',
  'q_treant_accord',
  'q_spore_tide',
  'q_sunken_court',
  'q_wardens_echoes',
  'q_waking_warden',
  'q_seal_restored',
  'q_hollow_the_huntsman',
  'q_hollow_old_marrowshell',
  'q_hollow_first_of_the_herd',
  'q_prof_hobby_switch',
  // the Frostveil Reach
  'q_fv_snowline_report',
  'q_fv_wolves_at_the_door',
  'q_fv_winter_pelts',
  'q_fv_ember_caches',
  'q_fv_lights_over_steps',
  'q_fv_silent_trapline',
  'q_fv_aurora_motes',
  'q_fv_rime_unbound',
  'q_fv_sprung_traps',
  'q_fv_howl_above',
  'q_fv_seeing_wren_home',
  'q_fv_frostmane_tyrant',
  // the Drakelands
  'q_dk_ash_on_the_wind',
  'q_dk_trolls_on_the_road',
  'q_dk_scorched_stores',
  'q_dk_banners_over_the_dunes',
  'q_dk_watcher_at_the_wargate',
  'q_dk_marrow_and_ash',
  'q_dk_scales_of_the_maw',
  'q_dk_matriarch_of_the_maw',
  // the Amberfall
  'q_af_goldmelt_road',
  'q_af_foxes_in_the_lamplight',
  'q_af_lanterns_on_the_water',
  'q_af_orchard_call',
  'q_af_amber_from_the_herd',
  'q_af_what_took_the_moorings',
  'q_af_sprites_and_spigots',
  'q_af_the_meredark',
  // the Willowfen
  'q_wf_across_the_fenway',
  'q_wf_rope_chewers',
  'q_wf_eels_for_the_smokehouse',
  'q_wf_mind_the_moorings',
  'q_wf_witch_of_willowweep',
  'q_wf_toll_and_tangle',
  'q_wf_wisplight_charms',
  'q_wf_croakers_hush',
  // the Nightbloom
  'q_nb_road_of_lanterns',
  'q_nb_striders_in_the_dark',
  'q_nb_wool_by_moonlight',
  'q_nb_night_gardens',
  'q_nb_eyes_on_the_vigil',
  'q_nb_charts_of_the_stones',
  'q_nb_restless_mounds',
  'q_nb_the_barrow_king',
  // the Wraithwood
  'q_ww_bells_of_gallowmere',
  'q_ww_silk_in_the_eaves',
  'q_ww_widows_skeins',
  'q_ww_candles_at_the_bounds',
  'q_ww_the_last_vicar',
  'q_ww_wraiths_of_the_tarn',
  'q_ww_what_the_bark_holds',
  'q_ww_walking_mosley_home',
  'q_ww_horn_of_the_huntsman',
  // the Palmreach
  'q_pr_down_to_drifthaven',
  'q_pr_wreck_line_cargo',
  'q_pr_scuttler_cull',
  'q_pr_boars_in_the_gardens',
  'q_pr_the_man_who_went_in',
  'q_pr_canopy_silk',
  'q_pr_the_lost_navigator',
  'q_pr_what_the_drums_guard',
  'q_pr_idol_guardian',
  // the Evergarden
  'q_eg_gate_report',
  'q_eg_hungry_shapes',
  'q_eg_stolen_shears',
  'q_eg_who_trims_the_hedges',
  'q_eg_gnomes_in_the_green',
  'q_eg_bloom_clippings',
  'q_eg_four_statues',
  'q_eg_bull_of_the_court',
  // the Farshore
  'q_fs_bell_at_the_landing',
  'q_fs_hold_the_riftfields',
  'q_fs_steel_for_the_redoubt',
  'q_fs_the_three_bells',
  'q_fs_song_before_the_break',
  'q_fs_moss_and_mending',
  'q_fs_bram_come_home',
  'q_fs_stalkers_off_the_light',
  'q_fs_the_great_break',
  // the Galecrest
  'q_gc_down_the_windway',
  'q_gc_wool_off_the_downs',
  'q_gc_scuttlers_in_the_pots',
  'q_gc_keeper_of_the_flame',
  'q_gc_lanterns_on_the_shear',
  'q_gc_wind_against_the_wick',
  'q_gc_the_far_shore',
  'q_gc_dead_mens_cargo',
  'q_gc_the_wreck_warden',
] as const;

const ZONE_IDS = [
  'eastbrook_vale',
  'mirefen_marsh',
  'thornpeak_heights',
  'veiled_hollow',
  'drakelands',
  'frostveil',
  'amberfall',
  'willowfen',
  'nightbloom',
  'wraithwood',
  'palmreach',
  'evergarden',
  'galecrest',
  'farshore_isle',
] as const;
const DUNGEON_IDS = [
  'hollow_crypt',
  'sunken_bastion',
  'gravewyrm_sanctum',
  'nythraxis_crypt',
  'nythraxis_boss_arena',
  'wildheart_basin',
  'the_last_keep',
] as const;
const DELVE_IDS = ['collapsed_reliquary', 'drowned_litany'] as const;
// Ravenpost authored letters (src/sim/content/letters.ts): the welcome letter
// plus every quest thank-you letter, keyed by letterId.
const LETTER_IDS = [
  'ravenpost_welcome',
  'letter_q_wolves',
  'letter_q_greyjaw',
  'letter_q_hollow',
  'heroic_marks_reward',
  // Guild trend letters (Professions 2.0), one per canonical adjacent
  // pair in CRAFT_RING order (GUILD_TREND_LETTERS in src/sim/content/letters.ts).
  'guild_trend_engineering_alchemy',
  'guild_trend_alchemy_cooking',
  'guild_trend_cooking_leatherworking',
  'guild_trend_leatherworking_tailoring',
  'guild_trend_tailoring_inscription',
  'guild_trend_inscription_enchanting',
  'guild_trend_enchanting_jewelcrafting',
  'guild_trend_jewelcrafting_weaponcrafting',
  'guild_trend_weaponcrafting_armorcrafting',
  'guild_trend_armorcrafting_engineering',
  // The one-time mastery reset notice (Professions 2.0,
  // MASTERY_RESET_LETTER in src/sim/content/letters.ts).
  'mastery_reset_notice',
  // Master tier-milestone letters (Professions 2.0), one per anchor
  // master per tier 1..5 (MASTER_TIER_LETTERS in src/sim/content/letters.ts).
  'prof_tier_weaponcrafting_armorcrafting_1',
  'prof_tier_weaponcrafting_armorcrafting_2',
  'prof_tier_weaponcrafting_armorcrafting_3',
  'prof_tier_weaponcrafting_armorcrafting_4',
  'prof_tier_weaponcrafting_armorcrafting_5',
  'prof_tier_leatherworking_tailoring_1',
  'prof_tier_leatherworking_tailoring_2',
  'prof_tier_leatherworking_tailoring_3',
  'prof_tier_leatherworking_tailoring_4',
  'prof_tier_leatherworking_tailoring_5',
  'prof_tier_alchemy_cooking_1',
  'prof_tier_alchemy_cooking_2',
  'prof_tier_alchemy_cooking_3',
  'prof_tier_alchemy_cooking_4',
  'prof_tier_alchemy_cooking_5',
  'prof_tier_engineering_alchemy_1',
  'prof_tier_engineering_alchemy_2',
  'prof_tier_engineering_alchemy_3',
  'prof_tier_engineering_alchemy_4',
  'prof_tier_engineering_alchemy_5',
] as const;

type MobId = (typeof MOB_IDS)[number];
type NpcId = (typeof NPC_IDS)[number];
type QuestId = (typeof QUEST_IDS)[number];
type ZoneId = (typeof ZONE_IDS)[number];
type DungeonId = (typeof DUNGEON_IDS)[number];
type DelveId = (typeof DELVE_IDS)[number];
type LetterId = (typeof LETTER_IDS)[number];

type MobTranslations = Record<MobId, { name: string }>;
type NpcTranslations = Record<NpcId, { name: string; title: string; greeting: string }>;
type QuestTranslation = {
  title: string;
  text: string;
  completion: string;
  objectives: Record<number, { label: string }>;
};
type QuestTranslations = Record<QuestId, QuestTranslation>;
type ZoneTranslations = Record<
  ZoneId,
  { name: string; welcome: string; pois: Record<number, { label: string }> }
>;
type DungeonTranslations = Record<
  DungeonId,
  { name: string; enterText: string; leaveText: string }
>;
type DelveTranslations = Record<DelveId, { name: string; enterText: string; leaveText: string }>;
type LetterTranslations = Record<LetterId, { sender: string; subject: string; body: string }>;

type WorldEntityTranslations = {
  worldContent: {
    corpseName: string;
    dungeonExitName: string;
    dungeonPartyWarning: string;
    dungeonInstanceBusy: string;
    delveLockedChestInteract: string;
    delveRewardChestInteract: string;
    delveSurfaceExitInteract: string;
    delveReliquaryInteract: string;
    delveRiteShrineBellInteract: string;
    delveRiteShrineCandleInteract: string;
    delveRiteShrineReedInteract: string;
    delveRiteShrineSkullInteract: string;
    mailboxName: string;
    noticeboardName: string;
  };
  entities: {
    mobs: MobTranslations;
    npcs: NpcTranslations;
    quests: QuestTranslations;
    zones: ZoneTranslations;
    dungeons: DungeonTranslations;
    delves: DelveTranslations;
    letters: LetterTranslations;
  };
};

function normalizeSourceText(text: string): string {
  return text
    .replace(/\$N/g, '{playerName}')
    .replace(/\$C/g, '{className}')
    .replace(/\u2014/g, '-');
}

function orderedValues<T>(ids: readonly string[], source: Record<string, T>): T[] {
  return ids.map((id) => {
    const value = source[id];
    if (!value) throw new Error(`Missing world entity source entry for ${id}`);
    return value;
  });
}

function makeEnglishWorldEntities(): WorldEntityTranslations {
  const mobs = {} as MobTranslations;
  orderedValues(MOB_IDS, MOBS).forEach((mob) => {
    mobs[mob.id as MobId] = { name: mob.name };
  });

  const npcs = {} as NpcTranslations;
  orderedValues(NPC_IDS, NPCS).forEach((npc) => {
    npcs[npc.id as NpcId] = {
      name: npc.name,
      title: npc.title,
      greeting: normalizeSourceText(npc.greeting),
    };
  });

  const quests = {} as QuestTranslations;
  orderedValues(QUEST_IDS, QUESTS).forEach((quest) => {
    const objectiveRecord = {} as Record<number, { label: string }>;
    quest.objectives.forEach((objective, objectiveIndex) => {
      objectiveRecord[objectiveIndex] = { label: objective.label };
    });
    quests[quest.id as QuestId] = {
      title: quest.name,
      text: normalizeSourceText(quest.text),
      completion: normalizeSourceText(quest.completionText),
      objectives: objectiveRecord,
    };
  });

  const zones = {} as ZoneTranslations;
  ZONES.forEach((zone) => {
    const poiRecord = {} as Record<number, { label: string }>;
    zone.pois.forEach((poi, index) => {
      poiRecord[index] = { label: poi.label };
    });
    zones[zone.id as ZoneId] = {
      name: zone.name,
      welcome: normalizeSourceText(zone.welcome),
      pois: poiRecord,
    };
  });

  const dungeons = {} as DungeonTranslations;
  orderedValues(DUNGEON_IDS, DUNGEONS).forEach((dungeon) => {
    dungeons[dungeon.id as DungeonId] = {
      name: dungeon.name,
      enterText: normalizeSourceText(dungeon.enterText),
      leaveText: normalizeSourceText(dungeon.leaveText),
    };
  });

  const delves = {} as DelveTranslations;
  orderedValues(DELVE_IDS, DELVES).forEach((delve) => {
    delves[delve.id as DelveId] = {
      name: delve.name,
      enterText: normalizeSourceText(delve.enterText),
      leaveText: normalizeSourceText(delve.leaveText),
    };
  });

  const lettersById: Record<string, LetterDef> = {
    [WELCOME_LETTER.letterId]: WELCOME_LETTER,
    [HEROIC_MARK_LETTER.letterId]: HEROIC_MARK_LETTER,
    [MASTERY_RESET_LETTER.letterId]: MASTERY_RESET_LETTER,
  };
  for (const letter of Object.values(QUEST_LETTERS)) lettersById[letter.letterId] = letter;
  for (const letter of Object.values(GUILD_TREND_LETTERS)) lettersById[letter.letterId] = letter;
  for (const byTier of Object.values(MASTER_TIER_LETTERS)) {
    for (const letter of Object.values(byTier)) lettersById[letter.letterId] = letter;
  }
  const letters = {} as LetterTranslations;
  orderedValues(LETTER_IDS, lettersById).forEach((letter) => {
    letters[letter.letterId as LetterId] = {
      sender: letter.senderName,
      subject: normalizeSourceText(letter.subject),
      body: normalizeSourceText(letter.body),
    };
  });

  return {
    worldContent: {
      corpseName: '{name} (corpse)',
      dungeonExitName: '{name} Exit',
      dungeonPartyWarning: '{name} is meant for a full party of {count}. Tread carefully.',
      dungeonInstanceBusy: 'All instances of {name} are busy. Try again soon.',
      delveLockedChestInteract: 'Press F to pick the lock',
      delveRewardChestInteract: 'Press F to claim spoils',
      delveSurfaceExitInteract: 'Press F to climb',
      delveReliquaryInteract: 'Drowned Reliquary: Press F to begin the rite',
      delveRiteShrineBellInteract: 'Bell Shrine: Press F to ring it',
      delveRiteShrineCandleInteract: 'Candle Shrine: Press F to touch it',
      delveRiteShrineReedInteract: 'Reed Shrine: Press F to touch it',
      delveRiteShrineSkullInteract: 'Skull Shrine: Press F to touch it',
      mailboxName: 'Mailbox',
      noticeboardName: 'Notice Board',
    },
    entities: { mobs, npcs, quests, zones, dungeons, delves, letters },
  };
}

// Only `.en` is consumed (by src/ui/i18n.catalog); non-English entity names live in the
// flat per-locale overlays, and dialect inheritance is a declared-base merge in the
// build resolver. So this object intentionally carries English only.
export const worldEntityText = {
  en: makeEnglishWorldEntities(),
};
