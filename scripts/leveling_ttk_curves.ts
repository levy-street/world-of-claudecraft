// Alternative mob curves for the leveling time-to-kill bench
// (scripts/leveling_ttk_report.ts --curve <name>). With no --curve the bench
// measures the SHIPPED open-world curve (src/sim/mob/open_world_tuning.ts); a
// named curve here replaces it, so a retune can be measured against the shipped
// one before it lands.

import type { MobStamp, MobTransform } from './leveling_ttk_probe';

export interface LevelingCurve {
  description: string;
  transform: MobTransform;
  stamp?: MobStamp;
}

export const LEVELING_CURVES: Record<string, LevelingCurve> = {
  // The raw template ladders with no open-world curve: the pre-v0.45.0 baseline.
  untuned: {
    description: 'Mob templates as authored, no open-world curve',
    transform: (template) => template,
    stamp: () => {},
  },
};
