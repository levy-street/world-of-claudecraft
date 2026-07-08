import { describe, expect, it } from 'vitest';
import type { MaterialRarity } from '../src/sim/professions/gathering';
import {
  CONSUMPTION_CHANCE_FLOOR,
  depleteEffect,
  effectConsumptionChance,
  slotEffect,
} from '../src/sim/professions/tools';
import { Rng } from '../src/sim/rng';

// Rarity-scaled effect durability consumption curve (#1139). Depends on
// #1136 (tool effect slotting/durability) and #1122 (the rarity ladder /
// rollMaterialRarity), both merged into this branch already.
describe('rarity-scaled effect durability consumption curve (#1139)', () => {
  // Statistical tolerance for the trial-based assertions below, expressed in
  // percentage points (matches the issue's "+/-10 percentage points" bar).
  const TOLERANCE = 0.1;
  const TRIALS = 20_000;

  // Runs `trials` independent single-use depletion rolls (a FRESH slot each
  // time, well above 0 durability, so the floor never caps the observed
  // rate) and returns the observed consumption rate.
  function observedRate(
    toolRarity: MaterialRarity,
    targetRarity: MaterialRarity,
    seed: number,
    trials = TRIALS,
  ): number {
    const rng = new Rng(seed);
    let consumed = 0;
    for (let i = 0; i < trials; i++) {
      const slot = slotEffect('gatherers_cache');
      slot.durability = 1000; // never hits 0 mid-trial
      if (depleteEffect(slot, toolRarity, targetRarity, rng)) consumed++;
    }
    return consumed / trials;
  }

  it('exact formula values match the issue worked example for an epic tool', () => {
    // "an epic tool with +3 quantity spends 1 durability on an epic target,
    // about 60 percent on rare, about 10 percent on common"
    expect(effectConsumptionChance('epic', 'epic')).toBe(1);
    expect(effectConsumptionChance('epic', 'rare')).toBeCloseTo(0.6, 10);
    expect(effectConsumptionChance('epic', 'common')).toBeCloseTo(0.1, 10);
  });

  it('the floor is respected for gaps wider than the worked example covers', () => {
    // epic vs uncommon: tierGap 2 -> 1 - 0.4*2 = 0.2
    expect(effectConsumptionChance('epic', 'uncommon')).toBeCloseTo(0.2, 10);
    // legendary vs common: tierGap 4 -> formula goes negative, floored
    expect(effectConsumptionChance('legendary', 'common')).toBe(CONSUMPTION_CHANCE_FLOOR);
    // legendary vs uncommon: tierGap 3 -> also floored
    expect(effectConsumptionChance('legendary', 'uncommon')).toBe(CONSUMPTION_CHANCE_FLOOR);
  });

  it('an equal-or-higher-rarity target always consumes a charge, regardless of tool rarity', () => {
    const pairs: [MaterialRarity, MaterialRarity][] = [
      ['common', 'common'],
      ['common', 'rare'],
      ['rare', 'rare'],
      ['rare', 'legendary'],
      ['legendary', 'legendary'],
    ];
    for (const [toolRarity, targetRarity] of pairs) {
      expect(effectConsumptionChance(toolRarity, targetRarity)).toBe(1);
    }
  });

  it('consumption chance is non-increasing as the tool outclasses its target by more tiers', () => {
    const order: MaterialRarity[] = ['legendary', 'epic', 'rare', 'uncommon', 'common'];
    for (let i = 1; i < order.length; i++) {
      const wider = effectConsumptionChance('legendary', order[i]);
      const narrower = effectConsumptionChance('legendary', order[i - 1]);
      expect(wider).toBeLessThanOrEqual(narrower);
    }
  });

  it('scripted statistical test: epic tool vs epic target consumes ~100% of the time', () => {
    const rate = observedRate('epic', 'epic', 1);
    expect(rate).toBeCloseTo(1, 1);
    expect(Math.abs(rate - 1)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('scripted statistical test: epic tool vs rare target consumes ~60% of the time', () => {
    const rate = observedRate('epic', 'rare', 2);
    expect(Math.abs(rate - 0.6)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('scripted statistical test: epic tool vs common target consumes ~10% of the time', () => {
    const rate = observedRate('epic', 'common', 3);
    expect(Math.abs(rate - 0.1)).toBeLessThanOrEqual(TOLERANCE);
  });

  it('draws exactly one Rng value per call, via Rng.chance (never Math.random)', () => {
    // Two independent Rng streams seeded identically must agree call-for-call:
    // if the roll ever consumed a different number of draws (or fell back to
    // Math.random), the two durability sequences would eventually diverge.
    const runSequence = (seed: number): number[] => {
      const rng = new Rng(seed);
      const slot = slotEffect('artisans_eye');
      const history: number[] = [];
      for (let i = 0; i < 40; i++) {
        depleteEffect(slot, 'epic', 'rare', rng);
        history.push(slot.durability);
      }
      return history;
    };
    expect(runSequence(555)).toEqual(runSequence(555));

    // A single roll consumes exactly one rng.next() draw: advancing a second
    // rng by exactly one manual `next()` call per roll reproduces the same
    // sequence of decisions as depleteEffect's internal draw.
    const seeded = new Rng(777);
    const mirror = new Rng(777);
    const slot = slotEffect('artisans_eye');
    for (let i = 0; i < 40; i++) {
      const before = slot.durability;
      depleteEffect(slot, 'epic', 'rare', seeded);
      const roll = mirror.next();
      const shouldConsume = roll < effectConsumptionChance('epic', 'rare') && before > 0;
      expect(slot.durability).toBe(shouldConsume ? before - 1 : before);
    }
  });
});
