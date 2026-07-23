import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';

function shaman(level: number) {
  const sim = new Sim({ seed: 42, playerClass: 'shaman', noPlayer: true });
  const pid = sim.addPlayer('shaman', 'Thrall');
  sim.tick();
  sim.setPlayerLevel(level, pid);
  const p = sim.entities.get(pid)!;
  p.gm = true;
  return { sim, pid, p };
}

describe('Frostbrand Weapon (shaman frost imbue)', () => {
  it('is a pure-data frost imbue defined on the shaman kit', () => {
    const def = ABILITIES.frostbrand_weapon;
    expect(def).toBeDefined();
    expect(def.class).toBe('shaman');
    expect(def.school).toBe('frost');
    expect(def.learnLevel).toBe(5);
    expect(def.requiresTarget).toBe(false);
    expect(def.effects).toEqual([{ type: 'imbue', bonus: 8, duration: 300 }]);
    // Rank 2 at level 20 raises the per-swing bonus to 13.
    expect(def.ranks?.[0]).toMatchObject({ rank: 2, level: 20 });
  });

  it('is gated by learn level and ranks up at 20', () => {
    expect(abilitiesKnownAt('shaman', 4).some((k) => k.def.id === 'frostbrand_weapon')).toBe(false);
    const at5 = abilitiesKnownAt('shaman', 5).find((k) => k.def.id === 'frostbrand_weapon');
    expect(at5?.rank).toBe(1);
    const at20 = abilitiesKnownAt('shaman', 20).find((k) => k.def.id === 'frostbrand_weapon');
    expect(at20?.rank).toBe(2);
  });

  it('casting applies an imbue aura that adds flat damage per swing', () => {
    const { sim, pid, p } = shaman(12);
    sim.castAbility('frostbrand_weapon', pid);
    sim.tick();
    const aura = p.auras.find((a) => a.id === 'frostbrand_weapon');
    expect(aura?.kind).toBe('imbue');
    expect(aura?.value).toBe(8);
  });

  it('rank 2 imbues a larger per-swing bonus', () => {
    const { sim, pid, p } = shaman(20);
    sim.castAbility('frostbrand_weapon', pid);
    sim.tick();
    const aura = p.auras.find((a) => a.id === 'frostbrand_weapon');
    expect(aura?.value).toBe(13);
  });
});
