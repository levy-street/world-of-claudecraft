import { describe, expect, it } from 'vitest';
import { runWarlockBalanceProbe } from '../scripts/warlock_balance_probe';

// The five-minute windows pin the INVARIANTS that hold across every
// composition this branch flows through (standalone and the class-overhauls
// integration line, whose talent threading moves absolute DPS and the exact
// starvation onset): the mana pool is genuinely finite (the pool is spent by
// the five-minute mark), starvation never runs away, and each spec stays
// inside a sanity corridor. The old release-v0.33 absolute bands were
// composition-relative and are deliberately retired (owner ruling: the
// starvation floor was the stale half). The two-minute anchors live in the
// per-spec tests/warlock_anchor_*.test.ts files since the 2026-08-13 split.
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
    // as the two-minute anchor floor in tests/warlock_anchor_demonology.test.ts).
    expect(result.dps).toBeGreaterThanOrEqual(100);
    expect(result.dps).toBeLessThanOrEqual(165);
    expect(result.manaEndPct).toBeLessThan(0.05);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});
