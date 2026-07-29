// Pure core for the meter tab's right-click menu: which action a given tab
// offers right now.
//
// DOM-free and i18n-free, so the rule ("a docked meter can separate, a separated
// one can regroup, damage does neither") is one testable decision rather than
// branching spread through the panel painter.

import type { MeterTab } from './meters_rows_view';

/** The action a tab's context menu offers. */
export type MeterMenuAct = 'separate' | 'regroup';

export interface MeterMenuRow {
  act: MeterMenuAct;
  /** The tab the action applies to, echoed back so the caller need not re-derive it. */
  tab: MeterTab;
}

export interface MeterMenuInput {
  /** The tab whose name was right-clicked. */
  tab: MeterTab;
  /** Whether that meter currently has its own window. */
  detached: boolean;
  /** Meters that can never leave the tabbed window (damage is its home). */
  detachable: readonly MeterTab[];
}

/**
 * The rows for one tab's menu. Empty for a meter that cannot leave the window
 * at all: an empty list means "open no menu", so damage right-clicks fall
 * through to the browser/HUD default instead of flashing an inert popup.
 */
export function buildMeterTabMenu(input: MeterMenuInput): MeterMenuRow[] {
  if (!input.detachable.includes(input.tab)) return [];
  return [{ act: input.detached ? 'regroup' : 'separate', tab: input.tab }];
}
