// The execute-window cast requirement (Warrior Execute, Warlock Duskfire, Paladin
// Hammer of Wrath): the ability is usable only while its target's health sits under
// a threshold, unless a proc or cooldown opens the window early.
//
// A pure leaf shared by the cast gate (combat/casting_lifecycle.ts) and the action
// bar (ui/hud/action_bar/action_bar_view.ts), so the bar can never paint a slot
// usable that the gate refuses, or grey out a cast the gate lets through. Both
// inputs are structural subsets that the live Entity and the online ClientWorld
// mirror satisfy alike; the target arrives as two numbers so the per-frame bar
// allocates nothing to ask.
import { type PaladinExecuteWindowOwner, paladinExecuteWindowActive } from '../paladin_devotion';
import type { AbilityDef } from '../types';
import { dawnsWrathHammerActive } from './paladin_dawns_wrath';

type ExecuteWindowAbility = Pick<AbilityDef, 'id' | 'executeThreshold' | 'requiresTargetHpBelow'>;

export interface ExecuteWindowCaster extends PaladinExecuteWindowOwner {
  auras: readonly { id?: string; kind: string }[];
}

/** The ability's execute threshold as a 0..1 health fraction, or undefined when it has
 *  none. Both fields surface the same requirement; only the boundary differs. */
export function executeWindowThreshold(ability: ExecuteWindowAbility): number | undefined {
  return ability.executeThreshold ?? ability.requiresTargetHpBelow;
}

/** Whether the target's health keeps this ability's execute window shut.
 *  executeThreshold is strict (health must be BELOW it); requiresTargetHpBelow is
 *  at-or-below. False for an ability with no execute requirement. */
export function targetOutsideExecuteWindow(
  ability: ExecuteWindowAbility,
  targetHp: number,
  targetMaxHp: number,
): boolean {
  const threshold = executeWindowThreshold(ability);
  if (threshold === undefined) return false;
  return ability.executeThreshold !== undefined
    ? targetHp >= targetMaxHp * threshold
    : targetHp > targetMaxHp * threshold;
}

/** Whether a worn proc or cooldown lets this ability ignore its execute window:
 *  Sudden Death for Execute, Divine Ascension / Avenging Wrath and Dawn's Wrath for
 *  Hammer of Wrath. */
export function executeWindowBypassed(caster: ExecuteWindowCaster, abilityId: string): boolean {
  return (
    (abilityId === 'execute' && caster.auras.some((aura) => aura.kind === 'sudden_death')) ||
    paladinExecuteWindowActive(caster, abilityId) ||
    dawnsWrathHammerActive(caster, abilityId)
  );
}

/** The cast gate's question: does the execute requirement refuse this cast now? */
export function executeWindowBlocksCast(
  ability: ExecuteWindowAbility,
  caster: ExecuteWindowCaster,
  targetHp: number,
  targetMaxHp: number,
): boolean {
  return (
    targetOutsideExecuteWindow(ability, targetHp, targetMaxHp) &&
    !executeWindowBypassed(caster, ability.id)
  );
}
