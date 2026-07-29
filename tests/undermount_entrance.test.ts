// The Undermount raid's in-world entrance: wing 1 has the single overworld door
// (the Thornpeak fissure); wings 2 and 3 are reached through internal sealed doors.
// This proves the raid is actually enterable in the world (walk into the door),
// not just via a direct enterDungeon call.

import { describe, expect, it } from 'vitest';
import { instanceKeyFor, updateDoorTriggers } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnySim = Sim & Record<string, any>;
type AnyEntity = Entity & Record<string, any>;

function makeSim(seed = 3): AnySim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true }) as AnySim;
}

function overworldDoor(sim: AnySim, dungeonId: string): AnyEntity | undefined {
  return [...sim.entities.values()].find(
    (e: AnyEntity) => e.templateId === 'dungeon_door' && e.dungeonId === dungeonId,
  );
}

describe('Undermount surface entrance', () => {
  it('spawns exactly one overworld door: wing 1, not wings 2 and 3', () => {
    const sim = makeSim();
    expect(overworldDoor(sim, 'undermount_wing1'), 'wing 1 door').toBeDefined();
    for (const id of ['undermount_wing2', 'undermount_wing3']) {
      expect(overworldDoor(sim, id), `${id} has no overworld door`).toBeUndefined();
    }
  });

  it('lets a player walk into the fissure and enter wing 1', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Solo');
    const p = sim.entities.get(pid) as AnyEntity;
    const door = overworldDoor(sim, 'undermount_wing1');
    if (!door) throw new Error('no wing 1 door');

    // Stand on the door and let the walk-in trigger fire.
    p.pos = {
      x: door.pos.x,
      y: terrainHeight(door.pos.x, door.pos.z, sim.cfg.seed),
      z: door.pos.z,
    };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    updateDoorTriggers(sim.ctx, p);

    const inst = (sim.instances as any[]).find(
      (i) => i.dungeonId === 'undermount_wing1' && i.partyKey === instanceKeyFor(sim.ctx, pid),
    );
    expect(inst, 'entered wing 1 through the door').toBeDefined();
  });
});
