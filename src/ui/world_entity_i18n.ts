import { type LetterDef, QUEST_LETTERS, WELCOME_LETTER } from '../sim/content/letters';
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
  // Drowned Litany delve mobs (Mirefen Marsh)
  'drowned_cantor',
  'reedbound_acolyte',
  'deepfen_spearjaw',
  'mirefen_widowling',
  'spider_egg_sac',
  'grave_silt_bulwark',
  'sump_troll_devourer',
  'choir_thrall',
  'sister_nhalia_drowned_canticle',
  'edda_reedhand',
  'tolling_bell',
  // Thornpeak Heights world boss + its summoned adds
  'thunzharr_waking_peak',
  'thunzharr_stormling',
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
  'brother_halven_marsh', // Drowned Litany delve board NPC (same character, marsh camp)
  'spirit_healer', // the graveyard angel (spawned at every graveyard + dungeon entry)
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
  'q_archetype_acceptance',
  'q_prof_make_amends',
] as const;

const ZONE_IDS = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;
const DUNGEON_IDS = [
  'hollow_crypt',
  'sunken_bastion',
  'gravewyrm_sanctum',
  'nythraxis_crypt',
  'nythraxis_boss_arena',
] as const;
const DELVE_IDS = ['collapsed_reliquary', 'drowned_litany'] as const;
// Ravenpost authored letters (src/sim/content/letters.ts): the welcome letter
// plus every quest thank-you letter, keyed by letterId.
const LETTER_IDS = [
  'ravenpost_welcome',
  'letter_q_wolves',
  'letter_q_greyjaw',
  'letter_q_hollow',
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

  const lettersById: Record<string, LetterDef> = { [WELCOME_LETTER.letterId]: WELCOME_LETTER };
  for (const letter of Object.values(QUEST_LETTERS)) lettersById[letter.letterId] = letter;
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
