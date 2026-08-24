import { describe, expect, it } from 'vitest';
import { runWarlockBalanceProbe } from '../scripts/warlock_balance_probe';

// The five-minute windows pin the INVARIANTS that hold across every
// composition this branch flows through (standalone and the class-overhauls
// integration line, whose talent threading moves absolute DPS and the exact
// starvation onset): the mana pool is genuinely finite (the pool is spent by
// the five-minute mark), starvation never runs away, and each spec stays
// inside a sanity corridor. The old release-v0.33 absolute bands were
// composition-relative and are deliberately retired (owner ruling: the
// starvation floor was the stale half). Corridors re-minted 2026-08-23 with
// the PVE viability round (the fixture kit re-anchor plus the spellDmgPct
// floors); measured seed-42 actuals were 206/179/199. The two-minute anchors
// live in the per-spec tests/warlock_anchor_*.test.ts files since the
// 2026-08-13 split.
describe('Affliction full-BiS five-minute inert-boss balance', () => {
  it('spends the mana pool by five minutes inside the sanity corridor', () => {
    const result = runWarlockBalanceProbe('affliction', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(175);
    expect(result.dps).toBeLessThanOrEqual(235);
    expect(result.manaEndPct).toBeLessThan(0.05);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});

describe('Demonology full-BiS five-minute inert-boss balance', () => {
  it('keeps a modest sustain floor without approaching Affliction', () => {
    const result = runWarlockBalanceProbe('demonology', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(150);
    expect(result.dps).toBeLessThanOrEqual(210);
    expect(result.manaEndPct).toBeLessThan(0.05);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});

describe('Destruction full-BiS five-minute inert-boss balance', () => {
  // Destruction had no five-minute window before the 2026-08-23 round (a
  // coverage gap the round's probe audit flagged); it gets the same
  // finite-pool and starvation invariants as its siblings.
  it('spends the mana pool by five minutes inside the sanity corridor', () => {
    const result = runWarlockBalanceProbe('destruction', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(170);
    expect(result.dps).toBeLessThanOrEqual(230);
    expect(result.manaEndPct).toBeLessThan(0.05);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});
