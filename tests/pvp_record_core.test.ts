import { describe, expect, it } from 'vitest';
import { formatPvpRecord } from '../src/ui/pvp_record_core';

describe('ranked PvP record formatting', () => {
  it('renders wins, losses, and draws in that order', () => {
    // The reported case: one win and one draw used to read "1-0", with the
    // drawn match appearing in no figure at all.
    expect(formatPvpRecord({ wins: 1, losses: 0, draws: 1 })).toBe('1-0-1');
  });

  it('always shows the draws figure, including at zero', () => {
    // Hiding it at zero would make the same record take two different shapes,
    // and a bare "1-0" is the exact ambiguity this replaces.
    expect(formatPvpRecord({ wins: 1, losses: 0, draws: 0 })).toBe('1-0-0');
    expect(formatPvpRecord({ wins: 0, losses: 0, draws: 0 })).toBe('0-0-0');
  });

  it('keeps each figure distinct rather than collapsing a repeated value', () => {
    expect(formatPvpRecord({ wins: 7, losses: 7, draws: 7 })).toBe('7-7-7');
    expect(formatPvpRecord({ wins: 12, losses: 3, draws: 5 })).toBe('12-3-5');
  });
});
