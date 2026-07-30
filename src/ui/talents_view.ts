// Pure, host-agnostic view model for the Talents V2 window.
//
// The canonical allocation is the world-owned { spec, rows } value. This core
// projects that value with the class row registry and player level. It never
// stages or mutates a second row model, so Offline Sim and ClientWorld snapshots
// produce the same view.

import {
  rowTreeFor,
  type SpecDef,
  type TalentAllocation,
  type TalentRow,
  type TalentRowOption,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';

export type TalentSpecAction = 'commit' | 'navigate';
export type TalentRowAction = 'select' | 'clear';

export interface TalentSpecVM {
  spec: SpecDef;
  selected: boolean;
  action: TalentSpecAction;
}

export interface TalentRowOptionVM {
  option: TalentRowOption;
  picked: boolean;
  pending: boolean;
  disabled: boolean;
  action: TalentRowAction;
}

export interface TalentRowVM {
  row: TalentRow;
  level: number;
  unlocked: boolean;
  options: TalentRowOptionVM[];
}

export interface TalentsView {
  hasRows: boolean;
  specs: TalentSpecVM[];
  rows: TalentRowVM[];
  pickedCount: number;
  unlockedCount: number;
  valid: boolean;
}

const EMPTY_VIEW: TalentsView = {
  hasRows: false,
  specs: [],
  rows: [],
  pickedCount: 0,
  unlockedCount: 0,
  valid: false,
};

export function buildTalentsView(
  allocation: TalentAllocation,
  cls: PlayerClass,
  playerLevel: number,
): TalentsView {
  const talents = talentsFor(cls);
  const tree = rowTreeFor(cls);
  if (!talents || !tree) return { ...EMPTY_VIEW };

  let pickedCount = 0;
  let unlockedCount = 0;
  const rows = tree.map((row): TalentRowVM => {
    const unlocked = playerLevel >= row.level;
    if (unlocked) unlockedCount++;
    const selectedId = unlocked ? allocation.rows[row.level] : undefined;
    if (selectedId) pickedCount++;
    return {
      row,
      level: row.level,
      unlocked,
      options: row.options.map((option) => {
        const picked = selectedId === option.id;
        const pending = Object.keys(option.effect).length === 0;
        return {
          option,
          picked,
          pending,
          disabled: !unlocked || pending,
          action: picked ? 'clear' : 'select',
        };
      }),
    };
  });

  return {
    hasRows: true,
    specs: talents.specs.map((spec) => {
      const selected = allocation.spec === spec.id;
      return { spec, selected, action: selected ? 'navigate' : 'commit' };
    }),
    rows,
    pickedCount,
    unlockedCount,
    valid: validateAllocation(cls, allocation, playerLevel).ok,
  };
}
