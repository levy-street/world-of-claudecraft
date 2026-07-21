import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { Aura } from '../src/sim/types';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

function exposeAura(value: number, remaining = 8): Aura {
  return {
    id: 'expose_test', name: 'Cracked Guard', kind: 'expose',
    remaining, duration: 8, value, sourceId: -1, school: 'physical',
  };
}

describe('Expose physical-vulnerability debuff', () => {
  it('amplifies physical damage taken by the debuff fraction', () => {
    const sim = makeSim();
    const src = createMob(900600, MOBS.varkas_boneguard, 18, { x: 0, y: 0, z: 0 });

    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 1_000_000; p.hp = 1_000_000;
    (sim as any).dealDamage(src, p, 100, false, 'physical', null, 'hit');
    const baseline = 1_000_000 - p.hp;
    expect(baseline).toBe(100);

    p.auras.length = 0;
    p.hp = 1_000_000;
    p.auras.push(exposeAura(0.18));
    (sim as any).dealDamage(src, p, 100, false, 'physical', null, 'hit');
    const amplified = 1_000_000 - p.hp;
    expect(amplified).toBe(118);
  });

  it('only amplifies physical damage, not spell schools', () => {
    const sim = makeSim();
    const src = createMob(900601, MOBS.varkas_boneguard, 18, { x: 0, y: 0, z: 0 });
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 1_000_000; p.hp = 1_000_000;
    p.auras.push(exposeAura(0.18));
    (sim as any).dealDamage(src, p, 100, false, 'shadow', null, 'hit');
    expect(1_000_000 - p.hp).toBe(100);
  });

  it('stacks additively across multiple Expose auras', () => {
    const sim = makeSim();
    const src = createMob(900602, MOBS.varkas_boneguard, 18, { x: 0, y: 0, z: 0 });
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 1_000_000; p.hp = 1_000_000;
    p.auras.push({ ...exposeAura(0.18), id: 'a', sourceId: 1 });
    p.auras.push({ ...exposeAura(0.18), id: 'b', sourceId: 2 });
    (sim as any).dealDamage(src, p, 100, false, 'physical', null, 'hit');
    // 1 + 0.18 + 0.18 = 1.36
    expect(1_000_000 - p.hp).toBe(136);
  });

  it('a landed Varkas Boneguard swing can inflict Cracked Guard', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 1_000_000; p.hp = 1_000_000; // survive every swing so we observe the debuff
    const tmpl = MOBS.varkas_boneguard;
    const saved = tmpl.expose!.chance;
    tmpl.expose!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(900610, tmpl, 18, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'expose');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'expose')!;
      expect(a.name).toBe('Cracked Guard');
      expect(a.value).toBe(0.18);
    } finally {
      tmpl.expose!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never inflicts Expose', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 1_000_000; p.hp = 1_000_000;
    const tmpl = MOBS.varkas_boneguard;
    const saved = tmpl.expose!.chance;
    tmpl.expose!.chance = 1;
    try {
      const pet = createMob(900611, tmpl, 18, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(p.auras.some((a) => a.kind === 'expose')).toBe(false);
    } finally {
      tmpl.expose!.chance = saved;
    }
  });

  it('a mob without the expose affix applies no debuff', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 1_000_000; p.hp = 1_000_000;
    const mob = createMob(900612, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'expose')).toBe(false);
  });
});
