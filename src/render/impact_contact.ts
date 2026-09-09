import { physicalContactSheet } from './ability_vfx/physical_choreography_core';
import { abilityVfxFullSpec } from './ability_vfx_registry';
import type { CharacterVisual } from './characters/visual';
import { attackAbilityId } from './characters/weapon_attack_style_core';
import { isBleedContinuation, meleeImpactProfile } from './melee_impact_core';

let lastHaptic = -Infinity;
/** Short contact feedback, independent of the victim's whole-body flinch lock. */
export function impactContact(
  visual: CharacterVisual | null,
  school: string,
  weight: number,
  local: boolean,
  reducedMotion: boolean,
  abilityId?: string,
  periodic = false,
): void {
  const profile = abilityId ? meleeImpactProfile(abilityId) : undefined;
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
  if (!reducedMotion) visual?.holdFrame(0.18, Math.min(0.045, 0.018 + weight * 0.01));
  if (!local || reducedMotion || typeof navigator === 'undefined' || !navigator.vibrate) return;
  const now = performance.now();
  if (now - lastHaptic < 90) return;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('woc_haptics_on') === '0')
      return;
    navigator.vibrate(Math.round(Math.min(28, 8 + weight * 8)));
    lastHaptic = now;
  } catch {
    /* Unsupported actuator or unavailable storage is silent. */
  }
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
