// The Nhalia Mourners' funeral dirge ("Dirge of Tongues") can curse a caster on a
// melee hit, stretching their spell cast times. Curse of Tongues is distinct from a
// silence (a full spell lockout) and from slowStrike (melee swing speed): a cursed
// victim still casts, just slower. It is read at cast-start, so it composes with the
// already haste-resolved cast time.
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { Entity } from '../src/sim/types';

function makeSim(playerClass: 'warrior' | 'mage' = 'mage') {
  return new Sim({ seed: 7, playerClass, autoEquip: true });
}

// Spawn a Nhalia Mourner adjacent to the player, hostile and ready to swing.
function spawnMourner(sim: Sim, target: Entity): Entity {
  const template = MOBS['nhalia_mourner'];
  const mob = createMob((sim as any).nextId++, template, 12, { x: target.pos.x, y: target.pos.y, z: target.pos.z });
  mob.hostile = true;
  (sim as any).addEntity(mob);
  return mob;
}

// Force a single landed swing (the curse chance is rolled per landed hit).
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

describe('mob curse of tongues ("Dirge of Tongues")', () => {
  it('seeds the tongues mechanic on the Nhalia Mourner', () => {
    expect(MOBS['nhalia_mourner'].tongues).toEqual({
      chance: 0.3, mult: 1.3, duration: 10, name: 'Dirge of Tongues', school: 'shadow',
    });
  });

  it('applies a tongues aura on a landed hit when it rolls', () => {
    const sim = makeSim();
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    const mob = spawnMourner(sim, p);
    MOBS['nhalia_mourner'].tongues!.chance = 1; // deterministic for the test
    swing(sim, mob, p);
    MOBS['nhalia_mourner'].tongues!.chance = 0.3;
    const aura = p.auras.find((a) => a.kind === 'tongues');
    expect(aura).toBeTruthy();
    expect(aura!.name).toBe('Dirge of Tongues');
    expect(aura!.remaining).toBe(10);
    expect(aura!.value).toBe(1.3);
  });

  // Point the player at a hostile, in-range, in-arc dummy so a hostile spell can begin.
  function aimAt(sim: Sim, p: Entity): Entity {
    const mob = spawnMourner(sim, { ...p, pos: { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z } } as Entity);
    mob.pos = { x: p.pos.x + 3, y: p.pos.y, z: p.pos.z };
    mob.maxHp = 100000; mob.hp = 100000;
    p.targetId = mob.id;
    p.facing = Math.atan2(mob.pos.x - p.pos.x, mob.pos.z - p.pos.z);
    return mob;
  }

  it('stretches a spell cast time while cursed', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    p.resource = p.maxResource;
    aimAt(sim, p);
    // Baseline cast time with no curse.
    sim.castAbility('fireball', p.id);
    const baseCast = p.castTotal;
    expect(baseCast).toBeGreaterThan(0);
    (sim as any).cancelCast(p);

    // Apply the curse and recast — the cast time should be 30% longer.
    p.auras.push({
      id: 'tongues_nhalia_mourner', name: 'Dirge of Tongues', kind: 'tongues',
      remaining: 10, duration: 10, value: 1.3, sourceId: 999, school: 'shadow',
    });
    p.gcdRemaining = 0;
    sim.castAbility('fireball', p.id);
    expect(p.castTotal).toBeCloseTo(baseCast * 1.3, 5);
  });

  it('does not block the cast outright (distinct from silence)', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    p.maxHp = 100000; p.hp = 100000;
    p.resource = p.maxResource;
    aimAt(sim, p);
    p.auras.push({
      id: 'tongues_x', name: 'Dirge of Tongues', kind: 'tongues',
      remaining: 10, duration: 10, value: 1.3, sourceId: 999, school: 'shadow',
    });
    sim.castAbility('fireball', p.id);
    expect(p.castingAbility).toBe('fireball');
  });

  it('a friendly pet swing never curses an ally', () => {
    const sim = makeSim('mage');
    const p = sim.player;
    const mob = spawnMourner(sim, p);
    mob.hostile = false; // friendly (mobSwing's other caller)
    MOBS['nhalia_mourner'].tongues!.chance = 1;
    swing(sim, mob, p);
    MOBS['nhalia_mourner'].tongues!.chance = 0.3;
    expect(p.auras.find((a) => a.kind === 'tongues')).toBeUndefined();
  });
});
