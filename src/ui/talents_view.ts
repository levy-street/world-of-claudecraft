// Pure, host-agnostic view model for the Talents 2.0 window.

import {
  type Role,
  type SpecDef,
  type TalentAllocation,
  talentsFor,
  validateAllocation,
} from '../sim/content/talents';
import type { PlayerClass } from '../sim/types';
import { buildChoiceRowsView } from './choice_rows_view';

/** A specialization card for the spec picker. */
export interface TalentSpecVM {
  spec: SpecDef;
  selected: boolean;
  role: Role;
}

/** The full derived talents view. */
export interface TalentsView {
  hasTalents: boolean;
  pickedRows: number;
  unlockedRows: number;
  totalRows: number;
  valid: boolean;
  specs: TalentSpecVM[];
  selectedSpec: SpecDef | null;
}

const EMPTY_VIEW: TalentsView = {
  hasTalents: false,
  pickedRows: 0,
  unlockedRows: 0,
  totalRows: 0,
  valid: false,
  specs: [],
  selectedSpec: null,
};

export function buildTalentsView(
  stage: TalentAllocation,
  cls: PlayerClass,
  playerLevel: number,
): TalentsView {
  const ct = talentsFor(cls);
  if (!ct) return EMPTY_VIEW;
  const rows = buildChoiceRowsView(cls, playerLevel, stage.rows ?? {});
  const selectedSpec = ct.specs.find((s) => s.id === stage.spec) ?? null;
  return {
    hasTalents: true,
    pickedRows: rows.picked,
    unlockedRows: rows.unlocked,
    totalRows: rows.rows.length,
    valid: validateAllocation(cls, stage, playerLevel).ok,
    specs: ct.specs.map((sp) => ({ spec: sp, selected: stage.spec === sp.id, role: sp.role })),
    selectedSpec,
  };
}
