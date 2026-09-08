// Pure event gate for physical-hit attack gestures. Casts with an authored
// full-body one-shot keep ownership of the rig while ordinary melee damage is
// still allowed to resolve underneath them.

import { isBleedContinuation } from '../melee_impact_core';
import { attackAbilityId } from './weapon_attack_style_core';
import { hunterPetComponent } from '../hunter_pet_component_core';
import { playerRangedAttackAlreadyStarted } from './skin_attack';

export interface DamageAttackAnimationContext {
  sourceKind: string | undefined;
  attackAnimationStarted: boolean | undefined;
  castingAbility: string | null | undefined;
  authoredCastOwnsBody: boolean;
}

export function shouldStartDamageAttackAnimation({
  sourceKind,
  attackAnimationStarted,
  castingAbility,
  authoredCastOwnsBody,
}: DamageAttackAnimationContext): boolean {
  if (playerRangedAttackAlreadyStarted(sourceKind, attackAnimationStarted))
    return false;
  return !(
    sourceKind === 'mob' &&
    castingAbility !== null &&
    authoredCastOwnsBody
  );
}

/** A character visual's authored-clip lookup (CharacterVisual, structurally). */
export interface AttackClipOverrideSource {
  hasAttackClipOverride(abilityId: string): boolean;
  readonly isPerformingAbility?: boolean;
}

/**
 * Resolve the gate above from the live source entity and its active visual,
 * moved verbatim from the renderer's damage-event arm: an authored full-body
 * cast clip on a casting mob owns the rig, so the landing damage must not
 * restart a generic attack gesture underneath it.
 */
export function damageEventStartsAttackAnimation(
  source: { kind: string; castingAbility?: string | null } | undefined,
  sourceVisual: AttackClipOverrideSource | null,
  attackAnimationStarted: boolean | undefined,
  abilityLabel?: string | null,
  primaryAbilityId?: string | null,
): boolean {
  if (!abilityLabel && !primaryAbilityId && sourceVisual?.isPerformingAbility) return false;
  if (
    isBleedContinuation(attackAbilityId(abilityLabel ?? null), primaryAbilityId)
  )
    return false;
  if (
    !primaryAbilityId &&
    [
      'Hunting Momentum',
      'Bloodhook Re-entry',
      'Bloodhook Wound',
      'Woundrend',
    ].includes(abilityLabel ?? '')
  )
    return false;
  if (hunterPetComponent(abilityLabel)) return false;
  const authoredCastOwnsBody =
    source?.kind === 'mob' &&
    source.castingAbility !== null &&
    source.castingAbility !== undefined &&
    sourceVisual?.hasAttackClipOverride(source.castingAbility) === true;
  return shouldStartDamageAttackAnimation({
    sourceKind: source?.kind,
    attackAnimationStarted,
    castingAbility: source?.castingAbility,
    authoredCastOwnsBody,
  });
}
