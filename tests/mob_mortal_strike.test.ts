import { describe, expect, it } from 'vitest';
import { updateAuras } from '../src/sim/combat/auras';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { type Aura, Entity } from '../src/sim/types';

const SEED = 5150;
const makeSim = () => new Sim({ seed: SEED, playerClass: 'warrior' });

function woundAura(value: number, remaining = 6): Aura {
  return {
    id: 'mortal_wound_test',
    name: 'Mortal Strike',
    kind: 'mortal_wound',
    remaining,
    duration: 6,
    value,
    sourceId: -1,
    school: 'physical',
  };
}

// A heal-over-time aura primed to tick on the next updateAuras call. The HoT path
// has no crit roll, so it isolates the healing-reduction math deterministically.
function primedHot(value: number): Aura {
  return {
    id: 'hot_test',
    name: 'Renew',
    kind: 'hot',
    remaining: 10,
    duration: 10,
    value,
    tickInterval: 1,
    tickTimer: 0.01,
    sourceId: -1,
    school: 'holy',
  };
}

describe('Mortal Strike healing-reduction debuff', () => {
  it('reduces incoming healing by the debuff fraction', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;

    p.hp = 1000;
    p.auras.push(primedHot(100));
    updateAuras((sim as any).ctx, p);
    const baseline = p.hp - 1000;
    expect(baseline).toBe(100);

    const p2 = sim.entities.get(sim.playerId)!;
    p2.auras.length = 0;
    p2.hp = 1000;
    p2.auras.push(woundAura(0.5));
    p2.auras.push(primedHot(100));
    updateAuras((sim as any).ctx, p2);
    const reduced = p2.hp - 1000;
    expect(reduced).toBe(50);
  });

  it('fully suppresses healing at 100% reduction and never goes negative', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 1000;
    p.auras.push(woundAura(1));
    p.auras.push(primedHot(200));
    updateAuras((sim as any).ctx, p);
    expect(p.hp).toBe(1000);
  });

  it('stacks multiplicatively across multiple Mortal Wound auras', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.auras.push({ ...woundAura(0.5), id: 'a', sourceId: 1 });
    p.auras.push({ ...woundAura(0.5), id: 'b', sourceId: 2 });
    expect((sim as any).healingTakenMult(p)).toBeCloseTo(0.25, 6);
  });

  it('does not affect healing once the debuff expires via updateAuras', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.auras.push(woundAura(0.5, 0.05)); // one tick of life
    updateAuras((sim as any).ctx, p); // remaining -> 0 -> spliced
    expect(p.auras.some((a) => a.kind === 'mortal_wound')).toBe(false);
    p.hp = 1000;
    p.auras.push(primedHot(100));
    updateAuras((sim as any).ctx, p);
    expect(p.hp - 1000).toBe(100);
  });

  it('a landed bastion_revenant swing can inflict the Mortal Wound', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000; // survive every swing so we observe the debuff
    const tmpl = MOBS.bastion_revenant;
    const saved = tmpl.mortalStrike!.chance;
    tmpl.mortalStrike!.chance = 1; // force the proc; misses/dodges still possible
    try {
      const mob = createMob(900500, tmpl, 13, { x: 0, y: 0, z: 0 });
      let applied = false;
      for (let i = 0; i < 60 && !applied; i++) {
        (sim as any).mobSwing(mob, p);
        applied = p.auras.some((a) => a.kind === 'mortal_wound');
      }
      expect(applied).toBe(true);
      const a = p.auras.find((x) => x.kind === 'mortal_wound')!;
      expect(a.name).toBe('Mortal Strike');
      expect(a.value).toBe(0.5);
    } finally {
      tmpl.mortalStrike!.chance = saved;
    }
  });

  it('a friendly pet swing (hostile=false) never inflicts Mortal Wound', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const tmpl = MOBS.bastion_revenant;
    const saved = tmpl.mortalStrike!.chance;
    tmpl.mortalStrike!.chance = 1;
    try {
      const pet = createMob(900501, tmpl, 13, { x: 0, y: 0, z: 0 });
      pet.hostile = false; // pets call mobSwing too
      for (let i = 0; i < 60; i++) (sim as any).mobSwing(pet, p);
      expect(p.auras.some((a) => a.kind === 'mortal_wound')).toBe(false);
    } finally {
      tmpl.mortalStrike!.chance = saved;
    }
  });

  it('a mob without mortalStrike applies no debuff', () => {
    const sim = makeSim();
    const p = sim.entities.get(sim.playerId)!;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = createMob(900502, MOBS.forest_wolf, 5, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 40; i++) (sim as any).mobSwing(mob, p);
    expect(p.auras.some((a) => a.kind === 'mortal_wound')).toBe(false);
  });
});
