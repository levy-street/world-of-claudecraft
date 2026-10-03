// /dev crypt (src/sim/dev/hollow_crypt_dev.ts): the playtest helpers the
// owner walks the rework with. Enter, teleport per area, open every gate,
// kill a pack or boss, and reset the run.

import { afterEach, describe, expect, it } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { HOLLOW_CRYPT_GATES } from '../src/sim/content/hollow_crypt';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { HOLLOW_CRYPT_DEV_AREAS } from '../src/sim/dev/hollow_crypt_dev';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import { dungeonGateState } from '../src/sim/instances/dungeon_gates';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function setup(): { sim: Sim; pid: number; me: () => Entity } {
  const sim = new Sim({
    seed: 17,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Walker');
  return { sim, pid, me: () => sim.ctx.entities.get(pid) as Entity };
}

describe('/dev crypt', () => {
  afterEach(() => clearDungeonGateStateForTest());

  it('teleports to every named area on walkable ground inside the run', () => {
    const { sim, pid, me } = setup();
    for (const [area, spot] of Object.entries(HOLLOW_CRYPT_DEV_AREAS)) {
      for (let t = 0; t < 40; t++) sim.tick(); // clear of the chat throttle
      sim.chat(`/dev crypt tp ${area}`, pid);
      const inst = claimedInstanceAt(sim.ctx, me().pos);
      expect(inst?.dungeonId, area).toBe('hollow_crypt');
      const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst?.slot ?? 0);
      expect(me().pos.x - o.x, area).toBeCloseTo(spot.x, 3);
      expect(me().pos.z - o.z, area).toBeCloseTo(spot.z, 3);
      // Never dropped into the mist chasm or inside a wall.
      expect(groundHeight(me().pos.x, me().pos.z, sim.cfg.seed), area).toBeGreaterThan(-39);
      expect(isBlocked(sim.cfg.seed, me().pos.x, me().pos.z, 0.5), area).toBe(false);
    }
  });

  it('opens every gate for the run, and a reset closes them again', () => {
    const { sim, pid, me } = setup();
    sim.chat('/dev crypt enter', pid);
    sim.chat('/dev crypt gates', pid);
    sim.tick();
    let inst = claimedInstanceAt(sim.ctx, me().pos);
    if (!inst) throw new Error('no claim');
    for (const g of HOLLOW_CRYPT_GATES)
      expect(dungeonGateState(sim.ctx, inst, g), g.id).toBe('open');
    sim.chat('/dev crypt reset', pid);
    sim.tick();
    inst = claimedInstanceAt(sim.ctx, me().pos);
    if (!inst) throw new Error('no fresh claim');
    expect(dungeonGateState(sim.ctx, inst, HOLLOW_CRYPT_GATES[0])).toBe('closed');
  });

  it('kills a named pack, then a boss, which opens exactly their gates', () => {
    const { sim, pid, me } = setup();
    sim.chat('/dev crypt enter', pid);
    for (const pack of ['c1', 'c2', 'c3', 'c4']) sim.chat(`/dev crypt kill ${pack}`, pid);
    sim.tick();
    const inst = claimedInstanceAt(sim.ctx, me().pos);
    if (!inst) throw new Error('no claim');
    const grille = HOLLOW_CRYPT_GATES.find((g) => g.id === 'grille');
    const causeway = HOLLOW_CRYPT_GATES.find((g) => g.id === 'web_bridge');
    if (!grille || !causeway) throw new Error('gates');
    expect(dungeonGateState(sim.ctx, inst, grille)).toBe('open');
    expect(dungeonGateState(sim.ctx, inst, causeway)).toBe('closed');
    sim.chat('/dev crypt kill rimeweb', pid);
    sim.tick();
    expect(dungeonGateState(sim.ctx, inst, causeway)).toBe('open');
  });
});
