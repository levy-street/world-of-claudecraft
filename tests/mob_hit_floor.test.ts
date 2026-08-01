// PR #443 added a steep miss penalty for attacking ABOVE your level (an anti-power-
// level / anti-bot deterrent). Because meleeMissChance keys off (target - attacker)
// level, that penalty is symmetric and also fired when a LOW-level mob swung at a
// HIGHER-level player, making enemies whiff ~85% of the time. swingMissChance makes
// the penalty player -> mob ONLY: a hostile wild mob always connects >= 80% against a
// player (or a player-owned pet), while player/pet -> mob keeps the full scaling.
//
// Issue #1050: the miss floor above was only half the fix. Armor DR and spell
// resist had no equivalent directional floor, so a heavily armored or much
// higher-level player (or hunter/warlock pet) could still mitigate a landed mob
// hit down toward nothing, keeping defensive-pet AFK farming of low-level mobs
// effectively risk-free. mobArmorReduction / isMobSpellResisted mirror
// swingMissChance's exact directional guard and MOB_VS_PLAYER_MAX_MISS's value
// for armor DR and spell resist respectively.
import { describe, expect, it } from 'vitest';
import {
  effectiveSpellHit,
  isMobSpellResisted,
  MOB_VS_PLAYER_MAX_RESIST,
} from '../src/sim/combat/spell_resist';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import {
  armorReduction,
  MOB_VS_PLAYER_MAX_ARMOR_DR,
  MOB_VS_PLAYER_MAX_MISS,
  meleeMissChance,
  mobArmorReduction,
  swingMissChance,
} from '../src/sim/types';

// swingMissChance only reads kind / level / hostile / ownerId, so a minimal stub is
// enough to exercise the directional guard without standing up a whole world.
function ent(over: Partial<Entity>): Entity {
  // hitBonus (0 here) is read by swingMissChance for the player-side Hit-rating
  // reduction, so the minimal stub must carry it.
  return {
    kind: 'mob',
    level: 1,
    hostile: true,
    ownerId: null,
    hitBonus: 0,
    ...over,
  } as unknown as Entity;
}

describe('enemy mobs always hit players at >= 80% (PR #443 penalty is player -> mob only)', () => {
  it('a low-level wild mob vs a higher-level player has its miss capped at 20%', () => {
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 10, ownerId: null });
    // The raw above-level miss (capped at ~26%) still exceeds the mob-facing floor...
    expect(meleeMissChance(mob.level, player.level)).toBeGreaterThan(MOB_VS_PLAYER_MAX_MISS);
    // ...but the swing guard holds a mob's hit at >= 80% against a player.
    expect(swingMissChance(mob, player)).toBeLessThanOrEqual(MOB_VS_PLAYER_MAX_MISS);
  });

  it('a player attacking a higher-level mob keeps the (capped) above-level penalty', () => {
    const player = ent({ kind: 'player', level: 6, ownerId: null });
    const mob = ent({ kind: 'mob', level: 10, hostile: true, ownerId: null });
    // Player -> mob keeps the full penalty (uncapped by the mob floor), now topping
    // out at ~26% (down from near-futile).
    expect(swingMissChance(player, mob)).toBe(meleeMissChance(player.level, mob.level));
    expect(swingMissChance(player, mob)).toBeCloseTo(0.26);
  });

  it('a mob swinging at a player-owned pet is also capped (the pet is player-side)', () => {
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const pet = ent({ kind: 'mob', level: 10, ownerId: 99 }); // ownerId set -> owned pet
    expect(swingMissChance(mob, pet)).toBeLessThanOrEqual(MOB_VS_PLAYER_MAX_MISS);
  });

  it('a player-owned pet attacking a higher mob is NOT capped (attacker is player-side)', () => {
    const pet = ent({ kind: 'mob', level: 1, hostile: true, ownerId: 99 });
    const mob = ent({ kind: 'mob', level: 10, hostile: true, ownerId: null });
    expect(swingMissChance(pet, mob)).toBe(meleeMissChance(pet.level, mob.level));
  });

  it('equal / below level is unchanged for both directions', () => {
    const mob = ent({ kind: 'mob', level: 10, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 10, ownerId: null });
    // mob -> player at equal level is already well under the cap, so it is untouched.
    expect(swingMissChance(mob, player)).toBe(meleeMissChance(mob.level, player.level));
  });
});

describe('enemy mob armor DR against a player never mitigates more than MOB_VS_PLAYER_MAX_ARMOR_DR (issue #1050)', () => {
  it('a hostile mob vs a heavily armored player has its armor DR capped at 20%', () => {
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const armor = 1_000_000; // pins the raw DR at its 75% cap
    // The raw armor DR (capped at 75%) still exceeds the mob-facing floor...
    expect(armorReduction(armor, mob.level)).toBeGreaterThan(MOB_VS_PLAYER_MAX_ARMOR_DR);
    // ...but mobArmorReduction holds a mob's mitigation at <= 20% against a player.
    expect(mobArmorReduction(mob, player, armor)).toBeLessThanOrEqual(MOB_VS_PLAYER_MAX_ARMOR_DR);
  });

  it('a player attacking a mob keeps the full armor DR scaling (up to 75%, untouched)', () => {
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const armor = 1_000_000;
    expect(mobArmorReduction(player, mob, armor)).toBe(armorReduction(armor, player.level));
    expect(mobArmorReduction(player, mob, armor)).toBeCloseTo(0.75);
  });

  it('a mob hitting a player-owned pet is also capped (the pet is player-side)', () => {
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const pet = ent({ kind: 'mob', level: 60, ownerId: 99 }); // ownerId set -> owned pet
    expect(mobArmorReduction(mob, pet, 1_000_000)).toBeLessThanOrEqual(MOB_VS_PLAYER_MAX_ARMOR_DR);
  });

  it('a player-owned pet attacking a mob is NOT capped (attacker is player-side)', () => {
    const pet = ent({ kind: 'mob', level: 60, hostile: true, ownerId: 99 });
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const armor = 1_000_000;
    expect(mobArmorReduction(pet, mob, armor)).toBe(armorReduction(armor, pet.level));
  });

  it('low armor already under the floor is unaffected either direction', () => {
    const mob = ent({ kind: 'mob', level: 10, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 10, ownerId: null });
    const armor = 50; // well under the 20% DR floor already
    expect(mobArmorReduction(mob, player, armor)).toBe(armorReduction(armor, mob.level));
  });

  // Review finding (PR #2601): armorReduction carries no level-difference term at all
  // (only the attacker's level and the raw armor value), unlike meleeMissChance, so an
  // unconditional floor here would also cap a same-level or higher-level mob's mitigation,
  // including raid bosses, redefining tanking mitigation globally instead of only fixing
  // the inverted low-level-mob-vs-high-level-player case issue #1050 was about. The floor
  // must apply ONLY when the mob is below the target's level.
  it('a same-level hostile mob keeps the full, uncapped armor DR (level parity is not the bug)', () => {
    const mob = ent({ kind: 'mob', level: 60, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const armor = 1_000_000; // pins the raw DR at its 75% cap
    expect(mobArmorReduction(mob, player, armor)).toBe(armorReduction(armor, mob.level));
    expect(mobArmorReduction(mob, player, armor)).toBeCloseTo(0.75);
  });

  it('a higher-level hostile mob (e.g. a raid boss) also keeps the full, uncapped armor DR', () => {
    const boss = ent({ kind: 'mob', level: 63, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const armor = 1_000_000;
    expect(mobArmorReduction(boss, player, armor)).toBe(armorReduction(armor, boss.level));
    expect(mobArmorReduction(boss, player, armor)).toBeCloseTo(0.75);
  });

  // Review finding (PR #2601, round 2): a hard `min(dr, 0.2)` right at the
  // attacker.level < target.level boundary is a discontinuous cliff (a mob one
  // level below the target snaps straight from full uncapped DR to 20%, and the
  // jump gets bigger the more armor a player stacks). mobArmorReduction ramps the
  // cap linearly over ARMOR_DR_RAMP_LEVELS (3) levels instead, so a mob only one
  // level below the target keeps most of its natural mitigation, and the cap only
  // fully saturates at MOB_VS_PLAYER_MAX_ARMOR_DR once the mob is 3+ levels down
  // (the far-below-level farm-loop case issue #1050 is actually about).
  it('a mob exactly one level below the target only partially ramps toward the DR cap, not a cliff', () => {
    const mob = ent({ kind: 'mob', level: 59, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const armor = 1_000_000;
    const natural = armorReduction(armor, mob.level);
    const capped = mobArmorReduction(mob, player, armor);
    // Strictly between the uncapped natural DR and the fully-saturated floor: a
    // one-level gap must not already be the hard floor, and must not be a no-op.
    expect(capped).toBeLessThan(natural);
    expect(capped).toBeGreaterThan(MOB_VS_PLAYER_MAX_ARMOR_DR);
    // Exact linear-ramp value at diff=1 over a 3-level span: 2/3 of the way from
    // natural toward the floor.
    const expected = natural - (natural - MOB_VS_PLAYER_MAX_ARMOR_DR) * (1 / 3);
    expect(capped).toBeCloseTo(expected, 10);
  });

  it('a mob three or more levels below the target is fully saturated at the DR cap', () => {
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const armor = 1_000_000;
    const threeBelow = ent({ kind: 'mob', level: 57, hostile: true, ownerId: null });
    const wayBelow = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    expect(mobArmorReduction(threeBelow, player, armor)).toBeCloseTo(
      MOB_VS_PLAYER_MAX_ARMOR_DR,
      10,
    );
    expect(mobArmorReduction(wayBelow, player, armor)).toBeCloseTo(MOB_VS_PLAYER_MAX_ARMOR_DR, 10);
  });

  it('low armor already under the cap ramps toward it from above, never below the natural DR', () => {
    // armor well under the 20% cap already, one level below the target: the ramp
    // math must clamp back to the natural (lower) DR, not overshoot past it.
    const mob = ent({ kind: 'mob', level: 59, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const armor = 50;
    expect(mobArmorReduction(mob, player, armor)).toBe(armorReduction(armor, mob.level));
  });
});

describe('enemy mob-cast spells never resist more than MOB_VS_PLAYER_MAX_RESIST against a player (issue #1050)', () => {
  // isMobSpellResisted only exposes its outcome via the rng.chance(p) roll, so a
  // fake rng that records the probability it was asked to roll lets these tests
  // assert on the FLOORED hit chance directly, the same way swingMissChance's
  // tests assert on its return value.
  function recordingRng(result: boolean): { rng: { chance(p: number): boolean }; calls: number[] } {
    const calls: number[] = [];
    return {
      rng: {
        chance(p: number) {
          calls.push(p);
          return result;
        },
      },
      calls,
    };
  }

  it('a low-level hostile mob casting at a much higher-level player has its resist chance floored', () => {
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 60, ownerId: null });
    const naturalHit = effectiveSpellHit(mob.level, player.level);
    // The raw above-level resist (uncapped) still exceeds the mob-facing floor...
    expect(1 - naturalHit).toBeGreaterThan(MOB_VS_PLAYER_MAX_RESIST);
    const { rng, calls } = recordingRng(true);
    isMobSpellResisted(rng, mob, player);
    // ...but the roll was made against the floored hit chance, not the raw one.
    expect(calls[0]).toBeCloseTo(1 - MOB_VS_PLAYER_MAX_RESIST, 10);
  });

  it('a player casting at a higher-level mob keeps the full above-level resist scaling (untouched)', () => {
    const player = ent({ kind: 'player', level: 6, ownerId: null });
    const mob = ent({ kind: 'mob', level: 10, hostile: true, ownerId: null });
    const naturalHit = effectiveSpellHit(player.level, mob.level);
    const { rng, calls } = recordingRng(true);
    isMobSpellResisted(rng, player, mob);
    expect(calls[0]).toBeCloseTo(naturalHit, 10);
  });

  it('a mob casting at a player-owned pet is also floored (the pet is player-side)', () => {
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const pet = ent({ kind: 'mob', level: 60, ownerId: 99 }); // ownerId set -> owned pet
    const { rng, calls } = recordingRng(true);
    isMobSpellResisted(rng, mob, pet);
    expect(calls[0]).toBeGreaterThanOrEqual(1 - MOB_VS_PLAYER_MAX_RESIST - 1e-9);
  });

  it('equal / below level is unchanged for both directions', () => {
    const mob = ent({ kind: 'mob', level: 10, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 10, ownerId: null });
    const naturalHit = effectiveSpellHit(mob.level, player.level);
    const { rng, calls } = recordingRng(true);
    isMobSpellResisted(rng, mob, player);
    expect(calls[0]).toBeCloseTo(naturalHit, 10);
  });
});

// The actual gameplay stake behind issue #1050: a hunter/warlock pet (or a bare
// AFK player) left on Defensive stance against low-level mobs while heavily
// armored and far above their level. Before this fix, armor DR alone could
// mitigate a landed mob hit down to 25% of its raw damage (armorReduction's 75%
// cap) on top of the already-floored miss chance, making sustained mob DPS
// negligible against passive HP regen. Runs the SAME rng seed and setup twice,
// varying only the target's armor, so the pre-armor roll/crit sequence (and thus
// which swings land, and their raw pre-mitigation damage) is byte-identical
// between the two runs; only the post-mitigation dealt amount can differ.
describe('farm-loop regression: mob-vs-player damage floor keeps AFK farming non-risk-free (issue #1050)', () => {
  function totalMobDamage(seed: number, armor: number, swings: number): number {
    const sim = new Sim({ seed, playerClass: 'mage', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Farmer');
    const player = sim.entities.get(pid);
    if (!player) throw new Error('player entity not found after addPlayer');
    player.level = 60;
    player.maxHp = 1_000_000_000;
    player.hp = 1_000_000_000;
    player.stats.armor = armor;
    const mob = createMob((sim as unknown as { nextId: number }).nextId++, MOBS.forest_wolf, 1, {
      x: 1,
      y: 0,
      z: 0,
    });
    mob.hostile = true;
    mob.hp = mob.maxHp;
    (sim as unknown as { addEntity(e: Entity): void }).addEntity(mob);
    player.pos = { x: 0, y: 0, z: 0 };
    player.prevPos = { ...player.pos };

    let total = 0;
    const origEmit = (sim as unknown as { emit(ev: SimEvent): void }).emit.bind(sim);
    (sim as unknown as { emit(ev: SimEvent): void }).emit = (ev: SimEvent) => {
      if (ev.type === 'damage' && ev.sourceId === mob.id && ev.targetId === player.id) {
        total += ev.amount;
      }
      return origEmit(ev);
    };
    for (let i = 0; i < swings; i++) {
      (sim as unknown as { mobSwing(m: Entity, t: Entity): void }).mobSwing(mob, player);
    }
    return total;
  }

  it('a heavily armored, far-above-level player still takes >= ~80% of the raw mob damage a bare target would', () => {
    const seed = 1234;
    const swings = 300;
    const baseline = totalMobDamage(seed, 0, swings); // no armor: DR is 0, so this is raw damage
    const armored = totalMobDamage(seed, 1_000_000, swings); // armor DR pinned at its 75% raw cap
    expect(baseline).toBeGreaterThan(0);
    // Before the fix, armor DR alone could cut this ratio to ~0.25 (the 75% DR
    // cap). The floor holds it at >= (1 - MOB_VS_PLAYER_MAX_ARMOR_DR), with a
    // little slack for block/rounding.
    expect(armored / baseline).toBeGreaterThanOrEqual(1 - MOB_VS_PLAYER_MAX_ARMOR_DR - 0.05);
    // Sanity check the floor is a floor, not a removal of mitigation entirely.
    expect(armored / baseline).toBeLessThan(1);
  });
});
