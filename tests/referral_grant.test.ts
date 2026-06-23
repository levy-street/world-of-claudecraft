// Sim.grantBonus (#475) is how the server applies a referral/promo reward to a
// live character. The credit semantics are load-bearing for the referral
// reconciler: copper must NOT count as earnings (or it re-bonuses itself), while
// XP routes through grantXp (so the player can level) and the reconciler advances
// its checkpoint past the counted bonus.

import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });

describe('Sim.grantBonus', () => {
  it('credits copper to the balance WITHOUT touching the lootCopper earned counter', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.player.id)!;
    const copper0 = meta.copper;
    const looted0 = meta.counters.lootCopper;
    sim.grantBonus(meta, 0, 5000);
    expect(meta.copper).toBe(copper0 + 5000);
    expect(meta.counters.lootCopper).toBe(looted0); // bonus copper is not re-counted as earnings
  });

  it('credits XP through grantXp: counts in xpGained and advances lifetimeXp', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.player.id)!;
    const xpGained0 = meta.counters.xpGained;
    const lifetime0 = meta.lifetimeXp;
    sim.grantBonus(meta, 300, 0);
    expect(meta.counters.xpGained).toBe(xpGained0 + 300); // reconciler advances its checkpoint past this
    expect(meta.lifetimeXp).toBe(lifetime0 + 300);
  });

  it('applies XP and copper together, and floors/ignores non-positive amounts', () => {
    const sim = makeSim();
    const meta = sim.meta(sim.player.id)!;
    const copper0 = meta.copper;
    const xpGained0 = meta.counters.xpGained;
    sim.grantBonus(meta, 0, 0);
    sim.grantBonus(meta, -100, -100);
    expect(meta.copper).toBe(copper0);
    expect(meta.counters.xpGained).toBe(xpGained0);
    sim.grantBonus(meta, 10.9, 20.9);
    expect(meta.counters.xpGained).toBe(xpGained0 + 10); // floored
    expect(meta.copper).toBe(copper0 + 20);
  });
});
