// Anti-caster mobs (e.g. the Gravecaller Summoner's "Silencing Shriek") can lock
// a victim out of spellcasting on a melee hit. Silence is distinct from a stun:
// it blocks spell (non-physical) abilities and breaks an in-progress spell, but
// leaves physical abilities, movement and auto-attack untouched.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'mage') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Gravecaller Summoner adjacent to the player, engaged and ready to swing.
function spawnSummoner(sim: Sim, target: Entity): Entity {
  const template = MOBS['gravecaller_summoner'];
  const mob = createMob((sim as any).nextId++, template, 12, { x: target.pos.x, y: target.pos.y, z: target.pos.z });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (silence chance is rolled per landed hit).
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

describe('mob silence ("Silencing Shriek")', () => {
  it('seeds the silence mechanic on the Gravecaller Summoner', () => {
    expect(MOBS['gravecaller_summoner'].silence).toEqual({
      chance: 0.3, duration: 4, name: 'Silencing Shriek', school: 'shadow',
    });
  });

  it('applies a silence aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const mob = spawnSummoner(sim, p);
    MOBS['gravecaller_summoner'].silence!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['gravecaller_summoner'].silence!.chance = 0.3;
    const aura = p.auras.find((a) => a.kind === 'silence');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Silencing Shriek');
    expect(aura!.remaining).toBe(4);
  });

  it('blocks a spell cast while silenced but allows physical abilities', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.auras.push({
      id: 'silence_gravecaller_summoner', name: 'Silencing Shriek', kind: 'silence',
      remaining: 4, duration: 4, value: 0, sourceId: 999, school: 'shadow',
    });
    // Fireball is a spell (school: fire) — must be rejected with "You are silenced!".
    const errs: string[] = [];
    const orig = (sim as any).error.bind(sim);
    (sim as any).error = (pid: number, msg: string) => { errs.push(msg); orig(pid, msg); };
    sim.castAbility('fireball', p.id);
    expect(errs).toContain('You are silenced!');
  });

  it('breaks an in-progress spell cast on the next tick', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    // Pretend a fireball is mid-cast (fire = a spell school).
    p.castingAbility = 'fireball';
    p.castRemaining = 2;
    p.channeling = false;
    p.auras.push({
      id: 'silence_x', name: 'Silencing Shriek', kind: 'silence',
      remaining: 4, duration: 4, value: 0, sourceId: 999, school: 'shadow',
    });
    sim.tick();
    expect(p.castingAbility).toBeNull();
  });

  it('does not block a physical ability while silenced', () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    p.resource = 100;
    p.auras.push({
      id: 'silence_x', name: 'Silencing Shriek', kind: 'silence',
      remaining: 4, duration: 4, value: 0, sourceId: 999, school: 'shadow',
    });
    const errs: string[] = [];
    const orig = (sim as any).error.bind(sim);
    (sim as any).error = (pid: number, msg: string) => { errs.push(msg); orig(pid, msg); };
    // Heroic Strike is physical — silence must NOT be the reason it's blocked.
    sim.castAbility('heroic_strike', p.id);
    expect(errs).not.toContain('You are silenced!');
  });

  it('a friendly pet swing never silences its target', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const pet = spawnSummoner(sim, p);
    pet.hostile = false; // a tamed/friendly summoner shape
    pet.ownerId = p.id;
    MOBS['gravecaller_summoner'].silence!.chance = 1;
    swing(sim, pet, p);
    MOBS['gravecaller_summoner'].silence!.chance = 0.3;
    expect(p.auras.some((a) => a.kind === 'silence')).toBe(false);
  });
});
