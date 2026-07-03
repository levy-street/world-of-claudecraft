// Housekeeping (game-config overrides) logic: the boot-time apply, the
// catalogs the admin panels render (shipped defaults + live values + saved
// overrides for every configurable domain), and the patch/merge handling for
// saves. Deliberately DB-free and GameServer-free (the IO/pure split of
// server/CLAUDE.md): SQL lives in housekeeping_db.ts and the request wiring in
// housekeeping_api.ts, so this module unit-tests without a database.

import {
  CAMPS,
  DELVE_LIST,
  DUNGEON_LIST,
  ITEMS,
  MOBS,
  NPCS,
  QUESTS,
  ZONES,
  zoneAt,
} from '../src/sim/data';
import {
  activeGameConfig,
  applyGameConfig,
  CALENDAR_FIELDS,
  CALENDAR_TUNING,
  CAMP_NUMERIC_FIELDS,
  type CalendarTuning,
  type CampOverride,
  DEFAULT_CALENDAR,
  DEFAULT_RATES,
  type GameConfigOverrides,
  type GameRates,
  gameConfigDefaults,
  ITEM_NUMERIC_FIELDS,
  type ItemOverride,
  MOB_FLAG_FIELDS,
  MOB_NUMERIC_FIELDS,
  type MobOverride,
  type NpcOverride,
  type NumericFieldSpec,
  QUEST_NUMERIC_FIELDS,
  type QuestOverride,
  RATE_FIELDS,
  TUNING,
  validateGameConfig,
} from '../src/sim/game_config';
import type { LootEntry, MobTemplate, QuestDef } from '../src/sim/types';

// ---------------------------------------------------------------------------
// Boot apply + restart-pending state
// ---------------------------------------------------------------------------

let appliedAt: string | null = null;
let bootWarnings: string[] = [];

/**
 * Validate + apply the persisted override document to the sim content tables.
 * Call BEFORE constructing the GameServer (the Sim ctor reads the tables).
 * Returns the validation warnings so boot can log them.
 */
export function applyGameConfigAtBoot(savedRaw: unknown, nowIso: string): string[] {
  const { config, errors } = validateGameConfig(savedRaw);
  applyGameConfig(config);
  appliedAt = nowIso;
  bootWarnings = errors;
  return errors;
}

// Stable stringify (sorted keys) so semantically equal documents compare equal.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** True when the saved document differs from what this process applied at boot. */
export function isRestartPending(savedClean: GameConfigOverrides): boolean {
  return stableStringify(savedClean) !== stableStringify(activeGameConfig());
}

// ---------------------------------------------------------------------------
// Save handling: patch one domain (or clear), always persisting a clean doc
// ---------------------------------------------------------------------------

const ENTITY_DOMAINS = ['mobs', 'quests', 'items', 'npcs', 'camps'] as const;
type EntityDomain = (typeof ENTITY_DOMAINS)[number];
export type OverrideDomain = EntityDomain | 'rates' | 'calendar' | 'xpTable';

export interface MergeResult {
  next: GameConfigOverrides | null;
  errors: string[];
  // Stale saved entries dropped while re-validating the stored doc (content
  // drift, e.g. a removed mob); surfaced but never block the save.
  warnings: string[];
}

function isEntityDomain(domain: string): domain is EntityDomain {
  return (ENTITY_DOMAINS as readonly string[]).includes(domain);
}

/**
 * Merge one admin edit into the saved document. `patch` REPLACES the target
 * (the whole rates block, the xp table, or one entity's override); null/absent
 * patch deletes it. The patch is validated alone first (a bad edit rejects with
 * errors); the stored doc is re-validated too, so what we persist is always
 * clean as a whole.
 */
export function mergeOverridePatch(savedRaw: unknown, body: unknown): MergeResult {
  const req = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const domain = req.domain;
  if (
    typeof domain !== 'string' ||
    (!isEntityDomain(domain) && domain !== 'rates' && domain !== 'calendar' && domain !== 'xpTable')
  ) {
    return { next: null, errors: ['unknown override domain'], warnings: [] };
  }
  const id = req.id;
  if (isEntityDomain(domain) && (typeof id !== 'string' || id.length === 0 || id.length > 128)) {
    return { next: null, errors: ['an entry id is required'], warnings: [] };
  }
  const patch = req.patch ?? null;

  const saved = validateGameConfig(savedRaw);
  const next: GameConfigOverrides = saved.config;

  if (patch === null) {
    // Deletion.
    if (domain === 'rates') delete next.rates;
    else if (domain === 'calendar') delete next.calendar;
    else if (domain === 'xpTable') delete next.xpTable;
    else if (next[domain]) {
      delete next[domain]?.[id as string];
      if (Object.keys(next[domain] ?? {}).length === 0) delete next[domain];
    }
    return { next, errors: [], warnings: saved.errors };
  }

  const miniDoc =
    domain === 'rates' || domain === 'calendar' || domain === 'xpTable'
      ? { [domain]: patch }
      : { [domain]: { [id as string]: patch } };
  const validated = validateGameConfig(miniDoc);
  if (validated.errors.length > 0) {
    return { next: null, errors: validated.errors, warnings: saved.errors };
  }
  if (domain === 'rates') {
    if (!validated.config.rates) return { next: null, errors: ['nothing to save'], warnings: [] };
    next.rates = validated.config.rates;
  } else if (domain === 'calendar') {
    if (!validated.config.calendar) {
      return { next: null, errors: ['nothing to save'], warnings: [] };
    }
    next.calendar = validated.config.calendar;
  } else if (domain === 'xpTable') {
    if (!validated.config.xpTable) return { next: null, errors: ['nothing to save'], warnings: [] };
    next.xpTable = validated.config.xpTable;
  } else {
    const entry = validated.config[domain]?.[id as string];
    if (!entry) return { next: null, errors: ['nothing to save'], warnings: [] };
    next[domain] = { ...next[domain], [id as string]: entry } as never;
  }
  return { next, errors: [], warnings: saved.errors };
}

/** Clear everything, one domain, or one entry. Returns the cleaned next doc. */
export function clearOverrides(savedRaw: unknown, body: unknown): MergeResult {
  const req = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const saved = validateGameConfig(savedRaw);
  const domain = req.domain;
  if (domain === undefined) return { next: {}, errors: [], warnings: saved.errors };
  if (typeof domain !== 'string') {
    return { next: null, errors: ['unknown override domain'], warnings: [] };
  }
  return mergeOverridePatch(savedRaw, { domain, id: req.id, patch: null });
}

// ---------------------------------------------------------------------------
// Catalogs: what the panels render. Every row carries the shipped default,
// the live (currently applied) value, and the saved override when present.
// ---------------------------------------------------------------------------

export interface HousekeepingStatus {
  restartPending: boolean;
  savedErrors: string[];
  savedUpdatedAt: string | null;
}

export function housekeepingStatus(
  savedRaw: unknown,
  savedUpdatedAt: string | null,
): HousekeepingStatus {
  const saved = validateGameConfig(savedRaw);
  return {
    restartPending: isRestartPending(saved.config),
    savedErrors: saved.errors,
    savedUpdatedAt,
  };
}

export interface HousekeepingOverview {
  realm: string;
  worldSeed: number;
  devCommands: boolean;
  appliedAt: string | null;
  bootWarnings: string[];
  counts: {
    mobs: number;
    quests: number;
    items: number;
    npcs: number;
    camps: number;
    zones: number;
    dungeons: number;
    delves: number;
  };
  overrideCounts: {
    rates: number;
    calendar: number;
    xpTable: boolean;
    mobs: number;
    quests: number;
    items: number;
    npcs: number;
    camps: number;
  };
  status: HousekeepingStatus;
}

export function housekeepingOverview(input: {
  realm: string;
  worldSeed: number;
  devCommands: boolean;
  savedRaw: unknown;
  savedUpdatedAt: string | null;
}): HousekeepingOverview {
  const saved = validateGameConfig(input.savedRaw);
  const config = saved.config;
  return {
    realm: input.realm,
    worldSeed: input.worldSeed,
    devCommands: input.devCommands,
    appliedAt,
    bootWarnings,
    counts: {
      mobs: Object.keys(MOBS).length,
      quests: Object.keys(QUESTS).length,
      items: Object.keys(ITEMS).length,
      npcs: Object.keys(NPCS).length,
      camps: CAMPS.length,
      zones: ZONES.length,
      dungeons: DUNGEON_LIST.length,
      delves: DELVE_LIST.length,
    },
    overrideCounts: {
      rates: Object.keys(config.rates ?? {}).length,
      calendar: Object.keys(config.calendar ?? {}).length,
      xpTable: config.xpTable !== undefined,
      mobs: Object.keys(config.mobs ?? {}).length,
      quests: Object.keys(config.quests ?? {}).length,
      items: Object.keys(config.items ?? {}).length,
      npcs: Object.keys(config.npcs ?? {}).length,
      camps: Object.keys(config.camps ?? {}).length,
    },
    status: {
      restartPending: isRestartPending(config),
      savedErrors: saved.errors,
      savedUpdatedAt: input.savedUpdatedAt,
    },
  };
}

export interface RatesCatalog {
  fields: NumericFieldSpec[];
  defaults: GameRates;
  applied: GameRates;
  saved: Partial<GameRates> | null;
  xpTableDefault: number[];
  xpTableSaved: number[] | null;
  status: HousekeepingStatus;
}

export function ratesCatalog(savedRaw: unknown, savedUpdatedAt: string | null): RatesCatalog {
  const saved = validateGameConfig(savedRaw);
  return {
    fields: [...RATE_FIELDS],
    defaults: { ...DEFAULT_RATES },
    applied: { ...TUNING },
    saved: saved.config.rates ?? null,
    xpTableDefault: [...gameConfigDefaults().xpTable],
    xpTableSaved: saved.config.xpTable ?? null,
    status: housekeepingStatus(savedRaw, savedUpdatedAt),
  };
}

export interface CalendarCatalog {
  fields: NumericFieldSpec[];
  defaults: CalendarTuning;
  applied: CalendarTuning;
  saved: Partial<CalendarTuning> | null;
  status: HousekeepingStatus;
}

export function calendarCatalog(savedRaw: unknown, savedUpdatedAt: string | null): CalendarCatalog {
  const saved = validateGameConfig(savedRaw);
  return {
    fields: [...CALENDAR_FIELDS],
    defaults: { ...DEFAULT_CALENDAR },
    applied: { ...CALENDAR_TUNING },
    saved: saved.config.calendar ?? null,
    status: housekeepingStatus(savedRaw, savedUpdatedAt),
  };
}

type NumericValues = Record<string, number | undefined>;
type FlagValues = Record<string, boolean | undefined>;

function numericValues(
  source: Record<string, unknown>,
  specs: readonly NumericFieldSpec[],
): NumericValues {
  const out: NumericValues = {};
  for (const spec of specs) out[spec.key] = source[spec.key] as number | undefined;
  return out;
}

export interface LootRow {
  itemId?: string;
  itemName?: string;
  copper?: number;
  chance: number;
  questId?: string;
  rollGroup?: string;
}

function lootRows(loot: LootEntry[]): LootRow[] {
  return loot.map((entry) => ({
    ...entry,
    itemName: entry.itemId ? ITEMS[entry.itemId]?.name : undefined,
  }));
}

export interface MobSpawnSummary {
  campCount: number;
  totalSpawns: number;
  zones: string[];
  dungeons: string[];
}

function mobSpawnSummaries(): Map<string, MobSpawnSummary> {
  const out = new Map<string, MobSpawnSummary>();
  const entry = (id: string): MobSpawnSummary => {
    let summary = out.get(id);
    if (!summary) {
      summary = { campCount: 0, totalSpawns: 0, zones: [], dungeons: [] };
      out.set(id, summary);
    }
    return summary;
  };
  for (const camp of CAMPS) {
    const summary = entry(camp.mobId);
    summary.campCount++;
    summary.totalSpawns += camp.count;
    const zone = zoneAt(camp.center.z).name;
    if (!summary.zones.includes(zone)) summary.zones.push(zone);
  }
  for (const dungeon of DUNGEON_LIST) {
    for (const spawn of dungeon.spawns) {
      const summary = entry(spawn.mobId);
      summary.totalSpawns++;
      if (!summary.dungeons.includes(dungeon.name)) summary.dungeons.push(dungeon.name);
    }
  }
  return out;
}

export interface HousekeepingMobRow {
  id: string;
  name: string;
  family: string;
  defaults: NumericValues;
  live: NumericValues;
  defaultFlags: FlagValues;
  liveFlags: FlagValues;
  lootDefault: LootRow[];
  lootLive: LootRow[];
  spawns: MobSpawnSummary;
  override: MobOverride | null;
}

export interface MobsCatalog {
  fields: NumericFieldSpec[];
  flagFields: string[];
  rows: HousekeepingMobRow[];
  status: HousekeepingStatus;
}

export function mobsCatalog(savedRaw: unknown, savedUpdatedAt: string | null): MobsCatalog {
  const saved = validateGameConfig(savedRaw);
  const shipped = gameConfigDefaults();
  const spawns = mobSpawnSummaries();
  const emptySpawns: MobSpawnSummary = { campCount: 0, totalSpawns: 0, zones: [], dungeons: [] };
  const rows = Object.entries(MOBS)
    .map(([id, def]) => {
      const snapshot = shipped.mobs.get(id);
      return {
        id,
        name: def.name,
        family: def.family,
        defaults: snapshot ? { ...snapshot.numeric } : {},
        live: numericValues(def as unknown as Record<string, unknown>, MOB_NUMERIC_FIELDS),
        defaultFlags: snapshot ? { ...snapshot.flags } : {},
        liveFlags: Object.fromEntries(MOB_FLAG_FIELDS.map((flag) => [flag, def[flag]])),
        lootDefault: lootRows(snapshot?.loot ?? []),
        lootLive: lootRows(def.loot),
        spawns: spawns.get(id) ?? emptySpawns,
        override: saved.config.mobs?.[id] ?? null,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    fields: [...MOB_NUMERIC_FIELDS],
    flagFields: [...MOB_FLAG_FIELDS],
    rows,
    status: housekeepingStatus(savedRaw, savedUpdatedAt),
  };
}

export interface HousekeepingQuestObjective {
  label: string;
  type: string;
  target: string;
  countDefault: number;
  countLive: number;
}

export interface HousekeepingQuestRow {
  id: string;
  name: string;
  zone: string | null;
  giverNpc: string | null;
  turnInNpc: string | null;
  requiresQuest: string | null;
  suggestedPlayers: number | null;
  defaults: NumericValues;
  live: NumericValues;
  retiredDefault: boolean;
  retiredLive: boolean;
  objectives: HousekeepingQuestObjective[];
  override: QuestOverride | null;
}

function objectiveTarget(objective: QuestDef['objectives'][number]): string {
  if (objective.targetMobId) return MOBS[objective.targetMobId]?.name ?? objective.targetMobId;
  if (objective.itemId) return ITEMS[objective.itemId]?.name ?? objective.itemId;
  if (objective.targetObjectItemId) {
    return ITEMS[objective.targetObjectItemId]?.name ?? objective.targetObjectItemId;
  }
  if (objective.targetNpcId) return NPCS[objective.targetNpcId]?.name ?? objective.targetNpcId;
  return '';
}

export interface QuestsCatalog {
  fields: NumericFieldSpec[];
  rows: HousekeepingQuestRow[];
  status: HousekeepingStatus;
}

export function questsCatalog(savedRaw: unknown, savedUpdatedAt: string | null): QuestsCatalog {
  const saved = validateGameConfig(savedRaw);
  const shipped = gameConfigDefaults();
  const rows = Object.entries(QUESTS)
    .map(([id, def]) => {
      const snapshot = shipped.quests.get(id);
      const giver = NPCS[def.giverNpcId];
      return {
        id,
        name: def.name,
        zone: giver ? zoneAt(giver.pos.z).name : null,
        giverNpc: giver?.name ?? null,
        turnInNpc: NPCS[def.turnInNpcId]?.name ?? null,
        requiresQuest: def.requiresQuest ?? null,
        suggestedPlayers: def.suggestedPlayers ?? null,
        defaults: snapshot ? { ...snapshot.numeric } : {},
        live: numericValues(def as unknown as Record<string, unknown>, QUEST_NUMERIC_FIELDS),
        retiredDefault: snapshot?.retired ?? false,
        retiredLive: def.retired ?? false,
        objectives: def.objectives.map((objective, i) => ({
          label: objective.label,
          type: objective.type,
          target: objectiveTarget(objective),
          countDefault: snapshot?.objectiveCounts[i] ?? objective.count,
          countLive: objective.count,
        })),
        override: saved.config.quests?.[id] ?? null,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    fields: [...QUEST_NUMERIC_FIELDS],
    rows,
    status: housekeepingStatus(savedRaw, savedUpdatedAt),
  };
}

export interface HousekeepingItemRow {
  id: string;
  name: string;
  kind: string;
  slot: string | null;
  quality: string | null;
  defaults: NumericValues;
  live: NumericValues;
  statsDefault: Record<string, number> | null;
  statsLive: Record<string, number> | null;
  override: ItemOverride | null;
}

export interface ItemsCatalog {
  fields: NumericFieldSpec[];
  rows: HousekeepingItemRow[];
  status: HousekeepingStatus;
}

export function itemsCatalog(savedRaw: unknown, savedUpdatedAt: string | null): ItemsCatalog {
  const saved = validateGameConfig(savedRaw);
  const shipped = gameConfigDefaults();
  const rows = Object.entries(ITEMS)
    .map(([id, def]) => {
      const snapshot = shipped.items.get(id);
      return {
        id,
        name: def.name,
        kind: def.kind,
        slot: def.slot ?? null,
        quality: def.quality ?? null,
        defaults: snapshot ? { ...snapshot.numeric } : {},
        live: numericValues(def as unknown as Record<string, unknown>, ITEM_NUMERIC_FIELDS),
        statsDefault: snapshot?.stats ? { ...(snapshot.stats as Record<string, number>) } : null,
        statsLive: def.stats ? { ...(def.stats as Record<string, number>) } : null,
        override: saved.config.items?.[id] ?? null,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    fields: [...ITEM_NUMERIC_FIELDS],
    rows,
    status: housekeepingStatus(savedRaw, savedUpdatedAt),
  };
}

export interface HousekeepingNpcRow {
  id: string;
  name: string;
  title: string;
  zone: string;
  posDefault: { x: number; z: number };
  posLive: { x: number; z: number };
  questIds: string[];
  questNames: string[];
  market: boolean;
  dynamic: boolean;
  vendorDefault: { itemId: string; name: string }[] | null;
  vendorLive: { itemId: string; name: string }[] | null;
  override: NpcOverride | null;
}

export interface NpcsCatalog {
  rows: HousekeepingNpcRow[];
  status: HousekeepingStatus;
}

const vendorRows = (items: string[] | undefined): { itemId: string; name: string }[] | null =>
  items ? items.map((itemId) => ({ itemId, name: ITEMS[itemId]?.name ?? itemId })) : null;

export function npcsCatalog(savedRaw: unknown, savedUpdatedAt: string | null): NpcsCatalog {
  const saved = validateGameConfig(savedRaw);
  const shipped = gameConfigDefaults();
  const rows = Object.entries(NPCS)
    .map(([id, def]) => {
      const snapshot = shipped.npcs.get(id);
      return {
        id,
        name: def.name,
        title: def.title,
        zone: zoneAt((snapshot?.pos ?? def.pos).z).name,
        posDefault: snapshot ? { ...snapshot.pos } : { ...def.pos },
        posLive: { ...def.pos },
        questIds: [...def.questIds],
        questNames: def.questIds.map((questId) => QUESTS[questId]?.name ?? questId),
        market: def.market ?? false,
        dynamic: def.dynamic ?? false,
        vendorDefault: vendorRows(snapshot?.vendorItems),
        vendorLive: vendorRows(def.vendorItems),
        override: saved.config.npcs?.[id] ?? null,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return { rows, status: housekeepingStatus(savedRaw, savedUpdatedAt) };
}

export interface HousekeepingCampRow {
  index: number;
  mobId: string;
  mobName: string;
  zone: string;
  defaults: { count: number; radius: number; center: { x: number; z: number } };
  live: { count: number; radius: number; center: { x: number; z: number } };
  override: CampOverride | null;
}

export interface SpawnsCatalog {
  fields: NumericFieldSpec[];
  rows: HousekeepingCampRow[];
  status: HousekeepingStatus;
}

export function spawnsCatalog(savedRaw: unknown, savedUpdatedAt: string | null): SpawnsCatalog {
  const saved = validateGameConfig(savedRaw);
  const shipped = gameConfigDefaults();
  const rows = CAMPS.map((camp, index) => {
    const snapshot = shipped.camps[index];
    return {
      index,
      mobId: camp.mobId,
      mobName: MOBS[camp.mobId]?.name ?? camp.mobId,
      zone: zoneAt(camp.center.z).name,
      defaults: {
        count: snapshot.count,
        radius: snapshot.radius,
        center: { ...snapshot.center },
      },
      live: { count: camp.count, radius: camp.radius, center: { ...camp.center } },
      override: saved.config.camps?.[String(index)] ?? null,
    };
  });
  return {
    fields: [...CAMP_NUMERIC_FIELDS],
    rows,
    status: housekeepingStatus(savedRaw, savedUpdatedAt),
  };
}

export interface HousekeepingZoneRow {
  id: string;
  name: string;
  levelRange: [number, number];
  biome: string;
  hubName: string;
  pois: string[];
  lakeCount: number;
  campCount: number;
  npcCount: number;
  questCount: number;
}

export interface HousekeepingDungeonRow {
  id: string;
  name: string;
  suggestedPlayers: number;
  spawnCount: number;
  bossNames: string[];
  overworldDoor: boolean;
}

export interface HousekeepingDelveRow {
  id: string;
  name: string;
  minLevel: number;
  suggestedPlayers: number;
  bosses: string[];
  tiers: {
    id: string;
    label: string;
    enemyLevelBonus: number;
    affixCount: number;
    rewardMult: number;
  }[];
  baseRewards: {
    copperMin: number;
    copperMax: number;
    firstClearXp: number;
    repeatClearXp: number;
  };
}

export interface WorldCatalog {
  zones: HousekeepingZoneRow[];
  dungeons: HousekeepingDungeonRow[];
  delves: HousekeepingDelveRow[];
  status: HousekeepingStatus;
}

function dungeonBossNames(spawns: { mobId: string }[]): string[] {
  const names: string[] = [];
  for (const spawn of spawns) {
    const template: MobTemplate | undefined = MOBS[spawn.mobId];
    if (template?.boss && !names.includes(template.name)) names.push(template.name);
  }
  return names;
}

export function worldCatalog(savedRaw: unknown, savedUpdatedAt: string | null): WorldCatalog {
  const zones = ZONES.map((zone) => ({
    id: zone.id,
    name: zone.name,
    levelRange: zone.levelRange,
    biome: zone.biome,
    hubName: zone.hub.name,
    pois: zone.pois.map((poi) => poi.label),
    lakeCount: zone.lakes.length,
    campCount: CAMPS.filter((camp) => zoneAt(camp.center.z).id === zone.id).length,
    npcCount: Object.values(NPCS).filter((npc) => zoneAt(npc.pos.z).id === zone.id).length,
    questCount: Object.values(QUESTS).filter((quest) => {
      const giver = NPCS[quest.giverNpcId];
      return giver ? zoneAt(giver.pos.z).id === zone.id : false;
    }).length,
  }));
  const dungeons = DUNGEON_LIST.map((dungeon) => ({
    id: dungeon.id,
    name: dungeon.name,
    suggestedPlayers: dungeon.suggestedPlayers,
    spawnCount: dungeon.spawns.length,
    bossNames: dungeonBossNames(dungeon.spawns),
    overworldDoor: dungeon.overworldDoor ?? true,
  }));
  const delves = DELVE_LIST.map((delve) => ({
    id: delve.id,
    name: delve.name,
    minLevel: delve.minLevel,
    suggestedPlayers: delve.suggestedPlayers,
    bosses: delve.bosses.map((mobId) => MOBS[mobId]?.name ?? mobId),
    tiers: delve.tiers.map((tier) => ({
      id: tier.id,
      label: tier.label,
      enemyLevelBonus: tier.enemyLevelBonus,
      affixCount: tier.affixCount,
      rewardMult: tier.rewardMult,
    })),
    baseRewards: { ...delve.baseRewards },
  }));
  return { zones, dungeons, delves, status: housekeepingStatus(savedRaw, savedUpdatedAt) };
}
