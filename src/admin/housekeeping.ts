// Host-agnostic helpers for the housekeeping pages: turning override documents
// into form state and parsing form state back into override patches, entirely
// pure so they unit-test in the default Node env (the pattern of
// moderation_actions.ts / ip_block.ts).

import type { HkNumericFieldSpec } from './types';

// Tri-state select value for optional boolean flags: '' = keep default.
export type FlagChoice = '' | 'on' | 'off';

// Svelte coerces bind:value on an <input type="number"> to a number (or null
// while empty/invalid), so form state that starts as a prefilled string comes
// back as this union after the operator edits it. Every parser accepts it.
export type FieldInput = string | number | null | undefined;

/** True when the operator actually entered something ('' / null = default). */
export function fieldFilled(value: FieldInput): boolean {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

/** Numeric value of a filled field (NaN when unparseable). */
export function fieldNumber(value: FieldInput): number {
  return typeof value === 'number' ? value : Number(String(value ?? '').trim());
}

/** Prefill one text input per numeric field from an override ('' = default). */
export function numericFormState(
  fields: HkNumericFieldSpec[],
  override: Record<string, unknown> | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    const value = override?.[field.key];
    out[field.key] = typeof value === 'number' ? String(value) : '';
  }
  return out;
}

export interface NumericPatchResult {
  patch: Record<string, number>;
  // Field keys with unparseable or out-of-range input.
  invalid: string[];
}

/** Parse the inputs back into a numeric patch; an empty field means "no override". */
export function parseNumericPatch(
  fields: HkNumericFieldSpec[],
  values: Record<string, FieldInput>,
): NumericPatchResult {
  const patch: Record<string, number> = {};
  const invalid: string[] = [];
  for (const field of fields) {
    if (!fieldFilled(values[field.key])) continue;
    const value = fieldNumber(values[field.key]);
    const outOfRange =
      !Number.isFinite(value) ||
      value < field.min ||
      value > field.max ||
      (field.integer === true && !Number.isInteger(value));
    if (outOfRange) {
      invalid.push(field.key);
    } else {
      patch[field.key] = value;
    }
  }
  return { patch, invalid };
}

/** Prefill one tri-state select per flag from an override. */
export function flagFormState(
  flags: string[],
  override: Record<string, unknown> | null,
): Record<string, FlagChoice> {
  const out: Record<string, FlagChoice> = {};
  for (const flag of flags) {
    const value = override?.[flag];
    out[flag] = typeof value === 'boolean' ? (value ? 'on' : 'off') : '';
  }
  return out;
}

/** Parse the tri-state selects into boolean overrides ('' contributes nothing). */
export function parseFlagPatch(values: Record<string, FlagChoice>): Record<string, boolean> {
  const patch: Record<string, boolean> = {};
  for (const [flag, choice] of Object.entries(values)) {
    if (choice === 'on') patch[flag] = true;
    if (choice === 'off') patch[flag] = false;
  }
  return patch;
}

export interface XpTableParse {
  table: number[] | null;
  error: 'empty' | 'length' | 'value' | null;
}

/** Parse a comma/space separated XP table; must list exactly `length` integers >= 1. */
export function parseXpTable(text: string, length: number): XpTableParse {
  const trimmed = text.trim();
  if (trimmed === '') return { table: null, error: 'empty' };
  const parts = trimmed.split(/[\s,]+/).filter((part) => part.length > 0);
  if (parts.length !== length) return { table: null, error: 'length' };
  const table: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 1) return { table: null, error: 'value' };
    table.push(value);
  }
  return { table, error: null };
}

/** Parse a comma/space/newline separated id list (vendor stock). */
export function parseIdList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export interface JsonArrayParse {
  value: unknown[] | null;
  error: boolean;
}

/** Parse a JSON array (the advanced loot editor); anything else is an error. */
export function parseJsonArray(text: string): JsonArrayParse {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null, error: false };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? { value: parsed, error: false } : { value: null, error: true };
  } catch {
    return { value: null, error: true };
  }
}

/** A patch object is worth sending only when it carries at least one key. */
export function patchOrNull(patch: Record<string, unknown>): Record<string, unknown> | null {
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Case-insensitive id/name filter for the catalog tables. */
export function matchesSearch(
  search: string,
  ...haystacks: (string | null | undefined)[]
): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return haystacks.some((hay) => (hay ?? '').toLowerCase().includes(needle));
}
