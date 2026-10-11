// Warfare Season 2 ("Vanguard") set bonuses: the engine payloads for all 27
// spec sets, merged into SET_ENGINE_BONUSES (content/ignivar_set_bonuses.ts)
// so set_bonus_mods.ts folds them exactly like the raid tier. Split in two
// class groups so each stays a readable data table.

import type { SetEngineBonusTier } from './ignivar_set_bonuses';
import { VANGUARD_BONUSES_A } from './vanguard_set_bonuses_a';
import { VANGUARD_BONUSES_B } from './vanguard_set_bonuses_b';

export const VANGUARD_SET_ENGINE_BONUSES: Record<string, readonly SetEngineBonusTier[]> = {
  ...VANGUARD_BONUSES_A,
  ...VANGUARD_BONUSES_B,
};
