import { describe, expect, it } from 'vitest';
import { ABILITIES, abilitiesKnownAt } from '../src/sim/content/classes';
import { Sim } from '../src/sim/sim';

describe('Valor Roar', () => {
  it('keeps the stable rallying_cry id for the winning Warrior party cooldown', () => {
    const def = ABILITIES.rallying_cry;
    expect(def).toBeTruthy();
    expect(def.id).toBe('rallying_cry');
    expect(def.name).toBe('Valor Roar');
    expect(def.class).toBe('warrior');
    expect(def.learnLevel).toBe(18);
    expect(def.school).toBe('physical');
    expect(def.requiresTarget).toBe(false);
    expect(def.castTime).toBe(0);
    expect(def.effects).toEqual([{ type: 'aoeAllyMaxHp', pct: 0.2, duration: 10, radius: 40 }]);
  });

  it('is unknown at level 17 and known from level 18 in the warrior kit', () => {
    const before = abilitiesKnownAt('warrior', 17).map((k) => k.def.id);
    const after = abilitiesKnownAt('warrior', 18).map((k) => k.def.id);
    expect(before).not.toContain('rallying_cry');
    expect(after).toContain('rallying_cry');
  });

  it('raises maximum health by 20% for 10 seconds when cast', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(18);
    const p = sim.player;
    const maxHpBefore = p.maxHp;
    sim.castAbility('rallying_cry');
    sim.tick();
    const buff = p.auras.find((a) => a.id === 'rallying_cry_hp');
    expect(buff).toBeTruthy();
    expect(buff).toMatchObject({ kind: 'buff_maxhp_pct', value: 0.2, remaining: 9.95 });
    expect(p.maxHp).toBe(Math.round(maxHpBefore * 1.2));
  });

  it('refreshes one shared health and Protection reduction buff across Warriors', () => {
    const sim = new Sim({ seed: 43, playerClass: 'warrior', noPlayer: true });
    const first = sim.addPlayer('warrior', 'First');
    const second = sim.addPlayer('warrior', 'Second');
    for (const pid of [first, second]) {
      sim.setPlayerLevel(20, pid);
      expect(sim.setSpec('prot', pid)).toBe(true);
    }
    sim.partyInvite(second, first);
    sim.partyAccept(second);
    const recipient = sim.entities.get(first);
    if (!recipient) throw new Error('missing Valor Roar recipient');

    sim.castAbility('rallying_cry', first);
    for (const id of ['rallying_cry_hp', 'rallying_cry_dr']) {
      const aura = recipient.auras.find((candidate) => candidate.id === id);
      expect(aura).toBeTruthy();
      if (aura) aura.remaining = 2;
    }
    sim.castAbility('rallying_cry', second);

    for (const id of ['rallying_cry_hp', 'rallying_cry_dr']) {
      expect(recipient.auras.filter((aura) => aura.id === id)).toEqual([
        expect.objectContaining({ sourceId: second, remaining: 10, duration: 10 }),
      ]);
    }
  });
});
