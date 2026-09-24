// One answer to "which druid forms may this button be pressed in?".
//
// `AbilityDef.requiresForm` was a single form for as long as every form button
// belonged to exactly one form. Savage Mending broke that in the v0.43 feral
// pass (a Wildfang heal Bruin and Cat both press), so the field now accepts a
// LIST as well, and this module is the one place that reads it. The cast gate,
// the auto-unshift decision, the tooltip line, and the action bar's form-kit
// seeding all ask here, which is what keeps them from disagreeing about which
// presses are legal.
//
// Pure: no SimContext, no DOM, plain aura kinds in and booleans out, so a
// Vitest can drive it directly and the online client can ask the same question.
import type { AbilityDef, AuraKind } from '../types';

/** The two action-locking druid forms an ability can be authored against. */
export type DruidCombatForm = 'bear' | 'cat';

/** The form aura each requirement names. Kept local and typed against the
 *  canonical AuraKind union in ../types, never a second string table. */
const FORM_AURA_KIND: Record<DruidCombatForm, AuraKind> = {
  bear: 'form_bear',
  cat: 'form_cat',
};

type FormRequirement = Pick<AbilityDef, 'requiresForm'>;

/** Every form this ability may be used in, in authored order. Empty when the
 *  ability carries no form requirement at all. */
export function requiredForms(def: FormRequirement): readonly DruidCombatForm[] {
  const requirement = def.requiresForm;
  if (requirement === undefined) return [];
  return typeof requirement === 'string' ? [requirement] : requirement;
}

/** Does this ability declare a form requirement? */
export function hasFormRequirement(def: FormRequirement): boolean {
  return requiredForms(def).length > 0;
}

/** May this ability be used while wearing exactly `form`? False for an ability
 *  with no form requirement: those belong to the caster-form kit, not a form
 *  kit bar. */
export function abilityBelongsToForm(def: FormRequirement, form: DruidCombatForm): boolean {
  return requiredForms(def).includes(form);
}

/** Does the wearer of `auras` satisfy this ability's form requirement? An
 *  ability with no requirement is trivially satisfied. */
export function formRequirementMet(
  auras: readonly { kind: string }[],
  def: FormRequirement,
): boolean {
  const forms = requiredForms(def);
  if (forms.length === 0) return true;
  return auras.some((aura) => forms.some((form) => aura.kind === FORM_AURA_KIND[form]));
}
