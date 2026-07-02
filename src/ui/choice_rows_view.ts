// Pure, host-agnostic view model for the Talents 2.0 choice-row picker: derives
// per-row lock state and per-option picked state from the class's static row
// content, the player's level, and the live allocation. No DOM here; the
// TalentsWindow "Choices" tab is the thin consumer (mirrors talents_view.ts).
import {
  CHOICE_ROWS,
  type ChoiceRowAllocation,
  type ChoiceRowLevel,
  type ChoiceRowOption,
} from '../sim/content/choice_rows';
import type { PlayerClass } from '../sim/types';

export interface ChoiceRowOptionVM {
  option: ChoiceRowOption;
  picked: boolean;
}

export interface ChoiceRowVM {
  level: ChoiceRowLevel;
  theme: string;
  unlocked: boolean;
  pickedId: string | null;
  options: ChoiceRowOptionVM[];
}

export interface ChoiceRowsView {
  rows: ChoiceRowVM[];
  picked: number; // rows with a selection
  unlocked: number; // rows the player's level has opened
}

export function buildChoiceRowsView(
  cls: PlayerClass,
  playerLevel: number,
  rows: ChoiceRowAllocation,
): ChoiceRowsView {
  const content = CHOICE_ROWS[cls]?.rows ?? [];
  let picked = 0;
  let unlocked = 0;
  const vms: ChoiceRowVM[] = content.map((row) => {
    const pickedId = rows[row.level] ?? null;
    const isUnlocked = playerLevel >= row.level;
    if (pickedId) picked++;
    if (isUnlocked) unlocked++;
    return {
      level: row.level,
      theme: row.theme,
      unlocked: isUnlocked,
      pickedId,
      options: row.options.map((option) => ({ option, picked: option.id === pickedId })),
    };
  });
  return { rows: vms, picked, unlocked };
}

/** Whether the class has any row content at all (pre-flip classes ship none). */
export function hasChoiceRows(cls: PlayerClass): boolean {
  return (CHOICE_ROWS[cls]?.rows.length ?? 0) > 0;
}
