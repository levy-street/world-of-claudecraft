// Some thugs fight dirty: the Vale Bandit's "Blinding Powder" flings a handful of
// road grit on a landed hit, fouling the victim's aim so their OWN weapon swings
// whiff for a few seconds. Blind is the weapon-side twin of silence — where
// silence locks out spells, blind spoils melee and ranged attacks. It leaves
// spellcasting, movement and the victim's defenses untouched.
import { describe, expect, it } from 'vitest';
import { blindMissBonus } from '../src/sim/combat/cc';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'warrior') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Vale Bandit adjacent to the player, hostile and ready to swing.
function spawnBandit(sim: Sim, target: Entity): Entity {
  const template = MOBS['vale_bandit'];
  const mob = createMob((sim as any).nextId++, template, 5, {
    x: target.pos.x,
    y: target.pos.y,
    z: target.pos.z,
  });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (blind chance is rolled per landed hit).
function swing(sim: Sim, mob: Entity, target: Entity) {
  // Force the swing to land regardless of world-gen RNG state. mobSwing's first
  // rng.next() is the miss/dodge roll; return a high value for just that call so
  // the hit always connects, then restore the real RNG for damage/crit rolls.
  const rng = (sim as any).rng;
  const realNext = rng.next.bind(rng);
  let firstRoll = true;
  rng.next = () => {
    if (firstRoll) {
      firstRoll = false;
      return 0.999;
    }
    return realNext();
  };
  try {
    (sim as any).mobSwing(mob, target);
  } finally {
    rng.next = realNext;
  }
}

describe('mob blind ("Blinding Powder")', () => {
  it('seeds the blind mechanic on the Vale Bandit', () => {
    expect(MOBS['vale_bandit'].blind).toEqual({
      chance: 0.25,
      miss: 0.3,
      duration: 5,
      name: 'Blinding Powder',
      school: 'physical',
    });
  });

  it('applies a blind aura carrying the added miss chance on a landed hit', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000;
    p.hp = 100000;
    const mob = spawnBandit(sim, p);
    MOBS['vale_bandit'].blind!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['vale_bandit'].blind!.chance = 0.25;
    const aura = p.auras.find((a) => a.kind === 'blind');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Blinding Powder');
    expect(aura!.remaining).toBe(5);
    expect(aura!.value).toBe(0.3); // the miss chance carried into combat math
  });

  it("makes the blinded victim's own swings whiff", () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    const dummy = spawnBandit(sim, p);
    dummy.maxHp = 100000;
    dummy.hp = 100000;
    // A total blind (100% added miss) guarantees the swing whiffs.
    p.auras.push({
      id: 'blind_x',
      name: 'Blinding Powder',
      kind: 'blind',
      remaining: 5,
      duration: 5,
      value: 1,
      sourceId: 999,
      school: 'physical',
    });
    const events: Array<{ kind?: string; sourceId: number }> = [];
    const orig = (sim as any).emit.bind(sim);
    (sim as any).emit = (e: any) => {
      events.push(e);
      orig(e);
    };
    const connected = (sim as any).meleeSwing(p, dummy, 0, null, { cannotBeDodged: true });
    expect(connected).toBe(false);
    expect(events.some((e) => e.kind === 'miss' && e.sourceId === p.id)).toBe(true);
  });

  it('adds no miss chance when the victim is not blinded', () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    // No blind aura → the swing math sees zero added miss chance.
    expect(blindMissBonus(p)).toBe(0);
    p.auras.push({
      id: 'blind_x',
      name: 'Blinding Powder',
      kind: 'blind',
      remaining: 5,
      duration: 5,
      value: 0.3,
      sourceId: 999,
      school: 'physical',
    });
    expect(blindMissBonus(p)).toBe(0.3);
  });

  it('does not block spellcasting while blinded', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.auras.push({
      id: 'blind_x',
      name: 'Blinding Powder',
      kind: 'blind',
      remaining: 5,
      duration: 5,
      value: 0.3,
      sourceId: 999,
      school: 'physical',
    });
    const errs: string[] = [];
    const orig = (sim as any).error.bind(sim);
    (sim as any).error = (pid: number, msg: string) => {
      errs.push(msg);
      orig(pid, msg);
    };
    sim.castAbility('fireball', p.id);
    expect(errs).not.toContain('You are silenced!');
  });

  it('a friendly pet swing never blinds its target', () => {
    const sim = makeSim('warrior');
    const p = sim.player;
    p.maxHp = 100000;
    p.hp = 100000;
    const pet = spawnBandit(sim, p);
    pet.hostile = false; // a tamed/friendly shape
    pet.ownerId = p.id;
    MOBS['vale_bandit'].blind!.chance = 1;
    swing(sim, pet, p);
    MOBS['vale_bandit'].blind!.chance = 0.25;
    expect(p.auras.some((a) => a.kind === 'blind')).toBe(false);
  });
});
