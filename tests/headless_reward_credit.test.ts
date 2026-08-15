import { describe, expect, it } from 'vitest';
import { ownedPetDamageForReward } from '../headless/reward_credit';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import type { SimEvent } from '../src/sim/types';

describe('ownedPetDamageForReward', () => {
  it('credits controlled undead and excludes player or foreign-pet damage', () => {
    const owned = createMob(10, MOBS.graveguard, 20, { x: 0, y: 0, z: 0 });
    owned.ownerId = 1;
    const foreign = createMob(11, MOBS.graveguard, 20, { x: 0, y: 0, z: 0 });
    foreign.ownerId = 2;
    const entities = new Map([
      [owned.id, owned],
      [foreign.id, foreign],
    ]);
    const damage = (sourceId: number, amount: number): SimEvent =>
      ({
        type: 'damage',
        sourceId,
        targetId: 99,
        amount,
        crit: false,
        school: 'shadow',
        ability: 'test',
        kind: 'hit',
      }) as SimEvent;

    expect(
      ownedPetDamageForReward(
        [damage(owned.id, 25), damage(foreign.id, 40), damage(1, 50)],
        entities,
        1,
      ),
    ).toBe(25);
  });
});
