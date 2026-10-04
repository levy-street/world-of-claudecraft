import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { mobBaseStats } from '../src/sim/mob_base_stats';

describe('mobBaseStats', () => {
  it.each([
    ['morthen', 10],
    ['crypt_shambler', 7],
    ['forest_wolf', 1],
    ['forest_wolf', 12],
  ])('matches what createMob gives %s at level %i', (id, level) => {
    const template = MOBS[id];
    const mob = createMob(1, template, level, { x: 0, y: 0, z: 0 });
    const base = mobBaseStats(template, level);
    expect(base.maxHp).toBe(mob.maxHp);
    expect(base.weapon).toEqual(mob.weapon);
    expect(base.armor).toBe(mob.stats.armor);
  });

  it('pins the classic elite scaling on the Crypt boss', () => {
    expect(MOBS.morthen.elite).toBe(true);
    expect(mobBaseStats(MOBS.morthen, 10)).toEqual({
      maxHp: 1191,
      weapon: { min: 41, max: 65, speed: 2.6 },
      armor: 234,
    });
  });
});
