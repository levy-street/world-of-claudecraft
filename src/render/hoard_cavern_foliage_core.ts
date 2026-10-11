import type { HoardValleyDressingPlacement, HoardValleyPlan } from './hoard_valley_core';

/** The first ten source anchors are shared by both static presets. */
export function hoardCavernHeroSpots(
  plan: HoardValleyPlan,
  crownRadius: number,
): HoardValleyDressingPlacement[] {
  const spots: HoardValleyDressingPlacement[] = [];
  for (const spot of plan.dressing.slice(0, 10)) {
    if (spots.length >= 6) break;
    if (spot.z < plan.revealZ || Math.abs(spot.x) < plan.centerClearHalfWidth + crownRadius * 1.025)
      continue;
    if (spots.some((other) => Math.hypot(other.x - spot.x, other.z - spot.z) < 10)) continue;
    spots.push(spot);
  }
  return spots;
}
