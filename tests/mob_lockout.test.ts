// The Wyrmcult Zealot's "Wyrmward Sigil" is a school-specific counterspell: a
// landed melee hit can lock the victim out of ONE spell school (fire) for a few
// seconds. Unlike a full silence, every other school — and physical abilities —
// stays usable, and an in-progress cast only breaks if it matches the locked school.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'mage') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Wyrmcult Zealot adjacent to the player, at the player's level for an
// even hit table, engaged and ready to swing.
function spawnZealot(sim: Sim, target: Entity): Entity {
  const template = MOBS['wyrmcult_zealot'];
  const mob = createMob((sim as any).nextId++, template, target.level, { x: target.pos.x, y: target.pos.y, z: target.pos.z });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (lockout chance is rolled per landed hit).
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

describe('mob school lockout ("Wyrmward Sigil")', () => {
  it('seeds the lockout mechanic on the Wyrmcult Zealot', () => {
    expect(MOBS['wyrmcult_zealot'].lockout).toEqual({
      chance: 0.25, duration: 6, name: 'Wyrmward Sigil', school: 'fire',
    });
  });

  it('applies a fire-school lockout aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const mob = spawnZealot(sim, p);
    MOBS['wyrmcult_zealot'].lockout!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['wyrmcult_zealot'].lockout!.chance = 0.25;
    const aura = p.auras.find((a) => a.kind === 'lockout');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Wyrmward Sigil');
    expect(aura!.remaining).toBe(6);
    expect(aura!.school).toBe('fire');
  });

  it('blocks a fire cast while locked out but leaves other schools free', () => {
    const sim = makeSim('mage');
    sim.setPlayerLevel(10); // so the mage knows both Fireball (fire) and Frostbolt (frost)
    const p = sim.player;
    p.auras.push({
      id: 'lockout_wyrmcult_zealot', name: 'Wyrmward Sigil', kind: 'lockout',
      remaining: 6, duration: 6, value: 0, sourceId: 999, school: 'fire',
    });
    const errs: string[] = [];
    const orig = (sim as any).error.bind(sim);
    (sim as any).error = (pid: number, msg: string) => { errs.push(msg); orig(pid, msg); };
    // Fireball is fire — locked out, rejected with the silence message.
    sim.castAbility('fireball', p.id);
    expect(errs).toContain('You are silenced!');
    // Frostbolt is frost — a fire lockout must NOT block it.
    errs.length = 0;
    sim.castAbility('frostbolt', p.id);
    expect(errs).not.toContain('You are silenced!');
  });

  it('breaks an in-progress fire cast on the next tick but spares other schools', () => {
    const sim = makeSim('mage');
    sim.setPlayerLevel(10);
    const p = sim.player;
    p.auras.push({
      id: 'lockout_x', name: 'Wyrmward Sigil', kind: 'lockout',
      remaining: 6, duration: 6, value: 0, sourceId: 999, school: 'fire',
    });
    // A fireball mid-cast is the locked school → broken next tick.
    p.castingAbility = 'fireball';
    p.castRemaining = 2;
    p.channeling = false;
    sim.tick();
    expect(p.castingAbility).toBeNull();
    // A frostbolt mid-cast is a different school → survives.
    p.castingAbility = 'frostbolt';
    p.castRemaining = 2;
    p.channeling = false;
    sim.tick();
    expect(p.castingAbility).toBe('frostbolt');
  });

  it('does not block a physical ability while locked out', () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    p.resource = 100;
    p.auras.push({
      id: 'lockout_x', name: 'Wyrmward Sigil', kind: 'lockout',
      remaining: 6, duration: 6, value: 0, sourceId: 999, school: 'fire',
    });
    const errs: string[] = [];
    const orig = (sim as any).error.bind(sim);
    (sim as any).error = (pid: number, msg: string) => { errs.push(msg); orig(pid, msg); };
    // Heroic Strike is physical — a lockout must never be the reason it's blocked.
    sim.castAbility('heroic_strike', p.id);
    expect(errs).not.toContain('You are silenced!');
  });

  it('a friendly pet swing never locks out its target', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const pet = spawnZealot(sim, p);
    pet.hostile = false; // a tamed/friendly shape
    pet.ownerId = p.id;
    MOBS['wyrmcult_zealot'].lockout!.chance = 1;
    swing(sim, pet, p);
    MOBS['wyrmcult_zealot'].lockout!.chance = 0.25;
    expect(p.auras.some((a) => a.kind === 'lockout')).toBe(false);
  });
});
