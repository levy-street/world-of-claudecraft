import { DUNGEONS, MOBS, NPCS, QUESTS, ZONES } from '../sim/data';

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
  'training_dummy',
] as const;

const NPC_IDS = [
  'the_merchant', 'marshal_redbrook', 'trader_wilkes', 'apothecary_lin', 'brother_aldric',
  'smith_haldren', 'fisherman_brandt', 'foreman_odell', 'warden_fenwick', 'brother_aldric_fen',
  'provisioner_hale', 'herbalist_yara', 'scout_maren', 'captain_thessaly',
  'brother_aldric_highwatch', 'scout_maren_highwatch', 'quartermaster_bree', 'armorer_hode',
  'loremaster_caddis',
] as const;

const QUEST_IDS = [
  'q_wolves', 'q_greyjaw', 'q_boars', 'q_spiders', 'q_murlocs', 'q_mine', 'q_bones',
  'q_supplies', 'q_whispers', 'q_names_of_the_dead', 'q_silence_the_call', 'q_rite',
  'q_hollow', 'q_sexton', 'q_gravecallers_trail', 'q_bandits', 'q_ringleader',
  'q_fenbridge_muster', 'q_prowlers', 'q_prowler_pelts', 'q_fen_supplies', 'q_deepfen',
  'q_idols', 'q_deepfen_purge', 'q_widows', 'q_broodmother', 'q_drowned',
  'q_drowned_censers', 'q_no_rest', 'q_trolls', 'q_troll_fetishes', 'q_grubjaw',
  'q_cult_camp', 'q_summoners', 'q_deacon', 'q_bastion_door', 'q_olen', 'q_mistcaller',
  'q_highwatch_summons', 'q_stalkers', 'q_stalker_pelts', 'q_kobold_tunnels',
  'q_glowing_wax', 'q_ogre_edges', 'q_ogre_totems', 'q_ogre_bounty', 'q_crushers',
  'q_drogmar', 'q_elementals', 'q_shard_cores', 'q_kazzix', 'q_zealots', 'q_cult_orders',
  'q_necromancers', 'q_revenants', 'q_revenant_vanguard', 'q_wyrm_sigils',
  'q_breaking_the_seal', 'q_voice_below', 'q_sanctum_gate', 'q_korgath', 'q_velkhar',
  'q_gravewyrm',
] as const;

const ZONE_IDS = ['eastbrook_vale', 'mirefen_marsh', 'thornpeak_heights'] as const;
const DUNGEON_IDS = ['hollow_crypt', 'sunken_bastion', 'gravewyrm_sanctum'] as const;

const OBJECTIVE_ITEM_IDS = [
  'greyjaw_fang', 'boar_hide', 'webwood_silk', 'supply_crate', 'gravecaller_sigil',
  'weathered_ledger_page', 'blessed_wax', 'ghostly_essence', 'morthen_grimoire',
  'fen_muster_order', 'mire_prowler_pelt', 'lost_caravan_goods', 'waterlogged_idol',
  'widow_venom_sac', 'rusted_censer', 'troll_fetish', 'grubjaw_tusk', 'cult_cipher',
  'bastion_ward_stone', 'highwatch_summons', 'ridge_stalker_pelt', 'glowing_wax',
  'ogre_war_totem', 'storm_core', 'kazzix_heartshard', 'wyrmcult_orders',
  'ritual_phylactery', 'gravewyrm_sigil', 'blessed_embers', 'sanctum_key_shard',
] as const;

type MobId = typeof MOB_IDS[number];
type NpcId = typeof NPC_IDS[number];
type QuestId = typeof QUEST_IDS[number];
type ZoneId = typeof ZONE_IDS[number];
type DungeonId = typeof DUNGEON_IDS[number];
type ObjectiveItemId = typeof OBJECTIVE_ITEM_IDS[number];

type MobTranslations = Record<MobId, { name: string }>;
type NpcTranslations = Record<NpcId, { name: string; title: string; greeting: string }>;
type QuestTranslation = { title: string; text: string; completion: string; objectives: Record<number, { label: string }> };
type QuestTranslations = Record<QuestId, QuestTranslation>;
type QuestNarrativeTranslations = Record<QuestId, readonly [text: string, completion: string]>;
type ZoneTranslations = Record<ZoneId, { name: string; welcome: string; pois: Record<number, { label: string }> }>;
type DungeonTranslations = Record<DungeonId, { name: string; enterText: string; leaveText: string }>;
type ObjectiveItemTranslations = Record<ObjectiveItemId, string>;

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

type ObjectiveSpec =
  | { kind: 'kill'; mobId: MobId; mode?: 'slain' | 'rest' | 'silenced' }
  | { kind: 'collect'; itemId: ObjectiveItemId };

type LocaleText = {
  corpseName: string;
  dungeonExitName: string;
  dungeonPartyWarning: string;
  dungeonInstanceBusy: string;
  kill(mob: string): string;
  rest(mob: string): string;
  silenced(mob: string): string;
  list(items: readonly string[]): string;
};

type LocaleData = {
  mobs: readonly string[];
  npcRows: readonly (readonly [string, string, string])[];
  questTitles: readonly string[];
  objectiveItems: readonly string[];
  zones: readonly (readonly [string, string, readonly string[]])[];
  dungeons: readonly (readonly [string, string, string])[];
};

const OBJECTIVE_SPECS: readonly (readonly ObjectiveSpec[])[] = [
  [{ kind: 'kill', mobId: 'forest_wolf' }],
  [{ kind: 'collect', itemId: 'greyjaw_fang' }],
  [{ kind: 'collect', itemId: 'boar_hide' }],
  [{ kind: 'kill', mobId: 'webwood_spider' }, { kind: 'collect', itemId: 'webwood_silk' }],
  [{ kind: 'kill', mobId: 'mudfin_murloc' }],
  [{ kind: 'kill', mobId: 'tunnel_rat' }],
  [{ kind: 'kill', mobId: 'restless_bones', mode: 'rest' }],
  [{ kind: 'collect', itemId: 'supply_crate' }],
  [{ kind: 'collect', itemId: 'gravecaller_sigil' }],
  [{ kind: 'collect', itemId: 'weathered_ledger_page' }],
  [{ kind: 'kill', mobId: 'restless_bones', mode: 'silenced' }],
  [{ kind: 'collect', itemId: 'blessed_wax' }, { kind: 'collect', itemId: 'ghostly_essence' }],
  [{ kind: 'kill', mobId: 'morthen' }],
  [{ kind: 'kill', mobId: 'sexton_marrow', mode: 'rest' }],
  [{ kind: 'collect', itemId: 'morthen_grimoire' }],
  [{ kind: 'kill', mobId: 'vale_bandit' }],
  [{ kind: 'kill', mobId: 'gorrak' }],
  [{ kind: 'collect', itemId: 'fen_muster_order' }],
  [{ kind: 'kill', mobId: 'mire_prowler' }],
  [{ kind: 'collect', itemId: 'mire_prowler_pelt' }],
  [{ kind: 'collect', itemId: 'lost_caravan_goods' }],
  [{ kind: 'kill', mobId: 'deepfen_murloc' }],
  [{ kind: 'collect', itemId: 'waterlogged_idol' }],
  [{ kind: 'kill', mobId: 'deepfen_murloc' }],
  [{ kind: 'kill', mobId: 'mire_widow' }, { kind: 'collect', itemId: 'widow_venom_sac' }],
  [{ kind: 'kill', mobId: 'mire_widow' }, { kind: 'kill', mobId: 'mirefen_broodmother' }],
  [{ kind: 'kill', mobId: 'drowned_dead', mode: 'rest' }],
  [{ kind: 'collect', itemId: 'rusted_censer' }],
  [{ kind: 'kill', mobId: 'drowned_dead', mode: 'rest' }],
  [{ kind: 'kill', mobId: 'fen_troll' }],
  [{ kind: 'collect', itemId: 'troll_fetish' }],
  [{ kind: 'collect', itemId: 'grubjaw_tusk' }],
  [{ kind: 'kill', mobId: 'gravecaller_cultist' }],
  [{ kind: 'kill', mobId: 'gravecaller_summoner' }, { kind: 'collect', itemId: 'cult_cipher' }],
  [{ kind: 'kill', mobId: 'deacon_voss' }],
  [{ kind: 'collect', itemId: 'bastion_ward_stone' }],
  [{ kind: 'kill', mobId: 'knight_commander_olen', mode: 'rest' }],
  [{ kind: 'kill', mobId: 'vael_the_mistcaller' }],
  [{ kind: 'collect', itemId: 'highwatch_summons' }],
  [{ kind: 'kill', mobId: 'ridge_stalker' }],
  [{ kind: 'collect', itemId: 'ridge_stalker_pelt' }],
  [{ kind: 'kill', mobId: 'deeprock_kobold' }],
  [{ kind: 'collect', itemId: 'glowing_wax' }],
  [{ kind: 'kill', mobId: 'thornpeak_ogre' }],
  [{ kind: 'collect', itemId: 'ogre_war_totem' }],
  [{ kind: 'kill', mobId: 'thornpeak_ogre' }],
  [{ kind: 'kill', mobId: 'ogre_crusher' }],
  [{ kind: 'kill', mobId: 'warlord_drogmar' }],
  [{ kind: 'kill', mobId: 'stormcrag_elemental' }],
  [{ kind: 'collect', itemId: 'storm_core' }],
  [{ kind: 'collect', itemId: 'kazzix_heartshard' }],
  [{ kind: 'kill', mobId: 'wyrmcult_zealot' }],
  [{ kind: 'kill', mobId: 'wyrmcult_zealot' }, { kind: 'collect', itemId: 'wyrmcult_orders' }],
  [{ kind: 'kill', mobId: 'wyrmcult_necromancer' }, { kind: 'collect', itemId: 'ritual_phylactery' }],
  [{ kind: 'kill', mobId: 'boneclad_revenant' }],
  [{ kind: 'kill', mobId: 'boneclad_revenant' }],
  [{ kind: 'collect', itemId: 'gravewyrm_sigil' }],
  [{ kind: 'collect', itemId: 'blessed_embers' }],
  [{ kind: 'kill', mobId: 'wyrmcult_zealot' }, { kind: 'kill', mobId: 'wyrmcult_necromancer' }],
  [{ kind: 'collect', itemId: 'sanctum_key_shard' }],
  [{ kind: 'kill', mobId: 'korgath_the_bound' }],
  [{ kind: 'kill', mobId: 'grand_necromancer_velkhar' }],
  [{ kind: 'kill', mobId: 'korzul_the_gravewyrm' }],
];

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

function stringsToRecord<TId extends string>(ids: readonly TId[], values: readonly string[], label: string): Record<TId, string> {
  if (values.length !== ids.length) {
    throw new Error(`${label} count mismatch: expected ${ids.length}, got ${values.length}`);
  }
  const record = {} as Record<TId, string>;
  ids.forEach((id, index) => {
    const value = values[index];
    if (!value) throw new Error(`Missing ${label} translation for ${id}`);
    record[id] = value;
  });
  return record;
}

function makeMobTranslations(values: readonly string[]): MobTranslations {
  const names = stringsToRecord(MOB_IDS, values, 'mob');
  const mobs = {} as MobTranslations;
  MOB_IDS.forEach((id) => { mobs[id] = { name: names[id] }; });
  return mobs;
}

function makeNpcTranslations(rows: readonly (readonly [string, string, string])[]): NpcTranslations {
  if (rows.length !== NPC_IDS.length) throw new Error(`NPC translation count mismatch: expected ${NPC_IDS.length}, got ${rows.length}`);
  const npcs = {} as NpcTranslations;
  NPC_IDS.forEach((id, index) => {
    const [name, title, greeting] = rows[index];
    if (!name || !title || !greeting) throw new Error(`Missing NPC translation for ${id}`);
    npcs[id] = { name, title, greeting };
  });
  return npcs;
}

function makeObjectiveItems(values: readonly string[]): ObjectiveItemTranslations {
  return stringsToRecord(OBJECTIVE_ITEM_IDS, values, 'quest objective item');
}

function objectiveLabel(spec: ObjectiveSpec, mobs: MobTranslations, items: ObjectiveItemTranslations, text: LocaleText): string {
  if (spec.kind === 'collect') return items[spec.itemId];
  const mobName = mobs[spec.mobId].name;
  if (spec.mode === 'rest') return text.rest(mobName);
  if (spec.mode === 'silenced') return text.silenced(mobName);
  return text.kill(mobName);
}

function makeQuestTranslations(
  titles: readonly string[],
  narratives: QuestNarrativeTranslations,
  mobs: MobTranslations,
  itemNames: ObjectiveItemTranslations,
  text: LocaleText,
): QuestTranslations {
  if (titles.length !== QUEST_IDS.length) throw new Error(`Quest title count mismatch: expected ${QUEST_IDS.length}, got ${titles.length}`);
  if (OBJECTIVE_SPECS.length !== QUEST_IDS.length) throw new Error('Quest objective spec count mismatch');
  const quests = {} as QuestTranslations;
  QUEST_IDS.forEach((id, index) => {
    const title = titles[index];
    const narrative = narratives[id];
    const [questText, completion] = narrative ?? [];
    if (!questText || !completion) throw new Error(`Missing quest narrative translation for ${id}`);
    const objectives = OBJECTIVE_SPECS[index].map((spec) => objectiveLabel(spec, mobs, itemNames, text));
    const objectiveRecord = {} as Record<number, { label: string }>;
    objectives.forEach((label, objectiveIndex) => { objectiveRecord[objectiveIndex] = { label }; });
    quests[id] = {
      title,
      text: questText,
      completion,
      objectives: objectiveRecord,
    };
  });
  return quests;
}

function makeZoneTranslations(rows: readonly (readonly [string, string, readonly string[]])[]): ZoneTranslations {
  if (rows.length !== ZONE_IDS.length) throw new Error(`Zone translation count mismatch: expected ${ZONE_IDS.length}, got ${rows.length}`);
  const zones = {} as ZoneTranslations;
  ZONE_IDS.forEach((id, index) => {
    const [name, welcome, pois] = rows[index];
    const sourcePois = ZONES[index].pois;
    if (pois.length !== sourcePois.length) {
      throw new Error(`POI translation count mismatch for ${id}: expected ${sourcePois.length}, got ${pois.length}`);
    }
    const poiRecord = {} as Record<number, { label: string }>;
    pois.forEach((label, poiIndex) => { poiRecord[poiIndex] = { label }; });
    zones[id] = { name, welcome, pois: poiRecord };
  });
  return zones;
}

function makeDungeonTranslations(rows: readonly (readonly [string, string, string])[]): DungeonTranslations {
  if (rows.length !== DUNGEON_IDS.length) throw new Error(`Dungeon translation count mismatch: expected ${DUNGEON_IDS.length}, got ${rows.length}`);
  const dungeons = {} as DungeonTranslations;
  DUNGEON_IDS.forEach((id, index) => {
    const [name, enterText, leaveText] = rows[index];
    dungeons[id] = { name, enterText, leaveText };
  });
  return dungeons;
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

function makeLocaleWorldEntities(data: LocaleData, text: LocaleText, narratives: QuestNarrativeTranslations): WorldEntityTranslations {
  const mobs = makeMobTranslations(data.mobs);
  const npcs = makeNpcTranslations(data.npcRows);
  const objectiveItems = makeObjectiveItems(data.objectiveItems);
  return {
    worldContent: {
      corpseName: text.corpseName,
      dungeonExitName: text.dungeonExitName,
      dungeonPartyWarning: text.dungeonPartyWarning,
      dungeonInstanceBusy: text.dungeonInstanceBusy,
    },
    entities: {
      mobs,
      npcs,
      quests: makeQuestTranslations(data.questTitles, narratives, mobs, objectiveItems, text),
      zones: makeZoneTranslations(data.zones),
      dungeons: makeDungeonTranslations(data.dungeons),
    },
  };
}

const esText: LocaleText = {
  corpseName: '{name} (cadáver)',
  dungeonExitName: 'Salida de {name}',
  dungeonPartyWarning: '{name} está pensado para un grupo completo de {count}. Avanza con cuidado.',
  dungeonInstanceBusy: 'Todas las instancias de {name} están ocupadas. Inténtalo de nuevo pronto.',
  kill: (mob) => `${mob} abatido`,
  rest: (mob) => `${mob} devuelto al descanso`,
  silenced: (mob) => `${mob} silenciado`,
  list: (items) => items.join(', '),
};

const frText: LocaleText = {
  corpseName: '{name} (cadavre)',
  dungeonExitName: 'Sortie de {name}',
  dungeonPartyWarning: '{name} est prévu pour un groupe complet de {count}. Avancez prudemment.',
  dungeonInstanceBusy: 'Toutes les instances de {name} sont occupées. Réessayez bientôt.',
  kill: (mob) => `${mob} tué`,
  rest: (mob) => `${mob} rendu au repos`,
  silenced: (mob) => `${mob} réduit au silence`,
  list: (items) => items.join(', '),
};

const itText: LocaleText = {
  corpseName: '{name} (cadavere)',
  dungeonExitName: 'Uscita da {name}',
  dungeonPartyWarning: '{name} è pensato per un gruppo completo di {count}. Procedi con cautela.',
  dungeonInstanceBusy: 'Tutte le istanze di {name} sono occupate. Riprova tra poco.',
  kill: (mob) => `${mob} ucciso`,
  rest: (mob) => `${mob} restituito al riposo`,
  silenced: (mob) => `${mob} messo a tacere`,
  list: (items) => items.join(', '),
};

const deText: LocaleText = {
  corpseName: '{name} (Leichnam)',
  dungeonExitName: 'Ausgang von {name}',
  dungeonPartyWarning: '{name} ist für eine vollständige Gruppe von {count} gedacht. Geh vorsichtig vor.',
  dungeonInstanceBusy: 'Alle Instanzen von {name} sind belegt. Versuch es bald erneut.',
  kill: (mob) => `${mob} getötet`,
  rest: (mob) => `${mob} zur Ruhe gelegt`,
  silenced: (mob) => `${mob} zum Schweigen gebracht`,
  list: (items) => items.join(', '),
};

const zhCnText: LocaleText = {
  corpseName: '{name}（尸体）',
  dungeonExitName: '{name}出口',
  dungeonPartyWarning: '{name}适合{count}人完整队伍挑战。请谨慎前进。',
  dungeonInstanceBusy: '{name}的所有副本都已被占用。请稍后再试。',
  kill: (mob) => `击败${mob}`,
  rest: (mob) => `让${mob}安息`,
  silenced: (mob) => `使${mob}沉寂`,
  list: (items) => items.join('、'),
};

const zhTwText: LocaleText = {
  corpseName: '{name}（屍體）',
  dungeonExitName: '{name}出口',
  dungeonPartyWarning: '{name}適合{count}人完整隊伍挑戰。請謹慎前進。',
  dungeonInstanceBusy: '{name}的所有副本都已被佔用。請稍後再試。',
  kill: (mob) => `擊敗${mob}`,
  rest: (mob) => `讓${mob}安息`,
  silenced: (mob) => `使${mob}沉寂`,
  list: (items) => items.join('、'),
};

const koText: LocaleText = {
  corpseName: '{name} (시체)',
  dungeonExitName: '{name} 출구',
  dungeonPartyWarning: '{name}은 {count}명의 완전한 파티를 위해 마련된 곳입니다. 조심해서 나아가십시오.',
  dungeonInstanceBusy: '{name}의 모든 인스턴스가 사용 중입니다. 잠시 후 다시 시도하십시오.',
  kill: (mob) => `${mob} 처치`,
  rest: (mob) => `${mob} 안식시킴`,
  silenced: (mob) => `${mob} 침묵시킴`,
  list: (items) => items.join(', '),
};

const jaText: LocaleText = {
  corpseName: '{name}（死体）',
  dungeonExitName: '{name}の出口',
  dungeonPartyWarning: '{name}は{count}人のフルパーティ向けです。慎重に進んでください。',
  dungeonInstanceBusy: '{name}のインスタンスはすべて使用中です。少し待ってから再試行してください。',
  kill: (mob) => `${mob}を討伐`,
  rest: (mob) => `${mob}を安息させる`,
  silenced: (mob) => `${mob}を沈黙させる`,
  list: (items) => items.join('、'),
};

const ptText: LocaleText = {
  corpseName: '{name} (cadáver)',
  dungeonExitName: 'Saída de {name}',
  dungeonPartyWarning: '{name} foi feito para um grupo completo de {count}. Avance com cuidado.',
  dungeonInstanceBusy: 'Todas as instâncias de {name} estão ocupadas. Tente novamente em breve.',
  kill: (mob) => `${mob} abatido`,
  rest: (mob) => `${mob} devolvido ao descanso`,
  silenced: (mob) => `${mob} silenciado`,
  list: (items) => items.join(', '),
};

const ruText: LocaleText = {
  corpseName: '{name} (труп)',
  dungeonExitName: 'Выход из {name}',
  dungeonPartyWarning: '{name} рассчитано на полную группу из {count} игроков. Продвигайтесь осторожно.',
  dungeonInstanceBusy: 'Все копии {name} заняты. Попробуйте еще раз чуть позже.',
  kill: (mob) => `${mob}: убито`,
  rest: (mob) => `${mob}: упокоено`,
  silenced: (mob) => `${mob}: усмирено`,
  list: (items) => items.join(', '),
};

const esQuestNarratives = {
  q_wolves: [`Los lobos del bosque se atreven ya con el camino norte, {playerName}. Abate 8 antes de que otra carreta desaparezca entre los pinos.`, `Buen trabajo. El camino ya parece menos hambriento.`],
  q_greyjaw: [`Hay un lobo que jamás cayó en trampa alguna: el viejo Greyjaw. Acecha al norte de la senda de los lobos; tráeme su colmillo.`, `Por fin murió ese viejo demonio. El muchacho de los establos dormirá mejor, y yo también.`],
  q_boars: [`La piel de jabalí hace buenas alforjas, y las praderas están llenas de animales. Tráeme 5 pieles de jabalí erizadas.`, `Magníficas pieles erizadas. Sacaré buen precio por ellas.`],
  q_spiders: [`Los acechadores de Webwood tienen la seda que necesito, pero han criado demasiado. Mata 6 y corta 4 glándulas de seda.`, `Aún se mueven. Perfecto. Te ganaste esto.`],
  q_murlocs: [`Pescaba el lago Espejo hasta que esos hombres pez salieron de los bajíos. Expulsa a 8 Aletabarro y cuida tu espalda.`, `¡Ja! Eso les enseñará a quedarse en sus propios charcos.`],
  q_mine: [`Abrimos una veta de cobre y los kobolds brotaron de la colina. Derriba 10 excavadores Rata de Túnel para que mi cuadrilla vuelva.`, `¡A trabajar, muchachos! Tienes mi gratitud y mi paga.`],
  q_bones: [`La vieja capilla fue un lugar de descanso, hasta que algo despertó a sus muertos. Devuelve 8 huesos inquietos a la tierra, {playerName}.`, `Que descansen ahora, y que la Luz perdone a quien los despertó.`],
  q_supplies: [`Los bandidos robaron mi último carro: herramientas, sal y lino de Eastbrook. Recupera 4 cajas de su campamento de las colinas del sudeste.`, `¡Mis cajas! Apenas tienen un rasguño. Eres una maravilla.`],
  q_whispers: [`Los muertos vuelven a levantarse porque algo los llama. Busca en la capilla una señal de quien susurra y tráela intacta.`, `Este sigilo lleva la marca de los Gravecallers. Temía que esa secta siguiera muerta, {playerName}.`],
  q_names_of_the_dead: [`Si los Gravecallers profanaron nuestras tumbas, necesito saber a quiénes robaron. Reúne 3 páginas del registro de entierros, {playerName}.`, `Pobres almas... y mira esto: el sacristán Marrow fue el primero. Morthen empezó con quien enterraba a Eastbrook.`],
  q_silence_the_call: [`Cada nombre del registro es un alma que Morthen quiere arrancar de la tierra. Silencia 12 huesos inquietos, {playerName}, antes de que el susurro sea coro.`, `El patio está más quieto, pero la llamada sube ahora desde la cripta, {playerName}.`],
  q_rite: [`Debemos abrir la cripta, pero solo un rito de vínculo dejará pasar a los vivos. Necesito 4 sebos benditos y 6 esencias fantasmales.`, `Está hecho. El camino de abajo se abre... reúne a tus compañeros más fuertes, {playerName}.`],
  q_hollow: [`Morthen te espera en el fondo de la Cripta Hueca, rodeado de muertos de élite. Lleva cuatro compañeros y acaba con él.`, `El susurro cesó. Los muertos duermen, {playerName}, y Eastbrook te debe cuanto tiene.`],
  q_sexton: [`El registro nombra al sacristán Marrow, primer guardián alzado por Morthen. Entra con cuatro compañeros y dale el descanso robado, {playerName}.`, `Marrow es libre al fin. No doblen campanas por él; oyó bastantes en vida.`],
  q_gravecallers_trail: [`Morthen murió, pero su secta no gastaría un siglo de silencio en una sola capilla. Busca su grimorio entre las ruinas, {playerName}.`, `Morthen escribía a un "Mistcaller" en la ciénaga norte. La secta no está muerta, {playerName}; solo esperó.`],
  q_bandits: [`Una banda de degolladores acampa en las colinas del sudoeste. Han robado tres carros esta semana. Abate 10 bandidos del Valle.`, `Diez cuchillos menos en la oscuridad. Toma esto, te lo ganaste.`],
  q_ringleader: [`Los bandidos obedecen a Gorrak el Despiadado. Corta la cabeza y el cuerpo se dispersará. Acaba con él, {playerName}.`, `¿Gorrak muerto? Entonces el Valle queda libre de su sombra.`],
  q_fenbridge_muster: [`Los escritos de Morthen nombran a un maestro en la ciénaga norte, {playerName}. Toma la orden de reunión en la puerta de Fenbridge y llévala al guardián.`, `¿El sello de Aldric? Servirás. La ciénaga se traga mis patrullas enteras.`],
  q_prowlers: [`Los merodeadores han aprendido el sonido de las mulas de carga. Mata 12 en torno a la calzada, {playerName}.`, `Doce, y ni una mordida en ti. Esta noche la calzada respira mejor.`],
  q_prowler_pelts: [`La calzada se sostiene con piel de merodeador aceitada, y mis reservas se acabaron. Tráeme 8 pieles intactas, {playerName}, antes de vadear hasta Eastbrook.`, `Buenas pieles gruesas. Ahora la calzada nos sobrevivirá a ambos.`],
  q_fen_supplies: [`Una caravana salió de Eastbrook y la niebla se la tragó. Rescata 5 cargas antes de que la ciénaga termine de hundirlas.`, `Empapadas, pero enteras. La ciénaga conserva lo que atrapa, {playerName}.`],
  q_deepfen: [`Los murlocs de Deepfen arrastran cosas del lecho del lago. Sacrifica 12 chasqueadores y averiguaremos qué los agita.`, `Eso los empujará de vuelta al barro un tiempo. Pero algo los puso a cavar.`],
  q_idols: [`Los hombres pez abrazan ídolos sacados del fondo como reliquias. Quítales 5, aunque no los entregarán de buena gana.`, `Obra de los Gravecallers, más antigua que Morthen. La secta empezó aquí, {playerName}.`],
  q_deepfen_purge: [`Esos ídolos son obra del culto, y los murlocs sacan el mal viejo de la ciénaga a brazadas. Mata 14 más.`, `Implacable y minucioso. Si esta ciénaga se seca, te espera trabajo de guardián.`],
  q_widows: [`El veneno de viuda limpia la podredumbre de las heridas, pero el matorral se ha vuelto horror. Mata 10 viudas y corta 6 sacos enteros.`, `Todos los sacos intactos. Tienes manos más firmes que medio sur, {playerName}.`],
  q_broodmother: [`Si las redes son tan gruesas, imagina qué las teje. Quema paso entre 8 viudas y mata a la vieja madre antes de que eclosione su puesta.`, `¿Muerta de verdad? Entonces el matorral vuelve a ser solo árboles. Que la Luz bendiga tu hoja, {playerName}.`],
  q_drowned: [`Los viajeros ahogados salen de los lagos cubiertos de algas. Libera 12 muertos ahogados, {playerName}.`, `Cada uno que derribas es un alma robada que vuelve a ser libre.`],
  q_drowned_censers: [`La capilla del norte se hundió con su congregación, y sus muertos llevan incensarios de rito funerario. Reúne 4 del patio.`, `Tal como temía: quemaban ceniza de tumba, y el rito está firmado por Voss.`],
  q_no_rest: [`Ese rito hace levantarse a los ahogados donde la ciénaga los toca. No podemos deshacerlo aún; deja 14 muertos menos a sus amos.`, `Das más misericordia a los muertos que sus señores. Toma esto, lo mereces.`],
  q_trolls: [`Los trolls de Mirefen abrieron túmulos más viejos que cualquier reino humano, {playerName}. Expúlsalos: 12 trolls muertos bastarán.`, `Los trolls no cavan sin motivo. Alguien de túnica gris les dijo dónde.`],
  q_troll_fetishes: [`Esos fetiches no son obra trol: nudos falsos, huesos humanos y todos apuntan a los túmulos. Tráeme 8.`, `Mismo artesano que en los estandartes del culto. Los trolls solo son palas alquiladas, {playerName}.`],
  q_grubjaw: [`Grubjaw no cava con los demás; se comió mis dos últimas mulas, arneses incluidos. Tráeme su colmillo, {playerName}.`, `¡Ese colmillo me llega al antebrazo! Las mulas están vengadas.`],
  q_cult_camp: [`Al norte, donde la niebla no levanta, los Gravecallers acampan como si ya poseyeran la ciénaga. Derriba 12 cultistas, {playerName}.`, `Doce túnicas boca abajo en el barro. Ahora saben que la ciénaga mira de vuelta.`],
  q_summoners: [`Los invocadores llaman a los ahogados como perros a un silbato. Silencia 8 y tráeme 4 cifras.`, `Cada cifra está refrendada por el diácono Voss y enviada al Mistcaller. El maestro de Morthen, {playerName}. Lo hemos encontrado.`],
  q_deacon: [`Voss canta a mis guardianes ahogados para que le sirvan. Toma el camino del campamento y entiérralo bien hondo, {playerName}.`, `Voss ha muerto y la niebla ya se adelgaza. Solo queda el Bastión.`],
  q_bastion_door: [`El Bastión Sumergido guarda al Mistcaller, y su puerta está sellada con piedras de tumba. Tráeme una piedra guardiana, {playerName}.`, `El sello cede como cuerda podrida. La puerta se abre, y la oscuridad escucha.`],
  q_olen: [`Olen murió defendiendo el Bastión y ahora vigila su puerta como marioneta. Esa vergüenza acaba aquí, {playerName}. Baja con cuatro compañeros y dale el descanso que ganó.`, `Su guardia terminó por fin. Yo mismo grabaré su nombre en la puerta. Gracias, {playerName}.`],
  q_mistcaller: [`Vael espera en el fondo del Bastión, voz que ahogó a cien viajeros. Lleva cuatro compañeros y acaba con él, {playerName}.`, `Vael murió y la niebla se levanta, pero sus últimas palabras hielan: el Wyrm se agita bajo los picos. Descansa mientras puedas, {playerName}.`],
  q_highwatch_summons: [`Las últimas palabras de Vael no me dejan, {playerName}. Toma la citación de Highwatch y dile a Thessaly que Aldric sube tras de ti.`, `Si Aldric sube en persona, esto es tan grave como temía. Bienvenido a Highwatch, {playerName}.`],
  q_stalkers: [`Los felinos de la cresta bajan hambrientos de la nieve y sangran mis patrullas. Abate 12, {playerName}.`, `Doce sombras menos en la cresta. Las patrullas respirarán esta noche.`],
  q_stalker_pelts: [`El invierno de esta montaña derriba puertas, {playerName}. Ocho pieles de acechador forrarán capas para la muralla.`, `Gruesas como mi brazo. La guardia no se congelará este año.`],
  q_kobold_tunnels: [`Los kobolds de Deeprock cavan recto hacia abajo, como si algo los llamara bajo la muralla, {playerName}. Mata 12 tuneladores.`, `Cada galería baja en línea recta. Los kobolds no cavan así por voluntad propia.`],
  q_glowing_wax: [`La cera de esos tuneladores brilla, {playerName}, y está cálida como un latido. Trae 6 trozos para que Caddis la estudie.`, `Sigue tibia. El brillo no coincide con ninguna llama que conozca el maestro.`],
  q_ogre_edges: [`Los clanes de Thornpeak acampan demasiado al este con pintura de guerra. Alguien los paga. Abate 12, {playerName}.`, `Doce caídos, y no retroceden. Quien los compró pagó con algo más pesado que oro.`],
  q_ogre_totems: [`Los ogros levantaron tótems de cuero y cráneo: señales de reunión, no de incursión. Derriba 6 y tráemelos. Cuidado con los trituradores del perímetro, {playerName}.`, `Calavera, cuero... y ligaduras de escama de wyrm. Son regalos del culto, {playerName}.`],
  q_ogre_bounty: [`Los clanes están comprados y mi muralla es su primer encargo. Mata 14 ogros más, {playerName}, con recompensa por cada uno.`, `Recompensa pagada entera. Las colinas callan un poco más.`],
  q_crushers: [`Los trituradores son la columna del campamento de Drogmar, cada uno vale por tres soldados míos. Rompe 10 con ayuda.`, `Diez trituradores menos. El campamento quedó sin espina dorsal.`],
  q_drogmar: [`Drogmar tomó la moneda del Wyrmcult y juró los clanes al despertar de la montaña. Entra en su campamento y mátalo, {playerName}, por Highwatch.`, `Drogmar yace muerto en su propio campamento. Compraste un invierno para mi muralla, {playerName}.`],
  q_elementals: [`Stormcrag calló mil años y ahora sus piedras caminan. Los elementales no despiertan sin más, {playerName}. Derriba 12 elementales para estudiar lo que quede.`, `Los fragmentos zumban como campanas. La montaña no está furiosa, {playerName}... la están perturbando.`],
  q_shard_cores: [`Cada elemental lleva un núcleo de tormenta. Seis juntos me dirán dónde nace la perturbación, {playerName}, aunque temo saberlo.`, `Todos apuntan al sur como limaduras hacia un imán. Al Santuario, {playerName}.`],
  q_kazzix: [`Kazzix arde más que los demás, una tormenta con hombros. Arráncale el fragmento de corazón en los riscos lejanos.`, `¡El fragmento aún crepita! Magnífico. Toma estas grebas por la molestia.`],
  q_zealots: [`El viento trae cánticos desde los picos del sur. Silencia 12 fanáticos, {playerName}; cada voz callada compra otra noche de sueño.`, `El viento está más callado. Lo que me inquieta, {playerName}, es que algo quizá responda al canto.`],
  q_cult_orders: [`Los fanáticos se mueven como soldados antes de un asedio, {playerName}. Mata 8 más y tráeme 4 órdenes escritas.`, `Esta letra viene del grimorio de Morthen. La misma mano guio cada tumba, {playerName}.`],
  q_necromancers: [`Las órdenes hablan de un anillo de filacterias, vasos de alma, {playerName}, alrededor del Santuario. Mata 8 nigromantes y trae 3 intactas.`, `Que la Luz nos perdone. Guardan los muertos del Valle y la ciénaga; nunca formaban un ejército, {playerName}. Eran un diezmo.`],
  q_revenants: [`Al este del camino yace un viejo campo de batalla. El culto levantó sus huesos con armaduras oxidadas. Devuelve 12 al suelo, {playerName}.`, `Fueron soldados como los míos. Quien los llamó no respeta a los muertos.`],
  q_revenant_vanguard: [`Los aparecidos forman filas verdaderas, {playerName}. Rompe 14 más antes de que marchen al Santuario.`, `Los campos vuelven a callar. Toma esto; nadie lo ha ganado más.`],
  q_wyrm_sigils: [`Es hora de que sepas toda la verdad, {playerName}. Los Gravecallers sirven a Korzul el Gravewyrm, y cada alma robada alimenta su despertar. Tráeme 3 sigilos del acceso al Santuario.`, `Sí... una letanía de despertar escrita durante generaciones. Están cerca, {playerName}.`],
  q_breaking_the_seal: [`El sello del Santuario se forjó con fuego de montaña. Trae 5 brasas benditas de los elementales, {playerName}, para abrirlo sin romperlo.`, `Arden azules y limpias. La montaña recuerda su antiguo juramento.`],
  q_voice_below: [`Anoche el campamento entero se arrodilló mirando al Santuario, {playerName}. Mata 10 fanáticos y 6 nigromantes antes de que esa voz tenga manos suficientes.`, `La genuflexión cesó. No silenciamos la voz, {playerName}; solo redujimos su coro.`],
  q_sanctum_gate: [`Este es el último umbral, {playerName}. La llave del Santuario fue rota en fragmentos bajo la mirada de los muertos acorazados. Tráeme 3 y abriré el camino en silencio.`, `Los fragmentos encajan y la puerta reconoce su llave. Reúne a los más fuertes, {playerName}.`],
  q_korgath: [`Maren halló cadenas gruesas como mástiles, {playerName}, y algo con forma de ogro tirando de ellas. Lleva cuatro compañeros y derriba a Korgath.`, `Korgath está roto al fin. Hasta sus cadenas merecían un final más amable.`],
  q_velkhar: [`Velkhar, primer Gravecaller, tejió cada hilo y vierte almas robadas en el Wyrm. Acaba con él, {playerName}.`, `Velkhar ha muerto y el rito perdió la cabeza, pero el Wyrm ya no duerme.`],
  q_gravewyrm: [`Ya no queda rito que detener, {playerName}, solo el Wyrm medio despierto. Entra con tus compañeros y termina lo empezado en la capilla.`, `Ha terminado. Los muertos de tres tierras descansan, y cada campana canta tu nombre, {playerName}.`],
} satisfies QuestNarrativeTranslations;

const frQuestNarratives = {
  q_wolves: [`Les loups des bois s'enhardissent sur la route du nord, {playerName}. Tuez-en 8 pour qu'Eastbrook respire un peu mieux.`, `Beau travail. La route paraît déjà plus sûre.`],
  q_greyjaw: [`Un loup n'a jamais été pris au piège: le vieux Greyjaw. Il rôde au nord des pistes de loups; rapportez-moi son croc.`, `Le vieux démon est enfin mort. Le garçon d'écurie dormira mieux, et moi aussi.`],
  q_boars: [`La peau de sanglier fait d'excellents sacs de voyage, et les prés en sont pleins. Rapportez-moi 5 peaux hérissées.`, `Ah, de belles peaux hérissées. Elles se vendront très bien.`],
  q_spiders: [`Les rôdeurs de Webwood filent la soie dont j'ai besoin, mais ils pullulent. Tuez-en 6 et prélevez 4 glandes de soie.`, `Beurk, elles bougent encore. Parfait. Vous avez mérité ceci.`],
  q_murlocs: [`Je pêchais le lac Miroir avant que ces hommes-poissons sortent des hauts-fonds. Repoussez 8 Aileron-de-boue et restez sur vos gardes.`, `Ha! Voilà qui leur apprendra à garder leurs bourbiers.`],
  q_mine: [`Nous avons trouvé un beau filon de cuivre, puis les kobolds ont jailli de la colline. Abattez 10 terrassiers rats des tunnels.`, `Ha! Au travail, les gars! Vous avez mes remerciements et ma paie.`],
  q_bones: [`La vieille chapelle était un lieu de repos avant que quelque chose réveille ses morts. Rendez 8 ossements agités à la terre, {playerName}.`, `Puissent-ils reposer, et puisse la Lumière pardonner à ce qui les a réveillés.`],
  q_supplies: [`Les bandits ont pris mon dernier chariot: outils, sel et bon lin d'Eastbrook. Reprenez 4 caisses dans leur camp du sud-est.`, `Mes caisses! À peine une égratignure. Vous êtes prodigieux.`],
  q_whispers: [`Les morts se relèvent parce que quelque chose les rappelle. Fouillez la chapelle et rapportez-moi tout sceau trouvé intact.`, `Ce sceau porte la marque des Gravecallers. Je priais pour que cette secte soit éteinte, {playerName}.`],
  q_names_of_the_dead: [`Si les Gravecallers ont pillé nos tombes, je dois savoir qui ils ont volé. Rassemblez 3 pages du registre funéraire, {playerName}.`, `Pauvres âmes... et voici le sacristain Marrow, le premier dérangé. Morthen a commencé par celui qui enterrait Eastbrook.`],
  q_silence_the_call: [`Chaque nom du registre est une âme que Morthen veut tirer de terre. Faites taire 12 ossements, {playerName}, avant que le murmure devienne choeur.`, `Le cimetière se calme, mais l'appel monte maintenant de la crypte, {playerName}.`],
  q_rite: [`La crypte doit être ouverte, mais seul un rite de lien laissera passer les vivants. Il me faut 4 suifs bénis et 6 essences spectrales.`, `C'est fait. Le passage s'ouvre... rassemblez vos compagnons les plus solides, {playerName}.`],
  q_hollow: [`Morthen attend au fond de la Crypte creuse, entouré des morts d'élite qu'il a relevés. Prenez quatre compagnons et mettez fin à tout cela.`, `Les murmures ont cessé. Les morts dorment, {playerName}, et Eastbrook vous doit tout.`],
  q_sexton: [`Le registre nomme le sacristain Marrow, premier serviteur relevé par Morthen. Descendez avec quatre compagnons et rendez-lui son repos, {playerName}.`, `Marrow est enfin libre. Ne sonnez pas pour lui; il a assez entendu de cloches.`],
  q_gravecallers_trail: [`Morthen est mort, mais sa secte n'aurait pas attendu un siècle pour une seule chapelle. Cherchez son grimoire dans les ruines, {playerName}.`, `Morthen écrivait à un Mistcaller dans le marais du nord. La secte n'est pas morte, {playerName}; elle a patienté.`],
  q_bandits: [`Une bande d'égorgeurs campe dans les collines du sud-ouest. Trois chariots ont été pillés cette semaine. Tuez 10 bandits du Val.`, `Dix lames de moins dans la nuit. Prenez ceci, vous l'avez gagné.`],
  q_ringleader: [`Les bandits obéissent à Gorrak l'Impitoyable. Coupez la tête et le corps se dispersera. Abattez-le, {playerName}.`, `Gorrak est mort? Alors le Val est libéré de son ombre.`],
  q_fenbridge_muster: [`Les écrits de Morthen nomment un maître dans le marais du nord. Prenez l'ordre de rassemblement à Fenbridge, {playerName}, et présentez-le au gardien.`, `Le sceau d'Aldric? Alors vous ferez l'affaire. Le marais avale mes patrouilles entières.`],
  q_prowlers: [`Les rôdeurs connaissent le bruit d'une mule de ravitaillement et chassent sur la chaussée. Tuez-en 12, {playerName}.`, `Douze, et pas une morsure sur vous. La chaussée respire mieux ce soir.`],
  q_prowler_pelts: [`La chaussée tient grâce à des peaux de rôdeur huilées, et mon stock est vide. Rapportez 8 peaux intactes, {playerName}, avant que nous pataugions jusqu'à Eastbrook.`, `De bonnes peaux épaisses. La chaussée nous survivra maintenant.`],
  q_fen_supplies: [`Une caravane d'Eastbrook a disparu dans la brume. Sauvez 5 cargaisons avant que le marais ne les achève.`, `Trempées, mais entières. Le marais garde ce qu'il prend, {playerName}.`],
  q_deepfen: [`Les murlocs de Deepfen draguent le fond du lac. Tuez 12 happeurs et nous verrons ce qui les agite.`, `Cela les repoussera un moment dans la boue. Mais quelque chose les a poussés à creuser.`],
  q_idols: [`Les hommes-poissons serrent des idoles remontées du fond comme des reliques. Prenez-en 5 aux happeurs.`, `Oeuvre de Gravecaller, plus ancienne que Morthen. La secte a commencé ici, {playerName}.`],
  q_deepfen_purge: [`Ces idoles viennent du culte, et les murlocs remontent le vieux mal du marais brassée après brassée. Tuez-en encore 14.`, `Impitoyable et méthodique. Si ce marais sèche un jour, il y aura du travail de gardien pour vous.`],
  q_widows: [`Le venin de veuve tire la pourriture des plaies, mais le fourré est devenu cauchemar. Tuez 10 veuves et prélevez 6 sacs intacts.`, `Chaque sac est intact. Vous avez la main plus sûre que la moitié des chirurgiens du sud, {playerName}.`],
  q_broodmother: [`Des toiles grosses comme des cordes ont forcément une mère. Brûlez la voie à travers 8 veuves et tuez l'ancienne avant l'éclosion.`, `Vraiment morte? Alors le fourré redevient seulement des arbres. Que la Lumière bénisse ta lame, {playerName}.`],
  q_drowned: [`Des voyageurs noyés sortent des lacs, couverts d'herbes. Libérez 12 morts noyés, {playerName}.`, `Chaque mort que vous abattez rend une âme volée à la liberté.`],
  q_drowned_censers: [`La chapelle du nord a sombré avec ses fidèles, et ses morts portent des encensoirs funéraires. Rapportez-en 4 du cimetière.`, `Comme je le craignais: ils brûlaient de la cendre de tombe, et le rite porte le nom de Voss.`],
  q_no_rest: [`Ce rite relève les noyés partout où le marais les touche. Nous ne pouvons le défaire encore; retirez 14 soldats à leurs maîtres.`, `Vous donnez aux morts plus de pitié que leurs maîtres. Prenez ceci, vous l'avez mérité.`],
  q_trolls: [`Les trolls de Mirefen ont ouvert des tertres plus vieux que les royaumes humains, {playerName}. Chassez-les: 12 trolls morts suffiront.`, `Les trolls ne creusent jamais sans raison. Quelqu'un en robe grise les a guidés.`],
  q_troll_fetishes: [`Ces fétiches ne sont pas trolls: mauvais noeuds, os humains, tous pointés vers les tertres. Rapportez-m'en 8.`, `Même main que sur les bannières du camp. Les trolls ne sont que des pelles louées, {playerName}.`],
  q_grubjaw: [`Grubjaw ne creuse pas avec les autres; il a mangé mes deux dernières mules, harnais compris. Il rôde sur les tertres de l'est, {playerName}. Rapportez-moi sa défense.`, `Cette défense est longue comme mon avant-bras! Les mules sont vengées.`],
  q_cult_camp: [`Au nord, là où la brume ne se lève jamais, les Gravecallers campent comme s'ils possédaient déjà le marais. Ils ne se cachent plus, {playerName}, c'est qu'ils se croient déjà vainqueurs. Tuez 12 cultistes.`, `Douze robes face contre boue. Ils savent maintenant que le marais les regarde aussi.`],
  q_summoners: [`Les invocateurs appellent les noyés comme des chiens au sifflet. Faites-en taire 8 et rapportez 4 chiffres.`, `Chaque chiffre porte le contreseing du diacre Voss et s'adresse au Mistcaller. Le maître de Morthen, {playerName}. Nous l'avons trouvé.`],
  q_deacon: [`Voss chante mes gardiens noyés pour les asservir. Prenez la route du camp et enterrez-le profond, {playerName}.`, `Voss est mort et la brume du camp s'éclaircit déjà. Il ne reste que le Bastion.`],
  q_bastion_door: [`Le Bastion englouti abrite le Mistcaller, et sa porte est scellée par des pierres tombales. Rapportez-moi une pierre de garde, {playerName}, et je déferai le sceau.`, `Le sceau cède comme une corde pourrie. La porte est ouverte, et l'ombre écoute.`],
  q_olen: [`Olen est mort en défendant le Bastion et garde maintenant sa porte en pantin. Cette honte prend fin, {playerName}. Descendez avec quatre compagnons et rendez-lui son repos.`, `Sa garde est enfin terminée. Je ferai graver son nom sur la porte moi-même. Merci, {playerName}.`],
  q_mistcaller: [`Vael attend au fond du Bastion, voix qui a noyé cent voyageurs. Prenez quatre compagnons et mettez-y fin, {playerName}.`, `Vael est mort et la brume se lève, mais ses derniers mots glacent: le Wyrm remue sous les pics. Repose-toi tant que tu le peux, {playerName}: les montagnes sont la suite.`],
  q_highwatch_summons: [`Les derniers mots de Vael ne me quittent pas, {playerName}. Prenez la convocation de Highwatch et dites à Thessaly qu'Aldric monte derrière vous.`, `Si Aldric monte lui-même, c'est aussi grave que je le craignais. Bienvenue à Highwatch, {playerName}.`],
  q_stalkers: [`Les félins de crête descendent des neiges, affamés, et mes patrouilles saignent. Tuez-en 12, {playerName}.`, `Douze ombres de moins sur la crête. Les patrouilles respireront ce soir.`],
  q_stalker_pelts: [`L'hiver de cette montagne n'attend pas qu'on ouvre, {playerName}. Huit peaux de traqueur doubleront les capes du mur.`, `Épaisses comme mon bras. La garde ne gèlera pas cette année.`],
  q_kobold_tunnels: [`Les kobolds de Deeprock creusent droit vers le bas, comme appelés sous le mur, {playerName}. Tuez 12 tunneliers.`, `Tout descend droit. Les kobolds ne creusent pas ainsi seuls.`],
  q_glowing_wax: [`La cire de ces tunneliers luit, {playerName}, et reste chaude comme un coeur. Rapportez 6 morceaux pour l'étude de Caddis.`, `Encore chaude. Cette lueur ne ressemble à aucune flamme connue du maître.`],
  q_ogre_edges: [`Les clans de Thornpeak campent trop à l'est avec peintures de guerre. Quelqu'un les paie. Tuez-en 12, {playerName}.`, `Douze à terre, et ils ne reculent pas. On les a payés avec plus lourd que de l'or.`],
  q_ogre_totems: [`Les ogres ont dressé des totems de peau et de crâne: une muster, pas un raid. Abattez-en 6 et rapportez-les. Méfiez-vous des broyeurs en périphérie, {playerName}.`, `Crâne, peau... et liens d'écailles de wyrm. Ce sont des cadeaux du culte, {playerName}.`],
  q_ogre_bounty: [`Les clans sont achetés et mon mur est leur première course. Tuez 14 ogres de plus, {playerName}; je paierai prime pour chacun.`, `Prime réglée. Les contreforts sont un peu plus silencieux.`],
  q_crushers: [`Les broyeurs sont l'échine du camp de Drogmar, chacun vaut trois de mes soldats. Brisez-en 10 avec de l'aide.`, `Dix broyeurs à terre. Le camp n'a plus de colonne vertébrale.`],
  q_drogmar: [`Drogmar a pris la monnaie du Wyrmcult et juré les clans au réveil de la montagne. Entrez dans son camp et tuez-le, {playerName}, pour Highwatch.`, `Drogmar est mort dans son propre camp. Vous avez acheté un hiver à mon mur, {playerName}.`],
  q_elementals: [`Stormcrag est resté muet mille ans, et ses pierres marchent. Les élémentaires ne s'éveillent pas sans raison, {playerName}. Tuez-en 12 pour que j'étudie les restes.`, `Les fragments vibrent comme des cloches frappées. La montagne n'est pas en colère, {playerName}, on la dérange.`],
  q_shard_cores: [`Chaque élémentaire porte un coeur de tempête. Six côte à côte révéleront le centre du trouble, {playerName}, même si je le redoute.`, `Tous pointent au sud comme de la limaille vers un aimant. Vers le Sanctuaire, {playerName}.`],
  q_kazzix: [`Kazzix brûle plus fort que les autres, une tempête avec des épaules. Arrachez son éclat de coeur dans les lointains rochers.`, `L'éclat crépite encore! Magnifique. Prenez ces jambières pour la peine.`],
  q_zealots: [`Le vent porte des chants depuis les pics du sud. Faites taire 12 zélotes, {playerName}; chaque voix tue achète une nuit de sommeil.`, `Le vent est plus calme. Ce qui m'inquiète, {playerName}, c'est que quelque chose réponde peut-être.`],
  q_cult_orders: [`Les zélotes bougent comme des soldats avant un siège, {playerName}. Tuez-en 8 autres et rapportez 4 jeux d'ordres.`, `Cette écriture vient du grimoire de Morthen. La même main a guidé chaque tombe, {playerName}.`],
  q_necromancers: [`Les ordres parlent d'un anneau de phylactères, {playerName}, vases d'âme autour du Sanctuaire. Tuez 8 nécromanciens et rapportez-en 3 intacts.`, `Que la Lumière nous pardonne. Ils contiennent les morts du Val et du marais; ce n'était pas une armée qu'ils bâtissaient, {playerName}, c'était une dîme.`],
  q_revenants: [`À l'est de la route dort un vieux champ de bataille. Le culte a relevé ses os en armures rouillées. Remettez-en 12 en terre, {playerName}.`, `Ils furent soldats, comme les miens. Ce qui les a relevés ne respecte pas les morts.`],
  q_revenant_vanguard: [`Les revenants forment de vrais rangs, {playerName}. Brisez-en 14 avant que la marche vers le Sanctuaire commence.`, `Les champs sont immobiles à nouveau. Prenez ceci; personne ne l'a davantage mérité.`],
  q_wyrm_sigils: [`Il est temps que tu saches tout, {playerName}. Les Gravecallers servent Korzul le Gravewyrm, et chaque âme volée nourrit son réveil. Rapportez 3 sigils de l'approche du Sanctuaire.`, `Oui... une litanie de réveil écrite sur des générations. Ils sont proches, {playerName}.`],
  q_breaking_the_seal: [`Le sceau du Sanctuaire fut forgé au feu de montagne. Rapportez 5 braises bénies des élémentaires, {playerName}, pour l'ouvrir sans le déchirer.`, `Elles brûlent bleu et pur. La montagne se souvient de son ancien serment.`],
  q_voice_below: [`Hier, tout le camp s'est agenouillé face au Sanctuaire, {playerName}. Tuez 10 zélotes et 6 nécromanciens avant que cette voix ait assez de mains.`, `L'agenouillement a cessé. Nous n'avons pas réduit la voix au silence, {playerName}; seulement son choeur.`],
  q_sanctum_gate: [`C'est le dernier seuil, {playerName}. La clef du Sanctuaire fut brisée sous les yeux des morts cuirassés. Rapportez 3 éclats et j'ouvrirai la voie en silence.`, `Les éclats s'ajustent et la porte reconnaît sa clef. Rassemblez les plus forts, {playerName}.`],
  q_korgath: [`Maren a trouvé des chaînes grosses comme des mâts, {playerName}, et une forme d'ogre qui tirait dessus. Prenez quatre compagnons et abattez Korgath.`, `Korgath est enfin brisé. Même ses chaînes méritaient une fin plus douce.`],
  q_velkhar: [`Velkhar, premier des Gravecallers, a tissé chaque fil et verse des âmes volées dans le Wyrm. Tuez-le, {playerName}.`, `Velkhar est mort et le rite n'a plus de tête, mais le Wyrm ne dort plus.`],
  q_gravewyrm: [`Il ne reste plus de rite à arrêter, {playerName}, seulement le Wyrm à demi éveillé. Entrez avec vos compagnons et finissez ce qui commença à la chapelle.`, `C'est fini. Les morts de trois terres reposent, et chaque cloche chante votre nom, {playerName}.`],
} satisfies QuestNarrativeTranslations;

const deQuestNarratives = {
  q_wolves: [`Die Waldwölfe fallen Reisende auf der Nordstraße an, {playerName}. Töte 8 von ihnen, damit Eastbrook wieder freier atmen kann.`, `Gute Arbeit. Die Straße fühlt sich schon sicherer an.`],
  q_greyjaw: [`Ein Wolf entging jeder Falle: der alte Greyjaw. Er streift nördlich der Wolfswege umher; bring mir seinen Fangzahn.`, `Der alte Teufel ist endlich tot. Der Stalljunge wird besser schlafen, und ich auch.`],
  q_boars: [`Eberhäute ergeben beste Reisetaschen, und die Wiesen wimmeln von ihnen. Bring mir 5 borstige Häute.`, `Ah, feine borstige Häute. Dafür bekomme ich einen guten Preis.`],
  q_spiders: [`Die Webwood-Lauerer spinnen Seide für meine Umschläge, sind aber viel zu zahlreich. Töte 6 und schneide 4 Seidendrüsen heraus.`, `Igitt, sie zucken noch. Perfekt. Das hast du dir verdient.`],
  q_murlocs: [`Zwanzig Jahre fischte ich am Spiegelsee, bis diese Fischmenschen aus den Untiefen krochen. Erschlage 8 Schlammflossen und pass auf Rudel auf.`, `Ha! Das lehrt sie, in ihren Schlammlöchern zu bleiben.`],
  q_mine: [`Wir fanden eine gute Kupferader, dann quollen Kobolde aus dem Hang. Erlege 10 Tunnelratten-Gräber, damit meine Leute zurückkehren.`, `Ha! Zurück an die Arbeit, Jungs! Du hast meinen Dank und mein Geld.`],
  q_bones: [`Die alte Kapelle war einst ein Ruheort, bis etwas die Toten weckte. Lege 8 ruhelose Knochen wieder in die Erde, {playerName}.`, `Mögen sie nun ruhen, und möge das Licht vergeben, was sie geweckt hat.`],
  q_supplies: [`Die Banditen raubten meinen letzten Wagen: Werkzeug, Salz und gutes Eastbrook-Leinen. Hol 4 Kisten aus ihrem Lager im Südosten zurück.`, `Meine Kisten! Kaum ein Kratzer. Du bist ein Wunder.`],
  q_whispers: [`Die Toten stehen wieder auf, weil etwas sie ruft. Durchsuche die Kapelle nach dem Rufer und bring jedes Siegel unversehrt her.`, `Dieses Siegel trägt das Zeichen der Gravecaller. Ich hatte gebetet, diese Sekte sei erloschen, {playerName}.`],
  q_names_of_the_dead: [`Wenn die Gravecaller unsere Gräber raubten, muss ich wissen, wessen Ruhe sie stahlen. Sammle 3 Seiten des Begräbnisbuchs, {playerName}.`, `Arme Seelen... und sieh hier: Küster Marrow war der erste. Morthen begann mit dem Mann, der Eastbrooks Tote begrub.`],
  q_silence_the_call: [`Jeder Name im Buch ist eine Seele, die Morthen aus der Erde ziehen will. Bringe 12 ruhelose Knochen zum Schweigen, {playerName}, bevor der Flüsterton zum Chor wird.`, `Der Hof wird stiller, doch der Ruf steigt jetzt aus der Gruft, {playerName}.`],
  q_rite: [`Die Gruft muss geöffnet werden, doch nur ein Bindungsritus lässt Lebende passieren. Ich brauche 4 gesegnete Talgbrocken und 6 geisterhafte Essenzen.`, `Es ist getan. Der Weg hinab steht offen... sammle deine stärksten Gefährten, {playerName}.`],
  q_hollow: [`Morthen wartet am Grund der Hohlen Gruft, umringt von den elitären Toten. Nimm vier Gefährten mit und beende ihn.`, `Das Flüstern ist verstummt. Die Toten schlafen, {playerName}, und Eastbrook schuldet dir alles.`],
  q_sexton: [`Das Buch nennt Küster Marrow, Morthens ersten erhobenen Wächter. Steig mit vier Gefährten hinab und gib ihm die geraubte Ruhe zurück, {playerName}.`, `Marrow ist endlich frei. Läutet keine Glocke für ihn; er hörte im Leben genug.`],
  q_gravecallers_trail: [`Morthen ist tot, doch seine Sekte verschwendet kein Jahrhundert des Schweigens an eine einzige Kapelle. Suche sein Grimoire in den Ruinen, {playerName}.`, `Morthen schrieb an einen Mistcaller im nördlichen Moor. Die Sekte ist nicht tot, {playerName}; sie war nur geduldig.`],
  q_bandits: [`Eine Rotte Halsabschneider lagert in den südwestlichen Hügeln. Drei Wagen wurden diese Woche beraubt. Töte 10 Talbanditen.`, `Zehn Klingen weniger in der Dunkelheit. Nimm das, du hast es verdient.`],
  q_ringleader: [`Die Banditen gehorchen Gorrak dem Gnadenlosen. Schlägst du den Kopf ab, zerstreut sich der Leib. Beende ihn, {playerName}.`, `Gorrak ist tot? Dann liegt sein Schatten nicht mehr über dem Tal.`],
  q_fenbridge_muster: [`Morthens Schriften nennen einen Meister im Nordmoor. Zieh den Musterungsbefehl vom Tor in Fenbridge, {playerName}, und zeig ihn dem Wärter.`, `Aldrics Siegel, ja? Dann taugst du. Das Moor verschlingt meine Patrouillen ganz.`],
  q_prowlers: [`Die Moorpirscher kennen den Klang von Lasttieren und jagen nun auf dem Damm. Töte 12, {playerName}.`, `Zwölf, und kein Biss an dir. Der Damm atmet heute Abend leichter.`],
  q_prowler_pelts: [`Der Damm hält nur durch geölte Pirscherfelle, und mein Vorrat ist aufgebraucht. Bring 8 unversehrte Bälge, {playerName}, bevor wir nach Eastbrook waten.`, `Gute, dicke Bälge. Der Damm wird uns beide überdauern.`],
  q_fen_supplies: [`Eine Karawane aus Eastbrook verschwand vor drei Tagen im Nebel. Berge 5 Ladungen, bevor das Moor sie ganz verschluckt.`, `Durchnässt, aber heil. Das Moor behält, was es fängt, {playerName}.`],
  q_deepfen: [`Die Deepfen-Murlocs wühlen Dinge vom Seegrund herauf. Töte 12 Schnapper, damit wir erfahren, was sie aufscheucht.`, `Das drängt sie eine Weile zurück in den Schlamm. Aber etwas ließ sie graben.`],
  q_idols: [`Die Fischmenschen klammern ausgebaggerte Götzen wie Heiligtümer. Nimm den Schnappern 5 davon ab.`, `Gravecaller-Werk, älter als Morthen. Die Sekte begann hier, {playerName}.`],
  q_deepfen_purge: [`Diese Götzen sind Kultwerk, und die Murlocs holen das alte Übel armvollweise hoch. Töte 14 weitere.`, `Schonungslos und gründlich. Falls dieses Moor je austrocknet, wartet Wärterarbeit auf dich.`],
  q_widows: [`Witwengift zieht Moorfäule aus Wunden, doch das Dickicht wurde zum Schrecken. Töte 10 Witwen und schneide 6 ganze Giftsäcke heraus.`, `Jeder Sack ganz. Deine Hände sind ruhiger als die halber Wundärzte im Süden, {playerName}.`],
  q_broodmother: [`Netze dick wie Taue haben eine Mutter. Brenn dich durch 8 Witwen und leg die Alte um, bevor ihr Gelege schlüpft.`, `Wirklich tot? Dann ist das Dickicht wieder nur ein Wald. Das Licht segne deine Klinge, {playerName}.`],
  q_drowned: [`Ertrunkene Reisende steigen mit Wasserpflanzen aus den Seen. Befreie 12 ertrunkene Tote, {playerName}.`, `Jeder Gefällte ist eine gestohlene Seele, die frei wird.`],
  q_drowned_censers: [`Die Nordkapelle sank mit ihrer Gemeinde, und ihre Toten tragen alte Räuchergefäße. Sammle 4 vom Friedhof.`, `Wie befürchtet: Sie verbrannten Grabasche, und der Ritus ist mit Voss gezeichnet.`],
  q_no_rest: [`Dieser Ritus lässt Ertrunkene überall auferstehen, wo das Moor sie berührt. Wir können ihn noch nicht brechen; nimm ihren Herren 14 Soldaten.`, `Du schenkst den Toten mehr Gnade als ihre Meister. Nimm dies, du hast es verdient.`],
  q_trolls: [`Die Mirefen-Trolle reißen Hügelgräber auf, {playerName}, älter als Menschenreiche. Vertreib sie: 12 tote Trolle sollten genügen.`, `Trolle graben nicht ohne Grund. Jemand in grauer Robe zeigte ihnen die Stelle.`],
  q_troll_fetishes: [`Diese Fetische sind kein Trollwerk: falsche Knoten, Menschenknochen, alle zeigen zu den Gräbern. Bring mir 8.`, `Der gleiche Macher wie bei den Bannern im Kultlager. Die Trolle sind nur gemietete Schaufeln, {playerName}.`],
  q_grubjaw: [`Grubjaw gräbt nicht mit den anderen; er fraß meine letzten zwei Packmulis samt Geschirr. Bring mir seinen Hauer, {playerName}.`, `Dieser Hauer ist so lang wie mein Unterarm! Die Maultiere sind gerächt.`],
  q_cult_camp: [`Nördlich, wo der Nebel nie weicht, lagern Gravecaller, als gehörte ihnen das Moor. Töte 12 Kultisten, {playerName}.`, `Zwölf Roben mit dem Gesicht im Schlamm. Nun wissen sie, dass das Moor zurückschaut.`],
  q_summoners: [`Beschwörer rufen die Ertrunkenen wie Hunde zur Pfeife. Bring 8 zum Schweigen und hol 4 Chiffren.`, `Jede Chiffre ist von Diakon Voss gegengezeichnet und an den Mistcaller gerichtet. Morthens Meister, {playerName}. Wir haben ihn gefunden.`],
  q_deacon: [`Voss singt meine ertrunkenen Wärter aus den Seen in seinen Dienst. Nimm die Lagerstraße und begrab ihn tief, {playerName}.`, `Voss ist tot, und der Nebel über dem Lager lichtet sich. Jetzt bleibt nur die Bastion.`],
  q_bastion_door: [`Die versunkene Bastion birgt den Mistcaller, und ihre Tür ist mit Grabsteinen versiegelt. Bring mir einen Wachstein, {playerName}.`, `Das Siegel zerfällt wie morsches Tau. Die Tür steht offen, und die Dunkelheit lauscht.`],
  q_olen: [`Olen starb bei der Verteidigung der Bastion und bewacht nun als Marionette ihre Tür. Diese Schande endet, {playerName}. Geh mit vier Gefährten hinab und gib ihm Ruhe.`, `Seine Wacht ist endlich vorüber. Ich werde seinen Namen selbst ins Tor schlagen. Danke, {playerName}.`],
  q_mistcaller: [`Vael wartet am Grund der Bastion, die Stimme, die hundert Reisende ertränkte. Nimm vier Gefährten und beende ihn, {playerName}.`, `Vael ist tot und der Nebel hebt sich, doch seine letzten Worte frieren Blut: Der Wyrm regt sich unter den Gipfeln. Ruh dich aus, solange du kannst, {playerName} - als Nächstes kommen die Berge.`],
  q_highwatch_summons: [`Vaels letzte Worte lassen mich nicht los, {playerName}. Nimm die Einberufung von Highwatch und sag Thessaly, dass Aldric hinter dir aufsteigt.`, `Wenn Aldric selbst den Berg steigt, ist es so schlimm wie befürchtet. Willkommen in Highwatch, {playerName}.`],
  q_stalkers: [`Die Gratkatzen kommen hungrig aus dem Schnee und lassen meine Patrouillen bluten. Erlege 12, {playerName}.`, `Zwölf Schatten weniger auf dem Grat. Die Patrouillen atmen heute Nacht leichter.`],
  q_stalker_pelts: [`Der Winter dieser Berge klopft nicht an, {playerName}, er tritt die Tür ein. Acht Pirscherfelle füttern genug Mäntel für die Mauer.`, `Dick wie mein Arm. Die Wacht wird dieses Jahr nicht erfrieren.`],
  q_kobold_tunnels: [`Die Kobolde von Deeprock graben gerade nach unten, als rufe etwas unter der Mauer. Ihre Tunnel laufen unter unserer Mauer, {playerName}. Töte 12 Tunnelgräber.`, `Jeder Schacht führt senkrecht hinab. Kobolde graben nicht von allein so.`],
  q_glowing_wax: [`Das Wachs dieser Gräber leuchtet, {playerName}, und ist warm wie ein Herzschlag. Bring 6 Brocken für Caddis' Studien.`, `Noch immer warm. Dieses Leuchten passt zu keiner Flamme, die der Lehrmeister kennt.`],
  q_ogre_edges: [`Die Thornpeak-Clans lagern viel zu weit östlich mit Kriegsbemalung. Jemand bezahlt sie. Töte 12, {playerName}.`, `Zwölf liegen, und sie weichen nicht. Wer sie kaufte, zahlte mit Schwererem als Gold.`],
  q_ogre_totems: [`Die Oger stellten Totems aus Haut und Schädeln auf: Musterzeichen, kein Raubzug. Reiße 6 nieder und bring sie her. Hüte dich vor den Zermalmern am Rand, {playerName}.`, `Schädel, Haut... und Wyrmschuppen-Bindungen. Das sind Geschenke des Kults, {playerName}.`],
  q_ogre_bounty: [`Die Clans sind gekauft, und meine Mauer ist ihr erster Auftrag. Töte 14 weitere Thornpeak-Oger, {playerName}; ich zahle Kopfgeld.`, `Kopfgeld vollständig bezahlt. Die Vorberge sind leiser.`],
  q_crushers: [`Drogmars Zermalmer sind das Rückgrat seines Kriegslagers, jeder so viel wert wie drei meiner Soldaten. Brich 10 mit Hilfe.`, `Zehn Zermalmer nieder. Das Lager ist ein Leib ohne Rückgrat.`],
  q_drogmar: [`Drogmar nahm Wyrmkult-Gold und schwor die Clans dem Erwachen des Berges. Geh ins Kriegslager und töte ihn, {playerName}, für Highwatch.`, `Drogmar liegt tot im eigenen Lager. Du hast meiner Mauer einen Winter erkauft, {playerName}.`],
  q_elementals: [`Stormcrag schwieg tausend Jahre, und nun laufen seine Steine. Elementare erwachen nicht einfach, {playerName} - etwas unter diesem Berg wälzt sich im Schlaf. Erlege 12 Elementare, damit ich die Reste prüfen kann.`, `Die Splitter summen wie angeschlagene Glocken. Der Berg ist nicht zornig, {playerName}; er wird gestört.`],
  q_shard_cores: [`Im Herzen jedes Elementars sitzt ein Sturmkern. Sechs nebeneinander zeigen mir den Ursprung der Störung, {playerName}, so sehr ich ihn fürchte.`, `Alle zeigen nach Süden wie Späne zum Magneten. Zum Heiligtum, {playerName}.`],
  q_kazzix: [`Kazzix brennt heller als die anderen, ein Sturm mit Schultern. Reiß ihm den Herzsplitter in den fernen Felsen heraus.`, `Der Herzsplitter knistert noch! Prächtig. Nimm diese Beinschützer für deine Mühe.`],
  q_zealots: [`Der Wind trägt Gesänge von den Südgipfeln. Bringe 12 Eiferer zum Schweigen, {playerName}; jede Stimme kauft dem Berg Schlaf.`, `Der Wind ist stiller. Was mich beunruhigt, {playerName}: Vielleicht singt etwas zurück.`],
  q_cult_orders: [`Die Eiferer bewegen sich wie Soldaten vor einer Belagerung. Eiferer, die sich organisieren, nehmen Befehle entgegen, {playerName}. Töte 8 weitere und bring 4 Befehlssätze.`, `Diese Schrift kenne ich aus Morthens Grimoire. Dieselbe Hand führte jedes Grab, {playerName}.`],
  q_necromancers: [`Die Befehle nennen einen Ring von Phylakterien, {playerName}, Seelengefäße um das Heiligtum. Töte 8 Nekromanten und bring 3 unversehrt.`, `Licht, vergib uns. Darin sind die Toten aus Tal und Moor; sie bauten nie ein Heer, {playerName}. Sie sammelten einen Zehnt.`],
  q_revenants: [`Östlich der Straße liegt ein altes Schlachtfeld. Der Kult hob die Knochen in rostiger Rüstung. Leg 12 zurück in die Erde, {playerName}.`, `Sie waren Soldaten wie meine. Was sie rief, achtet die Toten nicht.`],
  q_revenant_vanguard: [`Die Wiedergänger bilden echte Reihen, {playerName}. Brich 14 weitere, bevor ihr Marsch zum Heiligtum beginnt.`, `Die Felder liegen wieder still. Nimm das, niemand hat es mehr verdient.`],
  q_wyrm_sigils: [`Es ist Zeit, dass du alles erfährst, {playerName}. Die Gravecaller dienen Korzul dem Gravewyrm, und jede gestohlene Seele nährt sein Erwachen. Bring mir 3 Siegel vom Zugang zum Heiligtum.`, `Ja... eine Wecklitanei, über Generationen geschrieben. Sie sind nah, {playerName}.`],
  q_breaking_the_seal: [`Das Siegel des Heiligtums wurde mit Bergfeuer geschmiedet. Bring 5 gesegnete Gluten von Elementaren, {playerName}, damit wir es öffnen statt zerreißen.`, `Sie brennen blau und rein. Der Berg erinnert sich an seinen alten Schwur.`],
  q_voice_below: [`Gestern kniete das ganze Lager zum Heiligtum, {playerName}. Töte 10 Eiferer und 6 Nekromanten, bevor diese Stimme genug Hände hat.`, `Das Knien hat aufgehört. Wir haben die Stimme nicht zum Schweigen gebracht, {playerName}; nur ihren Chor ausgedünnt.`],
  q_sanctum_gate: [`Dies ist die letzte Schwelle, {playerName}. Der Schlüssel des Heiligtums wurde unter den Augen knochengepanzerter Toter zerbrochen. Bring 3 Splitter, und ich öffne leise den Weg.`, `Die Splitter sitzen richtig, und das Tor erkennt seinen Schlüssel. Sammle die Stärksten, {playerName}.`],
  q_korgath: [`Maren fand Ketten dick wie Masten und etwas Ogerförmiges darin, {playerName}. Nimm vier Gefährten und bring Korgath zu Fall.`, `Korgath ist endlich gebrochen. Sogar seine Ketten verdienten ein freundlicheres Ende.`],
  q_velkhar: [`Velkhar, erster der Gravecaller, spann jeden Faden und gießt gestohlene Seelen in den Wyrm. Beende ihn, {playerName}.`, `Velkhar ist tot, und der Ritus ist kopflos. Doch der Wyrm schläft nicht mehr.`],
  q_gravewyrm: [`Es bleibt kein Ritus mehr zu stoppen, {playerName}, nur der halb erwachte Wyrm. Geh mit deinen Gefährten hinein und vollende, was in der Kapelle begann.`, `Es ist vorbei. Die Toten dreier Länder ruhen, und jede Glocke singt heute deinen Namen, {playerName}.`],
} satisfies QuestNarrativeTranslations;

const itQuestNarratives = {
  q_wolves: [`I lupi della foresta assaltano la strada del nord, {playerName}. Uccidine 8 prima che un altro carro sparisca tra i pini.`, `Bel lavoro. La strada sembra già più sicura.`],
  q_greyjaw: [`Un lupo non è mai caduto in trappola: il vecchio Greyjaw. Si aggira a nord delle piste dei lupi; portami la sua zanna.`, `Il vecchio demonio è morto finalmente. Il ragazzo delle stalle dormirà meglio, e anch'io.`],
  q_boars: [`Le pelli di cinghiale fanno ottimi zaini da viaggio, e i prati ne sono pieni. Portami 5 pelli irsute.`, `Ah, belle pelli irsute. Frutteranno un buon prezzo.`],
  q_spiders: [`I predatori di Webwood filano seta utile ai miei impacchi, ma sono troppi. Uccidine 6 e taglia 4 ghiandole di seta.`, `Bleah, si muovono ancora. Perfetto. Te lo sei guadagnato.`],
  q_murlocs: [`Pescavo al Lago Specchio finché quegli uomini pesce non sono usciti dai bassifondi. Scaccia 8 Pinnalimo e guardati dai branchi.`, `Ah! Impareranno a restare nei loro pantani.`],
  q_mine: [`Avevamo trovato una vena di rame, poi i coboldi sono sbucati dalla collina. Abbatti 10 scavatori ratto di galleria.`, `Ah! Al lavoro, ragazzi! Hai i miei ringraziamenti e la mia paga.`],
  q_bones: [`La vecchia cappella era un luogo di riposo, finché qualcosa ha svegliato i morti. Riporta alla terra 8 ossa irrequiete, {playerName}.`, `Che riposino, e che la Luce perdoni chi li ha svegliati.`],
  q_supplies: [`I banditi hanno preso il mio ultimo carro: attrezzi, sale e buon lino di Eastbrook. Riprendi 4 casse dal loro campo a sud-est.`, `Le mie casse! Quasi senza graffi. Sei una meraviglia.`],
  q_whispers: [`I morti si rialzano perché qualcosa li richiama. Cerca nella cappella un sigillo o una traccia del richiamo e portala intatta.`, `Questo sigillo porta il marchio dei Gravecaller. Pregavo che la setta fosse estinta, {playerName}.`],
  q_names_of_the_dead: [`Se i Gravecaller hanno profanato le tombe, devo sapere chi hanno rubato. Raccogli 3 pagine del registro funebre, {playerName}.`, `Povere anime... e guarda: il sagrestano Marrow fu il primo. Morthen cominciò dall'uomo che seppelliva Eastbrook.`],
  q_silence_the_call: [`Ogni nome nel registro è un'anima che Morthen vuole strappare dalla terra. Zittisci 12 ossa irrequiete, {playerName}, prima che il sussurro diventi coro.`, `Il cimitero è più quieto, ma il richiamo ora sale dalla cripta, {playerName}.`],
  q_rite: [`La cripta deve essere aperta, ma solo un rito del vincolo lascia passare i vivi. Servono 4 pezzi di sego benedetto e 6 essenze spettrali.`, `È fatto. La via sotto è aperta... raduna i compagni più forti, {playerName}.`],
  q_hollow: [`Morthen attende in fondo alla Cripta Vuota, circondato dai morti d'élite che ha rialzato. Porta quattro compagni e fermalo.`, `I sussurri sono cessati. I morti dormono, {playerName}, ed Eastbrook ti deve tutto.`],
  q_sexton: [`Il registro nomina il sagrestano Marrow, primo guardiano rialzato da Morthen. Scendi con quattro compagni e ridagli il riposo rubato, {playerName}.`, `Marrow è libero finalmente. Non suonate campane per lui; ne udì abbastanza in vita.`],
  q_gravecallers_trail: [`Morthen è morto, ma la sua setta non sprecò un secolo di silenzio per una sola cappella. Cerca il suo grimorio tra le rovine, {playerName}.`, `Morthen scriveva a un Mistcaller nella palude del nord. La setta non è morta, {playerName}; ha solo atteso.`],
  q_bandits: [`Una banda di tagliagole si è accampata sulle colline sud-occidentali. Hanno rapinato tre carri questa settimana. Uccidi 10 banditi della Valle.`, `Dieci lame in meno nel buio. Prendi questo, te lo sei guadagnato.`],
  q_ringleader: [`I banditi obbediscono a Gorrak lo Spietato. Taglia la testa e il corpo si disperderà. Finiscilo, {playerName}.`, `Gorrak è morto? Allora la Valle è libera dalla sua ombra.`],
  q_fenbridge_muster: [`Gli scritti di Morthen nominano un maestro nella palude del nord. Non credo alle coincidenze, {playerName}: prendi l'ordine di adunata al cancello di Fenbridge e consegnalo al custode.`, `Il sigillo di Aldric? Allora andrai bene. La palude inghiotte intere le mie pattuglie.`],
  q_prowlers: [`I predatori hanno imparato il suono dei muli da carico e cacciano sulla strada rialzata. Uccidine 12, {playerName}.`, `Dodici, e neppure un morso su di te. La strada respirerà meglio stanotte.`],
  q_prowler_pelts: [`La strada rialzata regge grazie a pelli di predatore oliate, e le mie scorte sono finite. Portami 8 pelli integre, {playerName}.`, `Belle pelli spesse. Ora la strada sopravvivrà a entrambi.`],
  q_fen_supplies: [`Una carovana da Eastbrook è sparita nella nebbia. Recupera 5 carichi prima che la palude finisca di inghiottirli.`, `Fradici, ma interi. La palude tiene ciò che prende, {playerName}.`],
  q_deepfen: [`I murloc di Deepfen stanno tirando cose dal fondo del lago. Uccidi 12 murloc per capire cosa li agita.`, `Questo li ricaccerà nel fango per un po'. Ma qualcosa li ha messi a scavare.`],
  q_idols: [`Gli uomini pesce stringono idoli dragati dal fondo come reliquie. Prendine 5 ai murloc di Deepfen.`, `Opera dei Gravecaller, più antica di Morthen. La setta cominciò qui, {playerName}.`],
  q_deepfen_purge: [`Quegli idoli sono del culto, e i murloc stanno riportando su il vecchio male a bracciate. Uccidine altri 14.`, `Spietato e accurato. Se questa palude si asciugherà, avrai lavoro da custode.`],
  q_widows: [`Il veleno di vedova estrae la putredine dalle ferite, ma il folto è diventato un incubo. Uccidi 10 vedove e prendi 6 sacche intere.`, `Sacche tutte integre. Hai mani più ferme di metà dei chirurghi del sud, {playerName}.`],
  q_broodmother: [`Ragnatele grosse come gomene hanno una madre. Fatti strada tra 8 vedove e uccidi la vecchia prima che la covata si schiuda.`, `Davvero morta? Allora il folto torna a essere solo alberi. Che la Luce benedica la tua lama, {playerName}.`],
  q_drowned: [`Viaggiatori annegati emergono dai laghi coperti di alghe. Libera 12 morti annegati, {playerName}.`, `Ogni morto abbattuto è un'anima rubata che torna libera.`],
  q_drowned_censers: [`La cappella a nord affondò con la congregazione, e i suoi morti portano incensieri funebri. Raccogline 4 nel cortile.`, `Come temevo: bruciavano cenere di tomba, e il rito è firmato Voss.`],
  q_no_rest: [`Quel rito rialza gli annegati ovunque la palude li tocchi. Non possiamo disfarlo ancora; togli 14 soldati ai loro padroni.`, `Offri ai morti più misericordia dei loro padroni. Prendi questo, l'hai meritato.`],
  q_trolls: [`I troll di Mirefen hanno aperto tumuli più antichi di ogni regno umano, {playerName}. Cacciali: 12 troll morti basteranno.`, `I troll non scavano senza motivo. Qualcuno in veste grigia li ha guidati.`],
  q_troll_fetishes: [`Quei feticci non sono opera troll: nodi sbagliati, ossa umane, tutti puntati ai tumuli. Portamene 8.`, `Stessa mano degli stendardi del campo. I troll sono solo pale a noleggio, {playerName}.`],
  q_grubjaw: [`Grubjaw non scava con gli altri; ha mangiato i miei ultimi due muli, finimenti compresi. Portami la sua zanna, {playerName}.`, `Quella zanna è lunga quanto il mio avambraccio! I muli sono vendicati.`],
  q_cult_camp: [`A nord, dove la nebbia non si alza mai, i Gravecaller si accampano come padroni della palude. Abbatti 12 cultisti, {playerName}.`, `Dodici vesti a faccia in giù nel fango. Ora sanno che la palude osserva.`],
  q_summoners: [`Gli evocatori richiamano gli annegati come cani al fischio. Zittiscine 8 e portami 4 cifrari.`, `Ogni cifrario è controfirmato dal diacono Voss e diretto al Mistcaller. Il maestro di Morthen, {playerName}. Lo abbiamo trovato.`],
  q_deacon: [`Voss canta i miei guardiani annegati fuori dai laghi per servirlo. Prendi la strada del campo e seppelliscilo a fondo, {playerName}.`, `Voss è morto e la nebbia sul campo si dirada. Ora resta solo il Bastione.`],
  q_bastion_door: [`Il Bastione Sommerso custodisce il Mistcaller, e la sua porta è sigillata da pietre tombali. Portami una pietra di guardia, {playerName}.`, `Il sigillo cede come corda marcia. La porta è aperta, e il buio ascolta.`],
  q_olen: [`Olen morì difendendo il Bastione e ora ne guarda la porta come burattino. Questa vergogna finisce, {playerName}. Scendi con quattro compagni e dagli pace.`, `La sua guardia è finita finalmente. Inciderò io stesso il suo nome sul cancello. Grazie, {playerName}.`],
  q_mistcaller: [`Vael attende in fondo al Bastione, la voce che ha annegato cento viaggiatori. Porta quattro compagni e finiscilo, {playerName}.`, `Vael è morto e la nebbia si alza, ma le sue ultime parole gelano: il Wyrm si agita sotto i picchi. Riposa finché puoi, {playerName}: le montagne sono le prossime.`],
  q_highwatch_summons: [`Le ultime parole di Vael non mi lasciano, {playerName}. Prendi la convocazione di Highwatch e dì a Thessaly che Aldric sale dietro di te.`, `Se Aldric sale di persona, è grave come temevo. Benvenuto a Highwatch, {playerName}.`],
  q_stalkers: [`I felini della cresta scendono affamati dalle nevi e fanno sanguinare le pattuglie. Abbattine 12, {playerName}.`, `Dodici ombre in meno sulla cresta. Le pattuglie respireranno stanotte.`],
  q_stalker_pelts: [`L'inverno su questa montagna sfonda le porte, {playerName}. Otto pelli di braccatore fodereranno mantelli per il muro.`, `Spesse come il mio braccio. La guardia non gelerà quest'anno.`],
  q_kobold_tunnels: [`I coboldi di Deeprock scavano dritti verso il basso, come chiamati sotto il nostro muro, {playerName}. Uccidi 12 scavatori.`, `Ogni galleria scende diritta. I coboldi non scavano così da soli.`],
  q_glowing_wax: [`La cera di quei minatori brilla, {playerName}, ed è calda come un battito. Porta 6 pezzi per gli studi di Caddis.`, `Ancora calda. Il bagliore non somiglia a nessuna fiamma nota al maestro.`],
  q_ogre_edges: [`I clan di Thornpeak si sono accampati troppo a est con pitture di guerra. Qualcuno li paga. Uccidine 12, {playerName}.`, `Dodici a terra, e non arretrano. Chi li ha comprati ha pagato con qualcosa di più pesante dell'oro.`],
  q_ogre_totems: [`Gli ogre hanno eretto totem di pelle e teschio: segnali di adunata, non di razzia. Abbattene 6 e portali qui. Attento agli schiacciatori sul perimetro, {playerName}.`, `Teschio, pelle... e legature di scaglie di wyrm. Sono doni del culto, {playerName}.`],
  q_ogre_bounty: [`I clan sono comprati e il mio muro è il loro primo incarico. Uccidi altri 14 ogre, {playerName}; pagherò ogni taglia.`, `Taglia pagata per intero. Le colline sono più quiete.`],
  q_crushers: [`I frantumatori sono la spina del campo di Drogmar, ognuno vale tre miei soldati. Spezzane 10 con aiuto.`, `Dieci frantumatori a terra. Il campo è un corpo senza spina dorsale.`],
  q_drogmar: [`Drogmar ha preso la moneta del Wyrmcult e giurato i clan al risveglio della montagna. Quando colpisce il suolo, {playerName}, non restargli vicino. Entra nel campo e uccidilo per Highwatch.`, `Drogmar giace morto nel suo campo. Hai comprato un inverno al mio muro, {playerName}.`],
  q_elementals: [`Stormcrag è rimasta muta per mille anni, e ora le sue pietre camminano. Gli elementali non si svegliano da soli, {playerName}: qualcosa sotto questa montagna si rigira nel sonno. Abbatti 12 elementali per studiarne i resti.`, `I frammenti vibrano come campane colpite. La montagna non è adirata, {playerName}... viene disturbata.`],
  q_shard_cores: [`Nel cuore di ogni elementale c'è un nucleo della tempesta. Sei insieme indicheranno il centro del disturbo. Sospetto di saperlo già, {playerName}, e spero ardentemente di sbagliarmi.`, `Tutti puntano a sud come limatura verso una calamita. Al Santuario, {playerName}.`],
  q_kazzix: [`Kazzix brucia più degli altri, una tempesta con le spalle. Strappagli il frammento di cuore tra i dirupi lontani.`, `Il frammento crepita ancora! Magnifico. Prendi questi gambali.`],
  q_zealots: [`Il vento porta canti dai picchi del sud. Zittisci 12 zeloti, {playerName}; ogni voce fermata compra un'altra notte di sonno.`, `Il vento è più quieto. Ma ciò che mi turba non è il canto, {playerName}: è che qualcosa possa rispondere al canto.`],
  q_cult_orders: [`Gli zeloti si muovono come soldati prima di un assedio. Chi si organizza prende ordini, {playerName}. Uccidine altri 8 e portami 4 ordini scritti.`, `Questa scrittura viene dal grimorio di Morthen. La stessa mano ha guidato ogni tomba, {playerName}.`],
  q_necromancers: [`Gli ordini parlano di un anello di filatteri, vasi d'anima attorno al Santuario, {playerName}. Uccidi 8 negromanti e portane 3 intatti.`, `Che la Luce ci perdoni. Contengono i morti della Valle e della palude; non stavano costruendo un esercito, {playerName}, raccoglievano una decima.`],
  q_revenants: [`A est della strada giace un vecchio campo di battaglia. Il culto ne ha rialzato le ossa in piastre arrugginite. Rimettine 12 a terra, {playerName}.`, `Erano soldati, come i miei. Ciò che li ha chiamati non rispetta i morti.`],
  q_revenant_vanguard: [`I revenant formano ranghi veri, {playerName}. Spezzane altri 14 prima che marcino al Santuario.`, `I campi sono di nuovo immobili. Prendi questo; nessuno lo ha meritato di più.`],
  q_wyrm_sigils: [`È ora che tu sappia tutto, {playerName}. I Gravecaller servono Korzul il Gravewyrm, e ogni anima rubata alimenta il risveglio. Portami 3 sigilli dall'accesso al Santuario.`, `Sì... una litania del risveglio scritta per generazioni. Sono vicini, {playerName}.`],
  q_breaking_the_seal: [`Il sigillo del Santuario fu forgiato con fuoco di montagna. Porta 5 braci benedette dagli elementali, {playerName}, per aprirlo senza strapparlo.`, `Bruciano azzurre e pure. La montagna ricorda il suo antico giuramento.`],
  q_voice_below: [`Ieri tutto il campo si è inginocchiato verso il Santuario, {playerName}. Uccidi 10 zeloti e 6 negromanti prima che quella voce abbia abbastanza mani.`, `L'inginocchiarsi è finito. Non abbiamo zittito la voce, {playerName}; solo ridotto il suo coro.`],
  q_sanctum_gate: [`Questa è l'ultima soglia, {playerName}. La chiave del Santuario fu spezzata sotto gli occhi dei morti corazzati d'ossa. Portami 3 frammenti e aprirò la via in silenzio.`, `I frammenti combaciano e la porta riconosce la sua chiave. Raduna i più forti, {playerName}.`],
  q_korgath: [`Maren ha trovato catene grosse come alberi di nave e qualcosa di forma ogre che tirava, {playerName}. Porta quattro compagni e abbatti Korgath.`, `Korgath è spezzato infine. Persino le sue catene meritavano una fine più gentile.`],
  q_velkhar: [`Velkhar, primo dei Gravecaller, ha tessuto ogni filo e versa anime rubate nel Wyrm. Finiscilo, {playerName}.`, `Velkhar è morto e il rito è senza testa. Ma il Wyrm non dorme più.`],
  q_gravewyrm: [`Non resta alcun rito da fermare, {playerName}, solo il Wyrm mezzo desto. Entra con i tuoi compagni e finisci ciò che cominciò alla cappella.`, `È finita. I morti di tre terre riposano, e ogni campana canta il tuo nome, {playerName}.`],
} satisfies QuestNarrativeTranslations;

const ptQuestNarratives = {
  q_wolves: [`Os lobos da floresta atacam a estrada norte, {playerName}. Abata 8 antes que outra carroça desapareça entre os pinheiros.`, `Bom trabalho. A estrada já parece mais segura.`],
  q_greyjaw: [`Há um lobo que nunca caiu em armadilha: o velho Greyjaw. Ele ronda ao norte das trilhas dos lobos; traga a presa dele.`, `O velho demônio enfim morreu. O rapaz do estábulo dormirá melhor, e eu também.`],
  q_boars: [`Pele de javali faz ótimas mochilas de viagem, e os campos estão cheios deles. Traga-me 5 peles eriçadas.`, `Ah, belas peles eriçadas. Vão render bom preço.`],
  q_spiders: [`Os espreitadores de Webwood produzem a seda dos meus curativos, mas se multiplicaram demais. Mate 6 e corte 4 glândulas de seda.`, `Ugh, ainda se mexem. Perfeito. Você mereceu isto.`],
  q_murlocs: [`Pesquei no Lago Espelho até esses homens-peixe saírem dos baixios. Expulse 8 Barbatana-de-lodo e cuidado com os bandos.`, `Ha! Assim aprendem a ficar nos próprios lamaçais.`],
  q_mine: [`Abrimos uma boa veia de cobre e os kobolds jorraram da encosta. Derrube 10 escavadores rato de túnel.`, `Ha! De volta ao trabalho, rapazes! Você tem meu agradecimento e meu pagamento.`],
  q_bones: [`A velha capela era lugar de descanso até algo acordar seus mortos. Devolva 8 ossos inquietos à terra, {playerName}.`, `Que descansem agora, e que a Luz perdoe quem os despertou.`],
  q_supplies: [`Os bandidos levaram minha última carroça: ferramentas, sal e bom linho de Eastbrook. Recupere 4 caixas no acampamento sudeste.`, `Minhas caixas! Quase sem arranhões. Você é uma maravilha.`],
  q_whispers: [`Os mortos se levantam porque algo os chama. Procure na capela um selo ou sinal do chamador e traga intacto.`, `Este sigilo traz a marca dos Gravecallers. Eu rezava para que essa seita estivesse extinta, {playerName}.`],
  q_names_of_the_dead: [`Se os Gravecallers roubaram nossos túmulos, preciso saber quem foi tomado. Reúna 3 páginas do registro funerário, {playerName}.`, `Pobres almas... e veja: o sacristão Marrow foi o primeiro. Morthen começou pelo homem que enterrava Eastbrook.`],
  q_silence_the_call: [`Cada nome do registro é uma alma que Morthen quer arrancar da terra. Silencie 12 ossos inquietos, {playerName}, antes que o sussurro vire coro.`, `O pátio está mais quieto, mas o chamado agora sobe da cripta, {playerName}.`],
  q_rite: [`A cripta precisa ser aberta, mas só um rito de vínculo deixa vivos passarem. Preciso de 4 sebos abençoados e 6 essências espectrais.`, `Está feito. O caminho abaixo se abre... reúna seus companheiros mais fortes, {playerName}.`],
  q_hollow: [`Morthen espera no fundo da Cripta Vazia, cercado pelos mortos de elite que ergueu. Leve quatro companheiros e acabe com ele.`, `Os sussurros pararam. Os mortos dormem, {playerName}, e Eastbrook lhe deve tudo.`],
  q_sexton: [`O registro nomeia o sacristão Marrow, primeiro guardião erguido por Morthen. Desça com quatro companheiros e devolva o repouso roubado, {playerName}.`, `Marrow enfim está livre. Não toquem sinos por ele; ouviu sinos demais em vida.`],
  q_gravecallers_trail: [`Morthen está morto, mas sua seita não gastaria um século de silêncio por uma só capela. Procure o grimório nas ruínas, {playerName}.`, `Morthen escrevia a um Mistcaller no brejo ao norte. A seita não morreu, {playerName}; apenas esperou.`],
  q_bandits: [`Um bando de degoladores acampou nas colinas sudoeste. Três carroças foram roubadas esta semana. Mate 10 bandidos do Vale.`, `Dez lâminas a menos no escuro. Pegue isto, você mereceu.`],
  q_ringleader: [`Os bandidos obedecem a Gorrak, o Impiedoso. Corte a cabeça e o corpo se espalha. Acabe com ele, {playerName}.`, `Gorrak está morto? Então o Vale está livre da sombra dele.`],
  q_fenbridge_muster: [`Os escritos de Morthen citam um mestre no pântano do norte, e eu não acredito em coincidências, {playerName}. Pegue a ordem de concentração no portão de Fenbridge e apresente-a ao guardião.`, `O selo de Aldric, é? Então você serve. O pântano engole minhas patrulhas inteiras.`],
  q_prowlers: [`Os espreitadores aprenderam o som das mulas de suprimento e caçam na passarela. Mate 12, {playerName}.`, `Doze, e nenhuma mordida em você. A passarela respira melhor hoje.`],
  q_prowler_pelts: [`A passarela depende de peles de espreitador oleadas, e meu estoque acabou. Traga 8 peles intactas, {playerName}, antes que vadeemos até Eastbrook.`, `Boas peles grossas. A passarela sobreviverá a nós dois.`],
  q_fen_supplies: [`Uma caravana de Eastbrook desapareceu na névoa. Salve 5 cargas antes que o pântano termine de afundá-las.`, `Encharcadas, mas inteiras. O pântano guarda o que pega, {playerName}.`],
  q_deepfen: [`Os murlocs de Deepfen puxam coisas do fundo do lago. Mate 12 murlocs para descobrirmos o que os agita.`, `Isso os empurrará de volta à lama por um tempo. Mas algo os pôs a cavar.`],
  q_idols: [`Os homens-peixe agarram ídolos dragados do fundo como relíquias. Tome 5 dos murlocs de Deepfen.`, `Obra dos Gravecallers, mais antiga que Morthen. A seita começou aqui, {playerName}.`],
  q_deepfen_purge: [`Esses ídolos são do culto, e os murlocs erguem o velho mal do pântano aos braços. Mate mais 14.`, `Implacável e completo. Se este pântano secar, há trabalho de guardião para você.`],
  q_widows: [`O veneno de viúva tira a podridão das feridas, mas o matagal virou pesadelo. Mate 10 viúvas e corte 6 bolsas inteiras.`, `Todas inteiras. Você tem mãos mais firmes que metade dos cirurgiões do sul, {playerName}.`],
  q_broodmother: [`Teias grossas como cabos têm uma mãe. Abra caminho por 8 viúvas e mate a velha antes que a ninhada abra.`, `Morta de verdade? Então o matagal volta a ser só árvores. Que a Luz abençoe sua lâmina, {playerName}.`],
  q_drowned: [`Viajantes afogados saem dos lagos cobertos de ervas. Liberte 12 mortos afogados, {playerName}.`, `Cada um que cai é uma alma roubada solta outra vez.`],
  q_drowned_censers: [`A capela ao norte afundou com sua congregação, e seus mortos carregam incensários funerários. Recolha 4 no pátio.`, `Como eu temia: queimavam cinza de túmulo, e o rito está assinado por Voss.`],
  q_no_rest: [`Esse rito ergue os afogados onde quer que o pântano os toque. Ainda não podemos desfazê-lo; tire 14 soldados de seus mestres.`, `Você dá aos mortos mais misericórdia que os mestres deles. Pegue isto, você mereceu.`],
  q_trolls: [`Os trolls de Mirefen abriram túmulos mais velhos que reinos humanos, {playerName}. Expulse-os: 12 trolls mortos bastam.`, `Trolls não cavam sem motivo. Alguém de robe cinza mostrou onde.`],
  q_troll_fetishes: [`Esses fetiches não são obra troll: nós errados, ossos humanos, todos apontando aos túmulos. Traga 8.`, `Mesma mão dos estandartes do acampamento. Os trolls são só pás alugadas, {playerName}.`],
  q_grubjaw: [`Grubjaw não cava com os outros; comeu minhas duas últimas mulas, arreios e tudo. Ele ronda os túmulos mais a leste, {playerName}. Traga-me a presa dele.`, `Essa presa tem o tamanho do meu antebraço! As mulas estão vingadas.`],
  q_cult_camp: [`Ao norte, onde a névoa não se ergue, os Gravecallers acampam como donos do pântano. Derrube 12 cultistas, {playerName}.`, `Doze robes de cara na lama. Agora sabem que o pântano observa de volta.`],
  q_summoners: [`Os invocadores chamam os afogados como cães ao assobio. Silencie 8 e traga 4 cifras.`, `Cada cifra é contra-assinada pelo diácono Voss e endereçada ao Mistcaller. O mestre de Morthen, {playerName}. Encontramos o mestre.`],
  q_deacon: [`Voss canta meus guardiões afogados para fora dos lagos e os põe a servi-lo. Pegue a estrada do acampamento e enterre-o fundo, {playerName}.`, `Voss morreu e a névoa sobre o campo já afina. Agora resta o Bastião.`],
  q_bastion_door: [`O Bastião Submerso abriga o Mistcaller, e sua porta é selada por pedras tumulares. Traga uma pedra guardiã, {playerName}.`, `O selo se desfaz como corda podre. A porta está aberta, e a escuridão escuta.`],
  q_olen: [`Olen morreu defendendo o Bastião e agora guarda a porta como marionete. Essa vergonha acaba, {playerName}. Desça com quatro companheiros e dê a ele repouso.`, `A vigília dele terminou enfim. Eu mesmo gravarei seu nome no portão. Obrigado, {playerName}.`],
  q_mistcaller: [`Vael espera no fundo do Bastião, a voz que afogou cem viajantes. Leve quatro companheiros e acabe com ele, {playerName}.`, `Vael morreu e a névoa se levanta, mas suas últimas palavras gelam: o Wyrm se agita sob os picos. Descanse enquanto pode, {playerName}; as montanhas são o próximo destino.`],
  q_highwatch_summons: [`As últimas palavras de Vael não me deixam, {playerName}. Pegue a convocação de Highwatch e diga a Thessaly que Aldric sobe atrás de você.`, `Se Aldric sobe em pessoa, é tão ruim quanto eu temia. Bem-vindo a Highwatch, {playerName}.`],
  q_stalkers: [`Os felinos da crista descem famintos da neve e sangram minhas patrulhas. Abata 12, {playerName}.`, `Doze sombras a menos na crista. As patrulhas respirarão hoje à noite.`],
  q_stalker_pelts: [`O inverno desta montanha não bate, {playerName}, arromba a porta. Oito peles de rastreador forrarão capas para a muralha.`, `Grossas como meu braço. A guarda não congelará este ano.`],
  q_kobold_tunnels: [`Os kobolds de Deeprock cavam reto para baixo, como chamados sob a muralha, {playerName}. Mate 12 tuneladores.`, `Cada poço desce reto. Kobolds não cavam assim sozinhos.`],
  q_glowing_wax: [`A cera daqueles tuneladores brilha, {playerName}, e é quente como batimento. Traga 6 pedaços para os estudos de Caddis.`, `Ainda quente. Esse brilho não combina com nenhuma chama que o mestre conheça.`],
  q_ogre_edges: [`Os clãs de Thornpeak acamparam longe demais a leste, com pintura de guerra. Alguém os paga. Mate 12, {playerName}.`, `Doze caídos, e ainda não recuam. Quem os comprou pagou com algo mais pesado que ouro.`],
  q_ogre_totems: [`Os ogros ergueram totens de couro e crânio: sinal de concentração, não de saque. Derrube 6 e traga-os. Cuidado com os esmagadores no perímetro, {playerName}.`, `Crânio, couro... e amarras de escama de wyrm. Presentes do culto, {playerName}.`],
  q_ogre_bounty: [`Os clãs estão comprados e minha muralha é o primeiro serviço. Mate mais 14 ogros, {playerName}; pagarei por cabeça.`, `Recompensa paga inteira. As colinas estão mais quietas.`],
  q_crushers: [`Os esmagadores são a espinha do acampamento de Drogmar, cada um valendo três dos meus soldados. Quebre 10 com ajuda.`, `Dez esmagadores caídos. O acampamento é um corpo sem espinha.`],
  q_drogmar: [`Drogmar tomou a moeda do Wyrmcult e jurou os clãs ao despertar da montanha. Entre no acampamento e mate-o, {playerName}, por Highwatch.`, `Drogmar jaz morto no próprio campo. Você comprou um inverno para minha muralha, {playerName}.`],
  q_elementals: [`Stormcrag ficou silencioso por mil anos, e agora suas pedras andam. Os elementais não simplesmente despertam, {playerName}. Derrube 12 elementais para eu estudar o que restar.`, `Os fragmentos vibram como sinos tocados. A montanha não está furiosa, {playerName}... está sendo perturbada.`],
  q_shard_cores: [`No coração de cada elemental há um núcleo da tempestade. Seis juntos mostrarão o centro do distúrbio. Desconfio que já sei, {playerName}, e torço muito para estar errado.`, `Todos apontam ao sul como limalha para um ímã. Ao Santuário, {playerName}.`],
  q_kazzix: [`Kazzix arde mais que os outros, uma tempestade com ombros. Arranque seu fragmento de coração nos penhascos distantes.`, `O fragmento ainda estala! Magnífico. Pegue estas perneiras.`],
  q_zealots: [`O vento traz cânticos dos picos do sul. Silencie 12 zelotes, {playerName}; cada voz calada compra outra noite de sono.`, `O vento está mais quieto. O que me preocupa não é o cântico, {playerName}, é que algo talvez responda.`],
  q_cult_orders: [`Os zelotes se movem como soldados antes de um cerco. Cultistas que se organizam são cultistas recebendo ordens, {playerName}. Mate mais 8 e traga 4 conjuntos de ordens.`, `Esta letra veio do grimório de Morthen. A mesma mão guiou cada túmulo, {playerName}.`],
  q_necromancers: [`As ordens falam de um anel de filactérios, vasos de alma, {playerName}, ao redor do Santuário. Mate 8 necromantes e traga 3 intactos.`, `Que a Luz nos perdoe. Eles guardam os mortos do Vale e do pântano; nunca estavam erguendo um exército, {playerName}. Eram um dízimo.`],
  q_revenants: [`A leste da estrada há um velho campo de batalha. O culto ergueu seus ossos em placas enferrujadas. Ponha 12 de volta no chão, {playerName}.`, `Foram soldados, como os meus. O que os chamou não respeita os mortos.`],
  q_revenant_vanguard: [`Os revenantes formam fileiras reais, {playerName}. Quebre mais 14 antes que marchem ao Santuário.`, `Os campos estão parados de novo. Pegue isto; ninguém mereceu mais.`],
  q_wyrm_sigils: [`É hora de você saber de tudo, {playerName}. Os Gravecallers servem Korzul, o Gravewyrm, e cada alma roubada alimenta seu despertar. Traga 3 sigilos da aproximação do Santuário.`, `Sim... uma ladainha de despertar escrita por gerações. Estão perto, {playerName}.`],
  q_breaking_the_seal: [`O selo do Santuário foi forjado com fogo da montanha. Traga 5 brasas abençoadas dos elementais, {playerName}, para abri-lo sem rasgar.`, `Queimam azul e limpo. A montanha lembra seu antigo juramento.`],
  q_voice_below: [`Ontem o campo inteiro se ajoelhou para o Santuário, {playerName}. Mate 10 zelotes e 6 necromantes antes que essa voz tenha mãos suficientes.`, `Os joelhos se ergueram. Não silenciamos a voz, {playerName}; só afinamos seu coro.`],
  q_sanctum_gate: [`Este é o último limiar, {playerName}. A chave do Santuário foi quebrada sob os olhos dos mortos encouraçados de ossos. Traga 3 fragmentos e abrirei a passagem em silêncio.`, `Os fragmentos assentam e a porta reconhece a chave. Reúna os mais fortes, {playerName}.`],
  q_korgath: [`Maren achou correntes grossas como mastros, {playerName}, e algo em forma de ogro puxando-as. Leve quatro companheiros e derrube Korgath.`, `Korgath está quebrado enfim. Até as correntes mereciam fim mais gentil.`],
  q_velkhar: [`Velkhar, primeiro dos Gravecallers, teceu cada fio e despeja almas roubadas no Wyrm. Acabe com ele, {playerName}.`, `Velkhar morreu e o rito perdeu a cabeça. Mas o Wyrm já não dorme.`],
  q_gravewyrm: [`Não há rito a deter agora, {playerName}, só o Wyrm meio desperto. Entre com seus companheiros e termine o que começou na capela.`, `Acabou. Os mortos de três terras descansam, e cada sino canta seu nome, {playerName}.`],
} satisfies QuestNarrativeTranslations;

const zhCnQuestNarratives = {
  q_wolves: [`森林狼已经敢扑咬北路旅人，{playerName}。击败8只森林狼，让东溪能松一口气。`, `干得好。道路已经安全多了。`],
  q_greyjaw: [`老灰颚从未被陷阱困住。它在狼径北面的深林游荡，把它的尖牙带回来。`, `那头老恶狼终于死了。马厩里的孩子能睡安稳些，我也是。`],
  q_boars: [`野猪皮能做最好的行囊，镇外草地到处都是野猪。带回5张硬鬃野猪皮。`, `好结实的硬鬃皮！这些能卖个好价钱。`],
  q_spiders: [`网木潜伏者的丝能做药敷，但它们已经太多。杀死6只，再取4枚丝腺。`, `呃，还在抽动。正合适。这是你应得的。`],
  q_murlocs: [`我在镜湖打了二十年鱼，直到那些鱼人爬出浅滩。击退8个泥鳍潜伏者，小心它们成群而来。`, `哈！这会教它们待在自己的泥坑里。`],
  q_mine: [`我们刚挖到好铜脉，地道鼠就从山坡里涌出来。放倒10个地道鼠掘地者，让矿工回去开工。`, `哈！回去干活吧，伙计们！这是我的谢意和酬劳。`],
  q_bones: [`旧礼拜堂曾是安息之地，如今有东西唤醒了死者。让8具不宁骸骨归土，{playerName}。`, `愿他们从此安息，也愿圣光宽恕唤醒他们之物。`],
  q_supplies: [`强盗抢走了我的最后一辆货车，工具、盐和东溪亚麻都在里面。去东南山丘的营地夺回4个补给箱。`, `我的箱子！几乎没有划痕。你真让人惊喜。`],
  q_whispers: [`死者又爬起来，因为有什么在召唤他们。搜索礼拜堂遗址，把召唤者留下的徽记完整带给我。`, `这枚徽记有唤墓者的印记。我曾祈祷这个教派早已灭绝，{playerName}。`],
  q_names_of_the_dead: [`如果唤墓者盗用了我们的墓地，我必须知道他们偷走了谁。收集3页葬册残页，{playerName}。`, `可怜的亡魂...看这里，司事马罗是第一个。莫森从埋葬东溪死者的人开始。`],
  q_silence_the_call: [`名册上的每个名字都是莫森想拖出泥土的灵魂。{playerName}，在低语变成合唱前，让12具不宁骸骨沉寂。`, `墓园安静了些，可召唤如今从墓穴下方升起，{playerName}。`],
  q_rite: [`必须开启礼拜堂下的墓穴，但只有束缚仪式能让生者通过。我需要4块祝福油脂和6份幽魂精华。`, `完成了。下方的路已经打开...召集最强的同伴再下去，{playerName}。`],
  q_hollow: [`莫森在空洞墓穴底部等着，身边是他唤起的精英亡者。带上四名同伴，终结他。`, `低语停了。死者终于沉睡，{playerName}，东溪欠你一切。`],
  q_sexton: [`葬册写着司事马罗的名字，他是莫森唤起的第一个守门人。{playerName}，带四名同伴下墓穴，还给他被夺走的安息。`, `马罗终于自由了。别为他敲钟，他生前听得够多了。`],
  q_gravecallers_trail: [`莫森死了，但潜伏百年的教派不会只为一座村庄礼拜堂现身。去废墟里找他的魔典，{playerName}。`, `莫森写信给北方湿地的一名唤雾者。{playerName}，教派并未死去，只是在等待。`],
  q_bandits: [`一群割喉强盗在西南山丘扎营，本周已经抢了三辆货车。击杀10名谷地强盗。`, `黑夜里少了十把刀。拿着吧，这是你挣来的。`],
  q_ringleader: [`强盗听命于无情者戈拉克。斩掉头，身体就会散。除掉他，{playerName}。`, `戈拉克死了？那谷地摆脱了他的阴影。`],
  q_fenbridge_muster: [`莫森的书信提到北方沼泽里有一位主人。{playerName}，取下芬桥门柱上的集结令，交给守望者。`, `奥德里克的印记？那你能用。湿地正把我的巡逻队整支吞掉。`],
  q_prowlers: [`泥沼潜伏兽已经学会补给骡的声音，开始在栈道上狩猎。杀死12只，{playerName}。`, `十二只，你身上还没伤。今晚栈道能喘口气。`],
  q_prowler_pelts: [`栈道靠浸油的潜伏兽皮包木桩才撑得住，我的库存见底了。{playerName}，带回8张完好的毛皮。`, `好厚的皮。现在这条栈道会比我们俩都长久。`],
  q_fen_supplies: [`一支东溪商队三天前进了雾中，再没敲响城门铃。趁货物还没沉没，救回5批物资。`, `泡了水，但还完整。湿地会留下它抓住的一切，{playerName}。`],
  q_deepfen: [`深沼鱼人二十年都待在浅滩，如今却从湖底拖东西上来。击杀12个钳咬鱼人。`, `这会把它们赶回泥里一阵子。但一定有什么让它们开始挖掘。`],
  q_idols: [`守望者说鱼人把湖底捞起的神像当圣物抱着。夺来5个，我必须亲眼确认。`, `这是唤墓者的手笔，比莫森还古老。教派不是从东溪开始的，{playerName}。`],
  q_deepfen_purge: [`这些神像是邪教造物，鱼人正一捧一捧把湿地旧恶挖上来。回浅滩再杀14个。`, `冷酷又彻底。如果这片湿地有天干涸，你倒适合做守望者。`],
  q_widows: [`寡妇蛛毒能从伤口里拔出湿地腐毒，但灌木丛已经成了噩梦。杀10只寡妇蛛，取6个完整毒囊。`, `每个毒囊都完整。你的手比南方一半外科医师都稳，{playerName}。`],
  q_broodmother: [`你见过那些网，能织出腕粗蛛索的东西就在灌木丛上方。杀8只寡妇蛛，再杀蛛母。`, `真的死了？那片灌木丛终于只是树了。{playerName}，愿圣光保佑你的利刃。`],
  q_drowned: [`在栈道淹死的旅人正披着水草从湖里走出。让12个溺亡死者安息，{playerName}。`, `你击倒的每一个，都是被偷走的灵魂重获自由。`],
  q_drowned_censers: [`北边的礼拜堂随会众一起沉入湿地，死者还带着葬礼香炉。去院里收集4个。`, `正如我担心的，这些香炉烧的是墓灰，不是香。仪式署名是沃斯。`],
  q_no_rest: [`香炉上的仪式会让溺亡者在湿地触及之处复起。我们还无法破除它，只能先少给敌人14名士兵。`, `你给了死者比他们主人更多的怜悯。拿着，你早已应得。`],
  q_trolls: [`泥沼巨魔挖开了古老坟丘，{playerName}，比任何人类王国都古老。赶走它们，杀12个就够。`, `巨魔不会无缘无故挖掘。有人穿着灰袍告诉它们该挖哪里。`],
  q_troll_fetishes: [`那些护符不是巨魔手艺，结法不对，骨头是人骨，而且全指向敞开的坟丘。带回8个。`, `和邪教营地旗帜出自同一人之手。巨魔不过是雇来的铲子，{playerName}。`],
  q_grubjaw: [`格鲁布颚连其他巨魔都不愿靠近。它吃掉了我最后两头驮骡，连挽具也没剩。{playerName}，带回它的獠牙。`, `那根獠牙有我前臂那么长！驮骡终于得报了仇。`],
  q_cult_camp: [`向北越过第三片湖，雾从不散。唤墓者公开扎营，像已经拥有这片湿地。砍倒12名教徒，{playerName}。`, `十二件灰袍倒在泥里。现在他们知道湿地也会回望。`],
  q_summoners: [`玛伦报告说召唤师能像吹哨唤犬一样，把溺亡者从水里叫起。杀8个，带回4份密文。`, `每份密文都由执事沃斯副署，并递往堡垒里的唤雾者。莫森的主人，{playerName}，我们找到他了。`],
  q_deacon: [`沃斯站在营地中心，把我淹死的守望者唱出湖面为他效命。沿营路北上，把他埋深些，{playerName}。`, `沃斯死了，营地的雾已经变薄。你打碎了湿地里的声音，只剩堡垒。`],
  q_bastion_door: [`沉没堡垒就是唤雾者唱颂溺水圣歌的地方。邪教用墓石封住门，{playerName}，带回一块护符石。`, `结界像烂绳一样分开。门开了，门后的黑暗正在聆听。`],
  q_olen: [`奥伦守着堡垒直到沉没，如今却被唤雾者当傀儡守门。这耻辱该结束了，{playerName}。带四名同伴下去，给他应得的安息。`, `他的守望终于结束。我会亲自把他的名字刻在门上。谢谢你，{playerName}。`],
  q_mistcaller: [`维尔在堡垒底部等待，他的声音淹死百名旅人来筑军。带四名同伴，终结他，{playerName}。`, `维尔死了，雾第一次散开。但他的遗言让我血冷：{playerName}，Wyrm在群峰下苏醒。`],
  q_highwatch_summons: [`维尔的遗言仍在我耳边，{playerName}：Wyrm在群峰下苏醒。取下高望召令，告诉瑟萨莉我随后上山。`, `奥德里克的消息传得很远。若他亲自上山，事情就和我担心的一样糟。{playerName}，欢迎来到高望。`],
  q_stalkers: [`山脊猫从雪线下来，饿得撕咬我的巡逻队。先杀12只，{playerName}。`, `山脊上少了十二道阴影。今晚巡逻队能喘口气。`],
  q_stalker_pelts: [`{playerName}，这座山的冬天不会敲门，它会踹门。8张山脊潜猎者皮能为守墙披风加衬。`, `厚得像我的手臂。今年守望者不会冻死。`],
  q_kobold_tunnels: [`深岩的狗头人往不该挖的深处直挖，像有东西在呼唤。它们的隧道就在我们城墙下，{playerName}。杀12个深岩掘地者。`, `每条竖井都笔直向下。狗头人不会自己这样挖。`],
  q_glowing_wax: [`凯迪斯给我看了一支从掘地者身上拿来的蜡，{playerName}，发光又温热如心跳。带回6块发光蜡块。`, `还暖着。博学者说这光不属于任何他知道的火焰。`],
  q_ogre_edges: [`荆峰氏族从不来这么东边，如今却涂着战漆扎营。有人付了钱，{playerName}。砍倒12个。`, `十二个倒下，他们还是不退。买下他们的人付的不是普通黄金。`],
  q_ogre_totems: [`食人魔在营地周围竖起皮与颅骨的图腾，那是集结，不是劫掠。拆下6个带回来。当心外围的碾压者，{playerName}。`, `颅骨、兽皮...还有Wyrm鳞绑带。这些图腾是邪教送的礼，{playerName}。`],
  q_ogre_bounty: [`图腾说明氏族已被收买，而我的城墙是他们第一件差事。再杀14个荆峰食人魔，{playerName}。`, `赏金全数付清。山麓安静些了，现在该找买主。`],
  q_crushers: [`德罗格玛的战争营地盘踞在峭壁里，粉碎者是它的脊骨，每个都抵我三名士兵。带人击溃10个。`, `十个粉碎者倒下。战争营地失去了脊骨。`],
  q_drogmar: [`德罗格玛收了龙教的报酬，把氏族献给山脉苏醒。他是砸向城墙的锤——而当他砸向地面时，{playerName}，别站在他身边。进营地杀了他。`, `德罗格玛死在自己的营地。氏族会散向高山隘口，你为我的城墙买来一个冬天，{playerName}。`],
  q_elementals: [`风暴岩沉默千年，如今石头自己站起来行走。元素不会无缘无故苏醒，{playerName}。击倒12个元素，好让我研究残片。`, `碎片像被敲响的钟一样嗡鸣。山不是愤怒，{playerName}，它正被惊扰。`],
  q_shard_cores: [`每个元素心中都有风暴核心，石中缚着闪电。并列6枚就能告诉我扰动的中心。{playerName}，我恐怕我已经知道答案，只盼自己想错了。`, `每枚核心都朝同一方向倾斜，像铁屑指向磁石。它们指向南方，{playerName}。去圣所。`],
  q_kazzix: [`元素中有一个燃得更亮：碎片领主卡兹克斯，一场有肩膀的风暴。去远处峭壁夺下它的心裂片。`, `心裂片还在噼啪作响！太好了。拿上这些护腿，我是凭猜测和祈祷量的。`],
  q_zealots: [`{playerName}，南峰吹来的风带着圣歌。龙教不再隐藏，他们在圣所下扎营，对地下沉睡之物歌唱。让12名狂热者闭嘴。`, `风安静了些。但让我不安的不是歌声，{playerName}，而是也许有什么在回应。`],
  q_cult_orders: [`狂热者现在有岗哨、有清点，像围城前的士兵。会组织的邪教徒就是在听令的邪教徒，{playerName}。杀8个并带回4份书面命令。`, `这笔迹...我在东溪莫森的魔典里见过。每座坟后都是同一只手，{playerName}。`],
  q_necromancers: [`命令提到一圈护命匣，{playerName}，灵魂容器围着圣所供养它。杀8名死灵法师，带回3个完整护命匣。`, `愿圣光宽恕我们。里面装着谷地和湿地的死者，所有被收割的灵魂。{playerName}，他们从来不是在组建军队，而是在征收贡赋。`],
  q_revenants: [`圣所路东有片古战场，上一支攻山军的先锋已埋两百年。邪教叫醒了他们，穿着锈甲。{playerName}，让12个归土。`, `他们也曾是士兵，像我的人一样。召唤他们的东西不尊重死者。`],
  q_revenant_vanguard: [`亡魂正在列队，{playerName}，真正的盾线和纵队。再击溃14个，别让那场向圣所的行军开始。`, `战场再次静了。拿着吧，这是为守墙者打造的，没有人比你更配。`],
  q_wyrm_sigils: [`{playerName}，你该知道全貌了。唤墓者侍奉墓龙科祖尔，每个被偷走的灵魂都是倒入苏醒的贡品。带回3枚圣所徽记。`, `没错...一篇苏醒祷文，写了好几代。他们很近了，{playerName}。`],
  q_breaking_the_seal: [`圣所封印由山火铸成，只有山火能让我们通过而不撕裂它。{playerName}，带回5枚祝福余烬。`, `它们蓝而纯净地燃烧。山记得古老的誓言。`],
  q_voice_below: [`昨夜整个营地同时跪向圣所，{playerName}。科祖尔已经在他们梦里说话。杀10名狂热者和6名死灵法师。`, `跪拜停止了。我们没有让那声音沉默，{playerName}，只是削薄了它的合唱。`],
  q_sanctum_gate: [`最后的门槛到了，{playerName}。邪教把圣所门钥石击碎，碎片散在门前广场。带回3片，我会悄悄开启道路。`, `碎片归位了，门认出了自己的钥匙。召集你能找到的最强同伴，{playerName}。`],
  q_korgath: [`玛伦最后一次扫过圣所口，{playerName}，发现粗如船桅的锁链和一个食人魔形体在其中挣扎。带四名同伴击倒科加斯。`, `科加斯终于被打碎。连他的锁链也配得到更温柔的结局。`],
  q_velkhar: [`我们追踪的每条线，莫森、维尔、护命匣，都由一只手编织：大死灵法师维尔卡。终结他，{playerName}。`, `维尔卡死了，仪式失去了头。但你也感觉到了吧？灵魂已经耗尽，Wyrm不再沉睡。`],
  q_gravewyrm: [`没有仪式可阻止了，{playerName}，只剩半醒的Wyrm，吞食了谷地和湿地的死者。带同伴进洞，完成我们从礼拜堂开始的事。`, `结束了。三地死者得以安息，山也不再被鬼魂惊扰——今晚从这里到东溪，每一口钟鸣响的，都是你的名字，{playerName}。`],
} satisfies QuestNarrativeTranslations;

const zhTwQuestNarratives = {
  q_wolves: [`森林狼已敢撲咬北路旅人，{playerName}。擊敗8隻森林狼，讓東溪能鬆一口氣。`, `做得好。道路已經安全多了。`],
  q_greyjaw: [`老灰顎從未被陷阱困住。牠在狼徑北面的深林遊蕩，把牠的尖牙帶回來。`, `那頭老惡狼終於死了。馬廄裡的孩子能睡安穩些，我也是。`],
  q_boars: [`野豬皮能做最好的行囊，鎮外草地到處都是野豬。帶回5張硬鬃野豬皮。`, `好結實的硬鬃皮！這些能賣個好價錢。`],
  q_spiders: [`網木潛伏者的絲能做藥敷，但牠們已經太多。殺死6隻，再取4枚絲腺。`, `呃，還在抽動。正合適。這是你應得的。`],
  q_murlocs: [`我在鏡湖打了二十年魚，直到那些魚人爬出淺灘。擊退8個泥鰭潛伏者，小心牠們成群而來。`, `哈！這會教牠們待在自己的泥坑裡。`],
  q_mine: [`我們剛挖到好銅脈，地道鼠就從山坡裡湧出來。放倒10個地道鼠掘地者，讓礦工回去開工。`, `哈！回去幹活吧，夥計們！這是我的謝意和酬勞。`],
  q_bones: [`舊禮拜堂曾是安息之地，如今有東西喚醒了死者。讓8具不寧骸骨歸土，{playerName}。`, `願他們從此安息，也願聖光寬恕喚醒他們之物。`],
  q_supplies: [`強盜搶走了我的最後一輛貨車，工具、鹽和東溪亞麻都在裡面。去東南山丘的營地奪回4個補給箱。`, `我的箱子！幾乎沒有刮痕。你真讓人驚喜。`],
  q_whispers: [`死者又爬起來，因為有什麼在召喚他們。搜尋禮拜堂遺址，把召喚者留下的徽記完整帶給我。`, `這枚徽記有喚墓者的印記。我曾祈禱這個教派早已滅絕，{playerName}。`],
  q_names_of_the_dead: [`如果喚墓者盜用了我們的墓地，我必須知道他們偷走了誰。收集3頁葬冊殘頁，{playerName}。`, `可憐的亡魂...看這裡，司事馬羅是第一個。莫森從埋葬東溪死者的人開始。`],
  q_silence_the_call: [`名冊上的每個名字都是莫森想拖出泥土的靈魂。{playerName}，在低語變成合唱前，讓12具不寧骸骨沉寂。`, `墓園安靜了些，可召喚如今從墓穴下方升起，{playerName}。`],
  q_rite: [`必須開啟禮拜堂下的墓穴，但只有束縛儀式能讓生者通過。我需要4塊祝福油脂和6份幽魂精華。`, `完成了。下方的路已經打開...召集最強的同伴再下去，{playerName}。`],
  q_hollow: [`莫森在空洞墓穴底部等著，身邊是他喚起的精英亡者。帶上四名同伴，終結他。`, `低語停了。死者終於沉睡，{playerName}，東溪欠你一切。`],
  q_sexton: [`葬冊寫著司事馬羅的名字，他是莫森喚起的第一個守門人。{playerName}，帶四名同伴下墓穴，還給他被奪走的安息。`, `馬羅終於自由了。別為他敲鐘，他生前聽得夠多了。`],
  q_gravecallers_trail: [`莫森死了，但潛伏百年的教派不會只為一座村莊禮拜堂現身。去廢墟裡找他的魔典，{playerName}。`, `莫森寫信給北方濕地的一名喚霧者。{playerName}，教派並未死去，只是在等待。`],
  q_bandits: [`一群割喉強盜在西南山丘紮營，本週已經搶了三輛貨車。擊殺10名谷地強盜。`, `黑夜裡少了十把刀。拿著吧，這是你掙來的。`],
  q_ringleader: [`強盜聽命於無情者戈拉克。斬掉頭，身體就會散。除掉他，{playerName}。`, `戈拉克死了？那谷地擺脫了他的陰影。`],
  q_fenbridge_muster: [`莫森的書信提到北方沼澤裡有一位主人。我不相信巧合，{playerName}。取下芬橋門柱上的集結令，交給守望者。`, `奧德里克的印記？那你能用。濕地正把我的巡邏隊整支吞掉。`],
  q_prowlers: [`泥沼潛伏獸已經學會補給騾的聲音，開始在棧道上狩獵。殺死12隻，{playerName}。`, `十二隻，你身上還沒傷。今晚棧道能喘口氣。`],
  q_prowler_pelts: [`棧道靠浸油的潛伏獸皮包木樁才撐得住，我的庫存見底了。{playerName}，帶回8張完好的毛皮。`, `好厚的皮。現在這條棧道會比我們倆都長久。`],
  q_fen_supplies: [`一支東溪商隊三天前進了霧中，再沒敲響城門鈴。趁貨物還沒沉沒，救回5批物資。`, `泡了水，但還完整。濕地會留下它抓住的一切，{playerName}。`],
  q_deepfen: [`深沼魚人二十年都待在淺灘，如今卻從湖底拖東西上來。擊殺12個鉗咬魚人。`, `這會把牠們趕回泥裡一陣子。但一定有什麼讓牠們開始挖掘。`],
  q_idols: [`守望者說魚人把湖底撈起的神像當聖物抱著。奪來5個，我必須親眼確認。`, `這是喚墓者的手筆，比莫森還古老。教派不是從東溪開始的，{playerName}。`],
  q_deepfen_purge: [`這些神像是邪教造物，魚人正一捧一捧把濕地舊惡挖上來。回淺灘再殺14個。`, `冷酷又徹底。如果這片濕地有天乾涸，你倒適合做守望者。`],
  q_widows: [`寡婦蛛毒能從傷口裡拔出濕地腐毒，但灌木叢已經成了噩夢。殺10隻寡婦蛛，取6個完整毒囊。`, `每個毒囊都完整。你的手比南方一半外科醫師都穩，{playerName}。`],
  q_broodmother: [`你見過那些網，能織出腕粗蛛索的東西就在灌木叢上方。殺8隻寡婦蛛，再殺蛛母。`, `真的死了？那片灌木叢終於只是樹了。願聖光祝福你的劍刃，{playerName}。`],
  q_drowned: [`在棧道淹死的旅人正披著水草從湖裡走出。讓12個溺亡死者安息，{playerName}。`, `你擊倒的每一個，都是被偷走的靈魂重獲自由。`],
  q_drowned_censers: [`北邊的禮拜堂隨會眾一起沉入濕地，死者還帶著葬禮香爐。去院裡收集4個。`, `正如我擔心的，這些香爐燒的是墓灰，不是香。儀式署名是沃斯。`],
  q_no_rest: [`香爐上的儀式會讓溺亡者在濕地觸及之處復起。我們還無法破除它，只能先少給敵人14名士兵。`, `你給了死者比他們主人更多的憐憫。拿著，你早已應得。`],
  q_trolls: [`{playerName}，泥沼巨魔挖開了古老墳丘，比任何人類王國都古老。趕走牠們，殺12個就夠。`, `巨魔不會無緣無故挖掘。有人穿著灰袍告訴牠們該挖哪裡。`],
  q_troll_fetishes: [`那些護符不是巨魔手藝，結法不對，骨頭是人骨，而且全指向敞開的墳丘。帶回8個。`, `和邪教營地旗幟出自同一人之手。巨魔不過是雇來的鏟子，{playerName}。`],
  q_grubjaw: [`格魯布顎連其他巨魔都不願靠近。牠吃掉了我最後兩頭馱騾，連挽具也沒剩。{playerName}，帶回牠的獠牙。`, `那根獠牙有我前臂那麼長！馱騾終於得報了仇。`],
  q_cult_camp: [`向北越過第三片湖，霧從不散。喚墓者公開紮營，像已經擁有這片濕地。砍倒12名教徒，{playerName}。`, `十二件灰袍倒在泥裡。現在他們知道濕地也會回望。`],
  q_summoners: [`瑪倫報告說召喚師能像吹哨喚犬一樣，把溺亡者從水裡叫起。殺8個，帶回4份密文。`, `每份密文都由執事沃斯副署，並遞往堡壘裡的喚霧者。莫森的主人，{playerName}。我們找到他了。`],
  q_deacon: [`沃斯站在營地中心，把我淹死的守望者唱出湖面為他效命。沿營路北上，把他埋深些，{playerName}。`, `沃斯死了，營地的霧已經變薄。你打碎了濕地裡的聲音，只剩堡壘。`],
  q_bastion_door: [`沉沒堡壘就是喚霧者唱頌溺水聖歌的地方。邪教用墓石封住門，{playerName}，帶回一塊護符石。`, `結界像爛繩一樣分開。門開了，門後的黑暗正在聆聽。`],
  q_olen: [`奧倫守著堡壘直到沉沒，如今卻被喚霧者當傀儡守門。這恥辱該結束了，{playerName}。帶四名同伴下去，給他應得的安息。`, `他的守望終於結束。我會親自把他的名字刻在門上。謝謝你，{playerName}。`],
  q_mistcaller: [`維爾在堡壘底部等待，他的聲音淹死百名旅人來築軍。帶四名同伴，終結他，{playerName}。`, `維爾死了，霧第一次散開。但他的遺言讓我血冷：Wyrm在群峰下甦醒。教派侍奉的東西比我們猜想的更古老，{playerName}。`],
  q_highwatch_summons: [`維爾的遺言仍在我耳邊，{playerName}：Wyrm在群峰下甦醒。取下高望召令，告訴瑟薩莉我隨後上山。`, `奧德里克的消息傳得很遠。若他親自上山，事情就和我擔心的一樣糟。歡迎來到高望，{playerName}。`],
  q_stalkers: [`山脊貓從雪線下來，餓得撕咬我的巡邏隊。先殺12隻，{playerName}。`, `山脊上少了十二道陰影。今晚巡邏隊能喘口氣。`],
  q_stalker_pelts: [`{playerName}，這座山的冬天不會敲門，它會踹門。8張山脊潛獵者皮能為守牆披風加襯。`, `厚得像我的手臂。今年守望者不會凍死。`],
  q_kobold_tunnels: [`深岩的狗頭人往不該挖的深處直挖，像有東西在呼喚。牠們的隧道穿過我們的城牆下，{playerName}。殺12個深岩掘地者。`, `每條豎井都筆直向下。狗頭人不會自己這樣挖。`],
  q_glowing_wax: [`凱迪斯給我看了一支從掘地者身上拿來的蠟，{playerName}，發光又溫熱如心跳。帶回6塊發光蠟塊。`, `還暖著。博學者說這光不屬於任何他知道的火焰。`],
  q_ogre_edges: [`荊峰氏族從不來這麼東邊，如今卻塗著戰漆紮營。有人付了錢，{playerName}。砍倒12個。`, `十二個倒下，他們還是不退。買下他們的人付的不是普通黃金。`],
  q_ogre_totems: [`食人魔在營地周圍豎起皮與顱骨的圖騰，那是集結，不是劫掠。拆下6個帶回來。小心外圍的碾壓者，{playerName}。`, `顱骨、獸皮...還有Wyrm鱗綁帶。這些圖騰是邪教送的禮，{playerName}。`],
  q_ogre_bounty: [`圖騰說明氏族已被收買，而我的城牆是他們第一件差事。再殺14個荊峰食人魔，{playerName}。`, `賞金全數付清。山麓安靜些了，現在該找買主。`],
  q_crushers: [`德羅格瑪的戰爭營地盤踞在峭壁裡，粉碎者是它的脊骨，每個都抵我三名士兵。帶人擊潰10個。`, `十個粉碎者倒下。戰爭營地失去了脊骨。`],
  q_drogmar: [`德羅格瑪收了龍教的報酬，把氏族獻給山脈甦醒。他是砸向城牆的錘，當他砸向地面時，{playerName}，別站在他附近。進營地殺了他。`, `德羅格瑪死在自己的營地。氏族會散向高山隘口，你為我的城牆買來一個冬天，{playerName}。`],
  q_elementals: [`風暴岩沉默千年，如今石頭自己站起來行走。元素不會無故甦醒，{playerName}。擊倒12個元素，好讓我研究殘片。`, `碎片像被敲響的鐘一樣嗡鳴。山不是憤怒，{playerName}，它正被驚擾。`],
  q_shard_cores: [`每個元素心中都有風暴核心，石中縛著閃電。並列6枚就能告訴我擾動的中心。我恐怕已經知道答案，{playerName}，也衷心希望自己錯了。`, `每枚核心都朝同一方向傾斜，像鐵屑指向磁石。它們指向南邊，{playerName}。去聖所。`],
  q_kazzix: [`元素中有一個燃得更亮：碎片領主卡茲克斯，一場有肩膀的風暴。去遠處峭壁奪下它的心裂片。`, `心裂片還在劈啪作響！太好了。拿上這些護腿，我是憑猜測和祈禱量的。`],
  q_zealots: [`當風從南峰吹來時，{playerName}，它帶著聖歌。龍教不再隱藏，他們在聖所下紮營，對地下沉睡之物歌唱。讓12名狂熱者閉嘴。`, `風安靜了些。但讓我不安的不是歌聲，{playerName}，而是也許有什麼在回應。`],
  q_cult_orders: [`狂熱者現在有崗哨、有清點，像圍城前的士兵。會組織起來的邪教徒，就是在聽令的邪教徒，{playerName}。殺8個並帶回4份書面命令。`, `這筆跡...我在東溪莫森的魔典裡見過。每座墳後都是同一隻手，{playerName}。`],
  q_necromancers: [`命令提到一圈護命匣，{playerName}，靈魂容器圍著聖所供養它。殺8名死靈法師，帶回3個完整護命匣。`, `願聖光寬恕我們。裡面裝著谷地和濕地的死者，所有被收割的靈魂。他們從來不是在組建軍隊，{playerName}。他們是在收取貢稅。`],
  q_revenants: [`聖所路東有片古戰場，上一支攻山軍的先鋒已埋兩百年。邪教叫醒了他們，穿著鏽甲。{playerName}，讓12個歸土。`, `他們也曾是士兵，像我的人一樣。召喚他們的東西不尊重死者。`],
  q_revenant_vanguard: [`亡魂正在列隊，{playerName}，真正的盾線和縱隊。再擊潰14個，別讓那場向聖所的行軍開始。`, `戰場再次靜了。拿著吧，這是為守牆者打造的，沒有人比你更配。`],
  q_wyrm_sigils: [`{playerName}，你該知道全貌了。喚墓者侍奉墓龍科祖爾，每個被偷走的靈魂都是倒入甦醒的貢品。帶回3枚聖所徽記。`, `沒錯...一篇甦醒禱文，寫了好幾代。他們很近了，{playerName}。`],
  q_breaking_the_seal: [`聖所封印由山火鑄成，只有山火能讓我們通過而不撕裂它。帶回5枚祝福餘燼，{playerName}。`, `它們藍而純淨地燃燒。山記得古老的誓言。`],
  q_voice_below: [`昨夜整個營地同時跪向聖所，{playerName}。科祖爾已經在他們夢裡說話。殺10名狂熱者和6名死靈法師。`, `跪拜停止了。我們沒有讓那聲音沉默，{playerName}，只是削薄了它的合唱。`],
  q_sanctum_gate: [`這是最後的門檻了，{playerName}。邪教把聖所門鑰石擊碎，碎片散在門前廣場。帶回3片，我會悄悄開啟道路。`, `碎片歸位了，門認出了自己的鑰匙。召集你能找到的最強同伴，{playerName}。`],
  q_korgath: [`瑪倫最後一次掃過聖所口，{playerName}，發現粗如船桅的鎖鏈和一個食人魔形體在其中掙扎。帶四名同伴擊倒科加斯。`, `科加斯終於被打碎。連他的鎖鏈也配得到更溫柔的結局。`],
  q_velkhar: [`我們追蹤的每條線，莫森、維爾、護命匣，都由一隻手編織：大死靈法師維爾卡。終結他，{playerName}。`, `維爾卡死了，儀式失去了頭。但你也感覺到了吧？靈魂已經耗盡，Wyrm不再沉睡。`],
  q_gravewyrm: [`沒有儀式可阻止了，{playerName}，只剩半醒的Wyrm，吞食了谷地和濕地的死者。帶同伴進洞，完成我們從禮拜堂開始的事。`, `結束了。三地死者得以安息，山也不再被鬼魂驚擾，今晚每一口鐘鳴響的，都是你的名字，{playerName}。`],
} satisfies QuestNarrativeTranslations;

const jaQuestNarratives = {
  q_wolves: [`森の狼が北の道で旅人に牙をむけています、{playerName}。8頭を討ち、イーストブルックに息をつかせてください。`, `見事です。道はもう少し安全になりました。`],
  q_greyjaw: [`老グレイジョーだけは罠にかかったことがありません。狼道の北の奥森をうろついています。牙を持ち帰ってください。`, `あの古い悪魔もついに死にました。厩の少年も、私も、少し眠れるでしょう。`],
  q_boars: [`猪の皮は旅袋に最適です。町外れの草地に獣が満ちています。剛毛猪の皮を5枚持ってきてください。`, `いい剛毛の皮です。高く売れるでしょう。`],
  q_spiders: [`ウェブウッドの潜伏者は薬布に使う絹を出しますが、増えすぎました。6匹を倒し、絹腺を4つ切り取ってください。`, `うう、まだ動いています。完璧です。これはあなたの取り分です。`],
  q_murlocs: [`鏡の湖で二十年漁をしてきましたが、魚人が浅瀬から這い出しました。泥ひれを8体追い払い、群れに注意を。`, `はっ！自分たちの泥穴にこもることを覚えるでしょう。`],
  q_mine: [`よい銅脈を掘り当てた途端、コボルドが丘から湧きました。トンネルラット掘りを10体倒してください。`, `よし、仕事に戻れ、皆！礼と報酬を受け取ってください。`],
  q_bones: [`古い礼拝堂は眠りの場でしたが、何かが死者を起こしました。安らがぬ骨を8体、土へ返してください、{playerName}。`, `彼らが今こそ眠れますように。そして起こしたものを光が赦しますように。`],
  q_supplies: [`盗賊が最後の荷車を奪いました。道具、塩、上等なイーストブルックの麻です。南東の野営地から箱を4つ取り戻してください。`, `私の箱です！傷もほとんどありません。あなたは大した人です。`],
  q_whispers: [`死者は何かに呼び戻されています。礼拝堂を調べ、呼び声の主の印か封を見つけたら無傷で持ってきてください。`, `この印はグレイブコーラーのものです。滅んだと思いたかった一派でした、{playerName}。`],
  q_names_of_the_dead: [`グレイブコーラーが墓を暴いたなら、誰の眠りが奪われたのか知る必要があります。埋葬記録のページを3枚集めてください、{playerName}。`, `哀れな魂たち...ここに墓守マロウの名があります。モーセンはイーストブルックの死者を埋めた男から始めたのです。`],
  q_silence_the_call: [`記録の名はすべて、モーセンが土から引き出そうとする魂です。{playerName}、囁きが合唱になる前に、安らがぬ骨を12体沈めてください。`, `墓地は静まりましたが、呼び声は今や地下の墓所から昇っています、{playerName}。`],
  q_rite: [`墓所を開くには、束縛の儀式で生者の道を作る必要があります。祝福された獣脂を4つ、幽霊のエッセンスを6つ集めてください。`, `終わりました。下への道が開きます...最も強い仲間を集めてください、{playerName}。`],
  q_hollow: [`モーセンは虚ろの墓所の底で、起こした精鋭の死者に囲まれています。四人の仲間と共に彼を終わらせてください。`, `囁きは止みました。死者は眠り、イーストブルックはあなたにすべてを負っています、{playerName}。`],
  q_sexton: [`記録には墓守マロウの名があります。モーセンが最初に起こした門番です。{playerName}、四人の仲間と下り、奪われた眠りを返してください。`, `マロウはようやく自由です。鐘は鳴らさないでください。生前に十分聞きました。`],
  q_gravecallers_trail: [`モーセンは死にましたが、一世紀潜んだ一派が一つの礼拝堂だけで終わるはずがありません。{playerName}、廃墟で彼の魔導書を探してください。`, `モーセンは北の湿地のミストコーラーに書いていました。{playerName}、一派は死んでいません。ただ待っていたのです。`],
  q_bandits: [`南西の丘に盗賊団がいます。今週だけで荷車を三台襲いました。谷の盗賊を10人倒してください。`, `闇の中の刃が十本減りました。これはあなたのものです。`],
  q_ringleader: [`盗賊は無慈悲なるゴラックに従います。頭を落とせば体は散ります。彼を討ってください、{playerName}。`, `ゴラックが死んだ？なら谷はその影から解放されました。`],
  q_fenbridge_muster: [`モーセンの書き物は北の湿地の主を名指ししています。{playerName}、私は偶然を信じません。フェンブリッジの門柱から召集令を取り、番人へ届けてください。`, `アルドリックの印ですか。なら役に立ちます。湿地は私の巡察を丸ごと飲み込んでいます。`],
  q_prowlers: [`沼の徘徊者は補給ラバの音を覚え、土手道そのものを狩っています。12体を倒してください、{playerName}。`, `十二体、しかも噛まれていない。今夜の土手道は少し楽に息をします。`],
  q_prowler_pelts: [`土手道は油を染み込ませた徘徊者の皮で支えられています。備蓄が尽きました。{playerName}、無傷の毛皮を8枚持ってきてください。`, `よい厚い毛皮です。土手道は私たちより長く持つでしょう。`],
  q_fen_supplies: [`イーストブルックの隊商が霧に入り、戻りませんでした。湿地が沈めきる前に荷を5つ救い出してください。`, `水浸しでも無事です。湿地は捕まえたものを忘れません、{playerName}。`],
  q_deepfen: [`ディープフェンの魚人が湖底から何かを引き上げています。スナッパーを12体討ち、その理由を探りましょう。`, `しばらくは泥へ押し戻せます。だが、何かが掘らせているのです。`],
  q_idols: [`魚人は湖底の偶像を聖遺物のように抱えています。スナッパーから5つ奪ってください。`, `グレイブコーラーの業です。モーセンより古い。すべてはここで始まったのです、{playerName}。`],
  q_deepfen_purge: [`偶像は教団のものです。魚人は古い悪を湿地からすくい上げています。浅瀬へ戻り、さらに14体倒してください。`, `容赦なく徹底しています。この湿地が乾いたら、あなたには番人の仕事があります。`],
  q_widows: [`寡婦蜘蛛の毒は傷の腐れを抜きますが、茂みは悪夢になりました。10匹を倒し、毒嚢を6つ無傷で取ってください。`, `すべて無傷です。南の外科医の半分より手が確かですね、{playerName}。`],
  q_broodmother: [`腕ほど太い糸を紡ぐものがいます。寡婦蜘蛛を8匹焼き払い、群れの母を倒してください。`, `本当に死にましたか。なら茂みはただの木々に戻ります。{playerName}、光があなたの刃を祝福しますように。`],
  q_drowned: [`{playerName}、土手道で溺れた旅人が、水草をまとって湖から歩き出しています。溺れ死者を12体眠らせてください。`, `倒した一体ごとに、盗まれた魂が解き放たれます。`],
  q_drowned_censers: [`北の礼拝堂は会衆ごと沈み、死者は葬礼の香炉を持っています。墓地で4つ集めてください。`, `恐れていた通りです。香ではなく墓灰を焚いていた。儀式にはヴォスの名があります。`],
  q_no_rest: [`その儀式は湿地が触れる場所で溺死者を起こします。まだ壊せませんが、兵を14体減らせます。`, `あなたは死者に、主たちより多くの慈悲を与えました。受け取ってください。`],
  q_trolls: [`{playerName}、マイアフェンのトロルが、人の王国より古い塚を開きました。12体倒して追い払ってください。`, `トロルは理由なしに掘りません。灰色のローブが場所を教えたのでしょう。`],
  q_troll_fetishes: [`その護符はトロル製ではありません。結び目が違い、人骨で、すべて開いた塚を指しています。8つ持ってきてください。`, `教団の旗と同じ作り手です。トロルは雇われたシャベルにすぎません、{playerName}。`],
  q_grubjaw: [`グラブジョーは他のトロルも避ける大食らいです。最後の荷ラバ二頭を馬具ごと食べました。{playerName}、牙を持ってきてください。`, `前腕ほどの牙です！ラバたちの仇は討たれました。`],
  q_cult_camp: [`三つ目の湖の北、霧が晴れぬ場所にグレイブコーラーが堂々といます。{playerName}、彼らはもう勝ったつもりでいます。信徒を12人倒してください。`, `十二のローブが泥に伏しました。湿地も見返すと知ったでしょう。`],
  q_summoners: [`召喚師は笛に応じる犬のように溺死者を水から呼びます。8人を沈黙させ、暗号を4つ持ち帰ってください。`, `暗号はすべて助祭ヴォスの副署で、砦のミストコーラー宛てです。モーセンの主です、{playerName}。見つけました。`],
  q_deacon: [`ヴォスは溺れた番人を歌で湖から呼び、仕えさせています。{playerName}、野営地の道を進み、深く埋めてください。`, `ヴォスは死に、野営地の霧は薄れています。残るは砦だけです。`],
  q_bastion_door: [`沈んだ砦はミストコーラーの場所で、扉は墓石で封じられています。{playerName}、護り石を一つ持ってきてください。`, `封印は腐った縄のようにほどけます。扉は開き、闇が耳を澄ませています。`],
  q_olen: [`オレンは砦を守って溺れ、今は操り人形として同じ扉を守っています。{playerName}、四人の仲間と下り、眠らせてください。`, `彼の見張りはようやく終わりました。門に名を刻むのは私がやります。ありがとう、{playerName}。`],
  q_mistcaller: [`ヴァエルは砦の底にいます。百人を溺れさせ、軍を作った声です。四人の仲間と終わらせてください、{playerName}。`, `ヴァエルは死に、霧は晴れています。だが最後の言葉は血を凍らせます。Wyrmが峰の下で動く、と。{playerName}、今のうちに休んでください。次は山です。`],
  q_highwatch_summons: [`ヴァエルの最後の言葉が離れません、{playerName}。ハイウォッチ召喚状を取り、テサリーにアルドリックが後から登ると伝えてください。`, `アルドリックが自ら山へ来るなら、恐れていた通りです。ハイウォッチへようこそ、{playerName}。`],
  q_stalkers: [`尾根の猫が雪から飢えて下り、私の巡察を傷つけています。まず12頭倒してください、{playerName}。`, `尾根の影が十二減りました。今夜、巡察は息をつけます。`],
  q_stalker_pelts: [`{playerName}、この山の冬は扉を叩かず、蹴破ります。追跡者の毛皮8枚で壁の外套を裏打ちできます。`, `腕ほど厚い毛皮です。今年の見張りは凍えずに済みます。`],
  q_kobold_tunnels: [`ディープロックのコボルドは、壁の下から呼ばれているように真下へ掘っています。{playerName}、坑夫を12体倒してください。`, `どの坑も真下です。コボルドだけではこう掘りません。`],
  q_glowing_wax: [`坑夫のろうは光り、{playerName}、鼓動のように温かい。キャディスの研究のために6塊持ってきてください。`, `まだ温かい。博識者の知る炎とは違う光です。`],
  q_ogre_edges: [`ソーンピークの氏族が東へ出すぎて、戦化粧で野営しています。{playerName}、誰かが払っています。12体倒してください。`, `十二倒れても退きません。買った者は金より重いもので払ったのでしょう。`],
  q_ogre_totems: [`オーガは皮と頭蓋のトーテムを立てました。襲撃ではなく集結の印です。6つ倒して持ち帰ってください。{playerName}、周囲の粉砕者に気をつけて。`, `頭蓋、皮...そしてWyrmの鱗の結び。教団の贈り物です、{playerName}。`],
  q_ogre_bounty: [`氏族は買われ、私の壁が最初の用件です。{playerName}、ソーンピーク・オーガをさらに14体、報奨金つきで倒してください。`, `報奨金は全額です。丘陵は少し静かになりました。`],
  q_crushers: [`ドログマーの戦営で粉砕者は背骨です。一体が兵三人分。仲間と共に10体を砕いてください。`, `粉砕者が十体倒れました。戦営は背骨のない体です。`],
  q_drogmar: [`ドログマーはワーム教団の金を取り、山の目覚めへ氏族を誓わせました。{playerName}、彼が地を打つときは近くに立たないように。戦営に入り、ハイウォッチのために討ってください。`, `ドログマーは自分の野営地で死にました。あなたは壁に冬を一つ買ってくれました、{playerName}。`],
  q_elementals: [`ストームクラッグは千年沈黙していましたが、今は石が歩いています。{playerName}、精霊を12体倒し、残骸を調べさせてください。`, `破片は打たれた鐘のように鳴ります。{playerName}、山は怒っていません、乱されているのです。`],
  q_shard_cores: [`精霊の心には嵐の核があります。6つ並べれば、乱れの中心が分かります。{playerName}、私はもう答えを知っている気がします。間違いであることを切に願います。`, `すべて南を向きます。磁石に寄る鉄粉のように。聖所へ、{playerName}。`],
  q_kazzix: [`カジックスは他より明るく燃えます。肩を持った嵐です。遠い岩場で心臓片をもぎ取ってください。`, `心臓片はまだ弾けています！見事です。礼にこの脚具を。`],
  q_zealots: [`南の峰からの風が詠唱を運びます。信徒を12人沈黙させてください、{playerName}。声が止まるほど山は眠れます。`, `風は静かです。{playerName}、怖いのは詠唱ではなく、何かが返しているかもしれないことです。`],
  q_cult_orders: [`信徒は攻城前の兵のように動いています。{playerName}、8人を倒し、書かれた命令を4組持ってきてください。`, `この筆跡はモーセンの魔導書と同じです。すべての墓を導いた同じ手です、{playerName}。`],
  q_necromancers: [`命令は経箱の輪を語っています。{playerName}、聖所を養う魂の器です。死霊術師を8人倒し、3つを壊さず持ってきてください。`, `光よ、赦したまえ。谷と湿地の死者が入っています。{playerName}、これは軍ではなく、貢ぎ物でした。`],
  q_revenants: [`聖所道の東には古い戦場があります。教団は錆びた甲冑の骨を起こしました。{playerName}、12体を土へ戻してください。`, `彼らも兵でした。私の兵と同じです。起こしたものは死者を敬いません。`],
  q_revenant_vanguard: [`亡霊は本物の隊列を組んでいます、{playerName}。聖所へ行進する前に、さらに14体を砕いてください。`, `野は再び静まりました。受け取ってください。これほどふさわしい者はいません。`],
  q_wyrm_sigils: [`{playerName}、全てを知る時です。グレイブコーラーは墓ワームのコルズルに仕え、盗んだ魂を目覚めの貢ぎ物にしています。印章を3つ持ってきてください。`, `はい...何世代も書かれた目覚めの連祷です。彼らは近い、{playerName}。`],
  q_breaking_the_seal: [`聖所の封印は山火で作られました。同じ火だけが裂かずに道を開きます。{playerName}、祝福された残り火を5つ持ってきてください。`, `青く清く燃えています。山は古い誓いを覚えています。`],
  q_voice_below: [`{playerName}、昨夜、野営地全体が聖所へ膝をつきました。コルズルは夢で語っています。信徒10人と死霊術師6人を倒してください。`, `跪きは止まりました。声を黙らせたのではなく、合唱を薄くしただけです、{playerName}。`],
  q_sanctum_gate: [`{playerName}、最後の敷居です。教団は聖所の要石を砕き、広場に散らしました。3片を持ち帰れば、静かに開けます。`, `破片は合い、門は鍵を知りました。最も強い仲間を集めてください、{playerName}。`],
  q_korgath: [`マレンは聖所口で船のマストほどの鎖と、縛られたオーガの影を見つけました。{playerName}、四人の仲間とコルガスを倒してください。`, `コルガスはついに砕けました。彼の鎖でさえ、もっと優しい終わりに値しました。`],
  q_velkhar: [`モーセン、ヴァエル、経箱、すべての糸は大死霊術師ヴェルカーが紡ぎました。彼を終わらせてください、{playerName}。`, `ヴェルカーは死に、儀式は頭を失いました。けれど感じたでしょう。Wyrmはもう眠っていません。`],
  q_gravewyrm: [`止める儀式はもうありません、{playerName}。半ば目覚めたWyrmだけです。仲間と入り、礼拝堂で始めたことを終わらせてください。`, `終わりました。三つの地の死者は休み、山は憑かれずに眠ります。{playerName}、今夜すべての鐘があなたの名を鳴らします。`],
} satisfies QuestNarrativeTranslations;

const koQuestNarratives = {
  q_wolves: [`숲늑대들이 북쪽 길의 여행자들을 물어뜯고 있습니다, {playerName}. 8마리를 처치해 이스트브룩이 숨 돌리게 해 주십시오.`, `훌륭합니다. 길이 벌써 더 안전해졌습니다.`],
  q_greyjaw: [`어떤 덫에도 걸리지 않은 늑대가 있습니다. 늙은 그레이죠입니다. 늑대길 북쪽 깊은 숲에서 그 송곳니를 가져오십시오.`, `그 늙은 악마가 드디어 죽었군요. 마구간 소년도, 나도 편히 잘 수 있겠습니다.`],
  q_boars: [`멧돼지 가죽은 여행용 꾸러미에 좋고, 들판에는 멧돼지가 가득합니다. 억센 멧돼지 가죽 5장을 가져오십시오.`, `좋은 억센 가죽입니다. 값이 꽤 나가겠군요.`],
  q_spiders: [`그물나무 잠복자의 비단은 찜질약에 필요하지만, 숫자가 너무 늘었습니다. 6마리를 죽이고 비단샘 4개를 잘라 오십시오.`, `윽, 아직 꿈틀거립니다. 완벽합니다. 보상을 받으십시오.`],
  q_murlocs: [`나는 거울호수에서 이십 년을 낚시했습니다. 저 물고기 인간들이 얕은 물에서 기어 나오기 전까지는요. 진흙지느러미 8마리를 몰아내십시오.`, `하! 이제 제 진흙구덩이를 지키는 법을 배우겠지요.`],
  q_mine: [`좋은 구리 광맥을 찾자마자 코볼트들이 언덕에서 쏟아졌습니다. 굴쥐 채굴꾼 10마리를 처치해 광부들을 돌려보내십시오.`, `하! 다시 일하러 가라, 친구들! 감사와 보수를 받으십시오.`],
  q_bones: [`옛 예배당은 안식의 땅이었지만, 무언가가 죽은 자들을 깨웠습니다. 불안한 뼈무더기 8구를 흙으로 돌려보내십시오, {playerName}.`, `이제 쉬기를. 그리고 그들을 깨운 것을 빛이 용서하기를.`],
  q_supplies: [`도적들이 내 마지막 마차를 털었습니다. 도구, 소금, 이스트브룩 아마가 들었습니다. 남동쪽 야영지에서 보급 상자 4개를 되찾아 주십시오.`, `내 상자들입니다! 흠집도 거의 없군요. 대단합니다.`],
  q_whispers: [`죽은 자들이 다시 일어납니다. 무언가가 부르고 있기 때문입니다. 예배당을 수색해 부르는 자의 표식을 온전하게 가져오십시오.`, `이 인장은 무덤부름의 표식입니다. 이 교단이 사라졌기를 바랐는데, {playerName}.`],
  q_names_of_the_dead: [`무덤부름이 우리 무덤을 더럽혔다면 누구의 잠을 훔쳤는지 알아야 합니다. {playerName}이여, 매장 장부 페이지 3장을 모아 오십시오.`, `가엾은 영혼들... 여기 성구지기 매로우가 처음입니다. 모르덴은 이스트브룩의 죽은 자를 묻던 사람부터 시작했습니다.`],
  q_silence_the_call: [`장부의 모든 이름은 모르덴이 흙에서 끌어내려는 영혼입니다. {playerName}이여, 속삭임이 합창이 되기 전에 불안한 뼈 12구를 잠재우십시오.`, `묘지는 조용해졌지만, 부름은 이제 묘실 아래에서 올라옵니다, {playerName}.`],
  q_rite: [`묘실을 열어야 하지만, 산 자가 지나가려면 속박 의식이 필요합니다. 축복받은 수지 4개와 유령 정수 6개를 가져오십시오.`, `끝났습니다. 아래로 가는 길이 열렸습니다... 가장 강한 동료들을 모으십시오, {playerName}.`],
  q_hollow: [`모르덴은 텅 빈 묘실 밑바닥에서 자신이 일으킨 정예 망자들에게 둘러싸여 있습니다. 네 동료와 함께 끝내십시오.`, `속삭임이 멎었습니다. {playerName}이여, 온 계곡이 하지 못한 일을 그대가 해냈습니다. 죽은 자들은 잠들었고, 이스트브룩은 당신에게 모든 것을 빚졌습니다.`],
  q_sexton: [`장부에는 성구지기 매로우의 이름이 있습니다. 모르덴이 처음 일으킨 문지기입니다. {playerName}이여, 네 동료와 내려가 빼앗긴 안식을 돌려주십시오.`, `매로우가 마침내 자유롭습니다. 종은 울리지 마십시오. 살아서 충분히 들었습니다.`],
  q_gravecallers_trail: [`모르덴은 죽었지만, 한 세기 숨어 있던 교단이 한 예배당 때문에 움직였을 리 없습니다. {playerName}이여, 폐허에서 그의 마법서를 찾으십시오.`, `모르덴은 북쪽 습지의 안개부름에게 편지를 보냈습니다. {playerName}이여, 교단은 죽지 않았고, 기다렸을 뿐입니다.`],
  q_bandits: [`남서쪽 언덕에 칼잡이들이 야영하고 있습니다. 이번 주에 마차 셋을 털었습니다. 계곡 도적 10명을 처치하십시오.`, `어둠 속 칼이 열 자루 줄었습니다. 받으십시오, 벌어낸 보상입니다.`],
  q_ringleader: [`도적들은 무자비한 고라크를 따릅니다. 머리를 자르면 몸은 흩어집니다. 그를 끝내십시오, {playerName}.`, `고라크가 죽었습니까? 그럼 계곡은 그의 그림자에서 벗어났습니다.`],
  q_fenbridge_muster: [`모르덴의 글은 북쪽 습지의 주인을 말합니다. 나는 우연을 믿지 않습니다, {playerName}이여. 펜브리지 문기둥의 소집 명령서를 가져와 감시관에게 보이십시오.`, `알드릭의 인장입니까? 그럼 충분합니다. 습지가 내 순찰대를 통째로 삼키고 있습니다.`],
  q_prowlers: [`수렁 배회자들은 보급 노새 소리를 익히고 둑길까지 사냥합니다. 12마리를 처치하십시오, {playerName}.`, `열둘, 물린 자국도 없군요. 오늘 밤 둑길이 한숨 돌리겠습니다.`],
  q_prowler_pelts: [`둑길은 기름 먹인 배회자 가죽으로 말뚝을 감싸 버팁니다. 재고가 없습니다. {playerName}이여, 우리 모두가 이스트브룩까지 물을 헤치기 전에 온전한 가죽 8장을 가져오십시오.`, `두꺼운 좋은 가죽입니다. 이제 둑길은 우리 둘보다 오래 버틸 겁니다.`],
  q_fen_supplies: [`이스트브룩 대상단이 사흘 전 안개 속으로 들어간 뒤 돌아오지 않았습니다. 습지가 삼키기 전에 물품 5묶음을 구하십시오.`, `젖었지만 온전합니다. 습지는 잡은 것을 놓지 않습니다, {playerName}.`],
  q_deepfen: [`딥펜 멀록들이 호수 바닥에서 무언가를 끌어올리고 있습니다. 무는이 12마리를 처치해 그 이유를 알아봅시다.`, `한동안은 진흙으로 밀려날 겁니다. 하지만 무언가가 그들을 파게 만들었습니다.`],
  q_idols: [`물고기 인간들이 바닥에서 건진 우상을 성물처럼 안고 있습니다. 딥펜 무는이에게서 5개를 빼앗아 오십시오.`, `무덤부름의 작품입니다. 모르덴보다 오래되었습니다. 교단은 여기서 시작된 것입니다, {playerName}.`],
  q_deepfen_purge: [`그 우상들은 교단의 물건이고, 멀록들은 습지의 오래된 악을 퍼 올리고 있습니다. 얕은 물로 돌아가 14마리를 더 처치하십시오.`, `무자비하고 철저합니다. 이 습지가 마르면 감시관 일을 맡아도 되겠습니다.`],
  q_widows: [`과부거미 독은 상처의 습지 부패를 빼내지만, 덤불은 악몽이 되었습니다. 10마리를 죽이고 독주머니 6개를 온전하게 가져오십시오.`, `모두 온전합니다. 남쪽 외과의 절반보다 손이 안정적입니다, {playerName}.`],
  q_broodmother: [`밧줄 같은 거미줄을 짜는 어미가 있습니다. 과부거미 8마리를 뚫고 거미어미를 쓰러뜨리십시오.`, `정말 죽었습니까? 그럼 덤불은 다시 나무일 뿐입니다. 빛이 그대의 검을 축복하기를, {playerName}이여.`],
  q_drowned: [`{playerName}이여, 둑길에서 익사한 여행자들이 수초를 두르고 호수에서 걸어 나옵니다. 익사한 망자 12구를 쉬게 하십시오.`, `쓰러진 하나하나가 훔쳐진 영혼을 풀어 줍니다.`],
  q_drowned_censers: [`북쪽 예배당은 신도들과 함께 잠겼고, 죽은 자들은 장례 향로를 들고 있습니다. 마당에서 4개를 모아 오십시오.`, `두려운 대로입니다. 향이 아니라 무덤재를 태웠습니다. 의식에는 보스의 서명이 있습니다.`],
  q_no_rest: [`그 의식은 습지가 닿는 곳마다 익사자를 일으킵니다. 아직 풀 수 없지만, 병사 14구를 주인에게서 빼앗을 수 있습니다.`, `당신은 죽은 자들에게 주인들보다 큰 자비를 베풀었습니다. 받으십시오.`],
  q_trolls: [`{playerName}이여, 마이어펜 트롤들이 인간 왕국보다 오래된 봉분을 찢어 열었습니다. 12마리를 죽여 쫓아내십시오.`, `트롤은 이유 없이 파지 않습니다. 회색 로브가 어디를 팔지 알려준 겁니다.`],
  q_troll_fetishes: [`그 부적들은 트롤 솜씨가 아닙니다. 매듭도 틀리고, 사람 뼈이며, 열린 봉분을 가리킵니다. 8개를 가져오십시오.`, `교단 깃발과 같은 손입니다. 트롤은 고용된 삽에 불과합니다, {playerName}.`],
  q_grubjaw: [`그럽죠는 다른 트롤도 피합니다. 내 마지막 짐노새 두 마리를 마구째 먹었습니다. {playerName}이여, 그 엄니를 가져오십시오.`, `내 팔뚝만 한 엄니군요! 노새들의 원수는 갚았습니다.`],
  q_cult_camp: [`셋째 호수 북쪽, 안개가 걷히지 않는 곳에 무덤부름이 대놓고 야영합니다. 교단원 12명을 베십시오, {playerName}.`, `회색 로브 열둘이 진흙에 엎어졌습니다. 이제 습지도 되돌아본다는 걸 알겠지요.`],
  q_summoners: [`소환사들은 휘파람에 개를 부르듯 익사자를 물에서 부릅니다. 8명을 침묵시키고 암호문 4장을 가져오십시오.`, `모든 암호문은 부제 보스가 부서했고, 요새의 안개부름에게 보낸 것입니다. 모르덴의 주인입니다, {playerName}이여. 찾았습니다.`],
  q_deacon: [`보스는 익사한 감시관들을 호수에서 노래로 불러 섬기게 합니다. 야영지 길을 따라가 깊이 묻어 버리십시오, {playerName}.`, `보스는 죽었고 야영지의 안개가 옅어집니다. 이제 요새만 남았습니다.`],
  q_bastion_door: [`가라앉은 요새는 안개부름의 자리이고, 문은 묘석으로 봉해져 있습니다. {playerName}이여, 수호석 하나를 가져오면 내가 봉인을 풀겠습니다.`, `봉인이 썩은 밧줄처럼 갈라집니다. 문이 열렸고, 어둠이 듣고 있습니다.`],
  q_olen: [`올렌은 요새를 지키다 익사했고, 이제 꼭두각시가 되어 같은 문을 지킵니다. 그 치욕을 끝내십시오, {playerName}이여. 네 동료와 내려가 안식을 주십시오.`, `그의 경계가 마침내 끝났습니다. 문에 새길 이름은 내가 직접 새기겠습니다. 고맙습니다, {playerName}이여.`],
  q_mistcaller: [`바엘은 요새 밑바닥에서 기다립니다. 백 명의 여행자를 익사시켜 군대를 만든 목소리입니다. 그를 끝내십시오, {playerName}이여. 네 동료와 함께라면 습지의 죽은 자들도 마침내 잠들 것입니다.`, `바엘은 죽었고 안개가 걷힙니다. 그러나 마지막 말이 피를 얼립니다. Wyrm이 봉우리 아래서 꿈틀댄다고 했습니다. {playerName}이여, 할 수 있을 때 쉬십시오. 다음은 산입니다.`],
  q_highwatch_summons: [`바엘의 마지막 말이 떠나지 않습니다, {playerName}. 하이워치 소환장을 들고 테살리에게 알드릭이 뒤따라 산을 오른다고 전하십시오.`, `알드릭이 직접 오른다면 두려워하던 만큼 나쁜 일입니다. 하이워치에 온 것을 환영합니다, {playerName}이여.`],
  q_stalkers: [`산등성이 고양이들이 눈 아래에서 굶주려 내려와 순찰대를 물어뜯습니다. 먼저 12마리를 처치하십시오, {playerName}.`, `산등성이의 그림자가 열둘 줄었습니다. 오늘 밤 순찰대가 숨 돌리겠습니다.`],
  q_stalker_pelts: [`{playerName}이여, 이 산의 겨울은 문을 두드리지 않고 걷어찹니다. 추적자 가죽 8장이 성벽 망토를 덧댈 겁니다.`, `내 팔만큼 두껍습니다. 올해 경비대는 얼지 않겠습니다.`],
  q_kobold_tunnels: [`딥록 코볼트들이 성벽 아래에서 부르는 것처럼 곧장 아래로 파고 있습니다. {playerName}이여, 굴꾼 12마리를 처치하십시오.`, `모든 갱도가 곧장 아래입니다. 코볼트가 혼자 이렇게 파지는 않습니다.`],
  q_glowing_wax: [`굴꾼에게서 나온 밀랍은 빛나고, {playerName}이여, 심장처럼 따뜻합니다. 캐디스의 연구를 위해 빛나는 밀랍 6개를 가져오십시오.`, `아직 따뜻합니다. 이 빛은 현자가 아는 어떤 불꽃과도 맞지 않습니다.`],
  q_ogre_edges: [`쏜피크 부족들이 너무 동쪽에 전쟁칠을 하고 야영했습니다. 누군가 값을 치렀습니다, {playerName}이여. 12마리를 베십시오.`, `열둘이 쓰러졌지만 물러나지 않습니다. 그들을 산 자는 금보다 무거운 것을 냈습니다.`],
  q_ogre_totems: [`오우거들은 가죽과 해골 토템을 세웠습니다. 약탈이 아니라 소집의 표식입니다. 6개를 쓰러뜨려 가져오십시오. 외곽의 분쇄자들을 조심하십시오, {playerName}이여.`, `해골, 가죽... 그리고 Wyrm 비늘 끈입니다. 교단의 선물입니다, {playerName}.`],
  q_ogre_bounty: [`부족들은 매수되었고 내 성벽이 첫 임무입니다. 쏜피크 오우거 14마리를 더 처치하십시오, {playerName}. 현상금을 치르겠습니다.`, `현상금은 전액 지급합니다. 구릉이 조금 조용해졌습니다.`],
  q_crushers: [`드로그마르 전쟁 야영지의 분쇄자는 척추입니다. 하나가 내 병사 셋 값입니다. 동료와 10마리를 꺾으십시오.`, `분쇄자 열이 쓰러졌습니다. 야영지는 척추 없는 몸입니다.`],
  q_drogmar: [`드로그마르는 고룡교단의 돈을 받고 부족들을 산의 깨어남에 맹세시켰습니다. 그가 땅을 내리칠 때, {playerName}이여, 곁에 서 있지 마십시오. 전쟁 야영지에 들어가 하이워치를 위해 죽이십시오.`, `드로그마르가 제 야영지에서 죽었습니다. 당신은 내 성벽에 겨울 하나를 사 주었습니다, {playerName}.`],
  q_elementals: [`스톰크래그는 천 년 동안 조용했지만 이제 돌이 걷습니다. {playerName}이여, 정령은 그저 깨어나지 않습니다. 12마리를 쓰러뜨려 잔해를 연구하게 해 주십시오.`, `파편들이 울린 종처럼 웅웅댑니다. {playerName}이여, 산은 화난 것이 아니라 방해받고 있습니다.`],
  q_shard_cores: [`정령의 심장에는 폭풍 핵이 있습니다. 여섯 개를 나란히 놓으면 흔들림의 중심을 알 수 있습니다. 이미 짐작은 하고 있습니다, {playerName}이여. 부디 내 짐작이 틀리기를 바랍니다.`, `모두 남쪽을 가리킵니다. 자석으로 끌리는 쇳가루처럼. 성소입니다, {playerName}.`],
  q_kazzix: [`카직스는 다른 것보다 더 밝게 탑니다. 어깨 달린 폭풍입니다. 먼 바위에서 심장파편을 뽑아 오십시오.`, `아직도 파직댑니다! 훌륭합니다. 이 다리갑옷을 받으십시오.`],
  q_zealots: [`남쪽 봉우리의 바람이 성가를 실어 옵니다. 광신자 12명을 침묵시키십시오, {playerName}. 멎는 목소리마다 산이 하룻밤 더 잡니다.`, `바람은 조용해졌습니다. {playerName}이여, 두려운 건 노래가 아니라 무언가 대답할지도 모른다는 겁니다.`],
  q_cult_orders: [`광신자들은 공성 전 병사처럼 움직입니다. 조직된 광신자는 명령을 받는 광신자입니다, {playerName}이여. 8명을 더 죽이고 명령서 4묶음을 가져오십시오.`, `이 필체는 모르덴의 마법서에서 본 것입니다. 모든 무덤을 같은 손이 이끌었습니다, {playerName}.`],
  q_necromancers: [`명령서는 성소 둘레의 성물함 고리를 말합니다. 영혼 그릇입니다, {playerName}이여. 강령술사 8명을 죽이고 3개를 온전하게 가져오십시오.`, `빛이여 용서하소서. 계곡과 습지의 죽은 자들이 담겨 있습니다. {playerName}이여, 그들은 군대를 만든 것이 아니라 십일조를 거두고 있었습니다.`],
  q_revenants: [`성소 길 동쪽에는 오래된 전장이 있습니다. 교단이 녹슨 갑옷의 뼈들을 일으켰습니다. {playerName}이여, 12구를 흙으로 돌려보내십시오.`, `그들도 한때 병사였습니다. 내 병사들과 같습니다. 그들을 부른 것은 죽은 자를 존중하지 않습니다.`],
  q_revenant_vanguard: [`망령들이 진짜 대열을 짭니다, {playerName}. 성소로 행군하기 전에 14구를 더 꺾으십시오.`, `들판이 다시 고요합니다. 받으십시오. 이보다 더 자격 있는 이는 없습니다.`],
  q_wyrm_sigils: [`{playerName}이여, 이제 전부 알아야 합니다. 무덤부름은 무덤고룡 코르줄을 섬기며, 훔친 영혼마다 깨어남의 공물이 됩니다. 인장 3개를 가져오십시오.`, `그렇습니다... 세대를 거쳐 쓰인 깨어남의 기도입니다. 그들은 가까이 왔습니다, {playerName}.`],
  q_breaking_the_seal: [`성소의 봉인은 산불로 빚어졌습니다. 같은 불만이 찢지 않고 길을 엽니다. {playerName}이여, 축복받은 불씨 5개를 가져오십시오. 교단이 먼저 문을 열면 조심하지 않을 것이고, Wyrm은 곱게 깨어나지 않을 테니.`, `푸르고 맑게 탑니다. 산은 오래된 맹세를 기억합니다.`],
  q_voice_below: [`어젯밤 온 야영지가 성소를 향해 무릎 꿇었습니다, {playerName}이여. 코르줄이 꿈속에서 말합니다. 광신자 10명과 강령술사 6명을 처치하십시오.`, `무릎 꿇음은 멈췄습니다. 목소리를 침묵시킨 게 아니라 합창을 줄였을 뿐입니다, {playerName}.`],
  q_sanctum_gate: [`마지막 문턱입니다, {playerName}이여. 교단은 성소 열쇠돌을 깨뜨려 광장에 흩었습니다. 3조각을 가져오면 조용히 열겠습니다.`, `조각들이 맞고 문이 제 열쇠를 알아봅니다. 가장 강한 동료들을 모으십시오, {playerName}.`],
  q_korgath: [`{playerName}이여, 마렌은 성소 입구에서 돛대 같은 사슬과 그 안에서 버티는 오우거 형상을 보았습니다. 네 동료와 코르가스를 쓰러뜨리십시오.`, `코르가스가 마침내 부서졌습니다. 그의 사슬조차 더 나은 끝을 받을 만했습니다.`],
  q_velkhar: [`모르덴, 바엘, 성물함까지 모든 실은 대강령술사 벨카르가 엮었습니다. 그를 끝내십시오, {playerName}.`, `벨카르는 죽었고 의식은 머리를 잃었습니다. 하지만 느꼈겠지요. Wyrm은 더 이상 잠들지 않습니다.`],
  q_gravewyrm: [`멈출 의식은 없습니다, {playerName}. 반쯤 깬 Wyrm뿐입니다. 동료들과 들어가 예배당에서 시작한 일을 끝내십시오.`, `끝났습니다. 세 땅의 죽은 자들이 쉬고 산은 혼령 없이 잠듭니다. 오늘 밤 여기서 이스트브룩까지 모든 종이 울리는 것은 바로 그대의 이름입니다, {playerName}이여.`],
} satisfies QuestNarrativeTranslations;

const ruQuestNarratives = {
  q_wolves: [`Лесные волки осмелели и бросаются на путников у северной дороги, {playerName}. Убейте 8, чтобы Истврук вздохнул свободнее.`, `Хорошая работа. Дорога уже кажется безопаснее.`],
  q_greyjaw: [`Есть волк, которого не удержала ни одна ловушка: старый Серочелюст. Он рыщет к северу от волчьих троп. Принесите его клык.`, `Старый дьявол наконец мертв. Конюший мальчишка будет спать спокойнее, и я тоже.`],
  q_boars: [`Кабанья шкура годится для лучших дорожных сумок, а луга полны зверья. Принесите мне 5 щетинистых шкур.`, `Отличные щетинистые шкуры. За них дадут хорошую цену.`],
  q_spiders: [`Скрытни Вебвуда дают шелк для припарок, но расплодились сверх меры. Убейте 6 и вырежьте 4 шелковые железы.`, `Фу, еще дергаются. Прекрасно. Вы это заслужили.`],
  q_murlocs: [`Двадцать лет я рыбачил на Зеркальном озере, пока эти рыболюди не вылезли с мелей. Прогоните 8 Илогривых и берегитесь стаи.`, `Ха! Пусть учатся сидеть в своих грязных ямах.`],
  q_mine: [`Мы нашли добрую медную жилу, и тут из склона полезли кобольды. Уложите 10 копателей Туннельная Крыса.`, `Ха! За работу, парни! Вот моя благодарность и моя монета.`],
  q_bones: [`Старая часовня была местом покоя, пока что-то не разбудило мертвых. Верните земле 8 беспокойных костей, {playerName}.`, `Пусть они теперь покоятся, и пусть Свет простит то, что их разбудило.`],
  q_supplies: [`Бандиты увели мой последний воз: инструменты, соль и добрый истврукский лен. Верните 4 ящика из лагеря на юго-востоке.`, `Мои ящики! Почти без царапин. Вы просто чудо.`],
  q_whispers: [`Мертвые встают снова, потому что что-то их зовет. Обыщите часовню и принесите любой знак зовущего нетронутым.`, `На этом сигиле знак Могильного Зова. Я молился, чтобы эта секта исчезла, {playerName}.`],
  q_names_of_the_dead: [`Если Могильный Зов ограбил наши могилы, я должен знать, чьи имена украдены. Соберите 3 страницы погребальной книги, {playerName}.`, `Бедные души... а вот пономарь Марроу, первый потревоженный. Мортен начал с того, кто хоронил мертвых Истврука.`],
  q_silence_the_call: [`Каждое имя в книге - душа, которую Мортен хочет вытащить из земли. Упокойте 12 беспокойных костей, {playerName}, пока шепот не стал хором.`, `Двор стал тише, но зов теперь поднимается из самой крипты, {playerName}.`],
  q_rite: [`Крипту надо открыть, но только обряд связывания пропустит живых. Нужны 4 куска благословенного сала и 6 призрачных эссенций.`, `Готово. Путь вниз открыт... соберите самых сильных спутников, {playerName}.`],
  q_hollow: [`Мортен ждет на дне Пустой крипты среди поднятых им элитных мертвецов. Возьмите четырех спутников и покончите с ним.`, `Шепот стих. Мертвые спят, {playerName}, и Истврук обязан вам всем.`],
  q_sexton: [`Книга называет пономаря Марроу, первого стража, поднятого Мортеном. Спуститесь с четырьмя спутниками и верните ему украденный покой, {playerName}.`, `Марроу наконец свободен. Не звоните по нему; в жизни он слышал достаточно колоколов.`],
  q_gravecallers_trail: [`Мортен мертв, но его секта не пряталась век ради одной деревенской часовни. Найдите его гримуар среди руин, {playerName}.`, `Мортен писал некому Зовущему Туман в северной топи. Секта не умерла, {playerName}, а терпеливо ждала.`],
  q_bandits: [`Шайка головорезов стоит лагерем в юго-западных холмах. За неделю они ограбили три воза. Убейте 10 долинных бандитов.`, `На десять ножей меньше во тьме. Возьмите, вы заслужили.`],
  q_ringleader: [`Бандиты слушаются Горрака Безжалостного. Отрубите голову, и тело разбежится. Убейте его, {playerName}.`, `Горрак мертв? Значит, его тень больше не висит над долиной.`],
  q_fenbridge_muster: [`В писаниях Мортена назван хозяин в северной топи. И я не верю в совпадения, {playerName}. Снимите приказ о сборе с ворот Фенбриджа и предъявите стражу.`, `Печать Алдрика? Тогда сгодитесь. Топь глотает мои патрули целиком.`],
  q_prowlers: [`Болотные хищники выучили звук вьючных мулов и теперь охотятся на самой настилке. Убейте 12, {playerName}.`, `Двенадцать, и без укусов? Сегодня настилка дышит легче.`],
  q_prowler_pelts: [`Настилка держится на промасленных шкурах хищников, а мой запас пуст. Принесите 8 целых шкур, {playerName}, пока нам не пришлось брести в Истврук.`, `Добрые толстые шкуры. Теперь настилка переживет нас обоих.`],
  q_fen_supplies: [`Караван из Истврука ушел в туман три дня назад и не вернулся. Спасите 5 грузов, пока топь не довершила дело.`, `Вымокло, но цело. Топь хранит то, что ловит, {playerName}.`],
  q_deepfen: [`Глубинные мурлоки вытаскивают что-то со дна озера. Убейте 12 щелкунов, и мы поймем, что их растревожило.`, `Это загонит их обратно в грязь на время. Но что-то заставило их копать.`],
  q_idols: [`Рыболюди прижимают идолов со дна как святыни. Отберите 5 у глубинных щелкунов.`, `Работа Могильного Зова, древнее Мортена. Секта началась здесь, {playerName}.`],
  q_deepfen_purge: [`Эти идолы сделаны культом, и мурлоки выгребают старое зло из топи охапками. Вернитесь на мели и убейте еще 14.`, `Безжалостно и основательно. Если топь высохнет, вам найдется работа стража.`],
  q_widows: [`Яд вдовы вытягивает болотную гниль из ран, но чаща стала кошмаром. Убейте 10 вдов и принесите 6 целых ядовитых мешочков.`, `Все мешочки целы. У вас руки тверже, чем у половины хирургов на юге, {playerName}.`],
  q_broodmother: [`Паутина толщиной с канат имеет мать. Прорубитесь через 8 вдов и убейте старую матку до выхода выводка.`, `Правда мертва? Тогда чаща снова просто деревья. Да благословит Свет твой клинок, {playerName}.`],
  q_drowned: [`Утонувшие путники выходят из озер, увитые водорослями. Упокойте 12 утопших мертвецов, {playerName}.`, `Каждый павший от вашей руки - украденная душа, отпущенная на свободу.`],
  q_drowned_censers: [`Северная часовня утонула вместе с паствой, а ее мертвецы носят погребальные кадила. Соберите 4 во дворе.`, `Как я боялся: в них жгли могильный пепел, не ладан. Обряд подписан Воссом.`],
  q_no_rest: [`Этот обряд поднимает утопших всюду, где топь их коснется. Мы еще не можем разрушить его, но можем лишить хозяев 14 солдат.`, `Вы дали мертвым больше милости, чем их господа. Возьмите это.`],
  q_trolls: [`Мирефенские тролли вскрыли курганы древнее человеческих королевств, {playerName}. Прогоните их: 12 мертвых троллей хватит.`, `Тролли не копают без причины. Кто-то в серой робе показал им место.`],
  q_troll_fetishes: [`Эти фетиши не тролльей работы: узлы неверные, кости человеческие, и все указывают на открытые курганы. Принесите 8.`, `Та же рука, что делала знамена лагеря. Тролли - просто нанятые лопаты, {playerName}.`],
  q_grubjaw: [`Грубджо не копает с остальными; он съел двух моих последних мулов вместе со сбруей. Он рыщет у дальних восточных курганов, {playerName}. Принесите его клык.`, `Клык длиной с мое предплечье! Мулы отомщены.`],
  q_cult_camp: [`На севере, где туман не поднимается, Могильный Зов стоит лагерем так, будто топь уже их. Срубите 12 культистов, {playerName}.`, `Двенадцать серых роб лицом в грязь. Теперь они знают, что топь смотрит в ответ.`],
  q_summoners: [`Призыватели зовут утопших из воды, как собак на свист. Заставьте 8 умолкнуть и принесите 4 шифра.`, `Каждый шифр заверен дьяконом Воссом и адресован Зовущему Туман в бастионе. Хозяин Мортена, {playerName}. Мы нашли его.`],
  q_deacon: [`Восс песней поднимает моих утонувших стражей из озер себе на службу. Идите по лагерной дороге и заройте его поглубже, {playerName}.`, `Восс мертв, и туман над лагерем уже редеет. Остался только бастион.`],
  q_bastion_door: [`Затонувший бастион хранит Зовущего Туман, а его дверь запечатана могильными камнями. Принесите один обереговый камень, {playerName}, и я разрушу печать.`, `Печать расходится, как гнилая веревка. Дверь открыта, и тьма слушает.`],
  q_olen: [`Олен умер, защищая бастион, а теперь как кукла стережет ту же дверь. Этому позору конец, {playerName}. Спуститесь с четырьмя спутниками и дайте ему покой.`, `Его стража наконец окончена. Я сам вырежу его имя на воротах. Спасибо, {playerName}.`],
  q_mistcaller: [`Ваэль ждет на дне бастиона, голос, утопивший сотню путников ради армии. Возьмите четырех спутников, не меньше. Покончите с ним, {playerName}, и мертвецы топи наконец упокоятся.`, `Ваэль мертв, и туман поднимается. Но его последние слова леденят кровь: Wyrm шевелится под пиками. Секта служит чему-то древнее, чем мы думали, {playerName}.`],
  q_highwatch_summons: [`Последние слова Ваэля не отпускают меня, {playerName}. Возьмите призыв Хайвотча и скажите Тессали, что Алдрик поднимается следом.`, `Если Алдрик сам идет в горы, дело так плохо, как я боялась. Добро пожаловать в Хайвотч, {playerName}.`],
  q_stalkers: [`Хребтовые кошки спустились с высоких снегов голодными и рвут мои патрули. Убейте 12 для начала, {playerName}.`, `На двенадцать теней меньше на хребте. Патрули вздохнут сегодня ночью.`],
  q_stalker_pelts: [`Зима на этой горе не стучит, {playerName}, а вышибает дверь. 8 шкур хребтовых охотников утеплят плащи для стены.`, `Толстые, как моя рука. В этом году дозор не замерзнет.`],
  q_kobold_tunnels: [`Кобольды Глубокоскалья роют прямо вниз, словно их зовут из-под стены. Их туннели идут под нашей стеной, {playerName}. Убейте 12 туннельщиков.`, `Каждый ствол уходит прямо вниз. Кобольды сами так не копают.`],
  q_glowing_wax: [`Воск этих туннельщиков светится, {playerName}, и теплый, как сердцебиение. Принесите 6 кусков для исследований Каддиса.`, `Все еще теплый. Хранитель знаний не знает пламени с таким светом.`],
  q_ogre_edges: [`Кланы Терновых Пиков стоят слишком далеко на востоке с боевой краской. Кто-то им платит. Убейте 12, {playerName}.`, `Двенадцать пали, а они не отступают. Покупатель заплатил чем-то тяжелее золота.`],
  q_ogre_totems: [`Огры подняли тотемы из кожи и черепов: знак сбора, не набега. Сорвите 6 и принесите мне. Берегитесь дробителей по периметру, {playerName}.`, `Черепа, кожа... и перевязи из чешуи Wyrm. Подарки культа, {playerName}.`],
  q_ogre_bounty: [`Кланы куплены, и моя стена - их первое поручение. Убейте еще 14 огров Терновых Пиков, {playerName}; я заплачу за каждого.`, `Награда выплачена полностью. Предгорья стали тише.`],
  q_crushers: [`Крушители - позвоночник лагеря Дрогмара, каждый стоит трех моих солдат. Возьмите помощь и сломайте 10.`, `Десять крушителей пали. Лагерь стал телом без позвоночника.`],
  q_drogmar: [`Дрогмар взял монету Культа Вирма и присягнул кланы пробуждению горы. И когда он бьет по земле, {playerName}, не стойте рядом. Войдите в лагерь и убейте его ради Хайвотча.`, `Дрогмар мертв в собственном лагере. Вы купили моей стене зиму, {playerName}.`],
  q_elementals: [`Грозовой Утес молчал тысячу лет, а теперь его камни ходят. Элементали не пробуждаются просто так, {playerName} - что-то под этой горой ворочается во сне. Уложите 12 элементалей, чтобы я изучил остатки.`, `Осколки гудят, как ударенные колокола. Гора не злится, {playerName}; ее тревожат.`],
  q_shard_cores: [`В сердце каждого элементаля есть ядро бури. Шесть рядом покажут центр возмущения. Я, кажется, уже знаю его, {playerName}, и горячо надеюсь, что ошибаюсь.`, `Все указывают на юг, как опилки к магниту. К святилищу, {playerName}.`],
  q_kazzix: [`Каззикс горит ярче прочих, буря с плечами. Вырвите его сердечный осколок на дальних скалах.`, `Осколок еще трещит! Великолепно. Возьмите эти поножи.`],
  q_zealots: [`Ветер с южных пиков несет песнопения. Заставьте 12 фанатиков умолкнуть, {playerName}; каждая тишина дает горе еще ночь сна.`, `Ветер стал тише. Но меня тревожит не пение, {playerName}, а то, что кто-то может отвечать.`],
  q_cult_orders: [`Фанатики движутся как солдаты перед осадой. Фанатики, что организуются, - это фанатики, исполняющие приказы, {playerName}. Убейте еще 8 и принесите 4 комплекта приказов.`, `Этот почерк я видел в гримуаре Мортена. Одна рука вела каждую могилу, {playerName}.`],
  q_necromancers: [`В приказах сказано о кольце филактерий, сосудах душ, {playerName}, вокруг святилища. Убейте 8 некромантов и принесите 3 целыми.`, `Свет, прости нас. В них мертвые долины и топи. Это была не армия, {playerName}. Это была десятина.`],
  q_revenants: [`К востоку от дороги старое поле боя. Культ поднял кости в ржавых латах. Верните 12 в землю, {playerName}.`, `Когда-то они были солдатами, как мои. То, что их подняло, не чтит мертвых.`],
  q_revenant_vanguard: [`Ревенанты строятся настоящими рядами, {playerName}. Разбейте еще 14, пока не начался марш к святилищу.`, `Поля снова неподвижны. Возьмите это; никто не заслужил больше.`],
  q_wyrm_sigils: [`Пора знать все, {playerName}. Могильный Зов служит Корзулу Могильному Вирму, и каждая украденная душа питает его пробуждение. Принесите 3 сигила.`, `Да... литания пробуждения, писавшаяся поколениями. Они близко, {playerName}.`],
  q_breaking_the_seal: [`Печать святилища выкована горным огнем, и только он откроет путь, не разорвав ее. Принесите 5 благословенных углей, {playerName}.`, `Они горят синим и чистым. Гора помнит старую клятву.`],
  q_voice_below: [`Прошлой ночью весь лагерь встал на колени к святилищу, {playerName}. Корзул говорит им во сне. Убейте 10 фанатиков и 6 некромантов.`, `Коленопреклонение прекратилось. Мы не заставили голос умолкнуть, {playerName}; лишь проредили его хор.`],
  q_sanctum_gate: [`Это последний порог, {playerName}. Культ разбил ключевой камень святилища и разбросал осколки на площади. Принесите 3, и я тихо открою путь.`, `Осколки легли верно, и врата узнали ключ. Соберите сильнейших спутников, {playerName}.`],
  q_korgath: [`Марен нашла у входа в святилище цепи толщиной с мачты, {playerName}, и огрскую фигуру внутри. Возьмите четырех спутников и сразите Коргата.`, `Коргат наконец сломлен. Даже его цепи заслуживали более доброго конца.`],
  q_velkhar: [`Мортен, Ваэль, филактерии - каждую нить сплел верховный некромант Велхар. Покончите с ним, {playerName}.`, `Велхар мертв, и обряд обезглавлен. Но вы почувствовали это: Wyrm больше не спит.`],
  q_gravewyrm: [`Больше нет обряда, который можно остановить, {playerName}. Есть только полупроснувшийся Wyrm. Войдите со спутниками и завершите то, что началось у часовни.`, `Все кончено. Мертвые трех земель покоятся, гора спит без призраков, и сегодня каждый колокол отсюда до Истбрука звонит твоим именем, {playerName}.`],
} satisfies QuestNarrativeTranslations;

const esData: LocaleData = {
  mobs: [
    'Lobo del bosque', 'Viejo Greyjaw', 'Jabalí salvaje', 'Acechador de Webwood', 'Merodeador Aletabarro', 'Excavador Rata de Túnel',
    'Bandido del Valle', 'Huesos inquietos', 'Gorrak el Despiadado', 'Merodeador del lodazal', 'Chasqueador de Deepfen', 'Viuda de Mirefen',
    'La Madre de la nidada', 'Muerto ahogado', 'Trol de Mirefen', 'Grubjaw el Glotón', 'Cultista Gravecaller', 'Invocador Gravecaller', 'Sanador Gravecaller',
    'Diácono Voss', 'Acechador de la cresta', 'Tunelador de Deep Rock', 'Ogro de Thornpeak', 'Triturador de Thornpeak', 'Señor de la guerra Drogmar',
    'Elemental de Stormcrag', 'Señor de fragmentos Kazzix', 'Fanático del Culto del Wyrm', 'Nigromante del Culto del Wyrm', 'Aparecido de hueso',
    'Tambaleante de la Cripta', 'Acólito del Hueco', 'Viuda Huesofrío', 'Sacristán Marrow', 'Morthen el Gravecaller', 'Aparecido del Bastión',
    'Acólito atado a la marea', 'Siervo ahogado', 'Caballero comandante Olen', 'Vael el Mistcaller', 'Guardahuesos del Santuario', 'Dracónido del Santuario',
    'Caminahuesos alzado', 'Korgath el Encadenado', 'Gran nigromante Velkhar', 'Korzul el Gravewyrm',
    'Hinchazón del Pantano',
    'Muñeco de entrenamiento',
  ],
  npcRows: [
    ['El Mercader', 'Guardián del Mercado Mundial', 'Bienvenido al Mercado Mundial, {className}. Compra a aventureros de cada rincón del reino o vende tus propias mercancías.'],
    ['Mariscal Redbrook', 'Mariscal de la ciudad', 'Ten la hoja cerca, {className}. El Valle ya no es lo que era.'],
    ['Comerciante Wilkes', 'Proveedor', 'Pan fresco, agua limpia y precios justos. ¿Qué necesitas?'],
    ['Boticaria Lin', 'Herborista', 'Ten cuidado al pisar en los bosques orientales, amigo.'],
    ['Hermano Aldric', 'Sacerdote del Valle', 'Que la Luz te guarde. Ni siquiera los muertos descansan últimamente.'],
    ['Herrero Haldren', 'Armero y forjador', 'Cuidado con las chispas, {className}. El buen acero separa una cicatriz de una tumba.'],
    ['Pescador Brandt', 'Viejo lobo de agua', 'Grlmurlgrl... perdón, llevo demasiado tiempo oyendo a esos hombres pez.'],
    ['Capataz Odell', 'Capataz de la mina', '¡Toda la excavación está llena de esas alimañas con velas en la cabeza!'],
    ['Guardián Fenwick', 'Guardián de Fenbridge', 'Alto en la puerta, {className}. Más allá de los juncos, la ciénaga mata por nosotros.'],
    ['Hermano Aldric', 'Sacerdote del Valle', 'Que la Luz te mantenga sobre el agua, {playerName}. Los muertos de esta ciénaga no duermen: vadean.'],
    ['Proveedor Hale', 'Proveedor', 'Botas secas, pan seco y pólvora seca: en Fenbridge consigues dos de tres en un buen día.'],
    ['Herborista Yara', 'Herborista', 'Cuida el matorral al oeste del camino. Las telarañas están espesas como velamen.'],
    ['Exploradora Maren', 'Exploradora del mariscal', 'Pies silenciosos y una hoja corta te mantienen con vida. Habla rápido: debo volver a los juncos.'],
    ['Capitana Thessaly', 'Capitana de Highwatch', 'Doscientos años ha resistido este muro, {className}. No caerá bajo mi guardia, aunque gime.'],
    ['Hermano Aldric', 'Sacerdote del Valle', 'De un patio de capilla al techo del mundo... el rastro termina aquí. Siento que la montaña escucha.'],
    ['Exploradora Maren', 'Exploradora del mariscal', 'Seguí a los cultistas contigo por la ciénaga y el rastro llegó aquí. Las cumbres son peores, {className}. Mantente alerta.'],
    ['Intendente Bree', 'Intendente de Highwatch', 'Lana, galleta dura y botas herradas: Highwatch vive de las tres, y apenas tengo existencias.'],
    ['Armero Hode', 'Maestro armero', 'La forja está caliente y la piedra gira. Si corta, lo vendo.'],
    ['Maestro de saber Caddis', 'Maestro de saber', 'Cuida la pizarra suelta, {className}. La montaña está inquieta últimamente y quiero saber por qué.'],
  ],
  questTitles: [
    'Lobos a la puerta', 'El viejo lobo', 'Pieles de Bristleback', 'Amenaza de Webwood', 'Problemas en el lago', 'Ratas en la mina',
    'Los muertos inquietos', 'Suministros robados', 'Susurros bajo tierra', 'Los nombres de los muertos', 'Silenciar la llamada',
    'El rito vinculante', 'Dentro del Hueco', 'La campana del sacristán', 'El rastro del Gravecaller', 'Bandidos del Valle',
    'El cabecilla', 'Reunión en Fenbridge', 'Dientes de la ciénaga', 'Pieles para la calzada', 'La caravana perdida',
    'El Deepfen se agita', 'Ídolos de las profundidades', 'De vuelta a los bajíos', 'Seda y veneno', 'La Madre de la nidada',
    'Los muertos ahogados', 'Incensarios de las profundidades', 'Sin descanso entre los juncos', 'Túmulos de Mirefen',
    'Fetiche y hueso', 'El Glotón', 'Togas en los juncos', 'Detener la invocación', 'El diácono de la ciénaga',
    'El Bastión Sumergido', 'La vergüenza del caballero comandante', 'El Mistcaller', 'La guardia de las cumbres',
    'Acechadores en la cresta', 'El invierno llega a Highwatch', 'Problemas de Deeprock', 'Cera extraña', 'Ogros en las colinas',
    'Tótems de guerra', 'La recompensa de la capitana', 'Romper el campamento de guerra', 'Señor de la guerra Drogmar',
    'La montaña despierta', 'Núcleos de la tormenta', 'El señor de fragmentos', 'Cánticos en el viento', 'Órdenes de abajo',
    'El anillo de filacterias', 'Los campos de aparecidos', 'Huesos de la vanguardia', 'Sigilos del Wyrm', 'Romper el sello',
    'La voz de abajo', 'La puerta del Santuario', 'El guardián encadenado', 'El gran nigromante', 'Korzul el Gravewyrm',
  ],
  objectiveItems: [
    'Colmillo del viejo Greyjaw', 'Piel de jabalí erizada', 'Glándula de seda de Webwood', 'Caja de suministros robada',
    'Sigilo de Gravecaller', 'Página de registro desgastada', 'Sebo bendito', 'Esencia fantasmal', 'Grimorio de Morthen',
    'Orden de reunión de Fenbridge', 'Piel de merodeador del lodazal', 'Mercancías de la caravana perdida', 'Ídolo empapado',
    'Saco de veneno de viuda', 'Incensario oxidado', 'Fetiche trol de Mirefen', 'Colmillo de Grubjaw', 'Cifra Gravecaller',
    'Piedra guardiana del Bastión', 'Citación de Highwatch', 'Piel de acechador de la cresta', 'Cera resplandeciente',
    'Tótem de guerra ogro', 'Núcleo de tormenta', 'Fragmento del corazón de Kazzix', 'Órdenes del Culto del Wyrm',
    'Filacteria ritual', 'Sigilo del Gravewyrm', 'Brasas benditas', 'Fragmento de llave del santuario',
  ],
  zones: [
    ['Valle de Eastbrook', 'Busca al mariscal Redbrook en la ciudad: tiene trabajo para ti.', ['Eastbrook', 'Senda de lobos', 'Prado de jabalíes', 'Lago Espejo', 'Webwood', 'Mina de cobre', 'Campamento bandido', 'Capilla caída']],
    ['Ciénaga de Mirefen', 'Preséntate ante el guardián Fenwick en la puerta de Fenbridge.', ['Fenbridge', 'Juncos de merodeadores', 'Bajíos de Deepfen', 'Matorral de viudas', 'Capilla ahogada', 'Túmulos trol', 'Campamento Gravecaller', 'El Bastión Sumergido']],
    ['Alturas de Thornpeak', 'La capitana Thessaly sostiene el muro de Highwatch a duras penas.', ['Highwatch', 'Cresta del acechador', 'Madrigueras Deeprock', 'Colinas ogro', 'Campamento de guerra de Drogmar', 'Stormcrag', 'El Glimmermere', 'Tiendas del Culto del Wyrm', 'Campos de aparecidos', 'Santuario del Gravewyrm']],
  ],
  dungeons: [
    ['La Cripta Hueca', 'Desciendes a la Cripta Hueca...', 'Vuelves a subir a la luz del día.'],
    ['El Bastión Sumergido', 'Vadeas hacia las profundidades del Bastión Sumergido...', 'Sales de la oscuridad ahogada.'],
    ['Santuario del Gravewyrm', 'El aire se vuelve frío. Algo inmenso respira abajo...', 'Sales tambaleándote al viento de la montaña.'],
  ],
};

const frData: LocaleData = {
  mobs: [
    'Loup des bois', 'Vieux Greyjaw', 'Sanglier sauvage', 'Rôdeur de Webwood', 'Rôdeur Aileron-de-boue', 'Terrassier Rat des tunnels',
    'Bandit du Val', 'Ossements agités', "Gorrak l'Impitoyable", 'Rôdeur du bourbier', 'Happeur de Deepfen', 'Veuve de Mirefen',
    'La Mère des couvées', 'Mort noyé', 'Troll de Mirefen', 'Grubjaw le Glouton', 'Cultiste Gravecaller', 'Invocateur Gravecaller', 'Guérisseur Gravecaller',
    'Diacre Voss', 'Traqueur de crête', 'Tunnelier de Deeprock', 'Ogre de Thornpeak', 'Broyeur de Thornpeak', 'Seigneur de guerre Drogmar',
    'Élémentaire de Stormcrag', 'Seigneur des éclats Kazzix', 'Zélote du Culte du Wyrm', 'Nécromancien du Culte du Wyrm', "Revenant caparaçonné d'os",
    'Traînard de la crypte', 'Acolyte du Creux', 'Veuve Frissos', 'Sacristain Marrow', 'Morthen le Gravecaller', 'Revenant du Bastion',
    'Acolyte lié aux marées', 'Serviteur noyé', 'Chevalier-commandant Olen', 'Vael le Mistcaller', 'Garde-os du Sanctuaire', 'Drakonide du Sanctuaire',
    'Marche-os relevé', "Korgath l'Enchaîné", 'Grand nécromancien Velkhar', 'Korzul le Gravewyrm',
    'Baudruche des marais',
    'Mannequin d\'entraînement',
  ],
  npcRows: [
    ['Le Marchand', 'Gardien du Marché mondial', 'Bienvenue au Marché mondial, {className}. Achetez aux aventuriers du royaume ou proposez vos propres marchandises.'],
    ['Maréchal Redbrook', 'Maréchal de la ville', "Gardez votre lame près de vous, {className}. Le Val n'est plus ce qu'il était."],
    ['Marchand Wilkes', 'Fournisseur', 'Pain frais, eau claire, prix honnêtes. Que puis-je vous servir ?'],
    ['Apothicaire Lin', 'Herboriste', "Faites attention où vous mettez les pieds dans les bois de l'est, ami."],
    ['Frère Aldric', 'Prêtre du Val', 'Que la Lumière vous garde. Même les morts ne trouvent plus le repos ici.'],
    ['Forgeron Haldren', "Armurier et fabricant d'armes", "Attention aux étincelles, {className}. Un bon acier sépare une cicatrice d'une tombe."],
    ['Pêcheur Brandt', 'Vieux loup de mer', "Grlmurlgrl... pardon, j'écoute ces hommes-poissons depuis trop longtemps."],
    ['Contremaître Odell', 'Contremaître de la mine', 'Toute la mine grouille de ces vermines à chandelles !'],
    ['Gardien Fenwick', 'Gardien de Fenbridge', 'Halte à la porte, {className}. Au-delà des roseaux, la fange tue pour nous.'],
    ['Frère Aldric', 'Prêtre du Val', "Que la Lumière vous garde hors de l'eau, {playerName}. Les morts de ce marais ne dorment pas: ils pataugent."],
    ['Approvisionneur Hale', 'Fournisseur', 'Bottes sèches, pain sec, poudre sèche: à Fenbridge, deux sur trois est une bonne journée.'],
    ['Herboriste Yara', 'Herboriste', "Méfiez-vous du fourré à l'ouest de la route. Les toiles sont épaisses comme des voiles."],
    ['Éclaireuse Maren', 'Éclaireuse du maréchal', 'Des pas silencieux et une lame courte vous gardent en vie. Parlez vite, je dois retourner aux roseaux.'],
    ['Capitaine Thessaly', 'Capitaine de Highwatch', 'Ce mur tient depuis deux cents ans, {className}. Il ne cédera pas sous ma garde, mais il gémit.'],
    ['Frère Aldric', 'Prêtre du Val', "D'un cimetière de chapelle au toit du monde... la piste s'achève ici. Je sens la montagne écouter."],
    ['Éclaireuse Maren', 'Éclaireuse du maréchal', "J'ai suivi les cultistes dans le marais avec vous, et la piste mène ici. Les pics sont pires, {className}. Restez vigilant."],
    ['Quartier-maître Bree', 'Quartier-maître de Highwatch', 'Laine, biscuit dur et bottes ferrées: Highwatch vit de ces trois choses, et je manque de tout.'],
    ['Armurier Hode', 'Maître armurier', 'La forge est chaude et la meule tourne. Si ça coupe, je le vends.'],
    ['Maître du savoir Caddis', 'Maître du savoir', 'Méfiez-vous des schistes instables, {className}. La montagne est agitée ces temps-ci, et je veux savoir pourquoi.'],
  ],
  questTitles: [
    'Des loups à la porte', 'Le vieux loup', 'Peaux de Bristleback', 'La menace de Webwood', 'Troubles au lac', 'Des rats dans la mine',
    'Les morts sans repos', 'Fournitures volées', 'Murmures sous terre', 'Les noms des morts', "Faire taire l'appel", 'Le rite de lien',
    'Dans le Creux', 'La cloche du sacristain', 'La piste du Gravecaller', 'Bandits du Val', 'Le chef de bande', 'Rassemblement à Fenbridge',
    'Les crocs de la fange', 'Des peaux pour la chaussée', 'La caravane perdue', "Le Deepfen s'agite", 'Idoles des profondeurs',
    'Retour aux hauts-fonds', 'Soie et venin', 'La Mère des couvées', 'Les morts noyés', 'Encensoirs des profondeurs',
    'Pas de repos dans les roseaux', 'Tertres de Mirefen', 'Fétiche et os', 'Le Glouton', 'Robes dans les roseaux',
    "Arrêter l'invocation", 'Le diacre du bourbier', 'Le Bastion englouti', 'La honte du chevalier-commandant', 'Le Mistcaller',
    'La garde sur les pics', 'Traqueurs sur la crête', "L'hiver vient à Highwatch", 'Troubles à Deeprock', 'Cire étrange',
    'Ogres des contreforts', 'Totems de guerre', 'La prime de la capitaine', 'Briser le camp de guerre', 'Seigneur de guerre Drogmar',
    "La montagne s'éveille", 'Coeurs de la tempête', 'Le seigneur des éclats', 'Chants sur le vent', "Ordres d'en bas",
    "L'anneau des phylactères", 'Les champs des revenants', "Os de l'avant-garde", 'Sigils du Wyrm', 'Briser le sceau',
    "La voix d'en bas", 'La porte du Sanctuaire', 'Le gardien lié', 'Le grand nécromancien', 'Korzul le Gravewyrm',
  ],
  objectiveItems: [
    'Croc du vieux Greyjaw', 'Peau de sanglier hérissée', 'Glande de soie de Webwood', 'Caisse de fournitures volée',
    'Sceau de Gravecaller', 'Page de registre usée', 'Suif béni', 'Essence spectrale', 'Grimoire de Morthen',
    'Ordre de rassemblement de Fenbridge', 'Peau de rôdeur du bourbier', 'Marchandises de la caravane perdue', 'Idole détrempée',
    'Sac à venin de veuve', 'Encensoir rouillé', 'Fétiche troll de Mirefen', 'Défense de Grubjaw', 'Chiffre de Gravecaller',
    'Pierre de garde du Bastion', 'Convocation de Highwatch', 'Peau de traqueur de crête', 'Cire luisante', 'Totem de guerre ogre',
    'Coeur de tempête', 'Éclat de coeur de Kazzix', 'Ordres du Culte du Wyrm', 'Phylactère rituel', 'Sceau du Gravewyrm',
    'Braises bénies', 'Éclat de clé du sanctuaire',
  ],
  zones: [
    ["Val d'Eastbrook", 'Trouvez le maréchal Redbrook en ville: il a du travail pour vous.', ['Eastbrook', 'Piste des loups', 'Pré aux sangliers', 'Lac Miroir', 'Webwood', 'Mine de cuivre', 'Camp des bandits', 'Chapelle tombée']],
    ['Marais de Mirefen', 'Présentez-vous au gardien Fenwick à la porte de Fenbridge.', ['Fenbridge', 'Roseaux des rôdeurs', 'Hauts-fonds de Deepfen', 'Fourré des veuves', 'Chapelle noyée', 'Tertres trolls', 'Campement Gravecaller', 'Le Bastion englouti']],
    ['Hauteurs de Thornpeak', 'La capitaine Thessaly tient le mur de Highwatch, à peine.', ['Highwatch', 'Crête du traqueur', 'Terriers de Deeprock', 'Contreforts ogres', 'Camp de guerre de Drogmar', 'Stormcrag', 'Le Glimmermere', 'Tentes du Culte du Wyrm', 'Champs des revenants', 'Sanctuaire du Gravewyrm']],
  ],
  dungeons: [
    ['La Crypte creuse', 'Vous descendez dans la Crypte creuse...', 'Vous remontez à la lumière du jour.'],
    ['Le Bastion englouti', 'Vous pataugez dans les profondeurs du Bastion englouti...', "Vous sortez de l'obscurité noyée."],
    ['Sanctuaire du Gravewyrm', "L'air devient froid. Quelque chose d'immense respire en bas...", 'Vous titubez dans le vent de la montagne.'],
  ],
};

const deData: LocaleData = {
  mobs: [
    'Waldwolf', 'Alter Greyjaw', 'Wilder Eber', 'Webwood-Lauerer', 'Schlammflossen-Schleicher', 'Tunnelratten-Gräber',
    'Talbandit', 'Ruhelose Knochen', 'Gorrak der Gnadenlose', 'Moorpirscher', 'Deepfen-Schnapper', 'Mirefen-Witwe',
    'Die Brutmutter', 'Ertrunkener Toter', 'Mirefen-Troll', 'Grubjaw der Vielfraß', 'Gravecaller-Kultist', 'Gravecaller-Beschwörer', 'Gravecaller-Heiler',
    'Diakon Voss', 'Gratpirscher', 'Deeprock-Tunnelgräber', 'Thornpeak-Oger', 'Thornpeak-Zermalmer', 'Kriegsherr Drogmar',
    'Stormcrag-Elementar', 'Splitterlord Kazzix', 'Wyrmkult-Eiferer', 'Wyrmkult-Nekromant', 'Knochengepanzerter Wiedergänger',
    'Gruftschlurfer', 'Akolyth der Höhlung', 'Knochenkälte-Witwe', 'Küster Marrow', 'Morthen der Gravecaller', 'Bastion-Wiedergänger',
    'Gezeitengebundener Akolyth', 'Ertrunkener Knecht', 'Ritterkommandant Olen', 'Vael der Mistcaller', 'Heiligtums-Knochenwache',
    'Heiligtumsdrakonid', 'Erhobener Knochenläufer', 'Korgath der Gebundene', 'Großnekromant Velkhar', 'Korzul der Gravewyrm',
    'Sumpfbläher',
    'Übungspuppe',
  ],
  npcRows: [
    ['Der Händler', 'Hüter des Weltmarkts', 'Willkommen auf dem Weltmarkt, {className}. Kaufe von Abenteurern aus dem ganzen Reich oder biete deine eigenen Waren an.'],
    ['Marschall Redbrook', 'Stadtmarschall', 'Halte deine Klinge nah, {className}. Das Tal ist nicht mehr, was es war.'],
    ['Händler Wilkes', 'Proviantmeister', 'Frisches Brot, klares Wasser, faire Preise. Was brauchst du?'],
    ['Apothekerin Lin', 'Kräuterkundige', 'Pass im östlichen Wald auf, wohin du trittst, Freund.'],
    ['Bruder Aldric', 'Priester des Tals', 'Das Licht behüte dich. Selbst die Toten finden hier seit Kurzem keine Ruhe.'],
    ['Schmied Haldren', 'Rüstungs- und Waffenschmied', 'Achte auf die Funken, {className}. Guter Stahl trennt eine Narbe von einem Grab.'],
    ['Fischer Brandt', 'Alter Seebär', 'Grlmurlgrl... verzeih, ich habe diesen Fischmenschen zu lange zugehört.'],
    ['Vorarbeiter Odell', 'Minenvorarbeiter', 'Der ganze Stollen wimmelt von diesen Kerzenkopf-Schädlingen!'],
    ['Wärter Fenwick', 'Wärter von Fenbridge', 'Halt am Tor, {className}. Hinter dem Schilf tötet das Moor für uns.'],
    ['Bruder Aldric', 'Priester des Tals', 'Das Licht halte dich über Wasser, {playerName}. Die Toten in diesem Moor schlafen nicht: sie waten.'],
    ['Proviantmeister Hale', 'Proviantmeister', 'Trockene Stiefel, trockenes Brot, trockenes Pulver: In Fenbridge bekommst du an guten Tagen zwei davon.'],
    ['Kräuterkundige Yara', 'Kräuterkundige', 'Meide das Dickicht westlich der Straße. Die Netze sind diese Saison dick wie Segeltuch.'],
    ['Späherin Maren', 'Späherin des Marschalls', 'Leise Schritte und eine kurze Klinge halten dich am Leben. Sprich schnell, ich muss zurück ins Schilf.'],
    ['Hauptmann Thessaly', 'Hauptmann von Highwatch', 'Zweihundert Jahre steht diese Mauer, {className}. Unter meiner Wache bricht sie nicht, auch wenn sie ächzt.'],
    ['Bruder Aldric', 'Priester des Tals', 'Vom Kapellenhof im Tal bis zum Dach der Welt... die Spur endet hier. Ich spüre, wie der Berg lauscht.'],
    ['Späherin Maren', 'Späherin des Marschalls', 'Ich verfolgte mit dir Kultisten durch das Moor, und die Spur führte hierher. Die Gipfel sind schlimmer, {className}. Bleib wachsam.'],
    ['Quartiermeisterin Bree', 'Quartiermeisterin von Highwatch', 'Wolle, Hartzwieback und beschlagene Stiefel: Highwatch lebt von allen dreien, und mir fehlt alles.'],
    ['Rüstungsschmied Hode', 'Meisterrüster', 'Die Esse ist heiß und der Schleifstein dreht sich. Wenn es schneidet, verkaufe ich es.'],
    ['Lehrmeister Caddis', 'Lehrmeister', 'Achte auf lockeren Schiefer, {className}. Der Berg ist unruhig geworden, und ich will wissen warum.'],
  ],
  questTitles: [
    'Wölfe vor der Tür', 'Der alte Wolf', 'Bristleback-Häute', 'Bedrohung aus Webwood', 'Ärger am See', 'Ratten in der Mine',
    'Die ruhelosen Toten', 'Gestohlene Vorräte', 'Flüstern darunter', 'Die Namen der Toten', 'Den Ruf verstummen lassen',
    'Der Bindungsritus', 'In die Höhlung', 'Die Glocke des Küsters', 'Die Spur des Gravecallers', 'Banditen des Tals',
    'Der Rädelsführer', 'Musterung in Fenbridge', 'Zähne des Moors', 'Felle für den Damm', 'Die verlorene Karawane',
    'Deepfen regt sich', 'Götzen aus der Tiefe', 'Zurück in die Untiefen', 'Seide und Gift', 'Die Brutmutter',
    'Die ertrunkenen Toten', 'Räuchergefäße aus der Tiefe', 'Keine Ruhe im Schilf', 'Hügelgräber von Mirefen',
    'Fetisch und Knochen', 'Der Vielfraß', 'Roben im Schilf', 'Die Beschwörung stoppen', 'Der Diakon des Moors',
    'Die versunkene Bastion', 'Die Schande des Ritterkommandanten', 'Der Mistcaller', 'Die Wacht auf den Gipfeln',
    'Pirscher auf dem Grat', 'Der Winter kommt nach Highwatch', 'Ärger in Deeprock', 'Seltsames Wachs', 'Oger in den Vorbergen',
    'Totems des Krieges', 'Das Kopfgeld der Hauptfrau', 'Das Kriegslager brechen', 'Kriegsherr Drogmar', 'Der Berg erwacht',
    'Kerne des Sturms', 'Der Splitterlord', 'Gesänge im Wind', 'Befehle von unten', 'Der Ring der Phylakterien',
    'Die Wiedergängerfelder', 'Knochen der Vorhut', 'Siegel des Wyrms', 'Das Siegel brechen', 'Die Stimme von unten',
    'Das Tor des Heiligtums', 'Der gebundene Wächter', 'Der Großnekromant', 'Korzul der Gravewyrm',
  ],
  objectiveItems: [
    'Zahn des alten Greyjaw', 'Borstige Eberhaut', 'Seidendrüse von Webwood', 'Gestohlene Vorratskiste', 'Gravecaller-Siegel',
    'Verwitterte Buchseite', 'Gesegneter Talg', 'Geisterhafte Essenz', 'Morthens Grimoire', 'Musterungsbefehl von Fenbridge',
    'Balg eines Moorpirschers', 'Waren der verlorenen Karawane', 'Durchnässtes Götzenbild', 'Witwengiftsack', 'Rostiges Räuchergefäß',
    'Mirefen-Trollfetisch', 'Grubjaws Hauer', 'Gravecaller-Chiffre', 'Bastion-Wachstein', 'Einberufung von Highwatch',
    'Balg eines Gratpirschers', 'Glühendes Wachs', 'Ogerkriegstotem', 'Sturmkern', 'Kazzix Herzsplitter', 'Befehle des Wyrmkults',
    'Rituelles Seelengefäß', 'Gravewyrm-Siegel', 'Gesegnete Glut', 'Heiligtums-Schlüsselsplitter',
  ],
  zones: [
    ['Eastbrook-Tal', 'Suche Marschall Redbrook in der Stadt: Er hat Arbeit für dich.', ['Eastbrook', 'Wolfslauf', 'Eberwiese', 'Spiegelsee', 'Webwood', 'Kupfermine', 'Banditenlager', 'Gefallene Kapelle']],
    ['Mirefen-Moor', 'Melde dich bei Wärter Fenwick am Tor von Fenbridge.', ['Fenbridge', 'Pirscher-Schilf', 'Deepfen-Untiefen', 'Witwendickicht', 'Ertrunkene Kapelle', 'Trollhügel', 'Gravecaller-Lager', 'Die versunkene Bastion']],
    ['Thornpeak-Höhen', 'Hauptmann Thessaly hält die Mauer von Highwatch, gerade so.', ['Highwatch', 'Pirschergrat', 'Deeprock-Baue', 'Ogervorberge', 'Drogmars Kriegslager', 'Stormcrag', 'Der Glimmermere', 'Wyrmkult-Zelte', 'Wiedergängerfelder', 'Gravewyrm-Heiligtum']],
  ],
  dungeons: [
    ['Die Hohle Gruft', 'Du steigst in die Hohle Gruft hinab...', 'Du kletterst zurück ins Tageslicht.'],
    ['Die versunkene Bastion', 'Du watest in die versunkene Bastion hinab...', 'Du kletterst aus der ertrinkenden Dunkelheit.'],
    ['Gravewyrm-Heiligtum', 'Die Luft wird kalt. Etwas Gewaltiges atmet in der Tiefe...', 'Du taumelst zurück in den Bergwind.'],
  ],
};

const itData: LocaleData = {
  mobs: [
    'Lupo della foresta', 'Vecchio Greyjaw', 'Cinghiale selvatico', 'Predatore di Webwood', 'Predatore Pinnalimo', 'Scavatore ratto di galleria',
    'Bandito della Valle', 'Ossa irrequiete', 'Gorrak lo Spietato', 'Predatore del pantano', 'Murloc di Deepfen', 'Vedova di Mirefen',
    'Madre della covata', 'Morto annegato', 'Troll di Mirefen', 'Grubjaw il Goloso', 'Cultista Gravecaller', 'Evocatore Gravecaller', 'Guaritore Gravecaller',
    'Diacono Voss', 'Braccatore della cresta', 'Coboldo di Deeprock', 'Ogre di Thornpeak', 'Frantumatore ogre', 'Signore della guerra Drogmar',
    'Elementale di Stormcrag', 'Signore dei frammenti Kazzix', 'Zelota del Culto del Wyrm', 'Negromante del Culto del Wyrm',
    'Revenant corazzato di ossa', 'Barcollante della cripta', 'Accolito del Vuoto', 'Vedova Freddosso', 'Sagrestano Marrow',
    'Morthen il Gravecaller', 'Revenant del Bastione', 'Accolito legato alla marea', 'Servo annegato', 'Cavaliere comandante Olen',
    'Vael il Mistcaller', 'Guardiano osseo del Santuario', 'Draconide del Santuario', 'Camminatore di ossa risorto',
    'Korgath il Vincolato', 'Grande negromante Velkhar', 'Korzul il Gravewyrm',
    'Gonfiore della palude',
    'Manichino da allenamento',
  ],
  npcRows: [
    ['Il Mercante', 'Custode del Mercato Mondiale', 'Benvenuto al Mercato Mondiale, {className}. Compra dagli avventurieri del reame o vendi le tue merci.'],
    ['Maresciallo Redbrook', 'Maresciallo cittadino', 'Tieni la lama vicina, {className}. La Valle non è più quella di una volta.'],
    ['Mercante Wilkes', 'Fornitore', 'Pane fresco, acqua pulita e prezzi onesti. Che cosa ti serve?'],
    ['Speziale Lin', 'Erborista', 'Fai attenzione a dove metti i piedi nei boschi orientali, amico.'],
    ['Fratello Aldric', 'Sacerdote della Valle', 'Che la Luce ti protegga. Nemmeno i morti trovano più riposo qui.'],
    ['Fabbro Haldren', 'Armaiolo e fabbro', 'Attento alle scintille, {className}. Il buon acciaio separa una cicatrice da una tomba.'],
    ['Pescatore Brandt', 'Vecchio lupo di mare', 'Grlmurlgrl... scusa, ho ascoltato quegli uomini pesce troppo a lungo.'],
    ['Caposquadra Odell', 'Caposquadra della miniera', 'Tutta la galleria brulica di quei parassiti con la candela in testa!'],
    ['Custode Fenwick', 'Custode di Fenbridge', 'Fermo al cancello, {className}. Oltre le canne, la palude uccide per noi.'],
    ['Fratello Aldric', 'Sacerdote della Valle', 'Che la Luce ti mantenga fuori dall acqua, {playerName}. I morti di questa palude non dormono: guadano.'],
    ['Provveditore Hale', 'Fornitore', 'Stivali asciutti, pane secco e polvere asciutta: a Fenbridge, due su tre è una buona giornata.'],
    ['Erborista Yara', 'Erborista', 'Sta lontano dal folto a ovest della strada. Le ragnatele sono spesse come vele.'],
    ['Esploratrice Maren', 'Esploratrice del maresciallo', 'Passi silenziosi e una lama corta ti tengono in vita. Parla in fretta: devo tornare alle canne.'],
    ['Capitano Thessaly', 'Capitano di Highwatch', 'Questo muro resiste da duecento anni, {className}. Non cadrà sotto la mia guardia, anche se geme.'],
    ['Fratello Aldric', 'Sacerdote della Valle', 'Dal camposanto della cappella al tetto del mondo... la pista finisce qui. Sento la montagna ascoltare.'],
    ['Esploratrice Maren', 'Esploratrice del maresciallo', 'Ho seguito i cultisti nella palude con te, e la pista porta qui. Le cime sono peggiori, {className}. Resta vigile.'],
    ['Quartiermastro Bree', 'Quartiermastro di Highwatch', 'Lana, gallette dure e stivali ferrati: Highwatch vive di queste tre cose, e a me manca tutto.'],
    ['Armaiolo Hode', 'Maestro armaiolo', 'La forgia è calda e la mola gira. Se taglia, lo vendo.'],
    ['Maestro del sapere Caddis', 'Maestro del sapere', 'Fai attenzione allo scisto instabile, {className}. La montagna è inquieta da qualche tempo, e voglio sapere perché.'],
  ],
  questTitles: [
    'Lupi alla porta', 'Il vecchio lupo', 'Pelli di Bristleback', 'La minaccia di Webwood', 'Problemi al lago', 'Ratti nella miniera',
    'I morti inquieti', 'Scorte rubate', 'Sussurri nel sottosuolo', 'I nomi dei morti', 'Zittire il richiamo', 'Il rito del vincolo',
    'Nel Vuoto', 'La campana del sagrestano', 'La traccia del Gravecaller', 'Banditi della Valle', 'Il capo', 'Adunata a Fenbridge',
    'Zanne del pantano', 'Pelli per la strada rialzata', 'La carovana perduta', 'Deepfen si agita', 'Idoli delle profondità',
    'Ritorno ai bassifondi', 'Seta e veleno', 'La Madre della covata', 'I morti annegati', 'Incensieri delle profondità',
    'Nessun riposo tra le canne', 'Tumuli di Mirefen', 'Feticcio e ossa', 'Il Goloso', 'Vesti tra le canne', 'Fermare la chiamata',
    'Il diacono del pantano', 'Il Bastione Sommerso', 'La vergogna del cavaliere comandante', 'Il Mistcaller', 'La guardia sulle cime',
    'Braccatori sulla cresta', 'Inverno a Highwatch', 'Problemi a Deeprock', 'Cera strana', 'Ogre nelle colline', 'Totem di guerra',
    'La taglia del capitano', 'Spezzare il campo di guerra', 'Signore della guerra Drogmar', 'La montagna si sveglia',
    'Nuclei della tempesta', 'Il signore dei frammenti', 'Canti nel vento', 'Ordini dal basso', 'Anello di filatteri',
    'Campi dei revenant', 'Ossa di avanguardia', 'Sigilli del Wyrm', 'Rompere il sigillo', 'La voce dal basso',
    'La porta del Santuario', 'Il guardiano vincolato', 'Il grande negromante', 'Korzul il Gravewyrm',
  ],
  objectiveItems: [
    'Zanna del vecchio Greyjaw', 'Pelle di cinghiale irsuta', 'Ghiandola di seta di Webwood', 'Cassa di scorte rubata',
    'Sigillo Gravecaller', 'Pagina di registro consunta', 'Sego benedetto', 'Essenza spettrale', 'Grimorio di Morthen',
    'Ordine di adunata di Fenbridge', 'Pelle di predatore del pantano', 'Merci della carovana perduta', 'Idolo fradicio',
    'Sacca velenifera di vedova', 'Incensiere arrugginito', 'Feticcio troll di Mirefen', 'Zanna di Grubjaw',
    'Cifrario Gravecaller', 'Pietra di guardia del Bastione', 'Convocazione di Highwatch', 'Pelle di braccatore della cresta',
    'Cera luminosa', 'Totem di guerra ogre', 'Nucleo della tempesta', 'Frammento del cuore di Kazzix', 'Ordini del Culto del Wyrm',
    'Filatterio rituale', 'Sigillo del Gravewyrm', 'Braci benedette', 'Frammento di chiave del santuario',
  ],
  zones: [
    ['Valle di Eastbrook', 'Cerca il maresciallo Redbrook in città: ha lavoro per te.', ['Eastbrook', 'Sentiero dei lupi', 'Prato dei cinghiali', 'Lago Specchio', 'Webwood', 'Miniera di rame', 'Campo dei banditi', 'Cappella caduta']],
    ['Palude di Mirefen', 'Presentati al custode Fenwick al cancello di Fenbridge.', ['Fenbridge', 'Canne dei predatori', 'Bassifondi di Deepfen', 'Folto delle vedove', 'Cappella annegata', 'Tumuli troll', 'Campo Gravecaller', 'Il Bastione Sommerso']],
    ['Alture di Thornpeak', 'Il capitano Thessaly tiene a stento il muro di Highwatch.', ['Highwatch', 'Cresta del braccatore', 'Tane di Deeprock', 'Colline degli ogre', 'Campo di guerra di Drogmar', 'Stormcrag', 'Il Glimmermere', 'Tende del Culto del Wyrm', 'Campi dei revenant', 'Santuario del Gravewyrm']],
  ],
  dungeons: [
    ['La Cripta Vuota', 'Scendi nella Cripta Vuota...', 'Risali alla luce del giorno.'],
    ['Il Bastione Sommerso', 'Guadi nelle profondità del Bastione Sommerso...', 'Esci dall oscurità annegata.'],
    ['Santuario del Gravewyrm', 'L aria si fa fredda. Qualcosa di immenso respira sotto...', 'Barcolli di nuovo nel vento di montagna.'],
  ],
};

const zhCnData: LocaleData = {
  mobs: [
    '森林狼', '老灰颚', '野猪', '网木潜伏者', '泥鳍潜伏者', '地道鼠掘地者', '谷地强盗', '不宁骸骨', '无情者戈拉克',
    '泥沼潜伏兽', '深沼钳咬鱼人', '泥沼寡妇蛛', '蛛母', '溺亡死者', '泥沼巨魔', '贪食者格鲁布颚', '唤墓者教徒',
    '唤墓者召唤师', '唤墓者医者', '执事沃斯', '山脊潜猎者', '深岩掘地者', '荆峰食人魔', '荆峰粉碎者', '督军德罗格玛',
    '风暴岩元素', '碎片领主卡兹克斯', '龙教狂热者', '龙教死灵法师', '骨甲亡魂', '墓穴蹒跚者', '空洞侍僧',
    '寒骨寡妇蛛', '司事马罗', '唤墓者莫森', '堡垒亡魂', '潮缚侍僧', '溺亡奴仆', '骑士指挥官奥伦',
    '唤雾者维尔', '圣所骨卫', '圣所龙人', '复生骨行者', '被缚者科加斯', '大死灵法师维尔卡', '墓龙科祖尔',
    '沼泽胀囊',
    '训练假人',
  ],
  npcRows: [
    ['商人', '世界市场守护者', '欢迎来到世界市场，{className}。从王国各地的冒险者手中购买，或出售你自己的货物。'],
    ['雷德布鲁克元帅', '城镇元帅', '刀别离手，{className}。山谷已经不是从前的山谷了。'],
    ['威尔克斯商人', '补给商', '新鲜面包，清水，公道价格。你需要什么？'],
    ['林药剂师', '草药师', '在东边林地里落脚要小心，朋友。'],
    ['奥德里克修士', '山谷牧师', '愿圣光护佑你。如今连死者也无法在这里安息。'],
    ['哈德伦铁匠', '护甲与武器匠', '小心火星，{className}。好钢能把伤疤和坟墓隔开。'],
    ['布兰特渔夫', '老水手', '咕噜鱼噜... 抱歉，我听那些鱼人说话太久了。'],
    ['奥德尔工头', '矿井工头', '整条矿道都挤满了那些头顶蜡烛的害虫！'],
    ['芬威克守望者', '芬桥守望者', '在门口停下，{className}。芦苇后面的沼泽会替我们杀人。'],
    ['奥德里克修士', '山谷牧师', '愿圣光让你不沉入水下，{playerName}。这片湿地的死者不睡觉，他们在泥水中跋涉。'],
    ['海尔补给官', '补给商', '干靴子，干面包，干火药：在芬桥，一天能有两样就算不错。'],
    ['雅拉草药师', '草药师', '小心路西边的灌木丛。这里的蛛网厚得像船帆。'],
    ['玛伦斥候', '元帅的斥候', '安静的脚步和短刃能保命。快说，我得回芦苇地去。'],
    ['瑟萨莉队长', '高望队长', '这面墙已经站了两百年，{className}。只要我守着它，它就不会倒，虽然它正在呻吟。'],
    ['奥德里克修士', '山谷牧师', '从礼拜堂墓地到世界屋脊... 线索到这里结束。我感觉山正在聆听。'],
    ['玛伦斥候', '元帅的斥候', '我和你一起在湿地追踪那些邪教徒，而线索通向这里。群峰更糟，{className}。保持警惕。'],
    ['布里军需官', '高望军需官', '羊毛，硬饼，铁掌靴：高望靠这三样维持，而我什么都缺。'],
    ['霍德护甲匠', '护甲大师', '炉火正旺，砂轮正转。能砍的东西，我都卖。'],
    ['凯迪斯博学者', '博学者', '小心松动的页岩，{className}。这座山近来不安，我想知道原因。'],
  ],
  questTitles: [
    '门前群狼', '老狼', '硬鬃皮', '网木之患', '湖边麻烦', '矿洞里的鼠患', '不宁的死者', '被盗的补给', '地下低语',
    '死者之名', '让呼唤沉寂', '束缚仪式', '进入空洞', '司事的钟', '唤墓者的踪迹', '谷地强盗', '匪首',
    '芬桥集结', '沼泽之牙', '修筑栈道的毛皮', '失踪商队', '深沼躁动', '深处的神像', '回到浅滩',
    '丝与毒', '蛛母', '溺亡死者', '深处香炉', '芦苇中不得安息', '泥沼坟丘', '护符与白骨', '贪食者',
    '芦苇中的灰袍', '阻止召唤', '泥沼执事', '沉没堡垒', '骑士指挥官的耻辱', '唤雾者', '群峰守望',
    '山脊上的潜猎者', '冬日将至高望', '深岩麻烦', '奇异蜡块', '山麓食人魔', '战争图腾', '队长的悬赏',
    '击破战争营地', '督军德罗格玛', '山脉苏醒', '风暴核心', '碎片领主', '风中圣歌', '来自地下的命令',
    '护命匣之环', '亡魂战场', '先锋之骨', '墓龙徽记', '破除封印', '地下之声', '圣所大门',
    '被缚守护者', '大死灵法师', '墓龙科祖尔',
  ],
  objectiveItems: [
    '老灰颚的尖牙', '硬鬃野猪皮', '网木丝腺', '被盗补给箱', '唤墓者徽记', '风化账页', '祝福油脂', '幽魂精华',
    '莫森的魔典', '芬桥集结令', '泥沼潜伏者毛皮', '遗失商队货物', '浸水神像', '寡妇毒囊', '生锈香炉',
    '泥沼巨魔护符', '格鲁布颚的獠牙', '唤墓者密文', '堡垒护符石', '高望召令', '山脊潜猎者毛皮',
    '发光蜡块', '食人魔战争图腾', '风暴核心', '卡兹克斯的心裂片', '龙教命令', '仪式护命匣',
    '墓龙徽记', '祝福余烬', '圣所钥匙碎片',
  ],
  zones: [
    ['东溪谷', '去镇上找雷德布鲁克元帅，他有任务交给你。', ['东溪', '狼径', '野猪草地', '镜湖', '网木林', '铜矿坑', '强盗营地', '倒塌礼拜堂']],
    ['泥沼湿地', '到芬桥大门向守望者芬威克报到。', ['芬桥', '潜伏者芦苇地', '深沼浅滩', '寡妇灌木丛', '溺没礼拜堂', '巨魔坟丘', '唤墓者营地', '沉没堡垒']],
    ['荆峰高地', '瑟萨莉队长勉强守住高望城墙。', ['高望', '潜猎者山脊', '深岩洞穴', '食人魔山麓', '德罗格玛战争营地', '风暴岩', '微光湖', '龙教帐篷', '亡魂战场', '墓龙圣所']],
  ],
  dungeons: [
    ['空洞墓穴', '你走下空洞墓穴...', '你重新爬回日光之下。'],
    ['沉没堡垒', '你涉水进入沉没堡垒深处...', '你爬出溺水般的黑暗。'],
    ['墓龙圣所', '空气变得冰冷。下方有庞然之物在呼吸...', '你踉跄回到山风之中。'],
  ],
};

const zhTwData: LocaleData = {
  mobs: [
    '森林狼', '老灰顎', '野豬', '網木潛伏者', '泥鰭潛伏者', '地道鼠掘地者', '谷地強盜', '不寧骸骨',
    '無情者戈拉克', '泥沼潛伏獸', '深沼鉗咬魚人', '泥沼寡婦蛛', '蛛母', '溺亡死者', '泥沼巨魔',
    '貪食者格魯布顎', '喚墓者教徒', '喚墓者召喚師', '喚墓者醫者', '執事沃斯', '山脊潛獵者', '深岩掘地者',
    '荊峰食人魔', '荊峰粉碎者', '督軍德羅格瑪', '風暴岩元素', '碎片領主卡茲克斯', '龍教狂熱者',
    '龍教死靈法師', '骨甲亡魂', '墓穴蹣跚者', '空洞侍僧', '寒骨寡婦蛛', '司事馬羅', '喚墓者莫森',
    '堡壘亡魂', '潮縛侍僧', '溺亡奴僕', '騎士指揮官奧倫', '喚霧者維爾', '聖所骨衛', '聖所龍人',
    '復生骨行者', '被縛者科加斯', '大死靈法師維爾卡', '墓龍科祖爾',
    '沼澤脹囊',
    '訓練假人',
  ],
  npcRows: [
    ['商人', '世界市場守護者', '歡迎來到世界市場，{className}。向王國各地的冒險者購買，或出售你自己的貨物。'],
    ['雷德布魯克元帥', '城鎮元帥', '刀別離手，{className}。山谷已經不是從前的山谷了。'],
    ['威爾克斯商人', '補給商', '新鮮麵包，清水，公道價格。你需要什麼？'],
    ['林藥劑師', '草藥師', '在東邊林地裡落腳要小心，朋友。'],
    ['奧德里克修士', '山谷牧師', '願聖光護佑你。如今連死者也無法在這裡安息。'],
    ['哈德倫鐵匠', '護甲與武器匠', '小心火星，{className}。好鋼能把傷疤和墳墓隔開。'],
    ['布蘭特漁夫', '老水手', '咕嚕魚嚕... 抱歉，我聽那些魚人說話太久了。'],
    ['奧德爾工頭', '礦井工頭', '整條礦道都擠滿了那些頭頂蠟燭的害蟲！'],
    ['芬威克守望者', '芬橋守望者', '在門口停下，{className}。蘆葦後面的沼澤會替我們殺人。'],
    ['奧德里克修士', '山谷牧師', '願聖光讓你不沉入水下，{playerName}。這片濕地的死者不睡覺，他們在泥水中跋涉。'],
    ['海爾補給官', '補給商', '乾靴子，乾麵包，乾火藥：在芬橋，一天能有兩樣就算不錯。'],
    ['雅拉草藥師', '草藥師', '小心路西邊的灌木叢。這裡的蛛網厚得像船帆。'],
    ['瑪倫斥候', '元帥的斥候', '安靜的腳步和短刃能保命。快說，我得回蘆葦地去。'],
    ['瑟薩莉隊長', '高望隊長', '這面牆已經站了兩百年，{className}。只要我守著它，它就不會倒，雖然它正在呻吟。'],
    ['奧德里克修士', '山谷牧師', '從禮拜堂墓地到世界屋脊... 線索到這裡結束。我感覺山正在聆聽。'],
    ['瑪倫斥候', '元帥的斥候', '我和你一起在濕地追蹤那些邪教徒，而線索通向這裡。群峰更糟，{className}。保持警惕。'],
    ['布里軍需官', '高望軍需官', '羊毛，硬餅，鐵掌靴：高望靠這三樣維持，而我什麼都缺。'],
    ['霍德護甲匠', '護甲大師', '爐火正旺，砂輪正轉。能砍的東西，我都賣。'],
    ['凱迪斯博學者', '博學者', '小心鬆動的頁岩，{className}。這座山近來不安，我想知道原因。'],
  ],
  questTitles: [
    '門前群狼', '老狼', '硬鬃皮', '網木之患', '湖邊麻煩', '礦洞裡的鼠患', '不寧的死者', '被盜的補給',
    '地下低語', '死者之名', '讓呼喚沉寂', '束縛儀式', '進入空洞', '司事的鐘', '喚墓者的蹤跡',
    '谷地強盜', '匪首', '芬橋集結', '沼澤之牙', '修築棧道的毛皮', '失蹤商隊', '深沼躁動',
    '深處的神像', '回到淺灘', '絲與毒', '蛛母', '溺亡死者', '深處香爐', '蘆葦中不得安息',
    '泥沼墳丘', '護符與白骨', '貪食者', '蘆葦中的灰袍', '阻止召喚', '泥沼執事', '沉沒堡壘',
    '騎士指揮官的恥辱', '喚霧者', '群峰守望', '山脊上的潛獵者', '冬日將至高望', '深岩麻煩',
    '奇異蠟塊', '山麓食人魔', '戰爭圖騰', '隊長的懸賞', '擊破戰爭營地', '督軍德羅格瑪',
    '山脈甦醒', '風暴核心', '碎片領主', '風中聖歌', '來自地下的命令', '護命匣之環', '亡魂戰場',
    '先鋒之骨', '墓龍徽記', '破除封印', '地下之聲', '聖所大門', '被縛守護者', '大死靈法師',
    '墓龍科祖爾',
  ],
  objectiveItems: [
    '老灰顎的尖牙', '硬鬃野豬皮', '網木絲腺', '被盜補給箱', '喚墓者徽記', '風化帳頁',
    '祝福油脂', '幽魂精華', '莫森的魔典', '芬橋集結令', '泥沼潛伏者毛皮', '遺失商隊貨物',
    '浸水神像', '寡婦毒囊', '生鏽香爐', '泥沼巨魔護符', '格魯布顎的獠牙', '喚墓者密文',
    '堡壘護符石', '高望召令', '山脊潛獵者毛皮', '發光蠟塊', '食人魔戰爭圖騰', '風暴核心',
    '卡茲克斯的心裂片', '龍教命令', '儀式護命匣', '墓龍徽記', '祝福餘燼', '聖所鑰匙碎片',
  ],
  zones: [
    ['東溪谷', '去鎮上找雷德布魯克元帥，他有任務交給你。', ['東溪', '狼徑', '野豬草地', '鏡湖', '網木林', '銅礦坑', '強盜營地', '倒塌禮拜堂']],
    ['泥沼濕地', '到芬橋大門向守望者芬威克報到。', ['芬橋', '潛伏者蘆葦地', '深沼淺灘', '寡婦灌木叢', '溺沒禮拜堂', '巨魔墳丘', '喚墓者營地', '沉沒堡壘']],
    ['荊峰高地', '瑟薩莉隊長勉強守住高望城牆。', ['高望', '潛獵者山脊', '深岩洞穴', '食人魔山麓', '德羅格瑪戰爭營地', '風暴岩', '微光湖', '龍教帳篷', '亡魂戰場', '墓龍聖所']],
  ],
  dungeons: [
    ['空洞墓穴', '你走下空洞墓穴...', '你重新爬回日光之下。'],
    ['沉沒堡壘', '你涉水進入沉沒堡壘深處...', '你爬出溺水般的黑暗。'],
    ['墓龍聖所', '空氣變得冰冷。下方有龐然之物在呼吸...', '你踉蹌回到山風之中。'],
  ],
};

const koData: LocaleData = {
  mobs: [
    '숲늑대', '늙은 그레이죠', '야생 멧돼지', '그물나무 잠복자', '진흙지느러미 잠복자', '굴쥐 채굴꾼', '계곡 도적',
    '불안한 뼈무더기', '무자비한 고라크', '수렁 배회자', '딥펜 무는이', '마이어펜 과부거미', '거미어미',
    '익사한 망자', '마이어펜 트롤', '대식가 그럽죠', '무덤부름 교단원', '무덤부름 소환사', '무덤부름 치유사', '부제 보스',
    '산등성이 추적자', '깊은바위 굴꾼', '쏜피크 오우거', '쏜피크 분쇄자', '전쟁군주 드로그마르',
    '스톰크래그 정령', '파편군주 카직스', '고룡교단 광신도', '고룡교단 강령술사', '뼈갑옷 망령',
    '묘실 비틀거림꾼', '공허의 수행사제', '뼈서리 과부거미', '성구지기 매로우', '무덤부름 모르덴',
    '요새 망령', '조수결속 수행사제', '익사한 노예', '기사대장 올렌', '안개부름 바엘', '성소 뼈수호자',
    '성소 드라코니드', '되살아난 뼈걸음꾼', '속박된 코르가스', '대강령술사 벨카르', '무덤고룡 코르줄',
    '늪 팽창체',
    '훈련용 허수아비',
  ],
  npcRows: [
    ['상인', '세계 시장 관리자', '세계 시장에 오신 것을 환영합니다, {className}. 왕국의 모험가들에게서 물건을 사거나 자신의 물건을 내놓으십시오.'],
    ['레드브룩 원수', '마을 원수', '검을 가까이 두십시오, {className}. 계곡은 더 이상 예전 같지 않습니다.'],
    ['상인 윌크스', '보급상', '갓 구운 빵, 맑은 물, 정직한 가격입니다. 무엇이 필요하십니까?'],
    ['약제사 린', '약초상', '동쪽 숲에서 발 디딜 곳을 조심하십시오, 친구여.'],
    ['알드릭 수사', '계곡의 사제', '빛이 그대를 지켜 주기를. 이곳에서는 죽은 자들조차 이제 안식을 얻지 못합니다.'],
    ['대장장이 할드렌', '방어구 및 무기 제작자', '불꽃을 조심하십시오, {className}. 좋은 강철은 흉터와 무덤을 가릅니다.'],
    ['어부 브란트', '늙은 뱃사람', '그르멀그르... 죄송합니다. 저 물고기 인간들 말을 너무 오래 들었습니다.'],
    ['감독관 오델', '광산 감독관', '갱도 전체가 머리에 촛불을 단 해충들로 들끓고 있습니다!'],
    ['감시관 펜윅', '펜브리지 감시관', '문 앞에서 멈추십시오, {className}. 갈대 너머의 수렁은 우리 대신 사람을 죽입니다.'],
    ['알드릭 수사', '계곡의 사제', '빛이 그대를 물 위에 머물게 하기를, {playerName}. 이 습지의 죽은 자들은 잠들지 않고 물을 헤칩니다.'],
    ['보급관 헤일', '보급상', '마른 장화, 마른 빵, 마른 화약: 펜브리지에서는 셋 중 둘만 있어도 좋은 날입니다.'],
    ['약초상 야라', '약초상', '길 서쪽의 덤불을 조심하십시오. 거미줄이 돛처럼 두껍습니다.'],
    ['정찰병 마렌', '원수의 정찰병', '조용한 발걸음과 짧은 칼날이 목숨을 지킵니다. 빨리 말하십시오. 갈대밭으로 돌아가야 합니다.'],
    ['대장 테살리', '하이워치 대장', '이 성벽은 이백 년을 버텼습니다, {className}. 내가 지키는 동안 무너지지는 않겠지만, 신음하고 있습니다.'],
    ['알드릭 수사', '계곡의 사제', '예배당 묘지에서 세상의 지붕까지... 흔적은 여기서 끝납니다. 산이 듣고 있음을 느낍니다.'],
    ['정찰병 마렌', '원수의 정찰병', '당신과 함께 습지에서 광신도들을 추적했고, 그 흔적은 여기로 이어졌습니다. 봉우리는 더 위험합니다, {className}. 경계를 늦추지 마십시오.'],
    ['병참장교 브리', '하이워치 병참장교', '양모, 딱딱한 건빵, 쇠박은 장화: 하이워치는 이 세 가지로 버티지만 나는 전부 부족합니다.'],
    ['방어구 제작자 호드', '장인 방어구 제작자', '화덕은 뜨겁고 숫돌은 돌고 있습니다. 베는 물건이라면 팝니다.'],
    ['현자 캐디스', '현자', '느슨한 혈암을 조심하십시오, {className}. 산이 요즘 불안정해졌고, 나는 그 이유를 알고 싶습니다.'],
  ],
  questTitles: [
    '문 앞의 늑대들', '늙은 늑대', '성난등 가죽', '그물나무의 위협', '호숫가의 골칫거리', '광산의 쥐들',
    '쉬지 못하는 죽은 자', '도난당한 보급품', '아래의 속삭임', '죽은 자들의 이름', '부름을 침묵시키기',
    '속박 의식', '공허 속으로', '성구지기의 종', '무덤부름의 흔적', '계곡의 도적들', '우두머리',
    '펜브리지 소집', '수렁의 이빨', '둑길을 위한 가죽', '잃어버린 대상단', '딥펜의 동요', '깊은 곳의 우상',
    '얕은 물가로', '비단과 독', '거미어미', '익사한 망자들', '깊은 곳의 향로', '갈대밭에 안식은 없다',
    '마이어펜 봉분', '부적과 뼈', '대식가', '갈대밭의 로브', '소환 저지', '수렁의 부제', '가라앉은 요새',
    '기사대장의 치욕', '안개부름', '봉우리의 감시', '산등성이의 추적자', '하이워치에 겨울이 온다',
    '깊은바위 문제', '이상한 밀랍', '구릉의 오우거', '전쟁 토템', '대장의 현상금', '전쟁 야영지 파괴',
    '전쟁군주 드로그마르', '산이 깨어난다', '폭풍의 핵', '파편군주', '바람 위의 성가', '아래에서 온 명령',
    '성물함의 고리', '망령 들판', '선봉대의 뼈', '고룡의 인장', '봉인 깨기', '아래의 목소리', '성소의 문',
    '속박된 수호자', '대강령술사', '무덤고룡 코르줄',
  ],
  objectiveItems: [
    '늙은 그레이죠의 송곳니', '억센 멧돼지 가죽', '그물나무 비단샘', '도난당한 보급 상자', '무덤부름 인장',
    '풍화된 장부 페이지', '축복받은 수지', '유령 정수', '모르덴의 마법서', '펜브리지 소집 명령서',
    '수렁 배회자 가죽', '잃어버린 대상단 물품', '물먹은 우상', '과부 독주머니', '녹슨 향로',
    '마이어펜 트롤 부적', '그럽죠의 엄니', '무덤부름 암호문', '요새 수호석', '하이워치 소환장',
    '산등성이 추적자 가죽', '빛나는 밀랍', '오우거 전쟁 토템', '폭풍 핵', '카직스의 심장파편',
    '고룡교단 명령서', '의식 성물함', '무덤고룡 인장', '축복받은 불씨', '성소 열쇠 조각',
  ],
  zones: [
    ['이스트브룩 골짜기', '마을의 레드브룩 원수를 찾아가십시오. 그가 당신에게 맡길 일이 있습니다.', ['이스트브룩', '늑대길', '멧돼지 초원', '거울호수', '그물나무숲', '구리 광산', '도적 야영지', '무너진 예배당']],
    ['마이어펜 습지', '펜브리지 문에서 감시관 펜윅에게 보고하십시오.', ['펜브리지', '배회자 갈대밭', '딥펜 얕은 물', '과부거미 덤불', '가라앉은 예배당', '트롤 봉분', '무덤부름 야영지', '가라앉은 요새']],
    ['쏜피크 고지', '테살리 대장이 간신히 하이워치 성벽을 지키고 있습니다.', ['하이워치', '추적자 산등성이', '딥록 굴', '오우거 구릉', '드로그마르 전쟁 야영지', '스톰크래그', '글리머미어', '고룡교단 천막', '망령 들판', '무덤고룡 성소']],
  ],
  dungeons: [
    ['텅 빈 묘실', '텅 빈 묘실로 내려갑니다...', '다시 햇빛 아래로 올라옵니다.'],
    ['가라앉은 요새', '가라앉은 요새의 깊은 곳으로 물을 헤치며 들어갑니다...', '물에 잠긴 어둠에서 빠져나옵니다.'],
    ['무덤고룡 성소', '공기가 차가워집니다. 아래에서 거대한 무언가가 숨 쉽니다...', '산바람 속으로 비틀거리며 돌아옵니다.'],
  ],
};

const jaData: LocaleData = {
  mobs: [
    '森の狼', '老グレイジョー', '野生の猪', 'ウェブウッドの潜伏者', '泥ひれの潜伏者', 'トンネルラット掘り',
    '谷の盗賊', '安らがぬ骨', '無慈悲なるゴラック', '沼の徘徊者', 'ディープフェンのスナッパー', 'マイアフェンのウィドウ',
    '群れの母', '溺れ死者', 'マイアフェン・トロル', '大食いグラブジョー', 'グレイブコーラーの信徒',
    'グレイブコーラーの召喚師', 'グレイブコーラーの癒し手', '助祭ヴォス', '尾根の追跡者', 'ディープロックの坑夫', 'ソーンピーク・オーガ',
    'ソーンピークの粉砕者', '将軍ドログマー', 'ストームクラッグの精霊', '破片卿カジックス',
    'ワーム教団の狂信者', 'ワーム教団の死霊術師', '骨まといの亡霊', '墓所のよろめき手',
    '虚ろの侍祭', '骨冷えのウィドウ', '墓守マロウ', '墓呼びのモーセン', '砦の亡霊',
    '潮縛りの侍祭', '溺れた下僕', '騎士司令官オレン', '霧呼びのヴァエル', '聖所の骨衛兵',
    '聖所のドラコニッド', '甦った骨歩き', '縛られしコルガス', '大死霊術師ヴェルカー', '墓ワームのコルズル',
    '沼地の膨れ',
    '訓練用ダミー',
  ],
  npcRows: [
    ['商人', '世界市場の守り手', '世界市場へようこそ、{className}。王国中の冒険者から買うことも、自分の品を売ることもできます。'],
    ['レッドブルック元帥', '町の元帥', '刃を近くに置いておきなさい、{className}。谷はもう昔のままではありません。'],
    ['商人ウィルクス', '補給商', '焼きたてのパン、澄んだ水、正直な値段です。何が必要ですか？'],
    ['薬師リン', '薬草師', '東の森では足元に気をつけてください、友よ。'],
    ['アルドリック修道士', '谷の司祭', '光があなたを守りますように。ここでは死者でさえ安らげなくなりました。'],
    ['鍛冶師ハルドレン', '防具と武器の鍛冶師', '火花に気をつけなさい、{className}。良い鋼は傷跡と墓を分けます。'],
    ['漁師ブラント', '老いた船乗り', 'グルマーログル... 失礼、魚人どもの声を聞きすぎました。'],
    ['監督官オデル', '鉱山監督', '坑道全体が頭にろうそくを立てた害虫どもでいっぱいです！'],
    ['番人フェンウィック', 'フェンブリッジの番人', '門で止まりなさい、{className}。葦の向こうでは沼が我々の代わりに命を奪います。'],
    ['アルドリック修道士', '谷の司祭', '光があなたを水の上に留めますように、{playerName}。この湿地の死者は眠らず、水を歩きます。'],
    ['補給係ヘイル', '補給商', '乾いた靴、乾いたパン、乾いた火薬。フェンブリッジでは三つのうち二つあれば上出来です。'],
    ['薬草師ヤラ', '薬草師', '道の西の茂みに気をつけてください。蜘蛛の巣が帆のように厚くなっています。'],
    ['斥候マレン', '元帥の斥候', '静かな足取りと短い刃が命を守ります。手短に。葦原へ戻らねばなりません。'],
    ['隊長テサリー', 'ハイウォッチ隊長', 'この壁は二百年立ち続けています、{className}。私が守る限り崩れませんが、悲鳴を上げています。'],
    ['アルドリック修道士', '谷の司祭', '礼拝堂の墓地から世界の屋根まで... 足跡はここで終わります。山が耳を澄ませているのを感じます。'],
    ['斥候マレン', '元帥の斥候', 'あなたと共に湿地で信徒を追いました。そして足跡はここへ続いています。峰はさらに危険です、{className}。油断しないで。'],
    ['需品係ブリー', 'ハイウォッチ需品係', '羊毛、堅パン、鋲打ちの靴。ハイウォッチはこの三つで保っていますが、私はすべて不足しています。'],
    ['防具師ホード', '熟練防具師', '炉は熱く、砥石は回っています。切れるものなら売ります。'],
    ['博識者キャディス', '博識者', '崩れやすい頁岩に気をつけてください、{className}。山は近ごろ落ち着きがなく、その理由を知りたいのです。'],
  ],
  questTitles: [
    '戸口の狼', '老いた狼', 'ブリッスルバックの皮', 'ウェブウッドの脅威', '湖の騒ぎ', '鉱山の鼠',
    '安らがぬ死者', '盗まれた物資', '地下の囁き', '死者の名', '呼び声を沈めよ', '束縛の儀式',
    '虚ろへ', '墓守の鐘', '墓呼びの足跡', '谷の盗賊', '首領', 'フェンブリッジ集結', '沼の牙',
    '土手道のための毛皮', '失われた隊商', 'ディープフェンの目覚め', '深みの偶像', '浅瀬へ戻せ',
    '絹と毒', '群れの母', '溺れし死者', '深みの香炉', '葦の中に安息なし', 'マイアフェンの塚',
    '護符と骨', '大食らい', '葦の中のローブ', '召喚を止めろ', '沼の助祭', '沈んだ砦',
    '騎士司令官の恥', '霧呼び', '峰の見張り', '尾根の追跡者', 'ハイウォッチに冬来たる',
    'ディープロックの問題', '奇妙な蝋', '麓のオーガ', '戦のトーテム', '隊長の懸賞金',
    '戦営を砕け', '将軍ドログマー', '山が目覚める', '嵐の核', '破片卿', '風の上の詠唱',
    '下からの命令', '経箱の輪', '亡霊の野', '先鋒の骨', 'ワームの印章', '封印を破る',
    '下なる声', '聖所の門', '縛られた守護者', '大死霊術師', '墓ワームのコルズル',
  ],
  objectiveItems: [
    '老グレイジョーの牙', '剛毛猪の皮', 'ウェブウッドの絹腺', '盗まれた補給箱', 'グレイブコーラーの印章',
    '風化した帳簿のページ', '祝福された獣脂', '幽霊のエッセンス', 'モーセンの魔導書', 'フェンブリッジ召集令',
    '沼の徘徊者の毛皮', '失われた隊商の物資', '水浸しの偶像', '寡婦蜘蛛の毒嚢', '錆びた香炉',
    'マイアフェン・トロルの護符', 'グラブジョーの牙', 'グレイブコーラーの暗号', '砦の護り石',
    'ハイウォッチ召喚状', '尾根の追跡者の毛皮', '光る蝋', 'オーガ戦のトーテム', '嵐の核',
    'カジックスの心臓片', 'ワーム教団の命令書', '儀式の経箱', '墓ワームの印章', '祝福された残り火',
    '聖所の鍵片',
  ],
  zones: [
    ['イーストブルック渓谷', '町のレッドブルック元帥を訪ねてください。あなたに頼みたい仕事があります。', ['イーストブルック', '狼の道', '猪の草地', '鏡の湖', 'ウェブウッド', '銅鉱山', '盗賊の野営地', '倒れた礼拝堂']],
    ['マイアフェン湿地', 'フェンブリッジの門で番人フェンウィックに報告してください。', ['フェンブリッジ', '徘徊者の葦原', 'ディープフェンの浅瀬', '寡婦蜘蛛の茂み', '沈んだ礼拝堂', 'トロルの塚', 'グレイブコーラーの野営地', '沈んだ砦']],
    ['ソーンピーク高地', 'テサリー隊長がかろうじてハイウォッチの壁を保っています。', ['ハイウォッチ', '追跡者の尾根', 'ディープロックの巣穴', 'オーガの丘陵', 'ドログマーの戦営', 'ストームクラッグ', 'グリマーミア', 'ワーム教団の天幕', '亡霊の野', '墓ワームの聖所']],
  ],
  dungeons: [
    ['虚ろの墓所', '虚ろの墓所へ降りていきます...', '日の光の下へ戻ります。'],
    ['沈んだ砦', '沈んだ砦の深みへ水をかき分けて進みます...', '水に沈む闇から抜け出します。'],
    ['墓ワームの聖所', '空気が冷たくなります。下で巨大な何かが息をしています...', '山風の中へよろめき戻ります。'],
  ],
};

const ptData: LocaleData = {
  mobs: [
    'Lobo da floresta', 'Velho Greyjaw', 'Javali selvagem', 'Espreitador de Webwood', 'Espreitador Barbatana-de-lodo', 'Escavador rato de túnel',
    'Bandido do Vale', 'Ossos inquietos', 'Gorrak o Impiedoso', 'Espreitador do brejo', 'Murloc de Deepfen', 'Viúva de Mirefen',
    'Mãe da ninhada', 'Morto afogado', 'Troll de Mirefen', 'Grubjaw o Glutão', 'Cultista Gravecaller', 'Invocador Gravecaller', 'Curandeiro Gravecaller',
    'Diácono Voss', 'Rastreador da crista', 'Kobold de Deeprock', 'Ogro de Thornpeak', 'Esmagador ogro', 'Senhor da guerra Drogmar',
    'Elemental de Stormcrag', 'Senhor dos fragmentos Kazzix', 'Zelote do Culto do Wyrm', 'Necromante do Culto do Wyrm',
    'Revenante encouraçado de ossos', 'Cambaleante da cripta', 'Acólito do Vazio', 'Viúva Frio-osso', 'Sacristão Marrow',
    'Morthen o Gravecaller', 'Revenante do Bastião', 'Acólito preso à maré', 'Servo afogado', 'Cavaleiro-comandante Olen',
    'Vael o Mistcaller', 'Guarda-osso do Santuário', 'Draconídeo do Santuário', 'Andarilho de ossos erguido',
    'Korgath o Acorrentado', 'Grande necromante Velkhar', 'Korzul o Gravewyrm',
    'Inchaço do Brejo',
    'Boneco de treino',
  ],
  npcRows: [
    ['O Mercador', 'Guardião do Mercado Mundial', 'Bem-vindo ao Mercado Mundial, {className}. Compre de aventureiros do reino ou venda suas próprias mercadorias.'],
    ['Marechal Redbrook', 'Marechal da cidade', 'Mantenha a lâmina por perto, {className}. O Vale já não é o mesmo.'],
    ['Comerciante Wilkes', 'Fornecedor', 'Pão fresco, água limpa e preços honestos. Do que você precisa?'],
    ['Boticária Lin', 'Herbalista', 'Cuidado onde pisa nas matas do leste, amigo.'],
    ['Irmão Aldric', 'Sacerdote do Vale', 'Que a Luz proteja você. Nem os mortos encontram descanso aqui ultimamente.'],
    ['Ferreiro Haldren', 'Armeiro e ferreiro', 'Cuidado com as faíscas, {className}. Bom aço separa uma cicatriz de uma sepultura.'],
    ['Pescador Brandt', 'Velho lobo do mar', 'Grlmurlgrl... perdão, ouvi esses homens-peixe por tempo demais.'],
    ['Capataz Odell', 'Capataz da mina', 'Toda a galeria está cheia desses vermes com vela na cabeça!'],
    ['Guardião Fenwick', 'Guardião de Fenbridge', 'Pare no portão, {className}. Além dos juncos, o pântano mata por nós.'],
    ['Irmão Aldric', 'Sacerdote do Vale', 'Que a Luz mantenha você acima da água, {playerName}. Os mortos deste pântano não dormem: eles vadearam.'],
    ['Fornecedor Hale', 'Fornecedor', 'Botas secas, pão seco e pólvora seca: em Fenbridge, dois de três já é um bom dia.'],
    ['Herbalista Yara', 'Herbalista', 'Cuidado com o matagal a oeste da estrada. As teias estão grossas como velas de navio.'],
    ['Batedora Maren', 'Batedora do marechal', 'Passos silenciosos e uma lâmina curta mantêm você vivo. Fale depressa: preciso voltar aos juncos.'],
    ['Capitã Thessaly', 'Capitã de Highwatch', 'Este muro resiste há duzentos anos, {className}. Não cairá sob minha guarda, embora já gema.'],
    ['Irmão Aldric', 'Sacerdote do Vale', 'Do cemitério da capela ao teto do mundo... a trilha termina aqui. Sinto a montanha ouvindo.'],
    ['Batedora Maren', 'Batedora do marechal', 'Segui os cultistas pelo pântano com você, e a trilha leva até aqui. Os picos são piores, {className}. Fique alerta.'],
    ['Intendente Bree', 'Intendente de Highwatch', 'Lã, biscoito duro e botas ferradas: Highwatch vive dessas três coisas, e estou sem tudo.'],
    ['Armeiro Hode', 'Mestre armeiro', 'A forja está quente e a pedra gira. Se corta, eu vendo.'],
    ['Mestre do saber Caddis', 'Mestre do saber', 'Cuidado com a ardósia solta, {className}. A montanha anda inquieta, e quero saber por quê.'],
  ],
  questTitles: [
    'Lobos à porta', 'O velho lobo', 'Peles de Bristleback', 'A ameaça de Webwood', 'Problemas no lago', 'Ratos na mina',
    'Os mortos inquietos', 'Suprimentos roubados', 'Sussurros no subsolo', 'Os nomes dos mortos', 'Silenciar o chamado',
    'O rito de vínculo', 'Para o Vazio', 'O sino do sacristão', 'A trilha do Gravecaller', 'Bandidos do Vale', 'O chefe',
    'Concentração em Fenbridge', 'Dentes do brejo', 'Peles para a passarela', 'A caravana perdida', 'Deepfen se agita',
    'Ídolos das profundezas', 'De volta aos baixios', 'Seda e veneno', 'A Mãe da ninhada', 'Os mortos afogados',
    'Incensários das profundezas', 'Sem descanso nos juncos', 'Túmulos de Mirefen', 'Fetiche e osso', 'O Glutão',
    'Vestes nos juncos', 'Deter a invocação', 'O diácono do brejo', 'O Bastião Submerso', 'A vergonha do cavaleiro-comandante',
    'O Mistcaller', 'A guarda nos picos', 'Rastreadores na crista', 'O inverno chega a Highwatch', 'Problemas em Deeprock',
    'Cera estranha', 'Ogros nas colinas', 'Totens de guerra', 'A recompensa da capitã', 'Quebrar o acampamento de guerra',
    'Senhor da guerra Drogmar', 'A montanha desperta', 'Núcleos da tempestade', 'O senhor dos fragmentos', 'Cânticos no vento',
    'Ordens de baixo', 'O anel de filactérios', 'Campos de revenantes', 'Ossos da vanguarda', 'Sigilos do Wyrm',
    'Quebrar o selo', 'A voz de baixo', 'O portão do Santuário', 'O guardião acorrentado', 'O grande necromante',
    'Korzul o Gravewyrm',
  ],
  objectiveItems: [
    'Presa do velho Greyjaw', 'Pele eriçada de javali', 'Glândula de seda de Webwood', 'Caixa de suprimentos roubada',
    'Sigilo Gravecaller', 'Página de registro gasta', 'Sebo abençoado', 'Essência espectral', 'Grimório de Morthen',
    'Ordem de concentração de Fenbridge', 'Pele de espreitador do brejo', 'Mercadorias da caravana perdida', 'Ídolo encharcado',
    'Bolsa de veneno de viúva', 'Incensário enferrujado', 'Fetiche troll de Mirefen', 'Presa de Grubjaw', 'Cifra Gravecaller',
    'Pedra guardiã do Bastião', 'Convocação de Highwatch', 'Pele de rastreador da crista', 'Cera brilhante',
    'Totem de guerra ogro', 'Núcleo da tempestade', 'Fragmento do coração de Kazzix', 'Ordens do Culto do Wyrm',
    'Filactério ritual', 'Sigilo do Gravewyrm', 'Brasas abençoadas', 'Fragmento de chave do santuário',
  ],
  zones: [
    ['Vale de Eastbrook', 'Procure o marechal Redbrook na cidade: ele tem trabalho para você.', ['Eastbrook', 'Trilha dos lobos', 'Campo dos javalis', 'Lago Espelho', 'Webwood', 'Mina de cobre', 'Acampamento bandido', 'Capela caída']],
    ['Pântano de Mirefen', 'Apresente-se ao guardião Fenwick no portão de Fenbridge.', ['Fenbridge', 'Juncos dos espreitadores', 'Baixios de Deepfen', 'Matagal das viúvas', 'Capela afogada', 'Túmulos troll', 'Acampamento Gravecaller', 'O Bastião Submerso']],
    ['Alturas de Thornpeak', 'A capitã Thessaly mal segura o muro de Highwatch.', ['Highwatch', 'Crista do rastreador', 'Tocas de Deeprock', 'Colinas ogro', 'Acampamento de guerra de Drogmar', 'Stormcrag', 'O Glimmermere', 'Tendas do Culto do Wyrm', 'Campos de revenantes', 'Santuário do Gravewyrm']],
  ],
  dungeons: [
    ['A Cripta Vazia', 'Você desce para a Cripta Vazia...', 'Você volta à luz do dia.'],
    ['O Bastião Submerso', 'Você avança pela água até as profundezas do Bastião Submerso...', 'Você sai da escuridão afogada.'],
    ['Santuário do Gravewyrm', 'O ar fica frio. Algo imenso respira abaixo...', 'Você cambaleia de volta ao vento da montanha.'],
  ],
};

const ruData: LocaleData = {
  mobs: [
    'Лесной волк', 'Старый Серочелюст', 'Дикий кабан', 'Паук-скрытень Вебвуда', 'Илогривый скрытень', 'Копатель Туннельная Крыса',
    'Долинный бандит', 'Беспокойные кости', 'Горрак Безжалостный', 'Болотный хищник', 'Глубинный щелкун', 'Мирефенская вдова',
    'Матка выводка', 'Утопший мертвец', 'Мирефенский тролль', 'Грубджо Обжора', 'Культист Могильного Зова', 'Призыватель Могильного Зова', 'Лекарь Могильного Зова',
    'Дьякон Восс', 'Хребтовый охотник', 'Глубокоскальный туннельщик', 'Огр Терновых Пиков', 'Крушитель Терновых Пиков',
    'Воевода Дрогмар', 'Элементаль Грозового Утеса', 'Осколочный владыка Каззикс', 'Фанатик Культа Вирма',
    'Некромант Культа Вирма', 'Костепанцирный ревенант', 'Склепный шатун', 'Послушник Пустоти', 'Ледяная вдова',
    'Пономарь Марроу', 'Мортен Могильный Зов', 'Ревенант бастиона', 'Приливный послушник', 'Утопший раб',
    'Рыцарь-командор Олен', 'Ваэль Зовущий Туман', 'Костяной страж святилища', 'Драконид святилища',
    'Поднятый костеход', 'Коргат Связанный', 'Верховный некромант Велхар', 'Корзул Могильный Вирм',
    'Болотный вздутень',
    'Тренировочный манекен',
  ],
  npcRows: [
    ['Торговец', 'Хранитель мирового рынка', 'Добро пожаловать на Мировой рынок, {className}. Покупайте у искателей приключений всего королевства или выставляйте свои товары.'],
    ['Маршал Редбрук', 'Городской маршал', 'Держите клинок рядом, {className}. Долина уже не та, что прежде.'],
    ['Торговец Уилкс', 'Снабженец', 'Свежий хлеб, чистая вода, честные цены. Что вам нужно?'],
    ['Аптекарь Лин', 'Травница', 'Осторожнее ступайте в восточных лесах, друг.'],
    ['Брат Алдрик', 'Жрец долины', 'Да хранит вас Свет. Даже мертвым здесь нынче нет покоя.'],
    ['Кузнец Халдрен', 'Бронник и оружейник', 'Берегитесь искр, {className}. Хорошая сталь отделяет шрам от могилы.'],
    ['Рыбак Брандт', 'Старый моряк', 'Грлмурлгрл... простите, слишком долго слушал этих рыболюдей.'],
    ['Прораб Оделл', 'Горный прораб', 'Вся выработка кишит этими свечеголовыми паразитами!'],
    ['Страж Фенвик', 'Страж Фенбриджа', 'Стойте у ворот, {className}. За камышом топь убивает за нас.'],
    ['Брат Алдрик', 'Жрец долины', 'Да удержит вас Свет над водой, {playerName}. Мертвые в этой топи не спят: они бредут.'],
    ['Снабженец Хейл', 'Снабженец', 'Сухие сапоги, сухой хлеб и сухой порох: в Фенбридже в хороший день есть два из трех.'],
    ['Травница Яра', 'Травница', 'Берегитесь чащи к западу от дороги. Паутина нынче толста, как парусина.'],
    ['Разведчица Марен', 'Разведчица маршала', 'Тихие шаги и короткий клинок сохраняют жизнь. Говорите быстро, мне пора в камыши.'],
    ['Капитан Тессали', 'Капитан Хайвотча', 'Двести лет эта стена стоит, {className}. При мне она не падет, хотя уже стонет.'],
    ['Брат Алдрик', 'Жрец долины', 'От кладбища часовни до крыши мира... след заканчивается здесь. Я чувствую, как гора слушает.'],
    ['Разведчица Марен', 'Разведчица маршала', 'Я выслеживала культистов в топи рядом с вами, и след привел сюда. Вершины хуже, {className}. Будьте начеку.'],
    ['Квартирмейстер Бри', 'Квартирмейстер Хайвотча', 'Шерсть, сухари и подбитые железом сапоги: Хайвотч держится на этом, а мне не хватает всего.'],
    ['Бронник Ходе', 'Мастер-бронник', 'Горн горяч, точило крутится. Если режет, я это продаю.'],
    ['Хранитель знаний Каддис', 'Хранитель знаний', 'Осторожнее с рыхлым сланцем, {className}. Гора стала беспокойной, и я намерен узнать почему.'],
  ],
  questTitles: [
    'Волки у дверей', 'Старый волк', 'Шкуры щетиноспинов', 'Угроза Вебвуда', 'Беда у озера', 'Крысы в шахте',
    'Беспокойные мертвецы', 'Украденные припасы', 'Шепот внизу', 'Имена мертвых', 'Заглушить зов', 'Обряд связывания',
    'В Пустоту', 'Колокол пономаря', 'След Могильного Зова', 'Бандиты долины', 'Главарь', 'Сбор у Фенбриджа',
    'Зубы топи', 'Шкуры для настила', 'Потерянный караван', 'Глубокая Топь шевелится', 'Идолы глубин', 'Назад на отмели',
    'Шелк и яд', 'Матка выводка', 'Утопшие мертвецы', 'Кадила из глубин', 'Нет покоя в камышах', 'Курганы Мирефена',
    'Фетиш и кость', 'Обжора', 'Робы в камышах', 'Остановить призыв', 'Дьякон топи', 'Затонувший бастион',
    'Позор рыцаря-командора', 'Зовущий Туман', 'Дозор на пиках', 'Охотники на хребте', 'Зима идет в Хайвотч',
    'Беда Глубокоскалья', 'Странный воск', 'Огры у предгорий', 'Тотемы войны', 'Награда капитана',
    'Сломать военный лагерь', 'Воевода Дрогмар', 'Гора просыпается', 'Ядра бури', 'Осколочный владыка',
    'Песнопения на ветру', 'Приказы снизу', 'Кольцо филактерий', 'Поля ревенантов', 'Кости авангарда',
    'Сигилы Вирма', 'Сломать печать', 'Голос снизу', 'Врата святилища', 'Связанный страж', 'Верховный некромант',
    'Корзул Могильный Вирм',
  ],
  objectiveItems: [
    'Клык старого Серочелюста', 'Щетинистая кабанья шкура', 'Шелковая железа Вебвуда', 'Украденный ящик припасов',
    'Сигил Могильного Зова', 'Выветренная страница книги учета', 'Благословенное сало', 'Призрачная эссенция',
    'Гримуар Мортена', 'Приказ о сборе в Фенбридже', 'Шкура болотного хищника', 'Товары пропавшего каравана',
    'Размокший идол', 'Ядовитый мешочек вдовы', 'Ржавое кадило', 'Фетиш тролля Мирефена', 'Клык Грубджо',
    'Шифр Могильного Зова', 'Обереговый камень бастиона', 'Призыв Хайвотча', 'Шкура хребтового охотника',
    'Светящийся воск', 'Боевой тотем огра', 'Ядро бури', 'Осколок сердца Каззикса', 'Приказы Культа Вирма',
    'Ритуальная филактерия', 'Сигил Могильного Вирма', 'Благословенные угли', 'Осколок ключа святилища',
  ],
  zones: [
    ['Истврукская долина', 'Найдите в городе маршала Редбрука: у него есть для вас работа.', ['Истврук', 'Волчья тропа', 'Кабанья поляна', 'Зеркальное озеро', 'Вебвуд', 'Медный рудник', 'Лагерь бандитов', 'Павшая часовня']],
    ['Мирефенская топь', 'Доложите стражу Фенвику у ворот Фенбриджа.', ['Фенбридж', 'Камыши хищников', 'Отмели Глубокой Топи', 'Вдовья чаща', 'Утонувшая часовня', 'Курганы троллей', 'Лагерь Могильного Зова', 'Затонувший бастион']],
    ['Терновые высоты', 'Капитан Тессали едва удерживает стену Хайвотча.', ['Хайвотч', 'Хребет охотника', 'Норы Глубокоскалья', 'Огрские предгорья', 'Военный лагерь Дрогмара', 'Грозовой Утес', 'Глиммермир', 'Шатры Культа Вирма', 'Поля ревенантов', 'Святилище Могильного Вирма']],
  ],
  dungeons: [
    ['Пустая крипта', 'Вы спускаетесь в Пустую крипту...', 'Вы выбираетесь обратно к дневному свету.'],
    ['Затонувший бастион', 'Вы спускаетесь в Затонувший бастион по воде...', 'Вы выбираетесь из тонущей тьмы.'],
    ['Святилище Могильного Вирма', 'Воздух холодеет. Внизу дышит нечто огромное...', 'Вы пошатываясь выходите на горный ветер.'],
  ],
};

export const worldEntityText = {
  en: makeEnglishWorldEntities(),
  es: makeLocaleWorldEntities(esData, esText, esQuestNarratives),
  es_ES: {} as WorldEntityTranslations,
  fr_FR: makeLocaleWorldEntities(frData, frText, frQuestNarratives),
  fr_CA: {} as WorldEntityTranslations,
  en_CA: makeEnglishWorldEntities(),
  it_IT: makeLocaleWorldEntities(itData, itText, itQuestNarratives),
  de_DE: makeLocaleWorldEntities(deData, deText, deQuestNarratives),
  zh_CN: makeLocaleWorldEntities(zhCnData, zhCnText, zhCnQuestNarratives),
  zh_TW: makeLocaleWorldEntities(zhTwData, zhTwText, zhTwQuestNarratives),
  ko_KR: makeLocaleWorldEntities(koData, koText, koQuestNarratives),
  ja_JP: makeLocaleWorldEntities(jaData, jaText, jaQuestNarratives),
  pt_BR: makeLocaleWorldEntities(ptData, ptText, ptQuestNarratives),
  ru_RU: makeLocaleWorldEntities(ruData, ruText, ruQuestNarratives),
};

worldEntityText.es_ES = worldEntityText.es;
worldEntityText.fr_CA = worldEntityText.fr_FR;
