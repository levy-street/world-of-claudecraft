// The Gravecaller Mender's "Draining Litany" is a cost-tax curse: a landed hit
// can leave the victim's abilities more expensive (mana/rage/energy alike) for a
// few seconds. Unlike a silence (full lockout) or a stat drain, it inflates the
// resolved resource cost — resolved at the single resolvedAbility() choke point,
// so the affordability check and the actual spend always agree.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'mage') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Gravecaller Mender adjacent to the player, engaged and ready to swing.
function spawnMender(sim: Sim, target: Entity): Entity {
  const template = MOBS['gravecaller_mender'];
  const mob = createMob((sim as any).nextId++, template, 12, { x: target.pos.x, y: target.pos.y, z: target.pos.z });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (the cost-tax chance is rolled per landed hit).
function swing(sim: Sim, mob: Entity, target: Entity) {
  // Force the swing to land regardless of world-gen RNG state. mobSwing's first
  // rng.next() is the miss/dodge roll; return a high value for just that call so
  // the hit always connects, then restore the real RNG for damage/crit rolls.
  const rng = (sim as any).rng;
  const realNext = rng.next.bind(rng);
  let firstRoll = true;
  rng.next = () => { if (firstRoll) { firstRoll = false; return 0.999; } return realNext(); };
  try {
    (sim as any).mobSwing(mob, target);
  } finally {
    rng.next = realNext;
  }
}

const taxAura = (sourceId: number, pct = 0.4) => ({
  id: 'cost_tax_gravecaller_mender', name: 'Draining Litany', kind: 'cost_tax' as const,
  remaining: 8, duration: 8, value: pct, sourceId, school: 'shadow' as const,
});

describe('mob cost-tax ("Draining Litany")', () => {
  it('seeds the cost-tax mechanic on the Gravecaller Mender', () => {
    expect(MOBS['gravecaller_mender'].costTax).toEqual({
      chance: 0.3, pct: 0.4, duration: 8, name: 'Draining Litany', school: 'shadow',
    });
  });

  it('applies a cost_tax aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const mob = spawnMender(sim, p);
    MOBS['gravecaller_mender'].costTax!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['gravecaller_mender'].costTax!.chance = 0.3;
    const aura = p.auras.find((a) => a.kind === 'cost_tax');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Draining Litany');
    expect(aura!.remaining).toBe(8);
    expect(aura!.value).toBe(0.4);
  });

  it('inflates the resolved resource cost of an ability while taxed', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    const base = sim.resolvedAbility('fireball', p.id)!.cost;
    expect(base).toBeGreaterThan(0);
    p.auras.push(taxAura(999));
    expect(sim.resolvedAbility('fireball', p.id)!.cost).toBe(Math.ceil(base * 1.4));
  });

  it('takes the strongest tax when more than one is active and leaves cost intact with none', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    const base = sim.resolvedAbility('fireball', p.id)!.cost;
    expect(sim.resolvedAbility('fireball', p.id)!.cost).toBe(base); // no aura → untouched
    p.auras.push(taxAura(999, 0.2));
    p.auras.push(taxAura(998, 0.5));
    expect(sim.resolvedAbility('fireball', p.id)!.cost).toBe(Math.ceil(base * 1.5));
  });

  it('a friendly pet swing never taxes its target', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const pet = spawnMender(sim, p);
    pet.hostile = false; // a tamed/friendly mender shape
    pet.ownerId = p.id;
    MOBS['gravecaller_mender'].costTax!.chance = 1;
    swing(sim, pet, p);
    MOBS['gravecaller_mender'].costTax!.chance = 0.3;
    expect(p.auras.some((a) => a.kind === 'cost_tax')).toBe(false);
  });
});
