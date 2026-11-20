// The per-dungeon claim footprint (src/sim/instances/instance_footprint.ts):
// every shipped dungeon keeps the generic 120 yd half width, and the Smith's
// Heart, whose authored field reaches |x| 258, claims 270 so its Forge, Basin and
// Heart wings count as inside the run (occupancy, trash-kit targets, gate
// lines, deeds, summoned adds).

import { describe, expect, it } from 'vitest';
import { SMITH_HEART_FIELD } from '../src/sim/content/smith_heart_layout';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import {
  INSTANCE_FOOTPRINT_HALF_WIDTH,
  instanceHalfWidthOf,
} from '../src/sim/instances/instance_footprint';
import type { InstanceSlot } from '../src/sim/sim';
import { Sim } from '../src/sim/sim';
import type { WorldContent } from '../src/sim/types';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function claim(dungeonId: string): { sim: Sim; inst: InstanceSlot } {
  const sim = new Sim({
    seed: 5,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Footprint');
  expect(enterDungeon(sim.ctx, dungeonId, pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === dungeonId && i.partyKey !== null,
  ) as InstanceSlot;
  return { sim, inst };
}

describe('the instance claim footprint', () => {
  it('keeps the generic half width for every shipped dungeon', () => {
    for (const id of Object.keys(DUNGEONS)) {
      if (id === 'smith_heart') continue;
      expect(instanceHalfWidthOf(id), id).toBe(INSTANCE_FOOTPRINT_HALF_WIDTH);
    }
    expect(INSTANCE_FOOTPRINT_HALF_WIDTH).toBe(120);
  });

  it("covers the whole Smith's Heart field and stays inside its 600 yd band", () => {
    const half = instanceHalfWidthOf('smith_heart');
    const { minX, maxX } = SMITH_HEART_FIELD.bounds;
    expect(half).toBeGreaterThan(Math.max(-minX, maxX));
    expect(half).toBeLessThan(300);
  });

  it("resolves the Smith's Heart claim in its far wings, a generic one only within 120", () => {
    const heart = claim('smith_heart');
    const o = instanceOrigin(DUNGEONS.smith_heart.index, heart.inst.slot);
    for (const x of [-250, -200, -150, 0, 150, 200, 245]) {
      expect(claimedInstanceAt(heart.sim.ctx, { x: o.x + x, y: 0, z: o.z }), `x ${x}`).toBe(
        heart.inst,
      );
    }
    const crypt = claim('hollow_crypt');
    const c = instanceOrigin(DUNGEONS.hollow_crypt.index, crypt.inst.slot);
    expect(claimedInstanceAt(crypt.sim.ctx, { x: c.x + 100, y: 0, z: c.z })).toBe(crypt.inst);
    expect(claimedInstanceAt(crypt.sim.ctx, { x: c.x + 150, y: 0, z: c.z })).toBeNull();
  });
});
