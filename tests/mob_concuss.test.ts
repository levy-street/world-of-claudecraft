import { describe, expect, it } from 'vitest';
import { isStunned } from '../src/sim/combat/cc';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

describe('Concussive Blow stun-on-hit affix', () => {
  it('a landed thornpeak_ogre swing can stun the victim', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000; // survive every swing so we observe the stun
    const tmpl = MOBS.thornpeak_ogre;
    const saved = tmpl.concuss!.chance;
    tmpl.concuss!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(900600, tmpl, 16, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        p.auras.length = 0; // a fresh swing each loop; isolate the stun aura
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'stun');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'stun')!;
      expect(a.name).toBe('Concussive Blow');
      expect(a.duration).toBe(2);
      expect(isStunned(p)).toBe(true);
    } finally {
      tmpl.concuss!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never stuns', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const tmpl = MOBS.thornpeak_ogre;
    const saved = tmpl.concuss!.chance;
    tmpl.concuss!.chance = 1;
    try {
      const pet = createMob(900601, tmpl, 16, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 60; i++) {
        p.hp = p.maxHp;
        (sim as any).mobSwing(pet, p);
      }
      expect(p.auras.some((a) => a.kind === 'stun')).toBe(false);
    } finally {
      tmpl.concuss!.chance = saved;
    }
  });

  it('a mob without the concuss affix applies no stun', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = createMob(900602, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'stun')).toBe(false);
  });

  it('the refreshing stun never stacks into multiple auras', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const tmpl = MOBS.thornpeak_ogre;
    const saved = tmpl.concuss!.chance;
    tmpl.concuss!.chance = 1;
    try {
      const mob = createMob(900603, tmpl, 16, { x: 0, y: 0, z: 0 });
      for (let i = 0; i < 30; i++) {
        p.hp = p.maxHp; // a fatal swing would clear auras; keep the victim alive
        (sim as any).mobSwing(mob, p);
      }
      expect(p.auras.filter((a) => a.kind === 'stun').length).toBeLessThanOrEqual(1);
    } finally {
      tmpl.concuss!.chance = saved;
    }
  });
});
