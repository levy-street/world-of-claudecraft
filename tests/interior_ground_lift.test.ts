import { describe, expect, it } from 'vitest';
import { DUNGEON_FLOOR_Y, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { dawnholdKeepLiftAt, lastKeepLiftAt } from '../src/sim/dungeon_layout';
import { fireAndFlyFieldHeight } from '../src/sim/fire_and_fly_field';
import { interiorGroundLift } from '../src/sim/interior_ground_lift';
import type { DungeonDef } from '../src/sim/types';
import { wildheartFieldHeight } from '../src/sim/wildheart_field';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const LIFTS: [DungeonDef['interior'], (x: number, z: number) => number][] = [
  ['wildheart', wildheartFieldHeight],
  ['fire_and_fly', fireAndFlyFieldHeight],
  ['lastkeep', lastKeepLiftAt],
  ['dawnhold', dawnholdKeepLiftAt],
];

describe('the interiors that stand on their own floor', () => {
  it.each(LIFTS)('grounds the %s interior on its own lift, in every slot', (interior, lift) => {
    expect(interiorGroundLift(interior)).toBe(lift);
    const dungeon = Object.values(DUNGEONS).find((d) => d.interior === interior)!;
    expect(dungeon).toBeDefined();
    for (const slot of [0, 3]) {
      const origin = instanceOrigin(dungeon.index, slot);
      for (const [lx, lz] of [
        [0, 0],
        [12.5, -30],
        [-41, 18],
      ]) {
        expect(groundHeight(origin.x + lx, origin.z + lz, WORLD_SEED)).toBe(
          DUNGEON_FLOOR_Y + lift(lx, lz),
        );
      }
    }
  });

  it('leaves every other interior on the flat room floor', () => {
    const own = new Set(LIFTS.map(([interior]) => interior));
    for (const dungeon of Object.values(DUNGEONS)) {
      if (own.has(dungeon.interior)) continue;
      expect(interiorGroundLift(dungeon.interior), dungeon.id).toBeUndefined();
    }
  });
});
