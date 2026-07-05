// Host-agnostic helpers for the Bot Detector > Configuration page: turning the
// schema-driven catalog into form state and parsing form state back into the
// override document the save endpoint expects. Entirely pure so they unit-test
// in the default Node env (the pattern of moderation_actions.ts).

import type { FieldInput } from './field_input';
import { fieldFilled, fieldNumber } from './field_input';
import type { AntibotConfigField, AntibotConfigValue } from './types';

// One editable slot per field. Numbers ride the FieldInput union (Svelte
// coerces bind:value on number inputs); the rest keep their catalog type.
export type AntibotFormValue = FieldInput | boolean | string[];

export interface AntibotFieldGroup {
  group: string;
  fields: AntibotConfigField[];
}

/** Group fields under their section heading, preserving catalog order. */
export function groupAntibotFields(fields: AntibotConfigField[]): AntibotFieldGroup[] {
  const groups: AntibotFieldGroup[] = [];
  const byName = new Map<string, AntibotFieldGroup>();
  for (const field of fields) {
    let group = byName.get(field.group);
    if (!group) {
      group = { group: field.group, fields: [] };
      byName.set(field.group, group);
      groups.push(group);
    }
    group.fields.push(field);
  }
  return groups;
}

/** Seed one form slot per field from its currently applied value. */
export function antibotFormState(fields: AntibotConfigField[]): Record<string, AntibotFormValue> {
  const out: Record<string, AntibotFormValue> = {};
  for (const field of fields) {
    out[field.id] = Array.isArray(field.value) ? [...field.value] : field.value;
  }
  return out;
}

/** Order-insensitive equality for config values (multi_select is a set). */
export function antibotValueEquals(a: AntibotConfigValue, b: AntibotConfigValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((entry) => b.includes(entry));
  }
  return a === b;
}

/** True when the form slot differs from the field's shipped default. */
export function antibotFieldModified(field: AntibotConfigField, value: AntibotFormValue): boolean {
  const resolved = resolveFormValue(field, value);
  return resolved !== null && !antibotValueEquals(resolved, field.defaultValue);
}

/** True when the form slot differs from the value currently applied by the server. */
export function antibotFieldDirty(field: AntibotConfigField, value: AntibotFormValue): boolean {
  const resolved = resolveFormValue(field, value);
  if (resolved !== null) return !antibotValueEquals(resolved, field.value);

  // An empty number input means "use the default", while any other unparseable
  // input remains dirty so the save action can surface its validation error.
  if (field.type === 'number' && !fieldFilled(value as FieldInput)) {
    return !antibotValueEquals(field.defaultValue, field.value);
  }
  return true;
}

// The form slot as a typed config value; null when empty or unparseable (an
// empty number input reads as "use the default").
function resolveFormValue(
  field: AntibotConfigField,
  value: AntibotFormValue,
): AntibotConfigValue | null {
  switch (field.type) {
    case 'number': {
      if (Array.isArray(value) || typeof value === 'boolean') return null;
      if (!fieldFilled(value)) return null;
      const parsed = fieldNumber(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'multi_select':
      return Array.isArray(value) ? value : null;
    case 'select':
    case 'string':
      return typeof value === 'string' ? value : null;
  }
}

export interface AntibotOverridesResult {
  // The full override document to save: every field whose value differs from
  // its default. Fields at their default are simply absent (replace semantics).
  overrides: Record<string, AntibotConfigValue>;
  // Field ids with unparseable or out-of-range input; blocks the save.
  invalid: string[];
}

/** Parse the whole form back into the override document the endpoint expects. */
export function buildAntibotOverrides(
  fields: AntibotConfigField[],
  values: Record<string, AntibotFormValue>,
): AntibotOverridesResult {
  const overrides: Record<string, AntibotConfigValue> = {};
  const invalid: string[] = [];
  for (const field of fields) {
    const raw = values[field.id];
    if (field.type === 'number' && !fieldFilled(raw as FieldInput)) continue; // empty = default
    const resolved = resolveFormValue(field, raw);
    if (resolved === null) {
      invalid.push(field.id);
      continue;
    }
    if (field.type === 'number') {
      const numberValue = resolved as number;
      if (
        (field.min !== undefined && numberValue < field.min) ||
        (field.max !== undefined && numberValue > field.max)
      ) {
        invalid.push(field.id);
        continue;
      }
    }
    if (!antibotValueEquals(resolved, field.defaultValue)) overrides[field.id] = resolved;
  }
  return { overrides, invalid };
}

/** Toggle one option inside a multi_select slot (returns a fresh array). */
export function toggleAntibotOption(current: AntibotFormValue, option: string): string[] {
  const list = Array.isArray(current) ? current : [];
  return list.includes(option) ? list.filter((entry) => entry !== option) : [...list, option];
}

// Compact display text for a default value. Words come from the caller's t()
// (the i18n invariant: no baked English in a UI sink), numbers render as data.
export function antibotDefaultText(
  field: AntibotConfigField,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  const value = field.defaultValue;
  if (typeof value === 'boolean') {
    return translate(value ? 'antibot.valueOn' : 'antibot.valueOff');
  }
  if (Array.isArray(value)) {
    if (field.options && value.length === field.options.length) {
      return translate('antibot.valueAllKinds');
    }
    return translate('antibot.valueKindCount', { count: value.length });
  }
  return field.unit ? `${value} ${field.unit}` : String(value);
}
