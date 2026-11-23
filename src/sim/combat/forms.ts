import type { AbilityEffect, AuraKind } from '../types';

// One source of truth for the form kind set (types.ts FORM_AURA_KINDS, which
// includes form_fireball); re-exported here for the combat-side call sites.
export { isFormAuraKind } from '../types';

export function isResourceShiftFormAuraKind(kind: AuraKind): boolean {
  return kind === 'form_bear' || kind === 'form_cat' || kind === 'form_travel';
}

export function isActionLockingFormAuraKind(kind: AuraKind): boolean {
  return isResourceShiftFormAuraKind(kind) || kind === 'form_fireball';
}

export function isTravelFormAuraKind(kind: AuraKind): boolean {
  return kind === 'form_travel' || kind === 'form_fireball';
}

// Mount-safe forms: the caster forms that keep the body and only adorn it
// (Moonwing Form, Gloamveil). A rider shifts into and out of them in the
// saddle, and mounting leaves them on (mounts.ts). Every other form still
// dismounts: Cat, Bruin, and Fleet swap the body for a creature rig, Fleet
// and Ember Form carry a travel speed that would stack onto the mount's, and
// Lich Form is a combat cooldown rather than a toggle.
export const MOUNT_SAFE_FORM_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'form_moonkin',
  'form_shadow',
]);

export function isMountSafeFormAuraKind(kind: AuraKind): boolean {
  return MOUNT_SAFE_FORM_AURA_KINDS.has(kind);
}

/** A press that only toggles a mount-safe form: every effect it resolves to
 *  is that form's selfBuff. Anything more (a strike, a heal, a second buff) is
 *  a real cast and dismounts like every other ability. */
export function isMountSafeFormToggle(ability: { effects: readonly AbilityEffect[] }): boolean {
  return (
    ability.effects.length > 0 &&
    ability.effects.every((e) => e.type === 'selfBuff' && isMountSafeFormAuraKind(e.kind))
  );
}
