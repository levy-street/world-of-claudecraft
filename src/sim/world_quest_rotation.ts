// Pure world-quest rotation leaf shared by the sim, hosts, and map projections.
// The host supplies a realm-reset civil day; this module only performs bounded
// Gregorian arithmetic and deterministic content selection. No clock or RNG reads.

import { WORLD_QUESTS_BY_ID } from './content/world_quests';
import type { WorldQuestDef } from './types';

const WORLD_QUEST_CYCLE_PREFIX = 'wq3_';
export const WORLD_QUEST_ROTATION_DAYS = 3;
export const WORLD_QUESTS_PER_ROTATION = 5;

// Preserve the three shipped rotations and their modulo-3 cadence. Cycle 3
// replaces Eastbrook's bandit slot with its caravan. Cycles 4 and 5 offer
// Frostveil and Willowfen caravans in their own region's slots, leaving the
// first three rotations and the five-quest daily roster unchanged.
const WORLD_QUEST_ROTATION_ID_GROUPS = Object.freeze([
  Object.freeze([
    'wq_eastbrook_bandits',
    'wq_mirefen_gravecallers',
    'wq_palmreach_confections',
    'wq_evergarden_watch',
    'wq_galecrest_wisps',
  ]),
  Object.freeze([
    'wq_thornpeak_stormcrag',
    'wq_hollow_sporelings',
    'wq_drakelands_brood',
    'wq_frostveil_howlers',
    'wq_amberfall_lurkers',
  ]),
  Object.freeze([
    'wq_willowfen_ore',
    'wq_nightbloom_barrow',
    'wq_wraithwood_restless',
    'wq_farshore_salvage',
    'wq_proving_shore_scuttlers',
  ]),
  Object.freeze([
    'wq_eastbrook_caravan',
    'wq_mirefen_gravecallers',
    'wq_palmreach_confections',
    'wq_evergarden_watch',
    'wq_galecrest_wisps',
  ]),
  Object.freeze([
    'wq_thornpeak_stormcrag',
    'wq_hollow_sporelings',
    'wq_drakelands_brood',
    'wq_frostveil_caravan',
    'wq_amberfall_lurkers',
  ]),
  Object.freeze([
    'wq_willowfen_caravan',
    'wq_nightbloom_barrow',
    'wq_wraithwood_restless',
    'wq_farshore_salvage',
    'wq_proving_shore_scuttlers',
  ]),
] as const);

const WORLD_QUEST_ROTATIONS: readonly (readonly WorldQuestDef[])[] = Object.freeze(
  WORLD_QUEST_ROTATION_ID_GROUPS.map((ids) =>
    Object.freeze(ids.map((id) => WORLD_QUESTS_BY_ID[id])),
  ),
);

const DAYS_IN_MONTH = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function civilDayNumber(value: string): number | null {
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

/** Stable three-day cycle derived only from the host-fed realm reset date. */
export function worldQuestCycleForResetDay(resetDay: string): string {
  const day = civilDayNumber(resetDay);
  if (day === null) return '';
  const cycle = Math.floor((day - WORLD_QUEST_ROTATION_EPOCH_DAY) / WORLD_QUEST_ROTATION_DAYS);
  return `${WORLD_QUEST_CYCLE_PREFIX}${cycle}`;
}

/** Canonicalize current cycle ids and pre-rotation ISO-day save values. */
export function normalizeWorldQuestCycle(cycle: unknown): string {
  if (typeof cycle !== 'string') return '';
  if (cycle.length > 32) return '';
  const fromDay = worldQuestCycleForResetDay(cycle);
  if (fromDay) return fromDay;
  if (!cycle.startsWith(WORLD_QUEST_CYCLE_PREFIX)) return '';
  const encoded = cycle.slice(WORLD_QUEST_CYCLE_PREFIX.length);
  if (!/^-?\d+$/.test(encoded)) return '';
  const value = Number(encoded);
  return Number.isSafeInteger(value) ? `${WORLD_QUEST_CYCLE_PREFIX}${value}` : '';
}

export function worldQuestCycleNumber(cycle: unknown): number | null {
  const normalized = normalizeWorldQuestCycle(cycle);
  return normalized ? Number(normalized.slice(WORLD_QUEST_CYCLE_PREFIX.length)) : null;
}

/** Calendar-week slot sampled at the start of a stable three-day offer. */
export function worldQuestPuzzleWeekForCycle(cycle: unknown): number {
  const number = worldQuestCycleNumber(cycle);
  return number === null ? 0 : Math.floor((number * WORLD_QUEST_ROTATION_DAYS) / 7);
}

export function worldQuestPuzzleVariantForCycle(cycle: unknown, variantCount: number): number {
  if (!Number.isSafeInteger(variantCount) || variantCount <= 0) return 0;
  const week = worldQuestPuzzleWeekForCycle(cycle);
  return ((week % variantCount) + variantCount) % variantCount;
}

/** The five objectives offered by one rotation. No RNG or host clock reads. */
export function activeWorldQuestsForCycle(cycle: unknown): readonly WorldQuestDef[] {
  const number = worldQuestCycleNumber(cycle);
  if (number === null) return [];
  const groupCount = WORLD_QUEST_ROTATIONS.length;
  return WORLD_QUEST_ROTATIONS[((number % groupCount) + groupCount) % groupCount];
}

/** Nearest current-or-future cycle that offers an authored quest (dev tooling only). */
export function worldQuestCycleOfferingQuest(cycle: unknown, questId: string): string {
  const number = worldQuestCycleNumber(cycle);
  if (number === null) return '';
  for (let offset = 0; offset < WORLD_QUEST_ROTATIONS.length; offset++) {
    const candidate = `${WORLD_QUEST_CYCLE_PREFIX}${number + offset}`;
    if (activeWorldQuestsForCycle(candidate).some((quest) => quest.id === questId)) {
      return candidate;
    }
  }
  return '';
}
