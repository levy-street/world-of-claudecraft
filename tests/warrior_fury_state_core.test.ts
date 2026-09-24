import { describe, expect, it } from 'vitest';
import {
  warriorEchoCount,
  warriorFuryStateAge,
  warriorFuryStateKind,
} from '../src/render/warrior_fury_state_core';

describe('warriorFuryStateKind', () => {
  it('returns 0 for fury_enrage with enrage kind and finite positive remaining', () => {
    expect(warriorFuryStateKind({ id: 'fury_enrage', kind: 'enrage', remaining: 5 })).toBe(0);
  });
  it('returns 1 for furious_mending with buff_dr kind and finite positive remaining', () => {
    expect(warriorFuryStateKind({ id: 'furious_mending', kind: 'buff_dr', remaining: 8 })).toBe(1);
  });
  it('returns 2 for bladed_echo with aoe_echo kind, positive integer charges, and finite positive remaining', () => {
    expect(
      warriorFuryStateKind({ id: 'bladed_echo', kind: 'aoe_echo', remaining: 4, charges: 2 }),
    ).toBe(2);
  });
  it('returns 2 for bladed_echo with a single charge', () => {
    expect(
      warriorFuryStateKind({ id: 'bladed_echo', kind: 'aoe_echo', remaining: 4, charges: 1 }),
    ).toBe(2);
  });
  it('returns null when remaining is zero', () => {
    expect(warriorFuryStateKind({ id: 'fury_enrage', kind: 'enrage', remaining: 0 })).toBeNull();
  });
  it('returns null when remaining is negative', () => {
    expect(warriorFuryStateKind({ id: 'fury_enrage', kind: 'enrage', remaining: -1 })).toBeNull();
  });
  it('returns null when remaining is Infinity (not finite)', () => {
    expect(
      warriorFuryStateKind({ id: 'fury_enrage', kind: 'enrage', remaining: Infinity }),
    ).toBeNull();
  });
  it('returns null when remaining is NaN', () => {
    expect(warriorFuryStateKind({ id: 'fury_enrage', kind: 'enrage', remaining: NaN })).toBeNull();
  });
  it('returns null when remaining is absent', () => {
    expect(warriorFuryStateKind({ id: 'fury_enrage', kind: 'enrage' })).toBeNull();
  });
  it('returns null for an unknown id even with otherwise matching fields', () => {
    expect(warriorFuryStateKind({ id: 'other_buff', kind: 'enrage', remaining: 5 })).toBeNull();
  });
  it('returns null when kind does not match the id', () => {
    expect(warriorFuryStateKind({ id: 'fury_enrage', kind: 'buff_dr', remaining: 5 })).toBeNull();
  });
  it('returns null for bladed_echo with zero charges', () => {
    expect(
      warriorFuryStateKind({ id: 'bladed_echo', kind: 'aoe_echo', remaining: 4, charges: 0 }),
    ).toBeNull();
  });
  it('returns null for bladed_echo with negative charges', () => {
    expect(
      warriorFuryStateKind({ id: 'bladed_echo', kind: 'aoe_echo', remaining: 4, charges: -1 }),
    ).toBeNull();
  });
  it('returns null for bladed_echo when charges are absent', () => {
    expect(warriorFuryStateKind({ id: 'bladed_echo', kind: 'aoe_echo', remaining: 4 })).toBeNull();
  });
  it('returns null for bladed_echo with non-finite charges', () => {
    expect(
      warriorFuryStateKind({ id: 'bladed_echo', kind: 'aoe_echo', remaining: 4, charges: NaN }),
    ).toBeNull();
  });
});

describe('warriorFuryStateAge', () => {
  it('returns duration minus remaining as partial elapsed age', () => {
    expect(warriorFuryStateAge({ id: 'x', duration: 20, remaining: 17 })).toBe(3);
  });
  it('clamps elapsed to zero when remaining exceeds duration', () => {
    expect(warriorFuryStateAge({ id: 'x', duration: 10, remaining: 15 })).toBe(0);
  });
  it('returns the nonzero held age sentinel when duration is absent', () => {
    expect(warriorFuryStateAge({ id: 'x', remaining: 5 })).toBe(0.35);
  });
  it('returns the held age sentinel when neither duration nor remaining is present', () => {
    expect(warriorFuryStateAge({ id: 'x' })).toBe(0.35);
  });
  it('returns the held age sentinel when duration is zero', () => {
    expect(warriorFuryStateAge({ id: 'x', duration: 0, remaining: 5 })).toBe(0.35);
  });
  it('returns the held age sentinel when duration is Infinity', () => {
    expect(warriorFuryStateAge({ id: 'x', duration: Infinity, remaining: 5 })).toBe(0.35);
  });
  it('returns the held age sentinel when duration is NaN', () => {
    expect(warriorFuryStateAge({ id: 'x', duration: NaN, remaining: 5 })).toBe(0.35);
  });
  it('held age sentinel is nonzero', () => {
    expect(warriorFuryStateAge({ id: 'x' })).toBeGreaterThan(0);
  });
});

describe('warriorEchoCount', () => {
  it('returns 2 for two charges', () => expect(warriorEchoCount(2)).toBe(2));
  it('returns 1 for one charge', () => expect(warriorEchoCount(1)).toBe(1));
  it('returns 0 for zero charges (live echo depleted)', () => expect(warriorEchoCount(0)).toBe(0));
  it('caps at 2 for charges above two', () => expect(warriorEchoCount(5)).toBe(2));
  it('floors fractional charges (1.9 -> 1)', () => expect(warriorEchoCount(1.9)).toBe(1));
  it('floors fractional charges (0.8 -> 0)', () => expect(warriorEchoCount(0.8)).toBe(0));
  it('returns 0 for NaN', () => expect(warriorEchoCount(NaN)).toBe(0));
  it('returns 0 for undefined', () => expect(warriorEchoCount(undefined)).toBe(0));
  it('returns 0 for negative charges', () => expect(warriorEchoCount(-1)).toBe(0));
});
