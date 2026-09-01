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
    // Mana-end corridor widened 0.05 to 0.09 (all three specs) by the 2/4/6,
    // then to 0.12 at the 2026-08-30 legendary band (Heartwood budget growth)
    // lineage retune: the halved haste and Clearcasting rates mean fewer
    // casts fit the five minutes, so more mana survives the window.
    // Re-anchor to the new tier's measured economy when the Phase B Crucible
    // set bonuses land (a new gear wave sets a new level; no old target to
    // restore).
    // 0.096 measured at the 2026-08-30 legendary band (Heartwood's spirit
    // and intellect grew with its ilvl-49 budget, so slightly more pool is
    // left at five minutes); the corridor widens to match.
    expect(result.manaEndPct).toBeLessThan(0.12);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});

describe('Demonology full-BiS five-minute inert-boss balance', () => {
  it('keeps a modest sustain floor without approaching Affliction', () => {
    const result = runWarlockBalanceProbe('demonology', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(150);
    expect(result.dps).toBeLessThanOrEqual(210);
    expect(result.manaEndPct).toBeLessThan(0.12);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});

describe('Destruction full-BiS five-minute inert-boss balance', () => {
  // Destruction had no five-minute window before the 2026-08-23 round (a
  // coverage gap the round's probe audit flagged); it gets the same
  // finite-pool and starvation invariants as its siblings.
  //
  // Re-anchored 2026-08-30 at the OSSBrain v0.41.0 base merge. The 0.12 end
  // pool was COPIED from the siblings above and never measured against this
  // rotation: destruction taps at a 30 percent floor (life_tap in
  // tryDestruction, scripts/warlock_balance_probe.ts), so its end-of-fight
  // mana is wherever the five-minute boundary lands in the tap cycle, not a
  // drain signal. Measured 0.180 with starvedPct 0 and 207.2 dps, and the
  // filler's mana cost does not move it at all (a +1 on Gloom Bolt reproduced
  // 0.18037518 to every digit). The invariants that actually bite here are the
  // dps band and starvedPct; the end-pool pin is widened to match the cycle.
  it('spends the mana pool by five minutes inside the sanity corridor', () => {
    const result = runWarlockBalanceProbe('destruction', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(170);
    expect(result.dps).toBeLessThanOrEqual(230);
    expect(result.manaEndPct).toBeLessThan(0.2);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});
