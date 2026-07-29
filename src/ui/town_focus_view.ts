// Pure, host-agnostic view model for the town-focus allocation panel (#1143).
//
// DOM/i18n-free so tests/town_focus_repaint_gate.test.ts can drive it directly
// against either a Sim- or ClientWorld-shaped input. Owns the one thing worth testing
// without a DOM: turning a raw townFocus allocation + budget into per-component
// rows (current points, whether it can still take another point, whether it
// can give one back) and the remaining-point count. Rendering lives in
// town_focus_window.ts.

import { isTownFocusComponent, TOWN_FOCUS_COMPONENTS } from '../sim/professions/focus';

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
// Re-exported from the sim rather than derived here a second time (#2511):
// this is the exact set setTownFocus accepts, so a row the panel offers can
// never be a key the command boundary rejects.
export { TOWN_FOCUS_COMPONENTS };

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

/**
 * The compact repaint signature for an open panel (#2500).
 *
 * Hud polls this on the slow band and rebuilds only when it moves, the
 * "poll cheaply, rebuild on a signature change" shape the rest of the window
 * family already uses. Before it existed the panel discarded and rebuilt its
 * whole subtree twice a second on the open check alone, which restored
 * scrollTop but destroyed the keyboard user's focused control on a timer.
 *
 * Built from the VIEW rather than from the raw allocation so completeness is
 * checkable by inspection: renderTownFocusWindow reads `inTown`, `budget`,
 * `remaining` and each row's `component` / `points` / `canIncrease` /
 * `canDecrease`, and every one of those is a term here. `totalSpent` is the
 * one view field it deliberately omits, because nothing renders it (and
 * `remaining` is derived from it anyway); tests/town_focus_repaint_gate.test.ts
 * pins that set against the painter's real source, and refuses an alias that
 * would read a field past the scan, so a future row that starts rendering
 * another field cannot leave the gate behind.
 *
 * Language is deliberately NOT a term. A switch never moves the allocation, so
 * it is converged by Hud.refreshLocalizedDynamicUi() forcing one rebuild, the
 * same arm the arena / Vale Cup surfaces use for their text-independent
 * signatures.
 */
export function townFocusRenderSig(view: TownFocusView): string {
  const rows = view.rows
    .map((r) => `${r.component}:${r.points}:${r.canIncrease ? 1 : 0}${r.canDecrease ? 1 : 0}`)
    .join('|');
  return `${view.inTown ? 1 : 0}/${view.budget}/${view.remaining}/${rows}`;
}

/**
 * Applies a single +1/-1 step to `component`, clamped at 0 and at the budget.
 *
 * Built from TOWN_FOCUS_COMPONENTS rather than by spreading `allocation`
 * forward (#2511), so the payload the panel posts is a function of the rows it
 * actually draws. A spread carried any key buildTownFocusView never rendered
 * into every Save, where the command boundary now rejects the whole request
 * and the panel offers no control that could remove it. The sim closes that
 * from its own side by dropping unknown keys on load; this keeps the view core
 * from emitting a model it does not render in the first place. Inert for every
 * legitimate allocation, because both the row list and the budget sum here
 * already read TOWN_FOCUS_COMPONENTS and nothing else.
 *
 * `component` is filtered too, not just the allocation carried forward, or the
 * one key the caller names would be the single way back around the projection.
 * The panel only ever steps a row it drew, so this is unreachable from the
 * shipped client; it is here so the guarantee above holds for the function
 * rather than for its current caller.
 */
export function stepTownFocus(
  allocation: Readonly<Record<string, number>>,
  component: string,
  delta: 1 | -1,
  budget: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const c of TOWN_FOCUS_COMPONENTS) {
    const points = Math.max(0, allocation[c] ?? 0);
    if (points > 0) next[c] = points;
  }
  if (!isTownFocusComponent(component)) return next;
  const current = Math.max(0, next[component] ?? 0);
  const totalSpent = TOWN_FOCUS_COMPONENTS.reduce((sum, c) => sum + Math.max(0, next[c] ?? 0), 0);
  if (delta > 0 && totalSpent >= budget) return next;
  const updated = Math.max(0, current + delta);
  if (updated === 0) delete next[component];
  else next[component] = updated;
  return next;
}
