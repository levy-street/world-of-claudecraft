import { describe, expect, it } from 'vitest';
import { isRooted } from '../src/sim/combat/cc';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

describe('Ensnare web-root affix', () => {
  it('a landed webwood_spider swing can root the player in place', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000; // survive every swing so we observe the root
    const tmpl = MOBS.webwood_spider;
    const saved = tmpl.ensnare!.chance;
    tmpl.ensnare!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(900600, tmpl, 5, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'root');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'root')!;
      expect(a.name).toBe('Sticky Web');
      expect(isRooted(p)).toBe(true);
    } finally {
      tmpl.ensnare!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never roots its target', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const tmpl = MOBS.webwood_spider;
    const saved = tmpl.ensnare!.chance;
    tmpl.ensnare!.chance = 1;
    try {
      const pet = createMob(900601, tmpl, 5, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(p.auras.some((a) => a.kind === 'root')).toBe(false);
    } finally {
      tmpl.ensnare!.chance = saved;
    }
  });

  it('a mob without ensnare applies no root', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = createMob(900602, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'root')).toBe(false);
  });
});
