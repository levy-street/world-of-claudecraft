// v0.42.0 class balance: the pure primary-healing amplification helper
// (src/sim/primary_healing.ts). Custom-path wiring (Aegis, Wildbloom replant,
// Perpetual Sun) is covered separately in tests/v042_healer_custom_scaling.test.ts;
// this file pins the leaf helper's own contract in isolation.
import { describe, expect, it } from 'vitest';
import { scalePrimaryHealing } from '../src/sim/primary_healing';

describe('scalePrimaryHealing', () => {
  it('returns the amount byte-identical at a multiplier of 1, including zero and negative inputs', () => {
    expect(scalePrimaryHealing(0, 1)).toBe(0);
    expect(scalePrimaryHealing(1, 1)).toBe(1);
    expect(scalePrimaryHealing(403, 1)).toBe(403);
    expect(scalePrimaryHealing(-5, 1)).toBe(-5);
    expect(scalePrimaryHealing(361.4, 1)).toBe(361.4); // no incidental rounding at factor 1
  });

  it('multiplies and rounds the complete raw amount for the Spiritmend/Sunmender +10% factor', () => {
    // class-balance-v042.md diagnostic ranges (level 20, 100 Healing Power, no rows).
    expect(scalePrimaryHealing(361, 1.1)).toBe(397); // Mending Waters low end
    expect(scalePrimaryHealing(403, 1.1)).toBe(443); // Mending Waters high end
    expect(scalePrimaryHealing(276, 1.1)).toBe(304); // Mending Light low end
    expect(scalePrimaryHealing(308, 1.1)).toBe(339); // Mending Light high end
  });

  it('multiplies and rounds the complete raw amount for the shipped Groveheart +5% factor', () => {
    // Groveheart shipped at 1.05 (spec_output_tuning.ts primaryHealingMultiplier),
    // not the initial 1.20 candidate: see tests/v042_healer_custom_scaling.test.ts
    // "Groveheart primary-healing factor" for the retune rationale.
    expect(scalePrimaryHealing(135, 1.05)).toBe(142); // Rejuvenation tick
    expect(scalePrimaryHealing(430, 1.05)).toBe(452); // Wildmend low end
    expect(scalePrimaryHealing(482, 1.05)).toBe(506); // Wildmend high end
  });

  it('rounds half away from zero on the positive side, matching every other spell_scaling rider', () => {
    expect(scalePrimaryHealing(5, 1.1)).toBe(6); // 5.5 -> 6
  });
});
