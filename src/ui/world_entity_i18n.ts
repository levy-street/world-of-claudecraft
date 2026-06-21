import { DUNGEONS, MOBS, NPCS, QUESTS, ZONES } from '../sim/data';

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
  'forest_wolf', 'old_greyjaw', 'wild_boar', 'webwood_spider', 'mudfin_murloc', 'tunnel_rat',
  'vale_bandit', 'restless_bones', 'gorrak', 'mire_prowler', 'deepfen_murloc', 'mire_widow',
  'mirefen_broodmother', 'drowned_dead', 'fen_troll', 'grubjaw', 'gravecaller_cultist',
  'gravecaller_summoner', 'gravecaller_mender', 'deacon_voss', 'ridge_stalker', 'deeprock_kobold', 'thornpeak_ogre',
  'ogre_crusher', 'warlord_drogmar', 'stormcrag_elemental', 'shardlord_kazzix',
  'wyrmcult_zealot', 'wyrmcult_necromancer', 'boneclad_revenant', 'crypt_shambler',
  'hollow_acolyte', 'bonechill_widow', 'sexton_marrow', 'morthen', 'bastion_revenant',
  'tidebound_acolyte', 'drowned_thrall', 'knight_commander_olen', 'vael_the_mistcaller',
  'sanctum_boneguard', 'sanctum_drakonid', 'raised_bonewalker', 'korgath_the_bound',
  'grand_necromancer_velkhar', 'korzul_the_gravewyrm', 'bog_bloat',
  'fallen_captain_aldren', 'corrupted_priest_malric', 'deathstalker_voss',
  'vision_aldren_warrior', 'vision_malric_mage', 'vision_deathstalker_voss',
  'bound_guardian', 'nythraxis_skeleton_warrior',
  'nythraxis_scourge_of_thornpeak',
  // Brightwood Glade wildlife pack
  'brightwood_hare', 'glade_fox', 'spotted_fawn', 'meadow_crane', 'thornpelt_badger',
  'dawnmane_doe', 'bramble_lynx', 'brightwood_stag', 'grovetusk_boar', 'sunhide_bear',
  'brightwood_monarch',
] as const;

const NPC_IDS = [
  'the_merchant', 'marshal_redbrook', 'trader_wilkes', 'apothecary_lin', 'brother_aldric',
  'smith_haldren', 'fisherman_brandt', 'foreman_odell', 'warden_fenwick', 'brother_aldric_fen',
  'provisioner_hale', 'herbalist_yara', 'scout_maren', 'captain_thessaly',
  'brother_aldric_highwatch', 'scout_maren_highwatch', 'quartermaster_bree', 'armorer_hode',
  'loremaster_caddis', 'ranger_elwyn',
  'brother_aldric_raid', // dynamically-spawned raid turn-in NPC (Crypt of Nythraxis)
] as const;

const QUEST_IDS = [
  'q_wolves', 'q_greyjaw', 'q_boars', 'q_spiders', 'q_murlocs', 'q_mine', 'q_bones',
  'q_supplies', 'q_whispers', 'q_names_of_the_dead', 'q_silence_the_call', 'q_rite',
  'q_hollow', 'q_sexton', 'q_gravecallers_trail', 'q_bandits', 'q_ringleader',
  'q_fenbridge_muster', 'q_prowlers', 'q_prowler_pelts', 'q_fen_supplies', 'q_deepfen',
    'q_idols', 'q_aldrics_fallen_star', 'q_deepfen_purge', 'q_widows', 'q_broodmother',
    'q_drowned', 'q_drowned_censers', 'q_no_rest', 'q_trolls', 'q_troll_fetishes', 'q_grubjaw',
    'q_cult_camp', 'q_summoners', 'q_deacon', 'q_bastion_door', 'q_olen', 'q_mistcaller',
  'q_highwatch_summons', 'q_stalkers', 'q_stalker_pelts', 'q_kobold_tunnels',
  'q_glowing_wax', 'q_ogre_edges', 'q_ogre_totems', 'q_ogre_bounty', 'q_crushers',
  'q_drogmar', 'q_elementals', 'q_shard_cores', 'q_kazzix', 'q_zealots', 'q_cult_orders',
  'q_necromancers', 'q_revenants', 'q_revenant_vanguard', 'q_wyrm_sigils',
  'q_breaking_the_seal', 'q_voice_below', 'q_sanctum_gate', 'q_korgath', 'q_velkhar',
  'q_gravewyrm', 'q_the_codfather', 'q_nythraxis_restless_dead', 'q_nythraxis_graves',
  'q_nythraxis_sealed_crypt', 'q_nythraxis_bound_guardian', 'q_nythraxis_scourges_end',
  'q_brightwood_thinning', 'q_brightwood_monarch',
  'q_ledger_first_duty', 'q_ledger_teeth', 'q_ledger_reedwater', 'q_ledger_silk',
  'q_ledger_brood', 'q_ledger_deepvermin', 'q_ledger_toll', 'q_ledger_vigil',
  'q_ledger_great_boar', 'q_ledger_outlaw_captain',
] as const;

const ZONE_IDS = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;
const DUNGEON_IDS = ['hollow_crypt', 'sunken_bastion', 'gravewyrm_sanctum', 'nythraxis_crypt', 'nythraxis_boss_arena'] as const;

type MobId = typeof MOB_IDS[number];
type NpcId = typeof NPC_IDS[number];
type QuestId = typeof QUEST_IDS[number];
type ZoneId = typeof ZONE_IDS[number];
type DungeonId = typeof DUNGEON_IDS[number];

type MobTranslations = Record<MobId, { name: string }>;
type NpcTranslations = Record<NpcId, { name: string; title: string; greeting: string }>;
type QuestTranslation = { title: string; text: string; completion: string; objectives: Record<number, { label: string }> };
type QuestTranslations = Record<QuestId, QuestTranslation>;
type ZoneTranslations = Record<ZoneId, { name: string; welcome: string; pois: Record<number, { label: string }> }>;
type DungeonTranslations = Record<DungeonId, { name: string; enterText: string; leaveText: string }>;

type WorldEntityTranslations = {
  worldContent: {
    corpseName: string;
    dungeonExitName: string;
    dungeonPartyWarning: string;
    dungeonInstanceBusy: string;
  };
  entities: {
    mobs: MobTranslations;
    npcs: NpcTranslations;
    quests: QuestTranslations;
    zones: ZoneTranslations;
    dungeons: DungeonTranslations;
  };
};

function normalizeSourceText(text: string): string {
  return text.replace(/\$N/g, '{playerName}').replace(/\$C/g, '{className}').replace(/\u2014/g, '-');
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
  orderedValues(MOB_IDS, MOBS).forEach((mob) => { mobs[mob.id as MobId] = { name: mob.name }; });

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
    zone.pois.forEach((poi, index) => { poiRecord[index] = { label: poi.label }; });
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

  return {
    worldContent: {
      corpseName: '{name} (corpse)',
      dungeonExitName: '{name} Exit',
      dungeonPartyWarning: '{name} is meant for a full party of {count}. Tread carefully.',
      dungeonInstanceBusy: 'All instances of {name} are busy. Try again soon.',
    },
    entities: { mobs, npcs, quests, zones, dungeons },
  };
}

// Only `.en` is consumed (by src/ui/i18n.catalog); non-English entity names live in the
// flat per-locale overlays, and dialect inheritance is a declared-base merge in the
// build resolver. So this object intentionally carries English only.
export const worldEntityText = {
  en: makeEnglishWorldEntities(),
};
