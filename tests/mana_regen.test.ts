// Unit tests for src/sim/mana_regen.ts, the pure Spirit-mana-regen leaf that the
// tick (combat/auras.ts), the /manaregen readout, and the character-sheet tooltip
// all share. The behavior under test: the FULL Spirit amount out of combat (past
// the five-second rule) and COMBAT_SPIRIT_REGEN_FRACTION of it while the rule is
// active (Spirit's new in-combat "mp5" value).

import { describe, expect, it } from 'vitest';
import {
  COMBAT_SPIRIT_REGEN_FRACTION,
  FIVE_SECOND_RULE_SECONDS,
  manaRegenPer2s,
  spiritRegenPer2s,
} from '../src/sim/mana_regen';

describe('spiritRegenPer2s', () => {
  it('sums the Spirit term, the flat floor, and the per-level floor', () => {
    // spi 60, level 20: 60/3 + 4 + floor(20/5) = 20 + 4 + 4 = 28.
    expect(spiritRegenPer2s(60, 20, 0)).toBe(28);
  });

  it('scales by the additive manaRegenPct bonus', () => {
    // 28 * (1 + 0.5) = 42.
    expect(spiritRegenPer2s(60, 20, 0.5)).toBe(42);
  });

  it('keeps only the flat + per-level floors at zero Spirit', () => {
    expect(spiritRegenPer2s(0, 20, 0)).toBe(8); // 0 + 4 + 4
    expect(spiritRegenPer2s(0, 1, 0)).toBe(4); // 0 + 4 + 0
  });
});

describe('manaRegenPer2s', () => {
  it('restores the full rounded amount once the five-second rule has elapsed', () => {
    // spi 60, level 20: 60/3 + 4 + floor(20/5) = 20 + 4 + 4 = 28 (full, out of combat).
    expect(manaRegenPer2s(60, 20, 0, FIVE_SECOND_RULE_SECONDS)).toBe(28);
    // Any time at or past the threshold is out of combat.
    expect(manaRegenPer2s(60, 20, 0, 99)).toBe(28);
  });

  it('restores the reduced combat share while the rule is still active', () => {
    // Half a tick below the threshold is in combat: round(28 * 0.3) = round(8.4) = 8.
    const inCombat = manaRegenPer2s(60, 20, 0, FIVE_SECOND_RULE_SECONDS - 0.5);
    expect(inCombat).toBe(8);
    expect(inCombat).toBeLessThan(manaRegenPer2s(60, 20, 0, FIVE_SECOND_RULE_SECONDS));
  });

  it('makes Spirit strictly worth something in combat (non-zero for a real Spirit pool)', () => {
    expect(manaRegenPer2s(90, 40, 0, 0)).toBeGreaterThan(0);
  });

  it('folds the combat fraction and the manaRegenPct bonus together', () => {
    // full = 28 * (1 + 0.5) = 42; combat = round(42 * 0.3) = round(12.6) = 13.
    expect(manaRegenPer2s(60, 20, 0.5, 0)).toBe(13);
  });

  it('uses the classic max-Meditation combat share (30%)', () => {
    expect(COMBAT_SPIRIT_REGEN_FRACTION).toBe(0.3);
  });
});
