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

    // Re-anchored for the Blightcaller rework (the probe keeps the three DoTs
    // running and spends Blight on Putrefy): seed 42 measures 225.5 DPS, and
    // the corridor keeps about the same -15%/+15% margins as Demonology's.
    expect(result.dps).toBeGreaterThanOrEqual(192);
    expect(result.dps).toBeLessThanOrEqual(260);
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
    // 0.242 measured 2026-09-11 with the stamina baseline model
    // (item_budget.ts): the Deathless Heartwood was authored with its stamina
    // inside its line, so on the caster line the line was filled with Spirit
    // (25 to 43) and the kit's badge jewelry and Soulflame pieces gained
    // Spirit the same way; regen up, no Spell Power moved, so a quarter of the
    // pool survives the window. The corridor widens to 0.30 with the same
    // headroom the 0.12 line carried over its 0.096 measurement; the pool is
    // still finite (starvation still binds below).
    // 0.544 measured with the Blightcaller rotation: the DoTs are cheap for
    // their damage and Cruel Pact returns 20% of max mana per tap, so about
    // half the pool survives the window. Pinned from both sides around it.
    expect(result.manaEndPct).toBeLessThan(0.62);
    // And a floor under the measured 0.544, so the larger surviving pool is
    // pinned from both sides rather than left open below.
    expect(result.manaEndPct).toBeGreaterThan(0.46);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});

describe('Demonology full-BiS five-minute inert-boss balance', () => {
  // Re-anchored for the v0.42.0 Necromancy retune (+20% demonology damage:
  // spec_output_tuning.ts's owner spell bonus 0.10 -> 0.32 plus the baseline
  // pet bonus 0.15 -> 0.42, docs/design/class-balance-v042-results.md).
  // Measured seed-42 actual moved 179 -> 228.92 on this fixture; the corridor
  // moves with it, preserving the SAME relative floor/ceiling margins as the
  // pre-v0.42.0 corridor (150/210 against a measured 179, i.e. about -16%/
  // +17%) rather than just raising the ceiling. This asserts demonology's own
  // corridor only; it overlaps Affliction's (175-235, above), so no cross-spec
  // ordering is claimed or tested here.
  it('lands the Necromancy-buffed sustained DPS corridor', () => {
    const result = runWarlockBalanceProbe('demonology', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(192);
    // Ceiling 269 -> 280 for the shared pacts (Cruel Pact restores 20% of max
    // mana for every spec, plus Hard Bargain): seed 42 measures 271.5.
    expect(result.dps).toBeLessThanOrEqual(280);
    // 0.12 -> 0.55: the probe taps Cruel Pact under 30% mana and each tap now
    // returns 20% of max mana, so the window ends higher in the tap cycle
    // (seed 42 measures 0.496). starvedPct below still pins a finite economy.
    expect(result.manaEndPct).toBeLessThan(0.55);
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
  // Re-anchored at the v0.43 integration: the approved Ruinbolt cycle composes
  // with the later stamina/Spirit item-model pass, and seed 42 measures 241.176
  // DPS and 0.237 ending mana in the full-world BiS probe. The pool still spends
  // down; the check remains a finite-economy bound rather than a cycle-phase pin.
  it('spends the mana pool by five minutes inside the sanity corridor', () => {
    const result = runWarlockBalanceProbe('destruction', 42, 300);

    expect(result.dps).toBeGreaterThanOrEqual(170);
    // Ceiling 255 -> 272 for the shared pacts (Cruel Pact restores 20% of max
    // mana for every spec, plus Hard Bargain): seed 42 measures 263.3.
    expect(result.dps).toBeLessThanOrEqual(272);
    // 0.30 -> 0.47: each Cruel Pact tap now returns 20% of max mana, so the
    // window ends higher in the tap cycle (seed 42 measures 0.413).
    expect(result.manaEndPct).toBeLessThan(0.47);
    expect(result.starvedPct).toBeLessThan(0.45);
  }, 120_000);
});
