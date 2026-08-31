// The Ignivar raid's ONE overworld entrance: the keep tower door on
// Forgefather's Isle (the forge-lift's walk-up). The old Eastbrook walk-up
// testing door is retired (docs/design/ignivar-entrance/plan.md): the Halls
// and every deeper wing are interior-only rooms whose doorPos is only where
// leaving sets players down, beside the keep. These tests pin the content
// shape, the door in the live world, and the enter / refuse / leave loop
// through the real keep door and trigger paths.
import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD, DUNGEONS } from '../src/sim/data';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { collectCalmAnchorPads } from '../src/sim/terrain_calm_anchors';
import { dist2d } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

const KEEP_DOOR_POS = { x: 503.05, z: 2243.7 };
const APPROACH_LEAVE_OFFSET = { x: 0, z: -6.5 };
const RETIRED_EASTBROOK_POS = { x: -24, z: -114 };
const INTERIOR_ROOMS = [
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_SECOND_WING_ID,
] as const;

function placeAt(sim: Sim, pid: number, x: number, z: number): void {
  const p = sim.entities.get(pid);
  if (!p) throw new Error(`missing player ${pid}`);
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = terrainHeight(x, z, sim.cfg.seed);
  p.prevPos = { ...p.pos };
}

function formTestRaid(sim: Sim, pids: number[]): void {
  const raid = sim.ctx.formDungeonFinderGroup(
    pids.map((pid) => ({ partyId: null, leaderPid: pid, members: [pid] })),
    { raid: true },
  );
  if (!raid) throw new Error('test raid did not form');
}

describe('Ignivar keep entrance: content shape', () => {
  it('keeps the lift as the one walk-up room and every deeper wing interior-only', () => {
    const lift = DUNGEONS[IGNIVAR_LIFT_ROOM_ID];
    expect(lift.doorPos).toEqual(KEEP_DOOR_POS);
    expect(lift.overworldDoor).not.toBe(false);
    // Spoiler rule: the raid never publishes to the Guide through its door.
    expect(lift.guideVisible).toBe(false);
    for (const id of INTERIOR_ROOMS) {
      expect(DUNGEONS[id].overworldDoor, id).toBe(false);
      // Leaving any raid room sets players down beside the keep entrance,
      // never at the retired Eastbrook walk-up.
      expect(DUNGEONS[id].doorPos, id).toEqual(KEEP_DOOR_POS);
      expect(DUNGEONS[id].guideVisible, id).toBe(false);
    }
    expect(DUNGEONS[IGNIVAR_FORGE_APPROACH_ID].leaveOffset).toEqual(APPROACH_LEAVE_OFFSET);
  });

  it('registers the door terrain calm pad at the keep site only', () => {
    const doorPads = collectCalmAnchorPads().filter((pad) => pad.category === 'dungeonDoor');
    expect(
      doorPads.filter((pad) => pad.x === KEEP_DOOR_POS.x && pad.z === KEEP_DOOR_POS.z),
    ).toHaveLength(1);
    // The retired Eastbrook site no longer calms terrain, and neither does the
    // old world-origin placeholder.
    expect(
      doorPads.some(
        (pad) => pad.x === RETIRED_EASTBROOK_POS.x && pad.z === RETIRED_EASTBROOK_POS.z,
      ),
    ).toBe(false);
    expect(doorPads.some((pad) => pad.x === 0 && pad.z === 0)).toBe(false);
  });
});

describe('Ignivar keep entrance: the door in the live world', () => {
  it('spawns exactly one raid door, the lift door at the keep', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const liftDoors = [...sim.entities.values()].filter(
      (e) => e.templateId === 'dungeon_door' && e.dungeonId === IGNIVAR_LIFT_ROOM_ID,
    );
    expect(liftDoors).toHaveLength(1);
    expect(liftDoors[0].pos.x).toBe(KEEP_DOOR_POS.x);
    expect(liftDoors[0].pos.z).toBe(KEEP_DOOR_POS.z);
    expect(liftDoors[0].name).toBe('The Forge-Lift');
    // No interior room spawns an overworld door, and nothing dungeon-shaped
    // stands at the retired Eastbrook site.
    for (const id of INTERIOR_ROOMS) {
      expect(
        [...sim.entities.values()].some(
          (e) => e.templateId === 'dungeon_door' && e.dungeonId === id,
        ),
        id,
      ).toBe(false);
    }
    expect(
      [...sim.entities.values()].some(
        (e) =>
          e.templateId === 'dungeon_door' &&
          dist2d(e.pos, { x: RETIRED_EASTBROOK_POS.x, y: 0, z: RETIRED_EASTBROOK_POS.z }) < 50,
      ),
      'no dungeon door within 50 yards of the retired Eastbrook site',
    ).toBe(false);
  });

  it('boards a raid group onto the forge-lift through the walk-in trigger', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Keep Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    placeAt(sim, sim.player.id, KEEP_DOOR_POS.x, KEEP_DOOR_POS.z - 1);
    sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const claim = sim.instances.find(
      (inst) => inst.dungeonId === IGNIVAR_LIFT_ROOM_ID && inst.partyKey !== null,
    );
    expect(claim).toBeDefined();
  });

  it('refuses a solo player at the keep door and leaves them outside', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    placeAt(sim, sim.player.id, KEEP_DOOR_POS.x, KEEP_DOOR_POS.z - 1);
    const events = sim.tick();
    expect(
      events.some(
        (e) =>
          e.type === 'error' && e.text === 'You must convert your party to a raid group first.',
      ),
    ).toBe(true);
    expect(sim.player.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
  });

  it('drops players leaving the approach beside the keep door', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    const ally = sim.addPlayer('paladin', 'Leave Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_LIFT_ROOM_ID, sim.player.id, true)).toBe(true);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id, true)).toBe(true);
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    expect(sim.player.pos.x).toBeCloseTo(KEEP_DOOR_POS.x);
    expect(sim.player.pos.z).toBeCloseTo(KEEP_DOOR_POS.z + APPROACH_LEAVE_OFFSET.z);
  });
});
