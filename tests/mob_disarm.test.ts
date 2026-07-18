// Brutal melee mobs (e.g. the Thornpeak Crusher's "Disarming Smash") can knock a
// victim's weapon from their grip on a landed hit. Disarm is the inverse of silence:
// it suppresses weapon swings (auto-attack, melee and ranged) for a duration but
// leaves movement, spells and instant abilities untouched.
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'warrior') {
  return new Sim({ seed: 11, playerClass, autoEquip: true });
}

// Spawn a Thornpeak Crusher adjacent to the player, engaged and ready to swing.
function spawnCrusher(sim: Sim, target: Entity): Entity {
  const template = MOBS['ogre_crusher'];
  const mob = createMob((sim as any).nextId++, template, 17, {
    x: target.pos.x,
    y: target.pos.y,
    z: target.pos.z,
  });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (disarm chance is rolled per landed hit).
function swing(sim: Sim, mob: Entity, target: Entity) {
  (sim as any).mobSwing(mob, target);
}

describe('mob disarm ("Disarming Smash")', () => {
  it('seeds the disarm mechanic on the Thornpeak Crusher', () => {
    expect(MOBS['ogre_crusher'].disarm).toEqual({
      chance: 0.25,
      duration: 6,
      name: 'Disarming Smash',
      school: 'physical',
    });
  });

  it('applies a disarm aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = spawnCrusher(sim, p);
    MOBS['ogre_crusher'].disarm!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['ogre_crusher'].disarm!.chance = 0.25;
    const aura = p.auras.find((a) => a.kind === 'disarm');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Disarming Smash');
    expect(aura!.remaining).toBe(6);
  });

  it('suppresses auto-attack while disarmed, then resumes once it falls off', () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    const meta = (sim as any).players.get(p.id);
    // A defenseless dummy directly in front of the player, inside melee range.
    const dummy = createMob((sim as any).nextId++, MOBS['ogre_crusher'], 1, {
      x: p.pos.x + 1,
      y: p.pos.y,
      z: p.pos.z,
    });
    dummy.hostile = true;
    dummy.maxHp = 100000;
    dummy.hp = 100000;
    (sim as any).addEntity(dummy);
    p.targetId = dummy.id;
    p.autoAttack = true;
    p.facing = Math.atan2(dummy.pos.x - p.pos.x, dummy.pos.z - p.pos.z);

    // Disarmed: a ready swing must NOT land.
    p.auras.push({
      id: 'disarm_x',
      name: 'Disarming Smash',
      kind: 'disarm',
      remaining: 6,
      duration: 6,
      value: 0,
      sourceId: 999,
      school: 'physical',
    });
    p.swingTimer = 0;
    const before = dummy.hp;
    (sim as any).updatePlayerAutoAttack(p, meta);
    expect(dummy.hp).toBe(before); // no swing while disarmed

    // Weapon recovered: the same ready swing now lands.
    p.auras = p.auras.filter((a) => a.kind !== 'disarm');
    p.swingTimer = 0;
    (sim as any).updatePlayerAutoAttack(p, meta);
    expect(dummy.hp).toBeLessThan(before);
  });

  // Bug: Disarming Smash refreshes its full 6s duration on every landed proc,
  // with no guard against re-applying while already active. A single Thornpeak
  // Crusher swings every 2.6s, so a run of lucky 25%-chance procs (or a second
  // crusher in the same pack landing its own roll) can keep re-arming the debuff
  // faster than it falls off, locking the player out of auto-attack for far
  // longer than the stated 6s window ("Autoattack on Thornpeak Crusher freqently
  // does not work. Cant start swingtimer again").
  it('does not extend disarm past its base duration on a repeat proc while already active', () => {
    const sim = makeSim();
    sim.setPlayerLevel(60); // enough HP to survive incidental mob swings during the tick loop
    const p = sim.player;
    const mob = spawnCrusher(sim, p);
    try {
      MOBS['ogre_crusher'].disarm!.chance = 1; // deterministic: every landed hit procs
      swing(sim, mob, p); // first proc: applies the debuff, 6s remaining
      const first = p.auras.find((a) => a.kind === 'disarm');
      expect(first?.remaining).toBe(6);
      // Let 5s pass (still disarmed: 1s left), then land a second proc before it
      // falls off. The debuff must NOT reset back up to a fresh 6s.
      for (let i = 0; i < 20 * 5; i++) sim.tick();
      swing(sim, mob, p);
      const second = p.auras.find((a) => a.kind === 'disarm');
      expect(second).toBeTruthy();
      expect(second!.remaining).toBeCloseTo(1, 1);
    } finally {
      MOBS['ogre_crusher'].disarm!.chance = 0.25;
    }
  });

  it('a friendly pet swing never disarms its target', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000;
    p.hp = 100000;
    const pet = spawnCrusher(sim, p);
    pet.hostile = false; // a friendly shape sharing the mobSwing path
    pet.ownerId = p.id;
    MOBS['ogre_crusher'].disarm!.chance = 1;
    swing(sim, pet, p);
    MOBS['ogre_crusher'].disarm!.chance = 0.25;
    expect(p.auras.some((a) => a.kind === 'disarm')).toBe(false);
  });
});
