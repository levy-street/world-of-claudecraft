import { describe, expect, it } from 'vitest';
import {
  parseTalentAllocation,
  parseTalentLoadoutIndex,
  parseTalentOptionId,
  parseTalentRowLevel,
} from '../src/sim/talent_allocation_input';

describe('canonical Talent V2 boundary input', () => {
  it('accepts only the canonical spec and rows allocation and returns a detached value', () => {
    const input = {
      spec: 'arms',
      rows: { 5: 'war_row_double_charge', 20: 'war_row_bladestorm' },
    };

    const parsed = parseTalentAllocation(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed?.rows).not.toBe(input.rows);
  });

  it('rejects legacy point-tree and PTR dual-model allocations', () => {
    expect(parseTalentAllocation({ spec: 'arms', ranks: {}, choices: {} })).toBeNull();
    expect(parseTalentAllocation({ spec: 'arms', rows: {}, rowPicks: [] })).toBeNull();
    expect(parseTalentAllocation({ spec: 'arms', rows: {}, choices: {} })).toBeNull();
  });

  it('rejects unknown fields, unlocked-row aliases, and malformed values', () => {
    expect(parseTalentAllocation({ spec: 'arms', rows: {}, extra: true })).toBeNull();
    expect(parseTalentAllocation({ spec: 1, rows: {} })).toBeNull();
    expect(parseTalentAllocation({ spec: 'x'.repeat(65), rows: {} })).toBeNull();
    expect(parseTalentAllocation({ spec: null, rows: [] })).toBeNull();
    expect(parseTalentAllocation({ spec: null, rows: { 6: 'bad_level' } })).toBeNull();
    expect(parseTalentAllocation({ spec: null, rows: { 5: null } })).toBeNull();
    expect(parseTalentAllocation({ spec: null, rows: { 5: 'x'.repeat(65) } })).toBeNull();
  });

  it('accepts only canonical row levels and safe bounded loadout indexes', () => {
    for (const level of [5, 8, 11, 14, 17, 20]) expect(parseTalentRowLevel(level)).toBe(level);
    for (const value of [0, 4, 6, 21, '5', null]) expect(parseTalentRowLevel(value)).toBeNull();

    expect(parseTalentLoadoutIndex(0)).toBe(0);
    expect(parseTalentLoadoutIndex(9)).toBe(9);
    for (const value of [-1, 10, 1.5, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY, '0']) {
      expect(parseTalentLoadoutIndex(value)).toBeNull();
    }
  });

  it('distinguishes a clear selection from a malformed option id', () => {
    expect(parseTalentOptionId(null)).toBeNull();
    expect(parseTalentOptionId('war_row_double_charge')).toBe('war_row_double_charge');
    expect(parseTalentOptionId('')).toBeUndefined();
    expect(parseTalentOptionId('x'.repeat(65))).toBeUndefined();
    expect(parseTalentOptionId(5)).toBeUndefined();
  });
});
