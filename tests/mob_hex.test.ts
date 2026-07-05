// Murloc oracles (the Mudfin Skulker's "Mudfin Hex") can briefly turn a victim
// into a harmless critter on a melee hit. The hex reuses the exact `polymorph`
// aura the mage's Polymorph applies: it locks out every action (isStunned) and
// breaks the instant the victim takes damage. Unlike the player-cast version it
// does NOT heal the victim to full on apply — a monster shouldn't restore its prey.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'mage') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Mudfin Skulker adjacent to the player, hostile and ready to swing.
function spawnSkulker(sim: Sim, target: Entity): Entity {
  const mob = createMob((sim as any).nextId++, MOBS['mudfin_murloc'], 5, {
    x: target.pos.x, y: target.pos.y, z: target.pos.z,
  });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (the hex chance is rolled per landed hit).
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

describe('mob polymorph hex ("Mudfin Hex")', () => {
  it('seeds the hex mechanic on the Mudfin Skulker', () => {
    expect(MOBS['mudfin_murloc'].polymorphHex).toEqual({
      chance: 0.12, duration: 4, name: 'Mudfin Hex', school: 'nature',
    });
  });

  it('applies a polymorph aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.gm = true; // survive the swing; applyAura still lands the hex
    const mob = spawnSkulker(sim, p);
    MOBS['mudfin_murloc'].polymorphHex!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['mudfin_murloc'].polymorphHex!.chance = 0.12;
    const aura = p.auras.find((a) => a.kind === 'polymorph');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Mudfin Hex');
    expect(aura!.remaining).toBe(4);
    expect(aura!.breaksOnDamage).toBe(true);
  });

  it('does NOT heal the victim to full when the hex lands', () => {
    const sim = makeSim();
    const p = sim.player;
    p.gm = true;
    p.maxHp = 200; p.hp = 50; // wounded
    const mob = spawnSkulker(sim, p);
    MOBS['mudfin_murloc'].polymorphHex!.chance = 1;
    swing(sim, mob, p);
    MOBS['mudfin_murloc'].polymorphHex!.chance = 0.12;
    expect(p.auras.some((a) => a.kind === 'polymorph')).toBe(true);
    // The mage's Polymorph sets hp = maxHp; a mob's hex must not. The bite itself
    // deals damage, so a wounded victim only ends up MORE hurt, never topped off.
    expect(p.hp).toBeLessThanOrEqual(50);
    expect(p.hp).toBeLessThan(p.maxHp);
  });

  it('locks the victim out of casting while hexed', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.auras.push({
      id: 'hex_mudfin_murloc', name: 'Mudfin Hex', kind: 'polymorph',
      remaining: 4, duration: 4, value: 0, sourceId: 999, school: 'nature',
      breaksOnDamage: true,
    });
    const errs: string[] = [];
    const orig = (sim as any).error.bind(sim);
    (sim as any).error = (pid: number, msg: string) => { errs.push(msg); orig(pid, msg); };
    sim.castAbility('fireball', p.id);
    expect(errs).toContain('You are stunned!');
    expect(p.castingAbility).toBeNull();
  });

  it('breaks the hex the instant the victim takes damage', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    p.auras.push({
      id: 'hex_mudfin_murloc', name: 'Mudfin Hex', kind: 'polymorph',
      remaining: 4, duration: 4, value: 0, sourceId: 999, school: 'nature',
      breaksOnDamage: true,
    });
    (sim as any).dealDamage(null, p, 10, false, 'physical', null, 'hit');
    expect(p.auras.some((a) => a.kind === 'polymorph')).toBe(false);
  });

  it('does not hex a non-player target', () => {
    const sim = makeSim();
    const a = spawnSkulker(sim, sim.player);
    const b = spawnSkulker(sim, sim.player);
    b.hostile = true;
    MOBS['mudfin_murloc'].polymorphHex!.chance = 1;
    swing(sim, a, b); // murloc hitting another mob must not apply the hex
    MOBS['mudfin_murloc'].polymorphHex!.chance = 0.12;
    expect(b.auras.some((aura) => aura.kind === 'polymorph')).toBe(false);
  });
});
