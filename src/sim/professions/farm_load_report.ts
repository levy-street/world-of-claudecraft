// Dev-channel visibility for farm-plot load's silent-drop arms (the
// knownRecipes precedent), extracted from Sim.addPlayer per the monolith
// ratchet: a retired bed id or a tampered row vanishes on load by design
// (farm_persist.ts normalizeFarmPlots), and a corrupt hidden slot is REPLACED
// by a derived one while its row SURVIVES (so the row count alone cannot see
// it), but an operator reading server logs should see both happen. The
// counting half is pure (a Vitest drives it directly); the warn stays
// dev-channel English like every sim console.warn, never player-visible, so
// nothing here touches the i18n matchers.

import { countDroppedHiddenSlots, type PersistedFarmPlot } from './farm_persist';
import type { PlotState } from './farm_projection';

export interface DroppedFarmPlotCounts {
  rows: number;
  slots: number;
}

/** How many saved rows the load dropped and how many hidden slots it
 *  re-derived. typeof-object gated like countDroppedHiddenSlots: Object.keys
 *  of a tampered scalar ("farmPlots": "junk") returns index keys, which would
 *  fabricate a row count in the very tamper signal this exists to report. */
export function droppedFarmPlotCounts(
  saved: Record<string, PersistedFarmPlot> | undefined,
  live: ReadonlyMap<string, PlotState>,
): DroppedFarmPlotCounts {
  const rows = saved && typeof saved === 'object' ? Object.keys(saved).length - live.size : 0;
  return { rows, slots: countDroppedHiddenSlots(saved, live) };
}

/** The one addPlayer call: count, and warn only when something was dropped
 *  (unknown bed/crop id, invalid deadline, or non-finite slot). */
export function warnDroppedFarmPlotRows(
  saved: Record<string, PersistedFarmPlot> | undefined,
  live: ReadonlyMap<string, PlotState>,
  ownerName: string,
): void {
  const { rows, slots } = droppedFarmPlotCounts(saved, live);
  if (rows > 0 || slots > 0) {
    console.warn(
      `[load] dropped ${rows} farmPlots row(s) and re-derived ${slots} hidden slot(s) for ${ownerName} (unknown bed/crop id, invalid deadline, or non-finite slot)`,
    );
  }
}
