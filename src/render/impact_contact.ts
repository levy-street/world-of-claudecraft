import { playContactHaptic } from '../game/haptics';
import { physicalContactSheet } from './ability_vfx/physical_choreography_core';
import { abilityVfxFullSpec } from './ability_vfx_registry';
import type { CharacterVisual } from './characters/visual';
import { hasWarriorContactRecoil } from './characters/warrior_contact_recoil';
import { attackAbilityId } from './characters/weapon_attack_style_core';
import { isBleedContinuation, meleeImpactProfile } from './melee_impact_core';

/** Short contact feedback, independent of the victim's whole-body flinch lock. */
export function impactContact(
  visual: CharacterVisual | null,
  school: string,
  weight: number,
  local: boolean,
  reducedMotion: boolean,
  abilityId?: string,
  periodic = false,
  beat?: number,
  source?: { x: number; z: number },
): void {
  const profile = abilityId ? meleeImpactProfile(abilityId, beat) : undefined;
  const physical = abilityId ? abilityVfxFullSpec(abilityId)?.physical : undefined;
  if (physical) {
    const contact = physicalContactSheet(physical);
    school =
      physical.material === 'venom'
        ? 'physical-venom'
        : contact === 'contact_crush'
          ? 'physical-crush'
          : contact === 'contact_pierce'
            ? 'physical-pierce'
            : school;
  }
  if (profile?.bleeding) school = 'physical-blood';
  visual?.respondToElement(school, Math.min(0.95, 0.55 + weight * 0.15), profile);
  if (periodic || abilityId === 'deep_wounds') return;
  if (!reducedMotion && abilityId && hasWarriorContactRecoil(abilityId))
    visual?.receiveWarriorImpact?.(abilityId, beat ?? 0, source);
  if (abilityId === 'red_harvest' && beat !== undefined && !reducedMotion)
    visual?.receiveHarvestImpact(beat, source);
  if (!reducedMotion) visual?.holdFrame(0.18, Math.min(0.045, 0.018 + weight * 0.01));
  if (!local || reducedMotion) return;
  // The opt-out read and the throttle are src/game/haptics.ts's, not
  // reimplemented here: only the weight-scaled duration is this call's own.
  playContactHaptic(Math.round(Math.min(28, 8 + weight * 8)));
}

/** Damage owns wound pulses even on the final tick after the aura expires. */
export function damageContact(
  visual: CharacterVisual | null,
  event: {
    school: string;
    amount: number;
    ability: string | null;
    abilityId?: string | null;
  },
  local: boolean,
  reducedMotion: boolean,
): void {
  const id = event.ability === 'Bloodhook Wound' ? 'bloodhook' : attackAbilityId(event.ability);
  impactContact(
    visual,
    event.school,
    Math.min(2.2, 0.65 + Math.sqrt(event.amount) * 0.065),
    local,
    reducedMotion,
    id,
    isBleedContinuation(id, event.abilityId) || event.ability === 'Bloodhook Wound',
  );
}
