// Tank crit immunity is a CREATURE rule, keyed on the attacker: only a hostile
// mob's swing is crit-suppressed against a committed tank. A player pet swings
// through the same shared Sim.mobSwing shell, and before the attacker gate it
// inherited the suppression, which made committed tanks crit-immune to pets in
// PvP. These tests pin both arms at the swing level (the real code path) plus
// the pure leaf's attacker classification.
// The fight-level hostile-mob coverage per class lives in the
// tank_crit_immunity_*_pair.test.ts suite; this file owns the attacker side.

import { describe, expect, test } from 'vitest';
import { isCritImmuneTank, type TankCritImmunityMeta } from '../src/sim/combat/tank_crit_immunity';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SEED = 90210;
const SWINGS = 2000; // ~100 expected crits at the flat 5% mob crit roll

// Drive Sim.mobSwing directly against a committed Protection warrior and count
// landed swings and crits. The attacker is hand-configured per case (hostile
// wild mob vs player-owned pet); swings are called directly so the mob AI never
// runs and the only rng consumers are the swing rolls themselves. The tank's
// hp pool is re-inflated before EVERY swing: aura applications along the way
// re-run recalcPlayerStats, which would squash the pool back to normal and let
// the wolf kill the tank (dealDamage returns silently for a dead target).
function swingsAgainstProtWarrior(
  configureAttacker: (attacker: Entity, ownerPid: number) => void,
): {
  landed: number;
  crits: number;
} {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    noPlayer: true,
    world: EMPTY_TEST_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Defender');
  sim.setPlayerLevel(20, pid);
  sim.applyTalents({ spec: 'prot', rows: {} }, pid);
  const tank = sim.entities.get(pid);
  expect(tank).toBeDefined();
  if (!tank) throw new Error('defender missing');

  const attacker = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: tank.pos.x + 1,
    y: tank.pos.y,
    z: tank.pos.z,
  });
  configureAttacker(attacker, pid);

  for (let swing = 0; swing < SWINGS; swing++) {
    tank.maxHp = 1e9;
    tank.hp = tank.maxHp;
    sim.mobSwing(attacker, tank);
  }
  let landed = 0;
  let crits = 0;
  for (const event of sim.drainEvents()) {
    if (
      event.type === 'damage' &&
      event.sourceId === attacker.id &&
      event.targetId === pid &&
      (event.kind === 'hit' || event.kind === 'block')
    ) {
      landed++;
      if (event.crit) crits++;
    }
  }
  expect(landed).toBeGreaterThan(500); // the swings actually resolved
  return { landed, crits };
}

describe('tank crit immunity is keyed on the attacker', () => {
  test('a player pet swinging through mobSwing can crit a committed tank', () => {
    const { landed, crits } = swingsAgainstProtWarrior((attacker, ownerPid) => {
      attacker.hostile = false;
      attacker.ownerId = ownerPid;
    });
    // Rate band, not a raw count: the shared rng stream shifts on content adds,
    // so pin the ~5% creature crit roll rather than a seed-exact tally.
    expect(crits / landed).toBeGreaterThan(0.02);
    expect(crits / landed).toBeLessThan(0.1);
  });

  test('a hostile mob still cannot crit a committed tank', () => {
    const { crits } = swingsAgainstProtWarrior((attacker) => {
      attacker.hostile = true;
      attacker.ownerId = null;
    });
    expect(crits).toBe(0);
  });

  test('a player swinging through meleeSwing can crit a committed tank', () => {
    // The player white-hit table (combat/auto_attack.ts meleeSwing) never
    // consults tank crit immunity; this pins that a real player swing crits a
    // committed tank so the rule can never silently widen past creatures.
    const sim = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: EMPTY_TEST_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Defender');
    sim.setPlayerLevel(20, pid);
    sim.applyTalents({ spec: 'prot', rows: {} }, pid);
    const tank = sim.entities.get(pid);
    const attackerPid = sim.addPlayer('warrior', 'Attacker');
    sim.setPlayerLevel(20, attackerPid);
    const attacker = sim.entities.get(attackerPid);
    expect(tank).toBeDefined();
    expect(attacker).toBeDefined();
    if (!tank || !attacker) throw new Error('players missing');
    expect(attacker.critChance).toBeGreaterThan(0);

    const swings = sim as unknown as {
      meleeSwing(
        attacker: Entity,
        target: Entity,
        bonus: number,
        abilityName: string | null,
        opts: Record<string, never>,
      ): boolean;
    };
    for (let swing = 0; swing < SWINGS; swing++) {
      tank.maxHp = 1e9;
      tank.hp = tank.maxHp;
      swings.meleeSwing(attacker, tank, 0, null, {});
    }
    let landed = 0;
    let crits = 0;
    for (const event of sim.drainEvents()) {
      if (
        event.type === 'damage' &&
        event.sourceId === attacker.id &&
        event.targetId === pid &&
        (event.kind === 'hit' || event.kind === 'block')
      ) {
        landed++;
        if (event.crit) crits++;
      }
    }
    expect(landed).toBeGreaterThan(500);
    expect(crits).toBeGreaterThan(0);
    // Sanity band mirroring the pet case: the player's own crit chance drives
    // the rate, so just require a plausible non-degenerate fraction.
    expect(crits / landed).toBeLessThan(0.5);
  });
});

describe('isCritImmuneTank attacker classification (pure leaf)', () => {
  const protWarriorMeta: TankCritImmunityMeta = {
    cls: 'warrior',
    talentMods: { spec: 'prot' },
  };
  const tankTarget = { kind: 'player', auras: [] } as unknown as Entity;

  function creatureAttacker(hostile: boolean, ownerId: number | null): Entity {
    const mob = createMob(1, MOBS.forest_wolf, 20, { x: 0, y: 0, z: 0 });
    mob.hostile = hostile;
    mob.ownerId = ownerId;
    return mob;
  }

  test('a hostile wild mob is crit-suppressed against a committed tank', () => {
    expect(isCritImmuneTank(creatureAttacker(true, null), tankTarget, protWarriorMeta)).toBe(true);
  });

  test('a friendly player pet is never crit-suppressed', () => {
    expect(isCritImmuneTank(creatureAttacker(false, 7), tankTarget, protWarriorMeta)).toBe(false);
  });

  test('a player attacker is never crit-suppressed', () => {
    const playerAttacker = { kind: 'player', hostile: false } as unknown as Entity;
    expect(isCritImmuneTank(playerAttacker, tankTarget, protWarriorMeta)).toBe(false);
  });
});
