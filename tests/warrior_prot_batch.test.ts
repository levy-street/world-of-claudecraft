import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';

// Warrior review batch (owner 2026-07-08): Protection's Shieldcrack becomes the
// active rage BUILDER, Rallying Cry gains a Protection-only ally damage cut,
// Intimidating Shout is free in every spec, and Fury's Early Grave is a rage
// builder (no cost, +20 rage) rather than a spender.

const mods = (spec: string | null) =>
  computeTalentModifiers('warrior', { ...emptyAllocation(), spec: spec ?? null });
const resolved = (id: string, spec: string | null, level = 20) =>
  abilitiesKnownAt('warrior', level, mods(spec)).find((k) => k.def.id === id);

describe("Shieldcrack (shield_slam) is Protection's rage builder", () => {
  it('resolves to no cost and a 15-rage gainResource for committed prot', () => {
    const k = resolved('shield_slam', 'prot');
    expect(k).toBeTruthy();
    expect(k!.cost).toBe(0);
    expect(k!.effects).toContainEqual({ type: 'gainResource', amount: 15 });
    // Still a weapon strike with its tank threat, not a pure resource ability.
    expect(k!.effects.some((e) => e.type === 'weaponStrike')).toBe(true);
    expect(k!.threatFlat).toBe(110);
  });
});

describe('Early Grave (execute) is a rage builder for Fury only', () => {
  it('committed fury: no cost and mints 20 rage', () => {
    const k = resolved('execute', 'fury');
    expect(k).toBeTruthy();
    expect(k!.cost).toBe(0);
    expect(k!.effects).toContainEqual({ type: 'gainResource', amount: 20 });
  });

  it('arms, prot and no-spec: keep the 15-rage finisher cost and mint no rage', () => {
    for (const spec of ['arms', 'prot', null]) {
      const k = resolved('execute', spec);
      expect(k, `${spec}`).toBeTruthy();
      expect(k!.cost, `${spec} cost`).toBe(15);
      expect(
        k!.effects.some((e) => e.type === 'gainResource'),
        `${spec} gainResource`,
      ).toBe(false);
    }
  });
});

describe('Intimidating Shout is free in every spec', () => {
  it('resolves to cost 0 for no-spec, arms, fury and prot', () => {
    for (const spec of [null, 'arms', 'fury', 'prot']) {
      expect(resolved('intimidating_shout', spec)?.cost, `${spec}`).toBe(0);
    }
  });
});

describe('Rallying Cry: Protection adds a 5% ally damage-taken cut', () => {
  const makeWarrior = (spec: string): Sim => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    expect(sim.setSpec(spec)).toBe(true);
    sim.player.resource = 100;
    return sim;
  };

  it('prot grants BOTH the max-health buff AND a buff_dr(0.05) aura', () => {
    const sim = makeWarrior('prot');
    sim.castAbility('rallying_cry');
    sim.tick();
    const dr = sim.player.auras.find((a) => a.id === 'rallying_cry_dr');
    expect(dr?.kind).toBe('buff_dr');
    expect(dr?.value).toBe(0.05);
    expect(sim.player.auras.some((a) => a.id === 'rallying_cry_hp')).toBe(true);
  });

  it('arms and fury grant only the max-health buff, never the damage cut', () => {
    for (const spec of ['arms', 'fury']) {
      const sim = makeWarrior(spec);
      sim.castAbility('rallying_cry');
      sim.tick();
      expect(
        sim.player.auras.some((a) => a.id === 'rallying_cry_hp'),
        spec,
      ).toBe(true);
      expect(
        sim.player.auras.some((a) => a.id === 'rallying_cry_dr'),
        spec,
      ).toBe(false);
    }
  });
});
