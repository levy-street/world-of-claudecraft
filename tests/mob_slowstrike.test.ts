import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

describe('Mire Prowler "Miring Pounce" attack-speed slow', () => {
  it('swingIntervalMult lengthens the swing while the slow aura is active', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    const base = (sim as any).swingIntervalMult(p);
    expect(base).toBeCloseTo(1, 6);
    p.auras.push({
      id: 'slowstrike_mire_prowler', name: 'Miring Pounce', kind: 'attackspeed',
      remaining: 8, duration: 8, value: 1.3, sourceId: -1, school: 'physical',
    });
    // value > 1 multiplies the interval → slower swings.
    expect((sim as any).swingIntervalMult(p)).toBeCloseTo(1.3, 6);
  });

  it('a landed Mire Prowler swing can inflict the attack-speed slow', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000; // survive every swing so we observe the debuff
    const tmpl = MOBS.mire_prowler;
    const saved = tmpl.slowStrike!.chance;
    tmpl.slowStrike!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(900600, tmpl, 8, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'attackspeed');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'attackspeed')!;
      expect(a.name).toBe('Miring Pounce');
      expect(a.value).toBe(1.3);
      expect(a.duration).toBe(8);
    } finally {
      tmpl.slowStrike!.chance = saved;
    }
  });

  it('refreshes in place and never stacks a second aura', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const tmpl = MOBS.mire_prowler;
    const saved = tmpl.slowStrike!.chance;
    tmpl.slowStrike!.chance = 1;
    try {
      const mob = createMob(900601, tmpl, 8, { x: 0, y: 0, z: 0 });
      for (let i = 0; i < 120; i++) { p.hp = p.maxHp; (sim as any).mobSwing(mob, p); }
      expect(p.auras.filter((a) => a.kind === 'attackspeed').length).toBe(1);
    } finally {
      tmpl.slowStrike!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never inflicts the slow', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const tmpl = MOBS.mire_prowler;
    const saved = tmpl.slowStrike!.chance;
    tmpl.slowStrike!.chance = 1;
    try {
      const pet = createMob(900602, tmpl, 8, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(p.auras.some((a) => a.kind === 'attackspeed')).toBe(false);
    } finally {
      tmpl.slowStrike!.chance = saved;
    }
  });

  it('a mob without slowStrike applies no attack-speed debuff', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000; p.hp = 100000;
    const mob = createMob(900603, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'attackspeed')).toBe(false);
  });
});
