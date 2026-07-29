import type { SimEvent } from '../sim/types';

type Heal2Event = Extract<SimEvent, { type: 'heal2' }>;

export type HealLandingLogKey =
  | 'hud.combat.healSelf'
  | 'hud.combat.healSelfCrit'
  | 'hud.combat.healOther'
  | 'hud.combat.healOtherCrit'
  | 'hud.combat.healSelfFull'
  | 'hud.combat.healOtherFull'
  | 'hud.combat.healSelfAbsorbed'
  | 'hud.combat.healOtherAbsorbed';

export type HealLandingFloatTextKey =
  | 'hud.combat.floatingHealFull'
  | 'hud.combat.floatingHealAbsorbed';

/** A heal that landed for nothing because a heal-absorb shield (necrotic blight)
 *  devoured it. Distinct from "target already at full health", which is the OTHER
 *  way amount reaches 0 and needs the opposite message: a blighted target can be
 *  at 30 percent HP, and telling the healer they are full is exactly backwards. */
function wasAbsorbed(ev: Heal2Event): boolean {
  return ev.amount === 0 && (ev.absorbed ?? 0) > 0;
}

export function shouldShowHealLanding(ev: Heal2Event): boolean {
  if (ev.cueOnly) return false;
  if (ev.amount > 0) return true;
  return ev.hot !== true;
}

export function healLandingFloatTextKey(ev: Heal2Event): HealLandingFloatTextKey | null {
  if (ev.cueOnly || ev.hot === true) return null;
  if (wasAbsorbed(ev)) return 'hud.combat.floatingHealAbsorbed';
  return ev.amount === 0 ? 'hud.combat.floatingHealFull' : null;
}

export function shouldFloatHealLanding(ev: Heal2Event): boolean {
  return (ev.amount > 0 && shouldShowHealLanding(ev)) || healLandingFloatTextKey(ev) !== null;
}

export function healLandingLogKey(ev: Heal2Event, selfTarget: boolean): HealLandingLogKey | null {
  if (!shouldShowHealLanding(ev)) return null;
  if (wasAbsorbed(ev))
    return selfTarget ? 'hud.combat.healSelfAbsorbed' : 'hud.combat.healOtherAbsorbed';
  if (ev.amount <= 0) return selfTarget ? 'hud.combat.healSelfFull' : 'hud.combat.healOtherFull';
  if (selfTarget) return ev.crit ? 'hud.combat.healSelfCrit' : 'hud.combat.healSelf';
  return ev.crit ? 'hud.combat.healOtherCrit' : 'hud.combat.healOther';
}
