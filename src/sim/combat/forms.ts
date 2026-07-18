import type { AuraKind } from '../types';

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
