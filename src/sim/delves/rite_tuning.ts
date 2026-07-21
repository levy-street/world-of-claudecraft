// Shared Drowned Reliquary Rite difficulty tuning: the ONE source both the sim
// controller (drowned_litany_rite.ts) and the HUD difficulty popup
// (src/ui/hud/delve/rite_window.ts) read, so the popup's advertised numbers can never
// desync from the sim. Pure data, no sim state and no DOM, mirroring how
// src/sim/lockpick.ts feeds src/ui/hud/delve/lockpick_panel.ts.

import type { LootTier } from '../lockpick';
import type { RiteIntensity } from '../types';

/** Player-chosen difficulty. Easy shows the sequence more times and grants more
 * tries but caps loot low; Hard shows it once, allows a single try, and is the only
 * path to premium. `ceiling` caps the mistake-derived tier, so difficulty is strictly
 * monotonic by reward. `tries` is the number of full attempts at repeating the
 * sequence; a wrong touch fails the current try, and the tolerated mistake count is
 * tries - 1 (the last try has no slack). */
export const RITE_INTENSITY: Record<
  RiteIntensity,
  { length: number; tries: number; playbacks: number; ceiling: LootTier }
> = {
  easy: { length: 4, tries: 3, playbacks: 3, ceiling: 'low' },
  medium: { length: 5, tries: 2, playbacks: 2, ceiling: 'medium' },
  hard: { length: 6, tries: 1, playbacks: 1, ceiling: 'premium' },
};

/** Easy to Hard display order for the difficulty popup. */
export const RITE_INTENSITY_ORDER: readonly RiteIntensity[] = ['easy', 'medium', 'hard'];
