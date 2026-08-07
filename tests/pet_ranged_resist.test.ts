// A player pet's ranged bolt (petRangedAttack in src/sim/pet/pet_ai.ts: the
// Emberkin imp Firebolt, the mage Water Elemental bolt) must roll the same
// spell-resist table as every other spell path. The hostile-mob petSpell path
// (Sim.updateRangedPetAttack) and the player cast path (casting_lifecycle)
// both roll isMobSpellResisted / isSpellResisted; the imp-bolt projectile
// historically skipped the roll entirely, so player pet bolts could never be
// resisted, an engine asymmetry that made pet damage resist-immune.
//
// Same stub idiom as tests/spell_resist.test.ts: pin the shared rng's chance()
// so the hit roll deterministically fails (resist) or succeeds (land), and step
// the pending projectile directly so no other combat noise interferes.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { petRangedAttack } from '../src/sim/pet/pet_ai';
import { advancePendingProjectiles } from '../src/sim/projectile_travel';
import { Sim } from '../src/sim/sim';
import { type Entity, type SimEvent, spellHitChance } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

type DamageEvent = Extract<SimEvent, { type: 'damage' }>;

function isDamageTo(event: SimEvent, targetId: number): event is DamageEvent {
  return event.type === 'damage' && event.targetId === targetId;
}

// Summon the warlock's imp for real (cast summon_imp to completion) so the pet
// carries genuine owned-pet state, then hand back sim + imp + a spawned target.
function makeImpVsTarget(targetLevel: number): {
  sim: Sim;
  imp: Entity;
  mob: Entity;
} {
  const sim = new Sim({ seed: 7, playerClass: 'warlock', autoEquip: true });
  sim.setPlayerLevel(12);
  sim.castAbility('summon_imp');
  for (let i = 0; i < 20 * 12 && sim.player.castingAbility; i++) sim.tick();
  const imp = expectDefined(sim.petOf(sim.playerId));
  expect(imp).not.toBeNull();
  expect(imp.templateId).toBe('emberkin');
  const p = sim.player;
  const mob = createMob(sim.nextId++, MOBS.forest_wolf, targetLevel, {
    x: p.pos.x,
    y: p.pos.y,
    z: p.pos.z + 4,
  });
  mob.maxHp = 50000;
  mob.hp = 50000;
  mob.hostile = true;
  mob.aiState = 'idle';
  sim.addEntity(mob);
  return { sim, imp, mob };
}

// Hurl one bolt directly at the unit under test and step it to impact.
function hurlBolt(
  sim: Sim,
  imp: Entity,
  mob: Entity,
  ranged = expectDefined(MOBS.emberkin.petRanged),
): SimEvent[] {
  const events: SimEvent[] = [];
  sim.ctx.emit = (e: SimEvent) => events.push(e);
  petRangedAttack(sim.ctx, imp, mob, ranged);
  for (let i = 0; i < 200 && sim.ctx.pendingProjectiles.length > 0; i++)
    advancePendingProjectiles(sim.ctx);
  return events;
}

describe('pet ranged bolt spell resist', () => {
  it('an avoided pet bolt emits kind:"resist" with zero damage instead of landing', () => {
    // Arrange: pin the hit roll to fail so the resist is certain, and capture
    // its argument so the roll's PROBABILITY is pinned too: the resist chance
    // must be the level-derived spell-hit complement (spellHitChance for a
    // hitBonus-0 pet) with NO mob-vs-player floor (a player-owned caster takes
    // the unfloored isMobSpellResisted branch), not a hardcoded rate.
    const { sim, imp, mob } = makeImpVsTarget(60);
    const rolled: number[] = [];
    sim.rng.chance = (p: number) => {
      rolled.push(p);
      return false;
    };
    let ranges = 0;
    const realRange = sim.rng.range.bind(sim.rng);
    sim.rng.range = (a: number, b: number) => {
      ranges++;
      return realRange(a, b);
    };

    // Act
    const events = hurlBolt(sim, imp, mob);

    // Assert: the bolt resolves as a full resist, never as damage, attributed
    // to the pet with its real school and no crit styling on the zero.
    const dmg = events.filter((e) => isDamageTo(e, mob.id));
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.kind === 'resist')).toBe(true);
    expect(dmg.every((e) => e.amount === 0)).toBe(true);
    expect(dmg[0].sourceId).toBe(imp.id);
    expect(dmg[0].school).toBe('fire');
    expect(dmg[0].crit).toBe(false);
    expect(rolled[0]).toBeCloseTo(spellHitChance(imp.level, 60), 6);
    // Draw economy: a resisted bolt consumes exactly the one resist draw and
    // skips the crit and damage-range draws (the parity digest pins the stream
    // position; this pins the count at the unit level).
    expect(rolled.length).toBe(1);
    expect(ranges).toBe(0);
    // And it really dealt nothing: no hp loss, and the only hate-table entry
    // is aggroMob's baseline seed of 1 (the resisted pull still aggros), never
    // damage-scaled threat from a dealDamage that must not have run.
    expect(mob.hp).toBe(mob.maxHp);
    expect(mob.threat.get(imp.id)).toBe(1);
  });

  it('a non-fire template bolt keeps its own school on the resist event', () => {
    // Arrange: the Water Elemental's frost config through the same shared
    // petRangedAttack path; the resist event must carry frost, not fire.
    const { sim, imp, mob } = makeImpVsTarget(60);
    sim.rng.chance = () => false;

    // Act
    const events = hurlBolt(sim, imp, mob, expectDefined(MOBS.water_elemental.petRanged));

    // Assert
    const dmg = events.filter((e) => isDamageTo(e, mob.id));
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.every((e) => e.kind === 'resist')).toBe(true);
    expect(dmg[0].school).toBe('frost');
  });

  it('a resisted bolt still pulls the target into combat with the pet', () => {
    // Arrange
    const { sim, imp, mob } = makeImpVsTarget(60);
    sim.rng.chance = () => false;

    // Act
    const events = hurlBolt(sim, imp, mob);

    // Assert: the resist arm mirrors Sim.updateRangedPetAttack, which calls
    // enterCombat so a fully resisted pull still aggros the target.
    expect(events.some((e) => e.type === 'damage' && e.kind === 'resist')).toBe(true);
    expect(imp.inCombat).toBe(true);
    expect(mob.inCombat).toBe(true);
  });

  it('a bolt that passes the hit roll still lands for real damage', () => {
    // Arrange: chance() always succeeds, so the hit roll passes (and the crit
    // roll does too); the bolt must deal its normal damage.
    const { sim, imp, mob } = makeImpVsTarget(12);
    const rolled: number[] = [];
    sim.rng.chance = (p: number) => {
      rolled.push(p);
      return true;
    };
    let ranges = 0;
    const realRange = sim.rng.range.bind(sim.rng);
    sim.rng.range = (a: number, b: number) => {
      ranges++;
      return realRange(a, b);
    };

    // Act
    const events = hurlBolt(sim, imp, mob);

    // Assert
    const dmg = events.filter((e) => isDamageTo(e, mob.id));
    expect(dmg.length).toBeGreaterThan(0);
    expect(dmg.some((e) => e.amount > 0)).toBe(true);
    expect(dmg.some((e) => e.kind === 'resist')).toBe(false);
    expect(mob.hp).toBeLessThan(mob.maxHp);
    // Draw economy and order: the resist roll (level-derived probability) comes
    // first, then the 5% crit roll, then the damage-range draw.
    expect(rolled[0]).toBeCloseTo(spellHitChance(imp.level, 12), 6);
    expect(rolled[1]).toBe(0.05);
    expect(ranges).toBeGreaterThanOrEqual(1);
  });
});
