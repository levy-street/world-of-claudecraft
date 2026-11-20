// The entrances' budget for the session's STATIC graphics preset (the plan:
// entrance_budget_core.ts): the preset resolved to its effect tier through
// the one resolver the HUD uses (../../game/ui_effects_profile.ts), never the
// FPS governor. Read once, when a painter is built.

import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { GFX } from '../gfx';
import {
  type EntranceBudget,
  entranceBudget,
  type SmithHeartEntrance,
} from './entrance_budget_core';

/** `entrance`'s budget at the preset the player chose. */
export function entranceBudgetNow(entrance: SmithHeartEntrance): EntranceBudget {
  const { tier } = resolveUiEffectsProfile({
    presetLabel: GFX.tier,
    effectsQuality: 1,
    reduceMotion: false,
  });
  return entranceBudget(entrance, tier);
}
