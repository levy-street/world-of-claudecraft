// Pure, host-agnostic view model for the town-focus allocation panel (#1143).
//
// DOM/i18n-free so tests/town_focus_view.test.ts can drive it directly against
// either a Sim- or ClientWorld-shaped input. Owns the one thing worth testing
// without a DOM: turning a raw townFocus allocation + budget into per-component
// rows (current points, whether it can still take another point, whether it
// can give one back) and the remaining-point count. Rendering lives in
// town_focus_window.ts.

import { HARVEST_COMPONENT_ITEMS } from '../sim/professions/gathering';

export interface TownFocusRow {
  component: string;
  points: number;
  /** false once the panel-wide budget is exhausted. */
  canIncrease: boolean;
  canDecrease: boolean;
}

export interface TownFocusView {
  rows: TownFocusRow[];
  totalSpent: number;
  budget: number;
  remaining: number;
  inTown: boolean;
}

// Every currently-harvestable component type (#1140/#1142), stable order.
export const TOWN_FOCUS_COMPONENTS: readonly string[] = Object.keys(HARVEST_COMPONENT_ITEMS);

export function buildTownFocusView(
  allocation: Readonly<Record<string, number>>,
  budget: number,
  inTown: boolean,
): TownFocusView {
  const totalSpent = TOWN_FOCUS_COMPONENTS.reduce(
    (sum, c) => sum + Math.max(0, allocation[c] ?? 0),
    0,
  );
  const remaining = Math.max(0, budget - totalSpent);
  const rows: TownFocusRow[] = TOWN_FOCUS_COMPONENTS.map((component) => {
    const points = Math.max(0, allocation[component] ?? 0);
    return {
      component,
      points,
      canIncrease: inTown && remaining > 0,
      canDecrease: inTown && points > 0,
    };
  });
  return { rows, totalSpent, budget, remaining, inTown };
}

/** Applies a single +1/-1 step to `component`, clamped at 0 and at the budget. */
export function stepTownFocus(
  allocation: Readonly<Record<string, number>>,
  component: string,
  delta: 1 | -1,
  budget: number,
): Record<string, number> {
  const next: Record<string, number> = { ...allocation };
  const current = Math.max(0, next[component] ?? 0);
  const totalSpent = TOWN_FOCUS_COMPONENTS.reduce((sum, c) => sum + Math.max(0, next[c] ?? 0), 0);
  if (delta > 0 && totalSpent >= budget) return next;
  const updated = Math.max(0, current + delta);
  if (updated === 0) delete next[component];
  else next[component] = updated;
  return next;
}
