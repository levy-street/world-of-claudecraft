import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass } from '../src/sim/types';

// Parry (owner 2026-07-08): a FRONT-ONLY chance to fully avoid a melee attack, like
// dodge but strength-driven and only for weapon classes. A blow from behind can
// never be parried.

const PARRY_CLASSES: PlayerClass[] = ['warrior', 'paladin', 'rogue', 'hunter', 'shaman', 'druid'];
const CASTER_CLASSES: PlayerClass[] = ['mage', 'priest', 'warlock'];

const makeSim = (cls: PlayerClass): Sim => {
  const sim = new Sim({ seed: 1, playerClass: cls, autoEquip: true });
  sim.setPlayerLevel(20);
  return sim;
};

const nearestMob = (sim: Sim): Entity => {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead) continue;
    const d = (e.pos.x - sim.player.pos.x) ** 2 + (e.pos.z - sim.player.pos.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error('no mob');
  return best;
};

describe('Parry: who gets a parry chance', () => {
  it('every weapon class has a parry chance; pure casters have none', () => {
    for (const cls of PARRY_CLASSES) {
      expect(makeSim(cls).player.parryChance, cls).toBeGreaterThan(0);
    }
    for (const cls of CASTER_CLASSES) {
      expect(makeSim(cls).player.parryChance, cls).toBe(0);
    }
  });
});

describe('Parry: front-only in the hit table', () => {
  const sawParry = (sim: Sim, mob: Entity): boolean => {
    let saw = false;
    for (let i = 0; i < 60; i++) {
      sim.drainEvents();
      (sim as unknown as { mobSwing(m: Entity, t: Entity): void }).mobSwing(mob, sim.player);
      if (sim.drainEvents().some((e) => e.type === 'damage' && e.kind === 'parry')) saw = true;
    }
    return saw;
  };

  it('a parry class facing the attacker parries; from behind it cannot', () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    // Guarantee a parry whenever eligible, and remove dodge so it cannot mask the result.
    p.parryChance = 1;
    p.dodgeChance = 0;
    const mob = nearestMob(sim);

    // Facing the mob: parry is eligible.
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    expect(sawParry(sim, mob)).toBe(true);

    // Facing directly away (mob behind): parry is disabled.
    p.facing = Math.atan2(p.pos.x - mob.pos.x, p.pos.z - mob.pos.z);
    expect(sawParry(sim, mob)).toBe(false);
  });
});
