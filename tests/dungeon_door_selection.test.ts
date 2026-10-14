import { describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, DUNGEONS } from '../src/sim/data';
import { createGroundObject } from '../src/sim/entity';
import { nearestDungeonDoor } from '../src/sim/instances/dungeon_door_selection';
import { updateDoorTriggers } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';

function makeSim() {
  return new Sim({
    seed: 42,
    playerClass: 'warrior',
    world: { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] },
  });
}

function overlappingDoors(sim: Sim, height = 0) {
  // Isolate the real automatic trigger from authored doors at other locations.
  const ids: number[] = [];
  for (const [dungeonId, x, y] of [
    ['hollow_crypt', 0, height],
    ['sunken_bastion', 1, 0],
  ] as const) {
    const door = createGroundObject(sim.nextId++, '', 'Test door', { x, y, z: 0 });
    door.templateId = 'dungeon_door';
    door.dungeonId = dungeonId;
    sim.addEntity(door);
    ids.push(door.id);
  }
  sim.ctx.dungeonDoorIds = ids;
  return ids;
}

function releaseIn(sim: Sim, dungeonId: string) {
  sim.enterDungeon(dungeonId);
  expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(dungeonId);
  sim.player.pos.z += 30;
  sim.player.dead = true;
  sim.releaseSpirit();
  expect(sim.player.ghost).toBe(true);
}

describe('overlapping dungeon door selection', () => {
  it('uses stable ids for equal-distance doors and excludes the trigger boundary', () => {
    const sim = makeSim();
    const ids = overlappingDoors(sim);
    const pos = { x: 0.5, y: 0, z: 0 };
    expect(nearestDungeonDoor(sim.entities, ids, pos, 2, null)?.id).toBe(ids[0]);
    expect(nearestDungeonDoor(sim.entities, [...ids].reverse(), pos, 2, null)?.id).toBe(ids[0]);
    expect(nearestDungeonDoor(sim.entities, [ids[0]], { x: 2, y: 0, z: 0 }, 2, null)).toBeNull();
    expect(nearestDungeonDoor(sim.entities, [-1], pos, 2, null)).toBeNull();
  });
  it('enters the closest door instead of the first spawned door', () => {
    const sim = makeSim();
    overlappingDoors(sim);
    sim.player.pos = { x: 0.9, y: 0, z: 0 };
    updateDoorTriggers(sim.ctx, sim.player);
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe('sunken_bastion');
  });

  it('does not enter a door on a different floor with the same horizontal position', () => {
    const sim = makeSim();
    overlappingDoors(sim, 10);
    sim.player.pos = { x: 0, y: 0, z: 0 };
    updateDoorTriggers(sim.ctx, sim.player);
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe('sunken_bastion');
  });

  it('prioritizes the corpse dungeon when its door overlaps another entrance', () => {
    const sim = makeSim();
    releaseIn(sim, 'sunken_bastion');
    overlappingDoors(sim);
    sim.player.pos = { x: 0, y: 0, z: 0 };
    updateDoorTriggers(sim.ctx, sim.player);
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe('sunken_bastion');
    expect(sim.player.ghost).toBe(false);
    expect(sim.player.dead).toBe(false);
  });

  it('keeps a spirit released when it traverses an unrelated dungeon', () => {
    const sim = makeSim();
    releaseIn(sim, 'sunken_bastion');
    const corpse = { ...sim.player.corpsePos! };
    const claimId = sim.player.corpseInstanceId;
    sim.enterDungeon('hollow_crypt');
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe('hollow_crypt');
    expect(sim.player.ghost).toBe(true);
    expect(sim.player.dead).toBe(true);
    expect(sim.player.corpsePos).toEqual(corpse);
    expect(sim.player.corpseInstanceId).toBe(claimId);
    sim.enterDungeon('sunken_bastion');
    expect(sim.player.ghost).toBe(false);
  });

  it('does not revive in another party claim of the same dungeon', () => {
    const sim = makeSim();
    releaseIn(sim, 'sunken_bastion');
    const corpseClaim = sim.player.corpseInstanceId;
    const leader = sim.addPlayer('warrior', 'Other party');
    sim.enterDungeon('sunken_bastion', leader);
    sim.partyInvite(sim.player.id, leader);
    sim.partyAccept(sim.player.id);
    sim.enterDungeon('sunken_bastion');
    expect(sim.instanceClaimIdAt(sim.player.pos)).not.toBe(corpseClaim);
    expect(sim.player.ghost).toBe(true);
    expect(sim.player.corpseInstanceId).toBe(corpseClaim);
  });

  it('preserves normal single-door entry', () => {
    const sim = makeSim();
    const dungeon = DUNGEONS.hollow_crypt;
    sim.player.pos = sim.groundPos(dungeon.doorPos.x, dungeon.doorPos.z);
    updateDoorTriggers(sim.ctx, sim.player);
    expect(sim.instanceInfoAt(sim.player.pos)?.dungeonId).toBe(dungeon.id);
  });
});
