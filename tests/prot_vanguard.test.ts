import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';

// Protection's Vanguard (owner 2026-07-08): committing the Protection spec grants,
// through its Recompense mastery, a flat +40% Stamina and armor equal to 70% of
// Strength (on top of the existing +30% threat / +10% armor). No level scaling.

const makeWarrior = (): Sim => {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  sim.tick();
  return sim;
};

describe('Protection Vanguard mastery', () => {
  it('grants +40% Stamina and +70%-of-Strength armor on committing Protection', () => {
    const sim = makeWarrior();
    const baseSta = sim.player.stats.sta;
    const baseArmor = sim.player.stats.armor;
    const baseHp = sim.player.maxHp;
    const str = sim.player.stats.str;

    expect(sim.setSpec('prot')).toBe(true);
    sim.tick();

    // Stamina is boosted 40% (staPct); Strength is unchanged by the mastery.
    expect(sim.player.stats.str).toBe(str);
    expect(sim.player.stats.sta).toBe(Math.round(baseSta * 1.4));
    // Armor: 70% of Strength is added, then the mastery's +10% armor multiplies.
    expect(sim.player.stats.armor).toBe(Math.round((baseArmor + Math.round(str * 0.7)) * 1.1));
    // More Stamina means a bigger health pool.
    expect(sim.player.maxHp).toBeGreaterThan(baseHp);
  });

  it('does not touch a non-Protection warrior (Arms keeps base survivability)', () => {
    const sim = makeWarrior();
    const baseSta = sim.player.stats.sta;
    const baseArmor = sim.player.stats.armor;
    expect(sim.setSpec('arms')).toBe(true);
    sim.tick();
    // Arms' mastery is offensive; no Vanguard stamina/armor bump.
    expect(sim.player.stats.sta).toBe(baseSta);
    expect(sim.player.stats.armor).toBe(baseArmor);
  });
});
