// Restored from the pre-revert payload (f274835b1^) and adapted to the current
// derived-parry model: parry is WARRIOR-ONLY now (warriorMeleeDefense /
// warriorParryChance in src/sim/combat/warrior_hit_table.ts), Strength-scaled,
// front-arc gated, and folded into the existing one-roll hit tables. There is
// no entity.parryChance field anymore; the payload's every-weapon-class parry
// expectation is intentionally superseded by the warrior-only redesign.
import { describe, expect, it } from 'vitest';
import { warriorMeleeDefense, warriorParryChance } from '../src/sim/combat/warrior_hit_table';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';
import { swingMissChance } from '../src/sim/types';

type AnySim = Sim & {
  nextId: number;
  addEntity(entity: Entity): void;
  mobSwing(mob: Entity, target: Entity): void;
};

function makeSim(cls: PlayerClass): AnySim {
  return new Sim({ seed: 1, playerClass: cls, autoEquip: true }) as AnySim;
}

// A hostile wolf 2 yd in FRONT of the player (+z), idle so nothing else acts.
function spawnMobInFront(sim: AnySim): Entity {
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, 1, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 2,
  });
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return mob;
}

function damageKinds(events: SimEvent[]): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'damage' }> => e.type === 'damage')
    .map((e) => e.kind);
}

describe('parry: who gets a parry chance (warrior-only redesign)', () => {
  it('scales from Strength for a warrior; every other class and mobs get zero', () => {
    expect(warriorParryChance(0)).toBeCloseTo(0.05, 8);
    expect(warriorParryChance(20)).toBeCloseTo(0.05 + 20 * 0.0005, 8);

    const sim = makeSim('warrior');
    const mob = spawnMobInFront(sim);
    sim.player.facing = 0; // facing +z, toward the mob
    const forWarrior = warriorMeleeDefense(sim.player, mob);
    expect(forWarrior.parryChance).toBeCloseTo(warriorParryChance(sim.player.stats.str), 8);
    expect(forWarrior.parryChance).toBeGreaterThan(0);

    for (const cls of ['paladin', 'rogue', 'mage', 'priest'] as PlayerClass[]) {
      const other = makeSim(cls);
      const otherMob = spawnMobInFront(other);
      other.player.facing = 0;
      expect(warriorMeleeDefense(other.player, otherMob).parryChance, cls).toBe(0);
    }
    // A mob defender never parries either.
    expect(warriorMeleeDefense(mob, sim.player).parryChance).toBe(0);
  });

  it('is front-arc only in the pure helper', () => {
    const sim = makeSim('warrior');
    const mob = spawnMobInFront(sim);
    const p = sim.player;
    p.facing = 0; // toward the mob: in the front arc
    expect(warriorMeleeDefense(p, mob).parryChance).toBeGreaterThan(0);
    p.facing = Math.PI; // facing away: the blow lands from behind
    expect(warriorMeleeDefense(p, mob).parryChance).toBe(0);
  });
});

describe('parry: the one-roll mob-swing hit table', () => {
  // Force the single table roll into the parry window [miss, miss + parry).
  function parryRoll(sim: AnySim, mob: Entity): number {
    const missChance = swingMissChance(mob, sim.player);
    return missChance + warriorParryChance(sim.player.stats.str) / 2;
  }

  it('a warrior facing the attacker parries; from behind the same roll hits', () => {
    const sim = makeSim('warrior');
    const mob = spawnMobInFront(sim);
    const p = sim.player;
    p.dodgeChance = 0; // dodge shares the roll band; remove it so parry is isolated
    const roll = parryRoll(sim, mob);
    sim.rng.next = () => roll;

    p.facing = 0; // facing the mob
    sim.drainEvents();
    sim.mobSwing(mob, p);
    expect(damageKinds(sim.drainEvents())).toEqual(['parry']);

    p.facing = Math.PI; // mob now behind: parry is disabled, the roll connects
    sim.drainEvents();
    sim.mobSwing(mob, p);
    expect(damageKinds(sim.drainEvents())).toEqual(['hit']);
  });

  it('a non-warrior facing the attacker never parries on the same roll', () => {
    const sim = makeSim('paladin');
    const mob = spawnMobInFront(sim);
    const p = sim.player;
    p.dodgeChance = 0;
    // The roll a warrior of this Strength WOULD parry: for a paladin it connects.
    const roll = swingMissChance(mob, p) + warriorParryChance(p.stats.str) / 2;
    sim.rng.next = () => roll;
    p.facing = 0;
    sim.drainEvents();
    sim.mobSwing(mob, p);
    expect(damageKinds(sim.drainEvents())).toEqual(['hit']);
  });

  it('a parried swing consumes exactly ONE rng draw (rng order is unchanged)', () => {
    const sim = makeSim('warrior');
    const mob = spawnMobInFront(sim);
    const p = sim.player;
    p.dodgeChance = 0;
    p.facing = 0;
    const roll = parryRoll(sim, mob);
    let draws = 0;
    sim.rng.next = () => {
      draws++;
      return roll;
    };
    sim.drainEvents();
    sim.mobSwing(mob, p);
    expect(damageKinds(sim.drainEvents())).toEqual(['parry']);
    // The parry branch exits the one-roll table before the damage/crit draws,
    // so the shared rng stream advances by exactly the single table roll.
    expect(draws).toBe(1);
  });
});
