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
  'nythraxis_scourge_of_thornpeak',
  // Collapsed Reliquary delve mobs
  'reliquary_ledger_wraith',
  'reliquary_funeral_ringer',
  'reliquary_gravecall_acolyte',
  'reliquary_bonewalker',
  'reliquary_saintless_effigy',
  'deacon_varric',
  'acolyte_tessa',
  // Valdris continent (v0.19)
  'dune_prowler',
  'emberjaw_matriarch',
  'glasswind_scorpion',
  'tombrobber_scavenger',
  'sandbound_shade',
  'duststorm_elemental',
  'forsaken_judge',
  'karn_the_unburied',
  'sandmaw_tyrant',
  'duskmane_stalker',
  'palefang_the_silent',
  'palewidow_weaver',
  'blackriver_skulker',
  'feral_wisp',
  'guildless_cutthroat',
  'hollow_revenant',
  'frostpine_headhunter',
  'grelnok_the_hoarbound',
  'veykar_the_forsworn',
  'wolfsward_packwolf',
  'hoarfang_alpha',
  'ironhold_digger',
  'broken_legion_deserter',
  'broken_legion_arbalist',
  'granite_churn_elemental',
  'sellsword_ogre',
  'frosthelm_wendigo',
  'overseer_kazrik',
  'commander_vaelis',
  'hollow_lurker',
  'underway_renegade',
  'pale_gnawer',
  'deep_shale_elemental',
  'vask_smuggler_king',
  'thornfen_creeper',
  'thornwarped_stag',
  'thornfen_troll',
  'briar_horror',
  'briarfather_yew',
  'pass_raider',
  'crag_toller',
  'ironpass_crag_elemental',
  'ridge_wyvern',
  'warlord_skarn',
  'emberveil_bloat',
  'emberveil_leech',
  'mire_strider',
  'fog_wraith',
  'emberveil_colossus',
  'bridge_cultist',
  'gullpicked_skeleton',
  'riverbank_revenant',
  'pale_watcher',
  'the_bridgekeeper',
  'warped_warhound',
  'breach_horror',
  'ember_revenant',
  'magma_elemental',
  'ash_wraith',
  'breachsworn_deserter',
  'breach_scavenger_ogre',
  'ashwing_drake',
  'mazhrekk_the_flesh_tithe',
  'butcher_vhorlan',
  'firstborn_of_the_crater',
  'warbringer_khorvax',
  'ash_ghoul',
  'cinder_hound',
  'veilstalker',
  'ash_elemental',
  'burnfield_revenant',
  'colossid_fragment',
  'brine_scuttler',
  'bonepicker_renegade',
  'salt_wraith',
  'marrowfeaster',
  'duskwall_scavenger',
  'rubble_haunt',
  'sewer_broodspider',
  'gutter_hound',
  'scavenger_king',
  'forgefall_salamander',
  'magma_serpent',
  'claimjumper_sapper',
  'slag_ogre',
  'smeltjaw',
  'deserter_wraith',
  'ridge_shrieker',
  'spire_stalker',
  'not_quite_man',
  'deserter_king',
  // Valdris quest-expansion mobs
  'mirage_stalker',
  'bonewind_ravager',
  'blackmere_drowned',
  'rimeclaw_prowler',
  'ironhold_geomancer',
  'frosthelm_icehowler',
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
  'loremaster_caddis',
  'auctioneer_voss', // second World Market auctioneer (Highwatch, zone 3)
  'brother_aldric_raid', // dynamically-spawned raid turn-in NPC (Crypt of Nythraxis)
  'brother_halven', // Collapsed Reliquary delve board NPC
  // Valdris continent (v0.19)
  'judge_saphira',
  'caravan_master_odai',
  'armorer_khet',
  'spymaster_vael',
  'provisioner_maren',
  'isyra_coldwater',
  'marshal_corvin',
  'quartermaster_hilde',
  'armorer_ottokar',
  'fence_odrik',
  'quartermaster_senna',
  'tollkeeper_brann',
  'lanternkeeper_ketta',
  'sutler_ives',
  'trucekeeper_maro',
  'provisioner_saskia',
  'armorer_dreng',
  'provisioner_hask',
  'provisioner_sela',
  'provisioner_varrow',
  'provisioner_bruna',
  'provisioner_odric',
  // Valdris quest-expansion NPCs
  'oasis_keeper_neriah',
  'relic_warden_temos',
  'factor_ilvane',
  'auditor_cress',
  'prefect_alina',
  'huntmaster_roderic',
] as const;

const QUEST_IDS = [
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
  // Valdris continent (v0.19)
  'q_dune_prowlers',
  'q_dune_prowler_pelts',
  'q_glasswind_venom',
  'q_tombrobbers',
  'q_sandbound',
  'q_duststorms',
  'q_forsaken_judges',
  'q_sandmaw',
  'q_duskmane_hunt',
  'q_palewidow_silk',
  'q_blackmere_ledgers',
  'q_guildless_debts',
  'q_silent_court',
  'q_forsworn_master',
  'q_wolfsward_culling',
  'q_ironhold_ledgers',
  'q_granite_tempering',
  'q_broken_legion',
  'q_frosthelm_pass',
  'q_renegade_commander',
  // Valdris quest-expansion chains
  'q_oasis_waterline',
  'q_glasswind_husks',
  'q_mirage_stalkers',
  'q_mirage_eyes',
  'q_dig_manifests',
  'q_shade_censers',
  'q_judge_tablets',
  'q_karn_unburied',
  'q_emberjaw_matriarch',
  'q_bonewind_ravagers',
  'q_rise_walks',
  'q_ravager_hides',
  'q_aqueduct_bronze',
  'q_judge_regalia',
  'q_veth_pelt_lots',
  'q_veth_venom_ledger',
  'q_veth_quay_manifests',
  'q_veth_palefang_price',
  'q_veth_wisp_essence',
  'q_veth_wispwood_cull',
  'q_veth_drowned_tolls',
  'q_veth_mere_bottom',
  'q_veth_broken_contracts',
  'q_veth_knife_tax',
  'q_veth_court_records',
  'q_veth_adjourn_court',
  'q_veth_totem_tally',
  'q_veth_rimeclaw_pelts',
  'q_veth_terrace_sweep',
  'q_veth_hoarbound_debt',
  'q_tithe_scrip_recovery',
  'q_candle_tax_arrears',
  'q_assay_seal_audit',
  'q_pay_chest_manifest',
  'q_overseer_audit',
  'q_pelt_requisition',
  'q_hoarfang_writ',
  'q_wendigo_gall',
  'q_icehowler_cull',
  'q_arbalist_lines',
  'q_ogre_paymasters',
  'q_watchfort_reclamation',
  'q_frosthelm_signals',
  'q_wendigo_hide_lining',
  'q_ogre_iron_reforging',
  'q_larder_restock',
  'q_ration_theft',
  'q_stores_for_the_ascent',
] as const;

const ZONE_IDS = [
  'eastbrook_vale',
  'mirefen_marsh',
  'thornpeak_heights',
  // Valdris continent (v0.19)
  'ossara_domain',
  'veth_confederation',
  'kael_empire',
  'grey_hollows',
  'thornfen_border',
  'ironpass_crossing',
  'emberveil_marshes',
  'pale_crossing',
  'the_breach',
  'ashveil_wastes',
  'saltbone_flats',
  'duskwall_ruins',
  'cindral_ridge',
  'redspire_pass',
] as const;
const DUNGEON_IDS = [
  'hollow_crypt',
  'sunken_bastion',
  'gravewyrm_sanctum',
  'nythraxis_crypt',
  'nythraxis_boss_arena',
] as const;
const DELVE_IDS = ['collapsed_reliquary'] as const;

type MobId = (typeof MOB_IDS)[number];
type NpcId = (typeof NPC_IDS)[number];
type QuestId = (typeof QUEST_IDS)[number];
type ZoneId = (typeof ZONE_IDS)[number];
type DungeonId = (typeof DUNGEON_IDS)[number];
type DelveId = (typeof DELVE_IDS)[number];

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

type WorldEntityTranslations = {
  worldContent: {
    corpseName: string;
    dungeonExitName: string;
    dungeonPartyWarning: string;
    dungeonInstanceBusy: string;
    delveLockedChestInteract: string;
    delveRewardChestInteract: string;
    delveSurfaceExitInteract: string;
  };
  entities: {
    mobs: MobTranslations;
    npcs: NpcTranslations;
    quests: QuestTranslations;
    zones: ZoneTranslations;
    dungeons: DungeonTranslations;
    delves: DelveTranslations;
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

  return {
    worldContent: {
      corpseName: '{name} (corpse)',
      dungeonExitName: '{name} Exit',
      dungeonPartyWarning: '{name} is meant for a full party of {count}. Tread carefully.',
      dungeonInstanceBusy: 'All instances of {name} are busy. Try again soon.',
      delveLockedChestInteract: 'Press F to pick the lock',
      delveRewardChestInteract: 'Press F to claim spoils',
      delveSurfaceExitInteract: 'Press F to climb',
    },
    entities: { mobs, npcs, quests, zones, dungeons, delves },
  };
}

// Only `.en` is consumed (by src/ui/i18n.catalog); non-English entity names live in the
// flat per-locale overlays, and dialect inheritance is a declared-base merge in the
// build resolver. So this object intentionally carries English only.
export const worldEntityText = {
  en: makeEnglishWorldEntities(),
};
