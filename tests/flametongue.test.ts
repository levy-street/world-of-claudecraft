import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt, CLASSES } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { Sim } from '../src/sim/sim';

function shaman(level: number) {
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('shaman', 'Thrall');
  sim.setPlayerLevel(level, pid);
  if (level >= 5 && !sim.setSpec('elemental', pid)) throw new Error('no elemental spec');
  sim.tick();
  return { sim, pid };
}

describe('Flametongue Weapon (shaman fire imbue)', () => {
  it('is defined as a pure-data imbue ability in the shaman kit', () => {
    const def = ABILITIES.flametongue_weapon;
    expect(def).toBeDefined();
    expect(def.class).toBe('shaman');
    expect(def.learnLevel).toBe(5);
    expect(def.school).toBe('fire');
    expect(def.effects).toEqual([{ type: 'imbue', bonus: 8, duration: 1800 }]);
    // ranks up to +13 at level 18
    expect(def.ranks?.[0]).toMatchObject({ rank: 2, level: 18 });
    // listed in the class learn order
    expect(CLASSES.shaman.abilities).toContain('flametongue_weapon');
  });

  it('is not known before level 5 but is at level 5 (rank 1) and 18 (rank 2)', () => {
    expect(abilitiesKnownAt('shaman', 4).some((k) => k.def.id === 'flametongue_weapon')).toBe(
      false,
    );
    const elemental5 = computeTalentModifiers('shaman', { spec: 'elemental', rows: {} }, 5);
    const at5 = abilitiesKnownAt('shaman', 5, elemental5).find(
      (k) => k.def.id === 'flametongue_weapon',
    );
    expect(at5?.rank).toBe(1);
    const elemental18 = computeTalentModifiers('shaman', { spec: 'elemental', rows: {} }, 18);
    const at18 = abilitiesKnownAt('shaman', 18, elemental18).find(
      (k) => k.def.id === 'flametongue_weapon',
    );
    expect(at18?.rank).toBe(2);
  });

  it('casting it imbues the weapon with a flat per-swing bonus', () => {
    const { sim, pid } = shaman(10);
    const p = sim.entities.get(pid);
    if (!p) throw new Error('no shaman');
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false);
    sim.castAbility('flametongue_weapon', pid);
    sim.tick();
    const imbue = p.auras.find((a) => a.kind === 'imbue' && a.id === 'flametongue_weapon');
    expect(imbue).toBeDefined();
    expect(imbue?.value).toBe(9); // Elemental mastery scales the rank-1 imbue.
    // a pure damage weapon imbue
    expect(imbue?.value2).toBeUndefined();
  });

  it('grants the higher rank-2 bonus at level 18', () => {
    const { sim, pid } = shaman(18);
    sim.castAbility('flametongue_weapon', pid);
    sim.tick();
    const imbue = sim.entities
      .get(pid)
      ?.auras.find((a) => a.kind === 'imbue' && a.id === 'flametongue_weapon');
    expect(imbue?.value).toBe(15); // Elemental mastery scales the rank-2 imbue.
  });
});
