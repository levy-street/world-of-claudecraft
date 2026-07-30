// Pure action-bar row layout shared by the controller, desktop HUD builder, and
// mobile pager. Slot 0 is the Attack control. Configurable slots 1 to 33 are
// split into three rows of eleven without duplicating boundary arithmetic.

export const ACTION_BAR_ABILITY_SLOTS_PER_ROW = 11;
export const ACTION_BAR_ROW_COUNT = 3;
export const ACTION_BAR_ABILITY_SLOTS = ACTION_BAR_ABILITY_SLOTS_PER_ROW * ACTION_BAR_ROW_COUNT;

export type ActionBarRow = 1 | 2 | 3;

/** Resolve a valid HUD bar slot to its desktop row. Slot 0 belongs to row one. */
export function actionBarRowForSlot(barSlot: number): ActionBarRow {
  if (barSlot <= ACTION_BAR_ABILITY_SLOTS_PER_ROW) return 1;
  if (barSlot <= ACTION_BAR_ABILITY_SLOTS_PER_ROW * 2) return 2;
  return 3;
}
