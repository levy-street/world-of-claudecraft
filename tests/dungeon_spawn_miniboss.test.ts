import { describe, expect, it } from 'vitest';

import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { applyDungeonSpawnMinibossTuning } from '../src/sim/instances/dungeon_spawn_miniboss';

describe('dungeon spawn miniboss tuning', () => {
  it('promotes one entity without mutating its reusable base template', () => {
    const template = MOBS.ignivar_crucible_warden;
    const mob = createMob(1, template, 20, { x: 0, y: 0, z: 0 });

    applyDungeonSpawnMinibossTuning(mob, {
      healthMultiplier: 2.35,
      scale: 2.75,
      ccImmune: true,
      slowImmune: true,
    });

    expect(mob).toMatchObject({
      maxHp: 7539,
      hp: 7539,
      scale: 2.75,
      ccImmune: true,
      slowImmune: true,
      dungeonSpawnMiniboss: true,
    });
    expect(template).toMatchObject({ hpBase: 350, hpPerLevel: 55, scale: 1.7 });
    expect(template.ccImmune).toBeUndefined();
    expect(template.slowImmune).toBeUndefined();
  });

  it('leaves an ordinary Warden unmarked when no promotion is authored', () => {
    const mob = createMob(1, MOBS.ignivar_crucible_warden, 20, { x: 0, y: 0, z: 0 });

    applyDungeonSpawnMinibossTuning(mob, undefined);

    expect(mob.dungeonSpawnMiniboss).toBeUndefined();
    expect(mob.scale).toBe(1.7);
  });
});
