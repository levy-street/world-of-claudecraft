// PR #443 added a steep miss penalty for attacking ABOVE your level (an anti-power-
// level / anti-bot deterrent). Because meleeMissChance keys off (target - attacker)
// level, that penalty is symmetric and also fired when a LOW-level mob swung at a
// HIGHER-level player, making enemies whiff ~85% of the time. swingMissChance makes
// the penalty player -> mob ONLY: a hostile wild mob always connects >= 80% against a
// player (or a player-owned pet), while player/pet -> mob keeps the full scaling.
import { describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import { MOB_VS_PLAYER_MAX_MISS, meleeMissChance, swingMissChance } from '../src/sim/types';

// swingMissChance only reads kind / level / hostile / ownerId, so a minimal stub is
// enough to exercise the directional guard without standing up a whole world.
function ent(over: Partial<Entity>): Entity {
  return { kind: 'mob', level: 1, hostile: true, ownerId: null, ...over } as unknown as Entity;
}

describe('enemy mobs always hit players at >= 80% (PR #443 penalty is player -> mob only)', () => {
  it('a low-level wild mob vs a higher-level player has its miss capped at 20%', () => {
    const mob = ent({ kind: 'mob', level: 1, hostile: true, ownerId: null });
    const player = ent({ kind: 'player', level: 10, ownerId: null });
    // The raw #443 formula would make the mob whiff most of the time...
    expect(meleeMissChance(mob.level, player.level)).toBeGreaterThan(MOB_VS_PLAYER_MAX_MISS);
    // ...but the swing guard floors the hit at 80%.
    expect(swingMissChance(mob, player)).toBeLessThanOrEqual(MOB_VS_PLAYER_MAX_MISS);
  });

  it('a player attacking a higher-level mob keeps the full above-level penalty', () => {
    const player = ent({ kind: 'player', level: 6, ownerId: null });
    const mob = ent({ kind: 'mob', level: 10, hostile: true, ownerId: null });
    expect(swingMissChance(player, mob)).toBe(meleeMissChance(player.level, mob.level));
    expect(swingMissChance(player, mob)).toBeGreaterThan(MOB_VS_PLAYER_MAX_MISS);
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
