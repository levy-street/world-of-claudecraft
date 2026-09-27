// Which abilities are toggles, and when re-pressing one is the cast gate's
// "leaving" arm. A pure leaf shared by the cast gate (combat/casting_lifecycle.ts)
// and the action bar (ui/hud/action_bar/action_bar_view.ts), so the bar never
// greys the one press that takes a player back out of a restricted toggle.
import { type AbilityDef, isFormAuraKind } from '../types';

// Forms, stances and stealth are toggles: re-casting cancels the aura, and
// cancelling is never gated by cost or cooldown (the cooldown gates re-entry).
export function isToggleBuff(ability: Pick<AbilityDef, 'id' | 'effects'>): boolean {
  if (ability.id === 'ghost_wolf') return true;
  return ability.effects.some(
    (e) =>
      e.type === 'selfBuff' &&
      (isFormAuraKind(e.kind) ||
        e.kind === 'defensive_stance' ||
        e.kind === 'stealth' ||
        e.kind === 'stasis' ||
        e.healthDrainPctMax !== undefined),
  );
}

/** Re-pressing a worn toggle that carries requiresOutsideInstance (Ember Form) is the
 *  way back out, so the gate skips the whole combat/instance restriction for it. */
export function leavingRestrictedToggle(
  ability: Pick<AbilityDef, 'id' | 'effects' | 'requiresOutsideInstance'>,
  auras: readonly { id?: string }[],
): boolean {
  return (
    !!ability.requiresOutsideInstance &&
    isToggleBuff(ability) &&
    auras.some((a) => a.id === ability.id)
  );
}
