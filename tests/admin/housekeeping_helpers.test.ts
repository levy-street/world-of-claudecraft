// Pure form/patch helpers for the housekeeping admin pages (Node env; no DOM).
import { describe, expect, it } from 'vitest';
import {
  fieldFilled,
  fieldNumber,
  flagFormState,
  matchesSearch,
  numericFormState,
  parseFlagPatch,
  parseIdList,
  parseJsonArray,
  parseNumericPatch,
  parseXpTable,
  patchOrNull,
} from '../../src/admin/housekeeping';
import type { HkNumericFieldSpec } from '../../src/admin/types';

const FIELDS: HkNumericFieldSpec[] = [
  { key: 'hpBase', min: 1, max: 100, integer: false },
  { key: 'count', min: 0, max: 50, integer: true },
];

describe('numeric form state and patch', () => {
  it('prefills from an override and leaves defaults empty', () => {
    expect(numericFormState(FIELDS, { hpBase: 7 })).toEqual({ hpBase: '7', count: '' });
    expect(numericFormState(FIELDS, null)).toEqual({ hpBase: '', count: '' });
  });

  it('parses filled fields and reports invalid ones', () => {
    const ok = parseNumericPatch(FIELDS, { hpBase: '12.5', count: '3' });
    expect(ok.patch).toEqual({ hpBase: 12.5, count: 3 });
    expect(ok.invalid).toEqual([]);

    const bad = parseNumericPatch(FIELDS, { hpBase: '0', count: '2.5' });
    expect(bad.patch).toEqual({});
    expect(bad.invalid).toEqual(['hpBase', 'count']);

    const empty = parseNumericPatch(FIELDS, { hpBase: '', count: '  ' });
    expect(empty.patch).toEqual({});
    expect(empty.invalid).toEqual([]);
  });

  it('accepts number-coerced inputs (Svelte bind:value on type=number)', () => {
    // Svelte hands back numbers (or null while empty) once the operator edits.
    const ok = parseNumericPatch(FIELDS, { hpBase: 12.5, count: 3 });
    expect(ok.patch).toEqual({ hpBase: 12.5, count: 3 });
    expect(ok.invalid).toEqual([]);
    const nulls = parseNumericPatch(FIELDS, { hpBase: null, count: undefined });
    expect(nulls.patch).toEqual({});
    expect(nulls.invalid).toEqual([]);
    const bad = parseNumericPatch(FIELDS, { hpBase: 0, count: 2.5 });
    expect(bad.invalid).toEqual(['hpBase', 'count']);
  });

  it('fieldFilled and fieldNumber handle the coerced union', () => {
    expect(fieldFilled('')).toBe(false);
    expect(fieldFilled('  ')).toBe(false);
    expect(fieldFilled(null)).toBe(false);
    expect(fieldFilled(undefined)).toBe(false);
    expect(fieldFilled(0)).toBe(true);
    expect(fieldFilled('7')).toBe(true);
    expect(fieldNumber(7)).toBe(7);
    expect(fieldNumber('7.5')).toBe(7.5);
    expect(Number.isNaN(fieldNumber('abc'))).toBe(true);
  });
});

describe('flag form state and patch', () => {
  it('round-trips tri-state flags', () => {
    const state = flagFormState(['elite', 'rare'], { elite: true });
    expect(state).toEqual({ elite: 'on', rare: '' });
    expect(parseFlagPatch({ elite: 'on', rare: 'off', boss: '' })).toEqual({
      elite: true,
      rare: false,
    });
  });
});

describe('parseXpTable', () => {
  it('accepts exactly the expected count of positive integers', () => {
    expect(parseXpTable('100, 200, 300', 3)).toEqual({ table: [100, 200, 300], error: null });
    expect(parseXpTable('100 200\n300', 3)).toEqual({ table: [100, 200, 300], error: null });
    expect(parseXpTable('', 3)).toEqual({ table: null, error: 'empty' });
    expect(parseXpTable('100, 200', 3)).toEqual({ table: null, error: 'length' });
    expect(parseXpTable('100, 200, 0', 3)).toEqual({ table: null, error: 'value' });
    expect(parseXpTable('100, 200, 3.5', 3)).toEqual({ table: null, error: 'value' });
  });
});

describe('misc helpers', () => {
  it('parseIdList splits on commas and whitespace', () => {
    expect(parseIdList(' sword_1, potion_hp \n shield_2 ')).toEqual([
      'sword_1',
      'potion_hp',
      'shield_2',
    ]);
    expect(parseIdList('')).toEqual([]);
  });

  it('parseJsonArray accepts only JSON arrays', () => {
    expect(parseJsonArray('[{"chance":0.5}]')).toEqual({ value: [{ chance: 0.5 }], error: false });
    expect(parseJsonArray('')).toEqual({ value: null, error: false });
    expect(parseJsonArray('{"chance":0.5}')).toEqual({ value: null, error: true });
    expect(parseJsonArray('not json')).toEqual({ value: null, error: true });
  });

  it('patchOrNull drops empty patches', () => {
    expect(patchOrNull({})).toBeNull();
    expect(patchOrNull({ a: 1 })).toEqual({ a: 1 });
  });

  it('matchesSearch is case-insensitive over any haystack', () => {
    expect(matchesSearch('WOLF', 'forest_wolf', 'Forest Wolf')).toBe(true);
    expect(matchesSearch('bear', 'forest_wolf', 'Forest Wolf', null)).toBe(false);
    expect(matchesSearch('  ', 'anything')).toBe(true);
  });
});
