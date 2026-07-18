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
import type { TalentEffect } from './talents';
import { WARRIOR_ROWS } from './warrior_rows';

export const ROW_LEVELS = [5, 8, 11, 14, 17, 20] as const;
export type TalentRowLevel = (typeof ROW_LEVELS)[number];

export const ROW_COUNT = ROW_LEVELS.length;
export const OPTIONS_PER_ROW = 3;

export interface TalentRowOption {
  id: string;
  name: string;
  description: string;
  icon?: string;
  effect: TalentEffect;
}

export interface TalentRow {
  level: TalentRowLevel;
  theme?: string;
  decision?: string;
  options: readonly [TalentRowOption, TalentRowOption, TalentRowOption];
}

export type RowTree = readonly TalentRow[];

export interface ClassChoiceRows {
  rows: RowTree;
}

export const ROW_TREES = {
  warrior: WARRIOR_ROWS,
  paladin: PALADIN_CHOICE_ROWS.rows,
  hunter: HUNTER_CHOICE_ROWS.rows,
  rogue: ROGUE_CHOICE_ROWS.rows,
  priest: PRIEST_CHOICE_ROWS.rows,
  shaman: SHAMAN_CHOICE_ROWS.rows,
  mage: MAGE_CHOICE_ROWS.rows,
  warlock: WARLOCK_CHOICE_ROWS.rows,
  druid: DRUID_CHOICE_ROWS.rows,
} satisfies Record<PlayerClass, RowTree>;

const ROW_LEVEL_SET = new Set<number>(ROW_LEVELS);

export function isTalentRowLevel(level: number): level is TalentRowLevel {
  return Number.isInteger(level) && ROW_LEVEL_SET.has(level);
}

export function rowTreeFor(cls: PlayerClass): RowTree | null {
  return (ROW_TREES as Partial<Record<PlayerClass, RowTree>>)[cls] ?? null;
}

export function rowForLevel(cls: PlayerClass, level: number): TalentRow | null {
  if (!isTalentRowLevel(level)) return null;
  return rowTreeFor(cls)?.find((row) => row.level === level) ?? null;
}

export function rowsUnlockedAtLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  let unlocked = 0;
  for (const rowLevel of ROW_LEVELS) {
    if (level >= rowLevel) unlocked++;
  }
  return unlocked;
}

export function validateRowTree(tree: RowTree): string[] {
  const errors: string[] = [];
  if (tree.length !== ROW_COUNT) {
    errors.push(`expected ${ROW_COUNT} rows, got ${tree.length}`);
  }

  const optionIds = new Set<string>();
  for (let index = 0; index < tree.length; index++) {
    const row = tree[index];
    const expectedLevel = ROW_LEVELS[index];
    if (row.level !== expectedLevel) {
      errors.push(`row ${index}: level ${row.level}, expected ${expectedLevel}`);
    }
    if (row.options.length !== OPTIONS_PER_ROW) {
      errors.push(`row ${index}: ${row.options.length} options, expected ${OPTIONS_PER_ROW}`);
    }
    for (const option of row.options) {
      if (option.id.length === 0) {
        errors.push(`row ${index}: an option has no id`);
      } else if (optionIds.has(option.id)) {
        errors.push(`duplicate option id: ${option.id}`);
      } else {
        optionIds.add(option.id);
      }
    }
  }
  return errors;
}

for (const [cls, tree] of Object.entries(ROW_TREES)) {
  const errors = validateRowTree(tree);
  if (errors.length > 0) {
    throw new Error(`Invalid talent row tree for ${cls}: ${errors.join('; ')}`);
  }
}
