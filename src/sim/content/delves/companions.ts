import type { DelveCompanionDef } from '../../types';

export const DELVE_COMPANIONS: Record<string, DelveCompanionDef> = {
  companion_tessa: {
    id: 'companion_tessa',
    name: 'Acolyte Tessa',
    role: 'healer',
    mobTemplateId: 'acolyte_tessa',
  },
  companion_edda: {
    id: 'companion_edda',
    name: 'Edda Reedhand',
    role: 'healer',
    mobTemplateId: 'edda_reedhand',
  },
};

/**
 * Rank-up costs (rank 1 is free at intro; max rank 3). Marks only, tuned so the
 * full companion (8 Marks) is a one-to-three-day goal against the windowed
 * income model (3-9 Marks/day Normal by lockpick skill, 12+ Heroic; the
 * pricing-intent comment in shop.ts is the authority), not a 2-week grind.
 * Each rank also strengthens her heal (% of max HP, see DELVE_COMPANION_HEAL_PCT);
 * rank 3 additionally grants a once-per-run ally revive.
 */
export const COMPANION_UPGRADE_COSTS: Record<number, { marks: number; copper: number }> = {
  2: { marks: 3, copper: 0 },
  3: { marks: 5, copper: 0 },
};
