import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';

describe('Aspect of the Monkey', () => {
  it('is a hunter nature self-buff learned at level 5', () => {
    const def = ABILITIES['aspect_of_the_monkey'];
    expect(def).toBeTruthy();
    expect(def.class).toBe('hunter');
    expect(def.learnLevel).toBe(5);
    expect(def.school).toBe('nature');
    expect(def.requiresTarget).toBe(false);
    expect(def.effects).toEqual([
      { type: 'selfBuff', kind: 'buff_dodge', value: 0.08, duration: 1800 },
    ]);
  });

  it('is unknown at level 4 and known from level 5 in the hunter kit', () => {
    const at4 = abilitiesKnownAt('hunter', 4).map((k) => k.def.id);
    const at5 = abilitiesKnownAt('hunter', 5).map((k) => k.def.id);
    expect(at4).not.toContain('aspect_of_the_monkey');
    expect(at5).toContain('aspect_of_the_monkey');
  });

  it('raises the hunter dodge chance by 8% when cast', () => {
    const sim = new Sim({ seed: 42, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(10);
    const p = sim.player;
    const dodgeBefore = p.dodgeChance;
    sim.castAbility('aspect_of_the_monkey');
    sim.tick();
    const buff = p.auras.find((a) => a.id === 'aspect_of_the_monkey');
    expect(buff).toBeTruthy();
    expect(buff!.kind).toBe('buff_dodge');
    expect(p.dodgeChance).toBeCloseTo(dodgeBefore + 0.08, 5);
  });
});
