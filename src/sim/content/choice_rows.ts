import type { PlayerClass } from '../types';
import {
  DRUID_CHOICE_ROWS,
  HUNTER_CHOICE_ROWS,
  MAGE_CHOICE_ROWS,
  PALADIN_CHOICE_ROWS,
  PRIEST_CHOICE_ROWS,
  ROGUE_CHOICE_ROWS,
  SHAMAN_CHOICE_ROWS,
  WARLOCK_CHOICE_ROWS,
} from './choice_rows_classic';
import { accumulateTalentEffect, type TalentEffect, type TalentModifiers } from './talents';
import { WARRIOR_ROWS } from './warrior_rows';

export const CHOICE_ROW_LEVELS = [5, 8, 11, 14, 17, 20] as const;
export type ChoiceRowLevel = (typeof CHOICE_ROW_LEVELS)[number];

export interface ChoiceRowOption {
  id: string;
  name: string;
  description: string;
  icon?: string;
  effect: TalentEffect;
}

export interface ChoiceRow {
  level: ChoiceRowLevel;
  theme?: string;
  decision?: string;
  options: readonly [ChoiceRowOption, ChoiceRowOption, ChoiceRowOption];
}

export interface ClassChoiceRows {
  rows: readonly ChoiceRow[];
}

export type ChoiceRowAllocation = Partial<Record<ChoiceRowLevel, string>>;

export const CHOICE_ROWS: Record<PlayerClass, ClassChoiceRows> & Record<string, ClassChoiceRows> = {
  warrior: { rows: WARRIOR_ROWS },
  paladin: PALADIN_CHOICE_ROWS,
  hunter: HUNTER_CHOICE_ROWS,
  rogue: ROGUE_CHOICE_ROWS,
  priest: PRIEST_CHOICE_ROWS,
  shaman: SHAMAN_CHOICE_ROWS,
  mage: MAGE_CHOICE_ROWS,
  warlock: WARLOCK_CHOICE_ROWS,
  druid: DRUID_CHOICE_ROWS,
};

const CHOICE_ROW_LEVEL_SET = new Set<number>(CHOICE_ROW_LEVELS);

export function isChoiceRowLevel(level: number): level is ChoiceRowLevel {
  return CHOICE_ROW_LEVEL_SET.has(level);
}

export function rowForLevel(cls: PlayerClass, level: number): ChoiceRow | null {
  if (!isChoiceRowLevel(level)) return null;
  // guard the lookup: a bad class string from a future caller must fail
  // validation, not throw
  return CHOICE_ROWS[cls]?.rows.find((row) => row.level === level) ?? null;
}

export interface RowCheck {
  ok: boolean;
  reason?: string;
}

// Every rejection reason is the EXISTING localized 'Invalid talent build.'
// string (error.invalidBuild in sim_i18n, translated in every locale): row
// picks come from a pre-validating UI, so the distinct causes are only ever
// reachable by tampered clients and do not earn their own player strings.
export function validateRows(
  cls: PlayerClass,
  level: number,
  rows: ChoiceRowAllocation | undefined | null,
): RowCheck {
  if (!rows) return { ok: true };
  const seen = new Set<number>();
  for (const [rawLevel, optionId] of Object.entries(rows)) {
    const rowLevel = Number(rawLevel);
    if (!Number.isInteger(rowLevel) || !isChoiceRowLevel(rowLevel)) {
      return { ok: false, reason: 'Invalid talent build.' };
    }
    if (seen.has(rowLevel)) return { ok: false, reason: 'Invalid talent build.' };
    seen.add(rowLevel);
    if (typeof optionId !== 'string' || optionId.length === 0) {
      return { ok: false, reason: 'Invalid talent build.' };
    }
    const row = rowForLevel(cls, rowLevel);
    if (!row) return { ok: false, reason: 'Invalid talent build.' };
    if (level < row.level) return { ok: false, reason: 'Invalid talent build.' };
    if (!row.options.some((option) => option.id === optionId)) {
      return { ok: false, reason: 'Invalid talent build.' };
    }
  }
  return { ok: true };
}

export function repairRows(
  cls: PlayerClass,
  level: number,
  rows: ChoiceRowAllocation | undefined | null,
): ChoiceRowAllocation {
  const out: ChoiceRowAllocation = {};
  if (!rows) return out;
  for (const [rawLevel, optionId] of Object.entries(rows)) {
    const rowLevel = Number(rawLevel);
    if (!Number.isInteger(rowLevel) || !isChoiceRowLevel(rowLevel)) continue;
    if (typeof optionId !== 'string' || optionId.length === 0) continue;
    const cand = { ...out, [rowLevel]: optionId };
    if (validateRows(cls, level, cand).ok) out[rowLevel] = optionId;
  }
  return out;
}

export function accumulateRowEffects(
  mods: TalentModifiers,
  cls: PlayerClass,
  rows: ChoiceRowAllocation | undefined | null,
): void {
  if (!rows) return;
  for (const [rawLevel, optionId] of Object.entries(rows)) {
    const rowLevel = Number(rawLevel);
    if (!Number.isInteger(rowLevel) || !isChoiceRowLevel(rowLevel)) continue;
    const row = rowForLevel(cls, rowLevel);
    const option = row?.options.find((candidate) => candidate.id === optionId);
    if (option) accumulateTalentEffect(mods, option.effect, 1);
  }
}
