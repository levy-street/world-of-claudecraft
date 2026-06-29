import { describe, expect, it } from 'vitest';
import { isStunned } from '../src/sim/combat/cc';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

describe('Skullthump on-hit stun affix', () => {
  it('the Mogger Lackey carries stunOnHit data tuned to a brief physical stun', () => {
    const s = MOBS.mogger_lackey.stunOnHit!;
    expect(s).toBeDefined();
    expect(s.school).toBe('physical');
    expect(s.chance).toBeGreaterThan(0);
    expect(s.chance).toBeLessThanOrEqual(0.2); // gentle: lackeys can spawn in pairs
    expect(s.duration).toBeGreaterThan(0);
    expect(s.duration).toBeLessThanOrEqual(2);
  });

  it('a landed mogger_lackey swing can stun the player', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    p.maxHp = 100000;
    p.hp = 100000; // survive every swing so we observe the stun
    const tmpl = MOBS.mogger_lackey;
    const saved = tmpl.stunOnHit!.chance;
    tmpl.stunOnHit!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(900700, tmpl, 6, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'stun');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'stun')!;
      expect(a.name).toBe('Skullthump');
      expect(a.id).toBe('stun_mogger_lackey');
      expect(isStunned(p)).toBe(true);
    } finally {
      tmpl.stunOnHit!.chance = saved;
    }
  });

  it('the stun refreshes (does not infinitely stack) on repeated blows', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    p.maxHp = 100000;
    p.hp = 100000;
    const tmpl = MOBS.mogger_lackey;
    const saved = tmpl.stunOnHit!.chance;
    tmpl.stunOnHit!.chance = 1;
    try {
      const mob = createMob(900701, tmpl, 6, { x: 0, y: 0, z: 0 });
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(mob, p);
      expect(p.auras.filter((a) => a.id === 'stun_mogger_lackey').length).toBe(1);
    } finally {
      tmpl.stunOnHit!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never stuns its target', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    p.maxHp = 100000;
    p.hp = 100000;
    const tmpl = MOBS.mogger_lackey;
    const saved = tmpl.stunOnHit!.chance;
    tmpl.stunOnHit!.chance = 1;
    try {
      const pet = createMob(900702, tmpl, 6, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(p.auras.some((a) => a.kind === 'stun')).toBe(false);
    } finally {
      tmpl.stunOnHit!.chance = saved;
    }
  });

  it('a mob without stunOnHit applies no stun', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.gm = true;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = createMob(900703, MOBS.forest_wolf, 6, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'stun')).toBe(false);
  });
});
