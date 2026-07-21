import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Aura } from '../src/sim/types';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

function critVulnAura(value: number, remaining = 8): Aura {
  return {
    id: 'critvuln_test', name: 'Exposed Wound', kind: 'critvuln',
    remaining, duration: 8, value, sourceId: -1, school: 'physical',
  };
}

describe('Find Weakness crit-vulnerability debuff', () => {
  it('critVulnBonus reports the largest active critvuln aura', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    expect((sim as any).critVulnBonus(p)).toBe(0);
    p.auras.push({ ...critVulnAura(0.3), id: 'a', sourceId: 1 });
    p.auras.push({ ...critVulnAura(0.5), id: 'b', sourceId: 2 });
    expect((sim as any).critVulnBonus(p)).toBe(0.5);
  });

  it('amplifies CRITICAL hits by the debuff fraction but leaves normal hits alone', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const mob = createMob(910000, MOBS.mire_widow, 10, { x: 0, y: 0, z: 0 });

    // normal hit — no amplification even with the debuff up
    p.auras.length = 0;
    p.auras.push(critVulnAura(0.5));
    p.hp = 100000;
    (sim as any).dealDamage(mob, p, 100, false, 'physical', null, 'hit');
    expect(100000 - p.hp).toBe(100);

    // critical hit — amplified by +50%
    p.auras.length = 0;
    p.auras.push(critVulnAura(0.5));
    p.hp = 100000;
    (sim as any).dealDamage(mob, p, 100, true, 'physical', null, 'hit');
    expect(100000 - p.hp).toBe(150);

    // critical hit without the debuff — unmodified
    p.auras.length = 0;
    p.hp = 100000;
    (sim as any).dealDamage(mob, p, 100, true, 'physical', null, 'hit');
    expect(100000 - p.hp).toBe(100);
  });

  it('amplifies crits of any school (not just physical)', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const mob = createMob(910001, MOBS.mire_widow, 10, { x: 0, y: 0, z: 0 });
    p.auras.push(critVulnAura(0.5));
    (sim as any).dealDamage(mob, p, 100, true, 'shadow', null, 'hit');
    expect(100000 - p.hp).toBe(150);
  });

  it('a self-inflicted crit is never amplified', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    p.auras.push(critVulnAura(0.5));
    (sim as any).dealDamage(p, p, 100, true, 'physical', null, 'hit');
    expect(100000 - p.hp).toBe(100);
  });

  it('a landed Mirefen Widow swing can inflict the Exposed Wound', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000; // survive every swing so we observe the debuff
    const tmpl = MOBS.mire_widow;
    const saved = tmpl.critVuln!.chance;
    tmpl.critVuln!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(910002, tmpl, 10, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'critvuln');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'critvuln')!;
      expect(a.name).toBe('Exposed Wound');
      expect(a.value).toBe(0.5);
    } finally {
      tmpl.critVuln!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never inflicts the debuff', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const tmpl = MOBS.mire_widow;
    const saved = tmpl.critVuln!.chance;
    tmpl.critVuln!.chance = 1;
    try {
      const pet = createMob(910003, tmpl, 10, { x: 0, y: 0, z: 0 });
      pet.hostile = false;
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(p.auras.some((a) => a.kind === 'critvuln')).toBe(false);
    } finally {
      tmpl.critVuln!.chance = saved;
    }
  });

  it('a mob without critVuln applies no debuff', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const mob = createMob(910004, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'critvuln')).toBe(false);
  });
});
