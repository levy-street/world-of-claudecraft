// Per-zone meadow coverage floor. The blade carpet and the mid band gate each
// cell on soil lushness (meadowCoverage in meadow_tuning.ts), which leaves lean
// soil patchy: right for most zones, wrong for the art bible's painterly
// Eastbrook, where the meadow is one continuous combed carpet with no ground
// showing (docs/design/art-direction.md). A zone listed here never drops below
// its floor; every other zone keeps the shipped coverage exactly.
// Three-free and deterministic, so a plain Vitest pins it.

import { zoneAt } from '../sim/data';

/** Zone id to the coverage floor its meadow never drops below (0..1). */
export const MEADOW_COVERAGE_FLOORS: Readonly<Record<string, number>> = {
  eastbrook_vale: 0.96,
};

/** The coverage a cell at (x, z) uses: the shipped value, raised to the
 *  zone's floor where one is listed. */
export function zoneMeadowCoverage(x: number, z: number, shipped: number): number {
  const floor = MEADOW_COVERAGE_FLOORS[zoneAt(x, z).id];
  return floor === undefined ? shipped : Math.max(shipped, floor);
}
