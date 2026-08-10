import { describe, expect, it } from 'vitest';
import { runWarlockBalanceProbe } from '../scripts/warlock_balance_probe';

// The sub-200 anchor gate (owner ruling, 2026-08-06): every warlock spec lands
// at or under 200 DPS at 120 seconds in full BiS (no legendary is equippable by
// a warlock), with a healthy two-minute economy: the mana cliff belongs to the
// five-minute windows below, never inside the first two minutes. Measured as
// the probe harness's own four-seed mean, the same statistic the tuning study
// and the balance reports quote (a single seed wobbles a few points around it).
const ANCHOR_SEEDS = [42, 1337, 9001, 777] as const;

describe('warlock sub-200 BiS anchor at 120 seconds', () => {
  it.each(['affliction', 'destruction', 'demonology'] as const)(
    '%s stays at or under the 200 DPS anchor with a healthy two-minute economy',
    (spec) => {
      const rows = ANCHOR_SEEDS.map((seed) => runWarlockBalanceProbe(spec, seed, 120));
      const mean = (key: 'dps' | 'starvedPct') =>
        rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

      expect(mean('dps')).toBeLessThanOrEqual(200);
      // Floor 150 to 140 with the 2026-08-07 top-end trim round: the isolated
      // head benches below the composed tree, and the sanctioned cuts land
      // Ruination and Pactbound near 148-149 here. The floor still catches a
      // collapse; the anchor above is the load-bearing half.
      expect(mean('dps')).toBeGreaterThanOrEqual(140);
      expect(mean('starvedPct')).toBeLessThan(0.1);
    },
    180_000,
  );
});

// The five-minute windows pin the INVARIANTS that hold across every
// composition this branch flows through (standalone and the class-overhauls
// integration line, whose talent threading moves absolute DPS and the exact
// starvation onset): the mana pool is genuinely finite (the pool is spent by
// the five-minute mark), starvation never runs away, and each spec stays
// inside a sanity corridor. The old release-v0.33 absolute bands were
// composition-relative and are deliberately retired (owner ruling: the
// starvation floor was the stale half).
describe('Affliction full-BiS five-minute inert-boss balance', () => {
  it('spends the mana pool by five minutes inside the sanity corridor', () => {
    const result = runWarlockBalanceProbe('affliction', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(135);
    expect(result.dps).toBeLessThanOrEqual(200);
    expect(result.manaEndPct).toBeLessThan(0.05);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});

describe('Demonology full-BiS five-minute inert-boss balance', () => {
  it('keeps a modest sustain floor without approaching Affliction', () => {
    const result = runWarlockBalanceProbe('demonology', 42, 300);

    // Floor 110 to 100 with the 2026-08-07 top-end trim round (same reasoning
    // as the two-minute anchor floor above).
    expect(result.dps).toBeGreaterThanOrEqual(100);
    expect(result.dps).toBeLessThanOrEqual(165);
    expect(result.manaEndPct).toBeLessThan(0.05);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});
