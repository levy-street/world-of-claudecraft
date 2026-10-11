// Pure world-quest rotation leaf shared by the sim, hosts, and map projections.
// The host supplies a realm-reset civil day; this module only performs bounded
// Gregorian arithmetic and deterministic content selection. No clock or RNG reads.

import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { WorldQuestDef } from './types';

const WORLD_QUEST_CYCLE_PREFIX = 'wq1_';
export const WORLD_QUEST_ROTATION_DAYS = 1;

export const WORLD_QUEST_ZONES: readonly string[] = Object.freeze([
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
]);

export const WORLD_QUESTS_BY_ZONE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // Round 2 (2026-09): the zone hunts (content/world_quest_zone_hunts.ts) are
  // APPENDED to each pool so the earlier entries keep their day index. A pool's
  // ROTATING entries (the ALWAYS_ACTIVE ids below are filtered out first, so
  // Evergarden rotates four of its five and Galecrest none) form its cycle
  // (index = day mod count); rotating counts are 1, 4 or 7 only:
  // each divides the 84-day roster period, and the legacy three-day cycle ids
  // (wq3_N = day 3N) still reach every entry, which 3 or 6 would not. Palmreach
  // stays one deep: its confection board is a day-keyed puzzle that must be on
  // the board EVERY day (tests/world_quest_daily_levels.test.ts), and as a
  // purse-free quest it also keeps a full day under the ten-gold budget.
  // tests/world_quests.test.ts pins that every quest is offered within the
  // longest pool's cycle.
  eastbrook_vale: Object.freeze([
    'wq_eastbrook_bandits',
    'wq_eastbrook_caravan',
    'wq_eastbrook_calligraphy',
    'wq_eastbrook_shadow',
    'wq_eastbrook_boars',
    'wq_eastbrook_bones',
    'wq_eastbrook_spiders',
  ]),
  mirefen_marsh: Object.freeze([
    'wq_mirefen_gravecallers',
    'wq_mirefen_infiltrator',
    'wq_mirefen_widows',
    'wq_mirefen_drowned',
    'wq_mirefen_trolls',
    'wq_mirefen_prowlers',
    'wq_mirefen_murlocs',
  ]),
  thornpeak_heights: Object.freeze([
    'wq_thornpeak_stormcrag',
    'wq_thornpeak_kobolds',
    'wq_thornpeak_ogres',
    'wq_thornpeak_zealots',
  ]),
  veiled_hollow: Object.freeze([
    'wq_hollow_sporelings',
    'wq_hollow_glimmerwisps',
    'wq_hollow_stags',
    'wq_hollow_guardians',
  ]),
  drakelands: Object.freeze([
    'wq_drakelands_brood',
    'wq_evergarden_forging',
    'wq_evergarden_cannon',
    'wq_last_keep_cannon',
    'wq_drakelands_raiders',
    'wq_drakelands_trolls',
    'wq_drakelands_warcallers',
  ]),
  frostveil: Object.freeze([
    'wq_frostveil_howlers',
    'wq_frostveil_caravan',
    'wq_frostveil_wolves',
    'wq_frostveil_terraces',
    'wq_frostveil_wisps',
    'wq_frostveil_elementals',
    'wq_frostveil_sprites',
  ]),
  amberfall: Object.freeze([
    'wq_amberfall_lurkers',
    'wq_amberfall_stags',
    'wq_amberfall_sprites',
    'wq_amberfall_treants',
  ]),
  willowfen: Object.freeze([
    'wq_willowfen_ore',
    'wq_willowfen_caravan',
    'wq_willowfen_toads',
    'wq_willowfen_sprites',
  ]),
  nightbloom: Object.freeze([
    'wq_nightbloom_barrow',
    'wq_nightbloom_grazers',
    'wq_nightbloom_striders',
    'wq_nightbloom_stargazers',
  ]),
  wraithwood: Object.freeze([
    'wq_wraithwood_restless',
    'wq_wraithwood_spinners',
    'wq_wraithwood_shamblers',
    'wq_wraithwood_wraiths',
  ]),
  palmreach: Object.freeze(['wq_palmreach_confections']),
  evergarden: Object.freeze([
    'wq_evergarden_watch',
    'wq_evergarden_wisp_maze',
    'wq_evergarden_wolves',
    'wq_evergarden_gnomes',
    'wq_evergarden_stags',
  ]),
  galecrest: Object.freeze(['wq_galecrest_wisps', 'wq_galecrest_slalom']),
  farshore_isle: Object.freeze([
    'wq_farshore_salvage',
    'wq_farshore_wretches',
    'wq_farshore_riftspawn',
    'wq_farshore_stalkers',
  ]),
});

/** Daily activities offered alongside the ordinary zone rotation. */
export const ALWAYS_ACTIVE_WORLD_QUEST_IDS: readonly string[] = Object.freeze([
  'wq_evergarden_wisp_maze',
  'wq_galecrest_wisps',
  'wq_galecrest_slalom',
]);

export const WORLD_QUESTS_PER_ROTATION =
  WORLD_QUEST_ZONES.filter((zone) =>
    WORLD_QUESTS_BY_ZONE[zone].some((id) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(id)),
  ).length + ALWAYS_ACTIVE_WORLD_QUEST_IDS.length;
export const MAX_WORLD_QUESTS_PER_ROTATION = WORLD_QUESTS_PER_ROTATION;

const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

export function civilDayNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1];
  if (day > maxDay) return null;
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra;
}

const WORLD_QUEST_ROTATION_EPOCH_DAY = civilDayNumber('2026-08-31') as number;

/** Stable daily cycle derived only from the host-fed realm reset date. */
export function worldQuestCycleForResetDay(resetDay: string): string {
  const day = civilDayNumber(resetDay);
  if (day === null) return '';
  const cycle = Math.floor((day - WORLD_QUEST_ROTATION_EPOCH_DAY) / WORLD_QUEST_ROTATION_DAYS);
  return `${WORLD_QUEST_CYCLE_PREFIX}${cycle}`;
}

/** Canonicalize current cycle ids, legacy wq3_ ids, and ISO-day save values. */
export function normalizeWorldQuestCycle(cycle: unknown): string {
  if (typeof cycle !== 'string') return '';
  if (cycle.length > 32) return '';
  const fromDay = worldQuestCycleForResetDay(cycle);
  if (fromDay) return fromDay;
  if (cycle.startsWith(WORLD_QUEST_CYCLE_PREFIX)) {
    const encoded = cycle.slice(WORLD_QUEST_CYCLE_PREFIX.length);
    if (!/^-?\d+$/.test(encoded)) return '';
    const value = Number(encoded);
    return Number.isSafeInteger(value) ? `${WORLD_QUEST_CYCLE_PREFIX}${value}` : '';
  }
  if (cycle.startsWith('wq3_')) {
    const encoded = cycle.slice(4);
    if (!/^-?\d+$/.test(encoded)) return '';
    const value = Number(encoded);
    return Number.isSafeInteger(value) ? `${WORLD_QUEST_CYCLE_PREFIX}${value * 3}` : '';
  }
  return '';
}

export function worldQuestCycleNumber(cycle: unknown): number | null {
  const normalized = normalizeWorldQuestCycle(cycle);
  return normalized ? Number(normalized.slice(WORLD_QUEST_CYCLE_PREFIX.length)) : null;
}

/** Calendar-week slot sampled at the start of a stable daily offer. */
export function worldQuestPuzzleWeekForCycle(cycle: unknown): number {
  const number = worldQuestCycleNumber(cycle);
  return number === null ? 0 : Math.floor(number / 7);
}

export function worldQuestPuzzleVariantForCycle(cycle: unknown, variantCount: number): number {
  if (!Number.isSafeInteger(variantCount) || variantCount <= 0) return 0;
  const week = worldQuestPuzzleWeekForCycle(cycle);
  return ((week % variantCount) + variantCount) % variantCount;
}

/** One rotating quest per zone, plus the independently available daily activities. */
export function activeWorldQuestsForCycle(cycle: unknown): readonly WorldQuestDef[] {
  const number = worldQuestCycleNumber(cycle);
  if (number === null) return [];
  const quests: WorldQuestDef[] = [];
  for (const zoneId of WORLD_QUEST_ZONES) {
    const ids = WORLD_QUESTS_BY_ZONE[zoneId]?.filter(
      (id) => !ALWAYS_ACTIVE_WORLD_QUEST_IDS.includes(id),
    );
    if (!ids || ids.length === 0) continue;
    const index = ((number % ids.length) + ids.length) % ids.length;
    const quest = WORLD_QUESTS_BY_ID[ids[index]];
    if (quest) quests.push(quest);
  }
  for (const id of ALWAYS_ACTIVE_WORLD_QUEST_IDS) {
    const quest = WORLD_QUESTS_BY_ID[id];
    if (quest) quests.push(quest);
  }
  return Object.freeze(quests);
}

/** Nearest current-or-future cycle that offers an authored quest (dev tooling only). */
export function worldQuestCycleOfferingQuest(cycle: unknown, questId: string): string {
  const number = worldQuestCycleNumber(cycle);
  if (number === null) return '';
  const quest = WORLD_QUESTS_BY_ID[questId];
  if (!quest) return '';
  for (let offset = 0; offset < 14; offset++) {
    const candidate = `${WORLD_QUEST_CYCLE_PREFIX}${number + offset}`;
    if (activeWorldQuestsForCycle(candidate).some((q) => q.id === questId)) {
      return candidate;
    }
  }
  return '';
}
