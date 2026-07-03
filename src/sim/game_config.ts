// Game-config override layer (the admin Housekeeping feature's sim seam).
//
// The content tables in data.ts (MOBS/QUESTS/ITEMS/NPCS/CAMPS) are module
// singletons every sim system imports by reference, so an operator override is
// applied by MUTATING those tables IN PLACE, before any `new Sim(...)` runs.
// This module owns that whole lifecycle:
//
//   - `GameConfigOverrides` is the persisted override document (JSONB on the
//     server), a deep-partial over the shipped content.
//   - `validateGameConfig` sanitizes an untrusted document into a clean one,
//     dropping anything unknown or out of range (each drop is reported).
//   - `applyGameConfig` resets the tables to their shipped defaults and then
//     applies a validated document: global rate multipliers first, then
//     per-entity absolute values on top. Calling it with `{}` restores vanilla.
//   - `TUNING` carries the few knobs that are formulas rather than data
//     (the XP-gain multiplier, the mob respawn base, the world seed) for the
//     host and the XP grant path to read.
//
// Determinism: everything here is a pure function of its input (no rng, no
// wall-clock). With the default document the tables are byte-identical to the
// shipped content and every multiplier short-circuits to identity, so hosts
// that never call applyGameConfig (offline client, headless RL env) and a
// server with no overrides behave exactly like today. Two hosts applying the
// SAME document produce the SAME world for the same seed.
//
// Scope: the override state is PER-PROCESS (it rewrites the shared module
// singletons), never per-Sim. Apply a document once, before constructing any
// Sim in the process; every Sim in one process shares the same config.

import { CAMPS, ITEMS, MOBS, NPCS, QUESTS } from './data';
import type { CampDef, ItemDef, LootEntry, MobTemplate, QuestDef, Stats } from './types';
import { refreshPostcapXpTable, XP_TABLE } from './types';

// ---------------------------------------------------------------------------
// Rates: the global knobs. Data-shaped rates (mob hp/dmg, loot, gold) are
// applied by rewriting the content tables; formula-shaped rates (xpRate,
// respawnSeconds, worldSeed) live on TUNING and are read where they act.
// ---------------------------------------------------------------------------

export interface GameRates {
  // Multiplies every XP award (kills, quests, delves) in grantXp.
  xpRate: number;
  // Multiplies the copper amounts on mob loot tables.
  goldDropRate: number;
  // Multiplies every mob loot-entry chance (capped at 1).
  lootChanceRate: number;
  // Multiply mob health / damage template fields.
  mobHpRate: number;
  mobDmgRate: number;
  // Base mob respawn time in seconds (SimConfig.respawnSeconds default).
  respawnSeconds: number;
  // Overrides the host's world seed when set (server only; null = host default).
  worldSeed: number | null;
}

export const DEFAULT_RATES: Readonly<GameRates> = Object.freeze({
  xpRate: 1,
  goldDropRate: 1,
  lootChanceRate: 1,
  mobHpRate: 1,
  mobDmgRate: 1,
  respawnSeconds: 25,
  worldSeed: null,
});

// Live tuning knobs. Reset + rewritten by applyGameConfig; hosts that never
// apply a config read the defaults forever.
export const TUNING: GameRates = { ...DEFAULT_RATES };

// ---------------------------------------------------------------------------
// Guild calendar: caps + input bounds for the event calendar. Server-only
// (the offline Sim has no guild calendar, like worldSeed above): the values
// live here so they ride the one override document and its validation, and
// server/social.ts reads them at each use site.
// ---------------------------------------------------------------------------

export interface CalendarTuning {
  // Upcoming events allowed per guild.
  eventLimit: number;
  // Max lengths for the event title and note (player text, clamped).
  titleMax: number;
  noteMax: number;
  // How far out an event may be booked, in days (UTC).
  horizonDays: number;
  // How many past days stay visible (yesterday survives across timezones).
  keepPastDays: number;
}

export const DEFAULT_CALENDAR: Readonly<CalendarTuning> = Object.freeze({
  eventLimit: 25,
  titleMax: 48,
  noteMax: 160,
  horizonDays: 366,
  keepPastDays: 2,
});

// Live calendar knobs, same lifecycle as TUNING.
export const CALENDAR_TUNING: CalendarTuning = { ...DEFAULT_CALENDAR };

/** XP-award scaling used by grantXp. Identity when the rate is untouched. */
export function tunedXpAmount(amount: number): number {
  return TUNING.xpRate === 1 ? amount : Math.max(0, Math.round(amount * TUNING.xpRate));
}

// ---------------------------------------------------------------------------
// Override document shapes + field specs (the specs drive validation here and
// the admin form rendering server-side, so both always agree).
// ---------------------------------------------------------------------------

export interface NumericFieldSpec {
  key: string;
  min: number;
  max: number;
  integer?: boolean;
}

export const RATE_FIELDS: readonly NumericFieldSpec[] = [
  { key: 'xpRate', min: 0, max: 1000 },
  { key: 'goldDropRate', min: 0, max: 1000 },
  { key: 'lootChanceRate', min: 0, max: 1000 },
  { key: 'mobHpRate', min: 0.05, max: 1000 },
  { key: 'mobDmgRate', min: 0, max: 1000 },
  { key: 'respawnSeconds', min: 1, max: 86400, integer: true },
  { key: 'worldSeed', min: 1, max: 2147483647, integer: true },
];

export const CALENDAR_FIELDS: readonly NumericFieldSpec[] = [
  { key: 'eventLimit', min: 1, max: 200, integer: true },
  { key: 'titleMax', min: 4, max: 128, integer: true },
  { key: 'noteMax', min: 0, max: 1000, integer: true },
  { key: 'horizonDays', min: 1, max: 3660, integer: true },
  { key: 'keepPastDays', min: 0, max: 60, integer: true },
];

export const MOB_NUMERIC_FIELDS: readonly NumericFieldSpec[] = [
  { key: 'minLevel', min: 1, max: 60, integer: true },
  { key: 'maxLevel', min: 1, max: 60, integer: true },
  { key: 'hpBase', min: 1, max: 1000000 },
  { key: 'hpPerLevel', min: 0, max: 100000 },
  { key: 'dmgBase', min: 0, max: 100000 },
  { key: 'dmgPerLevel', min: 0, max: 10000 },
  { key: 'attackSpeed', min: 0.2, max: 10 },
  { key: 'armorPerLevel', min: 0, max: 1000 },
  { key: 'moveSpeed', min: 0, max: 20 },
  { key: 'aggroRadius', min: 0, max: 100 },
  { key: 'respawnMult', min: 0.05, max: 100 },
  { key: 'scale', min: 0.1, max: 10 },
];

export const MOB_FLAG_FIELDS = ['boss', 'rare', 'elite', 'canSwim', 'ccImmune'] as const;

export const QUEST_NUMERIC_FIELDS: readonly NumericFieldSpec[] = [
  { key: 'xpReward', min: 0, max: 1000000, integer: true },
  { key: 'copperReward', min: 0, max: 100000000, integer: true },
  { key: 'minLevel', min: 1, max: 60, integer: true },
  { key: 'suggestedPlayers', min: 1, max: 40, integer: true },
];

export const ITEM_NUMERIC_FIELDS: readonly NumericFieldSpec[] = [
  { key: 'sellValue', min: 0, max: 10000000, integer: true },
  { key: 'buyValue', min: 0, max: 10000000, integer: true },
  { key: 'requiredLevel', min: 1, max: 60, integer: true },
];

export const CAMP_NUMERIC_FIELDS: readonly NumericFieldSpec[] = [
  { key: 'count', min: 0, max: 50, integer: true },
  { key: 'radius', min: 1, max: 200 },
];

export const STAT_KEYS: readonly (keyof Stats)[] = ['str', 'agi', 'sta', 'int', 'spi', 'armor'];

// Loose world bounds for authored positions (overworld plus the temple band);
// only meant to reject garbage, not to path-check placement.
const POS_LIMIT = 10000;
const MAX_VENDOR_ITEMS = 40;
const MAX_LOOT_ENTRIES = 30;

export interface MobOverride {
  minLevel?: number;
  maxLevel?: number;
  hpBase?: number;
  hpPerLevel?: number;
  dmgBase?: number;
  dmgPerLevel?: number;
  attackSpeed?: number;
  armorPerLevel?: number;
  moveSpeed?: number;
  aggroRadius?: number;
  respawnMult?: number;
  scale?: number;
  boss?: boolean;
  rare?: boolean;
  elite?: boolean;
  canSwim?: boolean;
  ccImmune?: boolean;
  // Full replacement of the mob's loot table.
  loot?: LootEntry[];
}

export interface QuestOverride {
  xpReward?: number;
  copperReward?: number;
  minLevel?: number;
  suggestedPlayers?: number;
  retired?: boolean;
  // Per-objective required counts; must match the quest's objective count.
  objectiveCounts?: number[];
}

export interface ItemOverride {
  sellValue?: number;
  buyValue?: number;
  requiredLevel?: number;
  // Full replacement of the item's stat block.
  stats?: Partial<Stats>;
}

export interface NpcOverride {
  vendorItems?: string[];
  pos?: { x: number; z: number };
}

export interface CampOverride {
  // Anchor: camps have no ids, so overrides are keyed by array index and must
  // name the mob they expect there. A content reshuffle invalidates the row
  // instead of silently retuning the wrong camp.
  mobId: string;
  count?: number;
  radius?: number;
  center?: { x: number; z: number };
}

export interface GameConfigOverrides {
  rates?: Partial<GameRates>;
  calendar?: Partial<CalendarTuning>;
  // Full replacement of XP_TABLE (xp required per level, length preserved).
  xpTable?: number[];
  mobs?: Record<string, MobOverride>;
  quests?: Record<string, QuestOverride>;
  items?: Record<string, ItemOverride>;
  npcs?: Record<string, NpcOverride>;
  camps?: Record<string, CampOverride>;
}

// ---------------------------------------------------------------------------
// Validation: sanitize an untrusted document into a clean GameConfigOverrides.
// Anything unknown or out of range is dropped and reported, never applied.
// ---------------------------------------------------------------------------

export interface ValidatedGameConfig {
  config: GameConfigOverrides;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The content tables are plain object literals, so a truthy `TABLE[id]` check
// would accept inherited property names ('constructor', 'toString', ...) as
// "valid ids" and later write override fields onto built-in objects. Every id
// lookup in this module goes through this own-property check instead.
function tableEntry<T>(table: Record<string, T>, id: string): T | null {
  return Object.hasOwn(table, id) ? table[id] : null;
}

function cleanNumber(value: unknown, spec: NumericFieldSpec): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (spec.integer && !Number.isInteger(value)) return null;
  if (value < spec.min || value > spec.max) return null;
  return value;
}

function cleanPos(value: unknown): { x: number; z: number } | null {
  if (!isRecord(value)) return null;
  const { x, z } = value;
  if (typeof x !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.abs(x) > POS_LIMIT || Math.abs(z) > POS_LIMIT) return null;
  return { x, z };
}

function collectNumericFields(
  raw: Record<string, unknown>,
  specs: readonly NumericFieldSpec[],
  into: Record<string, number>,
  errors: string[],
  label: string,
): void {
  for (const spec of specs) {
    if (!(spec.key in raw)) continue;
    const value = cleanNumber(raw[spec.key], spec);
    if (value === null) {
      errors.push(`${label}: invalid ${spec.key}`);
    } else {
      into[spec.key] = value;
    }
  }
}

function cleanLootEntry(raw: unknown, label: string, errors: string[]): LootEntry | null {
  if (!isRecord(raw)) {
    errors.push(`${label}: loot entry is not an object`);
    return null;
  }
  const chance = cleanNumber(raw.chance, { key: 'chance', min: 0, max: 1 });
  if (chance === null) {
    errors.push(`${label}: loot entry needs a chance in 0..1`);
    return null;
  }
  const entry: LootEntry = { chance };
  if (raw.itemId !== undefined) {
    if (typeof raw.itemId !== 'string' || !tableEntry(ITEMS, raw.itemId)) {
      errors.push(`${label}: unknown loot itemId ${String(raw.itemId)}`);
      return null;
    }
    entry.itemId = raw.itemId;
  }
  if (raw.copper !== undefined) {
    const copper = cleanNumber(raw.copper, {
      key: 'copper',
      min: 0,
      max: 100000000,
      integer: true,
    });
    if (copper === null) {
      errors.push(`${label}: invalid loot copper`);
      return null;
    }
    entry.copper = copper;
  }
  if (raw.questId !== undefined) {
    if (typeof raw.questId !== 'string' || !tableEntry(QUESTS, raw.questId)) {
      errors.push(`${label}: unknown loot questId ${String(raw.questId)}`);
      return null;
    }
    entry.questId = raw.questId;
  }
  if (raw.rollGroup !== undefined) {
    if (typeof raw.rollGroup !== 'string' || raw.rollGroup.length > 64) {
      errors.push(`${label}: invalid loot rollGroup`);
      return null;
    }
    entry.rollGroup = raw.rollGroup;
  }
  if (entry.itemId === undefined && entry.copper === undefined) {
    errors.push(`${label}: loot entry needs an itemId or copper`);
    return null;
  }
  return entry;
}

function cleanMobOverride(id: string, raw: unknown, errors: string[]): MobOverride | null {
  const def = tableEntry(MOBS, id);
  if (!def) {
    errors.push(`mobs: unknown mob ${id}`);
    return null;
  }
  if (!isRecord(raw)) {
    errors.push(`mobs.${id}: override is not an object`);
    return null;
  }
  const numeric: Record<string, number> = {};
  collectNumericFields(raw, MOB_NUMERIC_FIELDS, numeric, errors, `mobs.${id}`);
  const out: MobOverride = { ...numeric };
  const effMin = out.minLevel ?? def.minLevel;
  const effMax = out.maxLevel ?? def.maxLevel;
  if (effMin > effMax) {
    errors.push(`mobs.${id}: minLevel > maxLevel`);
    delete out.minLevel;
    delete out.maxLevel;
  }
  for (const flag of MOB_FLAG_FIELDS) {
    if (!(flag in raw)) continue;
    if (typeof raw[flag] !== 'boolean') {
      errors.push(`mobs.${id}: invalid ${flag}`);
    } else {
      out[flag] = raw[flag];
    }
  }
  if (raw.loot !== undefined) {
    if (!Array.isArray(raw.loot) || raw.loot.length > MAX_LOOT_ENTRIES) {
      errors.push(`mobs.${id}: loot must be an array of at most ${MAX_LOOT_ENTRIES} entries`);
    } else {
      const loot: LootEntry[] = [];
      let bad = false;
      for (const entry of raw.loot) {
        const clean = cleanLootEntry(entry, `mobs.${id}`, errors);
        if (!clean) {
          bad = true;
          break;
        }
        loot.push(clean);
      }
      if (!bad) out.loot = loot;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function cleanQuestOverride(id: string, raw: unknown, errors: string[]): QuestOverride | null {
  const def = tableEntry(QUESTS, id);
  if (!def) {
    errors.push(`quests: unknown quest ${id}`);
    return null;
  }
  if (!isRecord(raw)) {
    errors.push(`quests.${id}: override is not an object`);
    return null;
  }
  const numeric: Record<string, number> = {};
  collectNumericFields(raw, QUEST_NUMERIC_FIELDS, numeric, errors, `quests.${id}`);
  const out: QuestOverride = { ...numeric };
  if ('retired' in raw) {
    if (typeof raw.retired !== 'boolean') {
      errors.push(`quests.${id}: invalid retired`);
    } else {
      out.retired = raw.retired;
    }
  }
  if (raw.objectiveCounts !== undefined) {
    const counts = raw.objectiveCounts;
    const valid =
      Array.isArray(counts) &&
      counts.length === def.objectives.length &&
      counts.every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 1000);
    if (!valid) {
      errors.push(
        `quests.${id}: objectiveCounts must list ${def.objectives.length} integers (1..1000)`,
      );
    } else {
      out.objectiveCounts = [...(counts as number[])];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function cleanItemOverride(id: string, raw: unknown, errors: string[]): ItemOverride | null {
  if (!tableEntry(ITEMS, id)) {
    errors.push(`items: unknown item ${id}`);
    return null;
  }
  if (!isRecord(raw)) {
    errors.push(`items.${id}: override is not an object`);
    return null;
  }
  const numeric: Record<string, number> = {};
  collectNumericFields(raw, ITEM_NUMERIC_FIELDS, numeric, errors, `items.${id}`);
  const out: ItemOverride = { ...numeric };
  if (raw.stats !== undefined) {
    if (!isRecord(raw.stats)) {
      errors.push(`items.${id}: stats must be an object`);
    } else {
      const stats: Partial<Stats> = {};
      let bad = false;
      for (const [key, value] of Object.entries(raw.stats)) {
        if (!STAT_KEYS.includes(key as keyof Stats)) {
          errors.push(`items.${id}: unknown stat ${key}`);
          bad = true;
          break;
        }
        const clean = cleanNumber(value, { key, min: -1000, max: 1000, integer: true });
        if (clean === null) {
          errors.push(`items.${id}: invalid stat ${key}`);
          bad = true;
          break;
        }
        stats[key as keyof Stats] = clean;
      }
      if (!bad) out.stats = stats;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function cleanNpcOverride(id: string, raw: unknown, errors: string[]): NpcOverride | null {
  if (!tableEntry(NPCS, id)) {
    errors.push(`npcs: unknown npc ${id}`);
    return null;
  }
  if (!isRecord(raw)) {
    errors.push(`npcs.${id}: override is not an object`);
    return null;
  }
  const out: NpcOverride = {};
  if (raw.vendorItems !== undefined) {
    const items = raw.vendorItems;
    const valid =
      Array.isArray(items) &&
      items.length <= MAX_VENDOR_ITEMS &&
      items.every((itemId) => typeof itemId === 'string' && !!tableEntry(ITEMS, itemId));
    if (!valid) {
      errors.push(`npcs.${id}: vendorItems must be known item ids (max ${MAX_VENDOR_ITEMS})`);
    } else {
      out.vendorItems = [...(items as string[])];
    }
  }
  if (raw.pos !== undefined) {
    const pos = cleanPos(raw.pos);
    if (!pos) {
      errors.push(`npcs.${id}: invalid pos`);
    } else {
      out.pos = pos;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function cleanCampOverride(key: string, raw: unknown, errors: string[]): CampOverride | null {
  const index = Number(key);
  if (!Number.isInteger(index) || index < 0 || index >= CAMPS.length) {
    errors.push(`camps: unknown camp index ${key}`);
    return null;
  }
  if (!isRecord(raw) || typeof raw.mobId !== 'string') {
    errors.push(`camps.${key}: override needs the anchoring mobId`);
    return null;
  }
  if (CAMPS[index].mobId !== raw.mobId) {
    errors.push(
      `camps.${key}: expected mob ${raw.mobId} but the camp spawns ${CAMPS[index].mobId} (content changed; re-apply from the current list)`,
    );
    return null;
  }
  const numeric: Record<string, number> = {};
  collectNumericFields(raw, CAMP_NUMERIC_FIELDS, numeric, errors, `camps.${key}`);
  const out: CampOverride = { mobId: raw.mobId, ...numeric };
  if (raw.center !== undefined) {
    const center = cleanPos(raw.center);
    if (!center) {
      errors.push(`camps.${key}: invalid center`);
    } else {
      out.center = center;
    }
  }
  return Object.keys(out).length > 1 ? out : null;
}

function cleanRates(raw: unknown, errors: string[]): Partial<GameRates> | null {
  if (!isRecord(raw)) {
    errors.push('rates: not an object');
    return null;
  }
  const out: Partial<GameRates> = {};
  for (const spec of RATE_FIELDS) {
    if (!(spec.key in raw)) continue;
    const value = raw[spec.key];
    if (spec.key === 'worldSeed' && value === null) {
      out.worldSeed = null;
      continue;
    }
    const clean = cleanNumber(value, spec);
    if (clean === null) {
      errors.push(`rates: invalid ${spec.key}`);
    } else {
      (out as Record<string, number>)[spec.key] = clean;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function cleanCalendar(raw: unknown, errors: string[]): Partial<CalendarTuning> | null {
  if (!isRecord(raw)) {
    errors.push('calendar: not an object');
    return null;
  }
  const out: Partial<CalendarTuning> = {};
  for (const spec of CALENDAR_FIELDS) {
    if (!(spec.key in raw)) continue;
    const clean = cleanNumber(raw[spec.key], spec);
    if (clean === null) {
      errors.push(`calendar: invalid ${spec.key}`);
    } else {
      (out as Record<string, number>)[spec.key] = clean;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function cleanDomain<T>(
  raw: unknown,
  domain: string,
  errors: string[],
  cleanOne: (id: string, value: unknown, errors: string[]) => T | null,
): Record<string, T> | null {
  if (!isRecord(raw)) {
    errors.push(`${domain}: not an object`);
    return null;
  }
  const out: Record<string, T> = {};
  for (const [id, value] of Object.entries(raw)) {
    const clean = cleanOne(id, value, errors);
    if (clean !== null) out[id] = clean;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Sanitize an untrusted override document. Returns the cleaned config plus one
 * error line per dropped field/entry; the cleaned config is always safe to
 * store and apply.
 */
export function validateGameConfig(raw: unknown): ValidatedGameConfig {
  const errors: string[] = [];
  const config: GameConfigOverrides = {};
  if (!isRecord(raw)) {
    if (raw !== undefined && raw !== null) errors.push('config: not an object');
    return { config, errors };
  }
  for (const domain of Object.keys(raw)) {
    if (
      !['rates', 'calendar', 'xpTable', 'mobs', 'quests', 'items', 'npcs', 'camps'].includes(domain)
    ) {
      errors.push(`config: unknown section ${domain}`);
    }
  }
  if (raw.rates !== undefined) {
    const rates = cleanRates(raw.rates, errors);
    if (rates) config.rates = rates;
  }
  if (raw.calendar !== undefined) {
    const calendar = cleanCalendar(raw.calendar, errors);
    if (calendar) config.calendar = calendar;
  }
  if (raw.xpTable !== undefined) {
    const table = raw.xpTable;
    const valid =
      Array.isArray(table) &&
      table.length === XP_TABLE.length &&
      table.every((n) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 100000000);
    if (!valid) {
      errors.push(`xpTable: must list ${XP_TABLE.length} integers (1..100000000)`);
    } else {
      config.xpTable = [...(table as number[])];
    }
  }
  if (raw.mobs !== undefined) {
    const mobs = cleanDomain(raw.mobs, 'mobs', errors, cleanMobOverride);
    if (mobs) config.mobs = mobs;
  }
  if (raw.quests !== undefined) {
    const quests = cleanDomain(raw.quests, 'quests', errors, cleanQuestOverride);
    if (quests) config.quests = quests;
  }
  if (raw.items !== undefined) {
    const items = cleanDomain(raw.items, 'items', errors, cleanItemOverride);
    if (items) config.items = items;
  }
  if (raw.npcs !== undefined) {
    const npcs = cleanDomain(raw.npcs, 'npcs', errors, cleanNpcOverride);
    if (npcs) config.npcs = npcs;
  }
  if (raw.camps !== undefined) {
    const camps = cleanDomain(raw.camps, 'camps', errors, cleanCampOverride);
    if (camps) config.camps = camps;
  }
  return { config, errors };
}

// ---------------------------------------------------------------------------
// Defaults snapshot: the shipped values of everything an override can touch,
// captured once (lazily, before the first mutation) so apply can reset and the
// admin panels can show "default vs current".
// ---------------------------------------------------------------------------

interface MobDefaults {
  numeric: Record<string, number | undefined>;
  flags: Record<string, boolean | undefined>;
  loot: LootEntry[];
}

interface QuestDefaults {
  numeric: Record<string, number | undefined>;
  retired: boolean | undefined;
  objectiveCounts: number[];
}

interface ItemDefaults {
  numeric: Record<string, number | undefined>;
  stats: Partial<Stats> | undefined;
}

interface NpcDefaults {
  vendorItems: string[] | undefined;
  pos: { x: number; z: number };
}

interface CampDefaults {
  mobId: string;
  count: number;
  radius: number;
  center: { x: number; z: number };
}

interface GameDefaults {
  rates: GameRates;
  xpTable: number[];
  mobs: Map<string, MobDefaults>;
  quests: Map<string, QuestDefaults>;
  items: Map<string, ItemDefaults>;
  npcs: Map<string, NpcDefaults>;
  camps: CampDefaults[];
}

const cloneLoot = (loot: LootEntry[]): LootEntry[] => loot.map((entry) => ({ ...entry }));

let defaults: GameDefaults | null = null;
// The document currently applied to the tables (post-validation), for hosts
// that need to compare against a newly saved one (restart-pending detection).
let activeConfig: GameConfigOverrides = {};

function captureDefaults(): GameDefaults {
  if (defaults) return defaults;
  const mobs = new Map<string, MobDefaults>();
  for (const [id, def] of Object.entries(MOBS)) {
    const numeric: Record<string, number | undefined> = {};
    for (const spec of MOB_NUMERIC_FIELDS) {
      numeric[spec.key] = def[spec.key as keyof MobTemplate] as number | undefined;
    }
    const flags: Record<string, boolean | undefined> = {};
    for (const flag of MOB_FLAG_FIELDS) flags[flag] = def[flag];
    mobs.set(id, { numeric, flags, loot: cloneLoot(def.loot) });
  }
  const quests = new Map<string, QuestDefaults>();
  for (const [id, def] of Object.entries(QUESTS)) {
    const numeric: Record<string, number | undefined> = {};
    for (const spec of QUEST_NUMERIC_FIELDS) {
      numeric[spec.key] = def[spec.key as keyof QuestDef] as number | undefined;
    }
    quests.set(id, {
      numeric,
      retired: def.retired,
      objectiveCounts: def.objectives.map((o) => o.count),
    });
  }
  const items = new Map<string, ItemDefaults>();
  for (const [id, def] of Object.entries(ITEMS)) {
    const numeric: Record<string, number | undefined> = {};
    for (const spec of ITEM_NUMERIC_FIELDS) {
      numeric[spec.key] = def[spec.key as keyof ItemDef] as number | undefined;
    }
    items.set(id, { numeric, stats: def.stats ? { ...def.stats } : undefined });
  }
  const npcs = new Map<string, NpcDefaults>();
  for (const [id, def] of Object.entries(NPCS)) {
    npcs.set(id, {
      vendorItems: def.vendorItems ? [...def.vendorItems] : undefined,
      pos: { ...def.pos },
    });
  }
  const camps: CampDefaults[] = CAMPS.map((camp) => ({
    mobId: camp.mobId,
    count: camp.count,
    radius: camp.radius,
    center: { ...camp.center },
  }));
  defaults = {
    rates: { ...DEFAULT_RATES },
    xpTable: [...XP_TABLE],
    mobs,
    quests,
    items,
    npcs,
    camps,
  };
  return defaults;
}

/** The shipped defaults of everything overridable (captured before any apply). */
export function gameConfigDefaults(): GameDefaults {
  return captureDefaults();
}

/** The validated document currently applied to the content tables. */
export function activeGameConfig(): GameConfigOverrides {
  return activeConfig;
}

// Assign a possibly-undefined shipped value back: restoring `undefined` deletes
// the key so optional-field semantics (`'x' in obj`, JSON round-trips) match
// the shipped content exactly.
function restoreField(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) {
    delete target[key];
  } else {
    target[key] = value;
  }
}

function resetToDefaults(): void {
  const base = captureDefaults();
  for (const [id, snapshot] of base.mobs) {
    const def = MOBS[id] as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(snapshot.numeric)) restoreField(def, key, value);
    for (const [key, value] of Object.entries(snapshot.flags)) restoreField(def, key, value);
    (def as unknown as MobTemplate).loot = cloneLoot(snapshot.loot);
  }
  for (const [id, snapshot] of base.quests) {
    const def = QUESTS[id] as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(snapshot.numeric)) restoreField(def, key, value);
    restoreField(def, 'retired', snapshot.retired);
    QUESTS[id].objectives.forEach((objective, i) => {
      objective.count = snapshot.objectiveCounts[i];
    });
  }
  for (const [id, snapshot] of base.items) {
    const def = ITEMS[id] as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(snapshot.numeric)) restoreField(def, key, value);
    restoreField(def, 'stats', snapshot.stats ? { ...snapshot.stats } : undefined);
  }
  for (const [id, snapshot] of base.npcs) {
    restoreField(
      NPCS[id] as unknown as Record<string, unknown>,
      'vendorItems',
      snapshot.vendorItems ? [...snapshot.vendorItems] : undefined,
    );
    NPCS[id].pos = { ...snapshot.pos };
  }
  base.camps.forEach((snapshot, i) => {
    CAMPS[i].count = snapshot.count;
    CAMPS[i].radius = snapshot.radius;
    CAMPS[i].center = { ...snapshot.center };
  });
  XP_TABLE.length = 0;
  XP_TABLE.push(...base.xpTable);
  refreshPostcapXpTable();
  Object.assign(TUNING, DEFAULT_RATES);
  Object.assign(CALENDAR_TUNING, DEFAULT_CALENDAR);
}

const scaleChance = (chance: number, rate: number): number => Math.min(1, chance * rate);
const scaleCopper = (copper: number, rate: number): number =>
  Math.max(0, Math.round(copper * rate));

function applyGlobalMobRates(rates: GameRates): void {
  const scaleHp = rates.mobHpRate !== 1;
  const scaleDmg = rates.mobDmgRate !== 1;
  const scaleLoot = rates.lootChanceRate !== 1;
  const scaleGold = rates.goldDropRate !== 1;
  if (!scaleHp && !scaleDmg && !scaleLoot && !scaleGold) return;
  for (const def of Object.values(MOBS)) {
    if (scaleHp) {
      def.hpBase *= rates.mobHpRate;
      def.hpPerLevel *= rates.mobHpRate;
    }
    if (scaleDmg) {
      def.dmgBase *= rates.mobDmgRate;
      def.dmgPerLevel *= rates.mobDmgRate;
    }
    if (scaleLoot || scaleGold) {
      for (const entry of def.loot) {
        if (scaleLoot) entry.chance = scaleChance(entry.chance, rates.lootChanceRate);
        if (scaleGold && entry.copper !== undefined) {
          entry.copper = scaleCopper(entry.copper, rates.goldDropRate);
        }
      }
    }
  }
}

/**
 * Reset the content tables to their shipped defaults, then apply a VALIDATED
 * override document on top: global rate multipliers first, per-entity absolute
 * values after (so a hand-tuned boss is exact, not re-scaled). Idempotent:
 * applying the same document twice, or `{}` to restore vanilla, always lands
 * on the same table state. Call BEFORE constructing any `Sim` so construction
 * (spawn counts, rolled levels) sees the overridden content.
 */
export function applyGameConfig(config: GameConfigOverrides): void {
  resetToDefaults();
  const rates: GameRates = { ...DEFAULT_RATES, ...config.rates };
  Object.assign(TUNING, rates);
  Object.assign(CALENDAR_TUNING, { ...DEFAULT_CALENDAR, ...config.calendar });
  applyGlobalMobRates(rates);
  if (config.xpTable) {
    XP_TABLE.length = 0;
    XP_TABLE.push(...config.xpTable);
    refreshPostcapXpTable();
  }
  for (const [id, override] of Object.entries(config.mobs ?? {})) {
    const def = tableEntry(MOBS, id);
    if (!def) continue;
    const target = def as unknown as Record<string, unknown>;
    for (const spec of MOB_NUMERIC_FIELDS) {
      const value = (override as Record<string, unknown>)[spec.key];
      if (typeof value === 'number') target[spec.key] = value;
    }
    for (const flag of MOB_FLAG_FIELDS) {
      if (typeof override[flag] === 'boolean') target[flag] = override[flag];
    }
    if (override.loot) def.loot = cloneLoot(override.loot);
  }
  for (const [id, override] of Object.entries(config.quests ?? {})) {
    const def = tableEntry(QUESTS, id);
    if (!def) continue;
    const target = def as unknown as Record<string, unknown>;
    for (const spec of QUEST_NUMERIC_FIELDS) {
      const value = (override as Record<string, unknown>)[spec.key];
      if (typeof value === 'number') target[spec.key] = value;
    }
    if (typeof override.retired === 'boolean') def.retired = override.retired;
    if (override.objectiveCounts && override.objectiveCounts.length === def.objectives.length) {
      def.objectives.forEach((objective, i) => {
        objective.count = override.objectiveCounts?.[i] ?? objective.count;
      });
    }
  }
  for (const [id, override] of Object.entries(config.items ?? {})) {
    const def = tableEntry(ITEMS, id);
    if (!def) continue;
    const target = def as unknown as Record<string, unknown>;
    for (const spec of ITEM_NUMERIC_FIELDS) {
      const value = (override as Record<string, unknown>)[spec.key];
      if (typeof value === 'number') target[spec.key] = value;
    }
    if (override.stats) def.stats = { ...override.stats };
  }
  for (const [id, override] of Object.entries(config.npcs ?? {})) {
    const def = tableEntry(NPCS, id);
    if (!def) continue;
    if (override.vendorItems) def.vendorItems = [...override.vendorItems];
    if (override.pos) def.pos = { ...override.pos };
  }
  for (const [key, override] of Object.entries(config.camps ?? {})) {
    const camp: CampDef | undefined = CAMPS[Number(key)];
    // Anchor re-check (content may have shifted since validation/persistence).
    if (!camp || camp.mobId !== override.mobId) continue;
    if (typeof override.count === 'number') camp.count = override.count;
    if (typeof override.radius === 'number') camp.radius = override.radius;
    if (override.center) camp.center = { ...override.center };
  }
  activeConfig = config;
}

// Capture the shipped defaults eagerly, while the tables are guaranteed
// pristine: data.ts is fully evaluated before this module's body runs (it is
// imported above), and nothing else mutates the tables at load time. This
// removes any ordering assumption about who touches the tables first.
captureDefaults();
