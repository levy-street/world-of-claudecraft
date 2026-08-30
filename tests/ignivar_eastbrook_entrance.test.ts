// The Ignivar raid's walk-up testing entrance in Eastbrook. The raid family's
// public front door (a Drakelands gate, docs/design/ignivar-entrance/plan.md)
// is still to be authored; until it lands, the Halls of the First Tempering
// keep a plain overworld door on the Eastbrook market block so raid groups
// can zone in without /dev commands. These tests pin the door's content
// shape, the site's safety against the town layout and camp discs, and the
// enter / refuse / leave loop through the real door and trigger paths.
import { describe, expect, it } from 'vitest';
import { ZONE1_CAMPS, ZONE1_ROADS } from '../src/sim/content/zone1';
import { DUNGEON_X_THRESHOLD, DUNGEONS } from '../src/sim/data';
import { DOOR_CLEAR_RADIUS } from '../src/sim/dungeon_door_clearance';
import {
  distancePointToObb,
  EASTBROOK_LAYOUT,
  type Obb2,
  type Point2,
  samplePolyline,
} from '../src/sim/eastbrook_layout';
import {
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_SECOND_WING_ID,
} from '../src/sim/ignivar_raid_ids';
import { enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { collectCalmAnchorPads } from '../src/sim/terrain_calm_anchors';
import { terrainHeight } from '../src/sim/world';

const DOOR_POS = { x: -24, z: -114 };
const DEEPER_WINGS = [
  IGNIVAR_RAID_ARENA_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
  IGNIVAR_SECOND_WING_ID,
] as const;

function eastbrookSolids(): Obb2[] {
  return [
    ...EASTBROOK_LAYOUT.preservedBuildings.map((building) => building.footprint),
    ...EASTBROOK_LAYOUT.buildings.map((building) => building.footprint),
    ...EASTBROOK_LAYOUT.market.stalls.map((stall) => stall.footprint),
    ...EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.footprint),
    ...EASTBROOK_LAYOUT.fences.map((fence) => fence.footprint),
    EASTBROOK_LAYOUT.services.noticeboard.footprint,
  ];
}

function solidClearance(point: Point2): number {
  let clearance =
    Math.hypot(
      point.x - EASTBROOK_LAYOUT.civic.wellBeacon.position.x,
      point.z - EASTBROOK_LAYOUT.civic.wellBeacon.position.z,
    ) - EASTBROOK_LAYOUT.civic.wellBeacon.radius;
  for (const obb of eastbrookSolids()) {
    clearance = Math.min(clearance, distancePointToObb(point, obb));
  }
  return clearance;
}

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

describe('Ignivar Eastbrook entrance: content shape', () => {
  it('gives the forge approach the Eastbrook door and keeps the deeper wings interior-only', () => {
    const approach = DUNGEONS[IGNIVAR_FORGE_APPROACH_ID];
    expect(approach.doorPos).toEqual(DOOR_POS);
    expect(approach.overworldDoor).not.toBe(false);
    // Spoiler rule: the testing entrance never publishes the raid to the Guide.
    expect(approach.guideVisible).toBe(false);
    for (const id of DEEPER_WINGS) {
      expect(DUNGEONS[id].overworldDoor, id).toBe(false);
      // Leaving any raid room drops beside the Eastbrook entrance, not at the
      // old world-origin placeholder.
      expect(DUNGEONS[id].doorPos, id).toEqual(DOOR_POS);
    }
  });

  it('registers the door terrain calm pad at the Eastbrook site only', () => {
    const doorPads = collectCalmAnchorPads().filter((pad) => pad.category === 'dungeonDoor');
    expect(doorPads.filter((pad) => pad.x === DOOR_POS.x && pad.z === DOOR_POS.z)).toHaveLength(1);
    expect(doorPads.some((pad) => pad.x === 0 && pad.z === 0)).toBe(false);
  });
});

describe('Ignivar Eastbrook entrance: site safety', () => {
  it('stands clear of every Eastbrook solid, including its jambs and leave drop', () => {
    // Jambs extend DOOR_ARCH_JAMB_X (1.5) to each side; the leave drop is the
    // default leaveOffset {0, -4}. Floors leave margin so a future layout
    // addition crowding the door fails here with a named point.
    expect(solidClearance(DOOR_POS)).toBeGreaterThanOrEqual(3);
    expect(solidClearance({ x: DOOR_POS.x - 1.5, z: DOOR_POS.z })).toBeGreaterThanOrEqual(3);
    expect(solidClearance({ x: DOOR_POS.x + 1.5, z: DOOR_POS.z })).toBeGreaterThanOrEqual(3);
    expect(solidClearance({ x: DOOR_POS.x, z: DOOR_POS.z - 4 })).toBeGreaterThanOrEqual(1.5);
  });

  it('sits outside every camp disc by the full door clearance radius', () => {
    // At >= DOOR_CLEAR_RADIUS from every disc edge the camp spawner's
    // projection never engages, so the door displaces zero mob spawns.
    for (const camp of ZONE1_CAMPS) {
      const edgeDistance =
        Math.hypot(DOOR_POS.x - camp.center.x, DOOR_POS.z - camp.center.z) - camp.radius;
      expect(edgeDistance, camp.mobId).toBeGreaterThanOrEqual(DOOR_CLEAR_RADIUS);
    }
  });

  it('stays reachable from the zone road network', () => {
    let nearestRoad = Infinity;
    for (const road of ZONE1_ROADS) {
      for (const point of samplePolyline(road, 0.25)) {
        nearestRoad = Math.min(nearestRoad, Math.hypot(DOOR_POS.x - point.x, DOOR_POS.z - point.z));
      }
    }
    expect(nearestRoad).toBeLessThanOrEqual(10);
  });
});

describe('Ignivar Eastbrook entrance: the door in the live world', () => {
  it('spawns exactly one approach door at the Eastbrook site', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
    const doors = [...sim.entities.values()].filter(
      (e) => e.templateId === 'dungeon_door' && e.dungeonId === IGNIVAR_FORGE_APPROACH_ID,
    );
    expect(doors).toHaveLength(1);
    expect(doors[0].pos.x).toBe(DOOR_POS.x);
    expect(doors[0].pos.z).toBe(DOOR_POS.z);
    expect(doors[0].name).toBe('Halls of the First Tempering');
  });

  it('zones a raid group into the Halls through the walk-in trigger', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Approach Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    placeAt(sim, sim.player.id, DOOR_POS.x, DOOR_POS.z - 1);
    sim.tick();
    expect(sim.player.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    const claim = sim.instances.find(
      (inst) => inst.dungeonId === IGNIVAR_FORGE_APPROACH_ID && inst.partyKey !== null,
    );
    expect(claim).toBeDefined();
  });

  it('refuses a solo player at the door and leaves them outside', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    placeAt(sim, sim.player.id, DOOR_POS.x, DOOR_POS.z - 1);
    const events = sim.tick();
    expect(
      events.some(
        (e) =>
          e.type === 'error' && e.text === 'You must convert your party to a raid group first.',
      ),
    ).toBe(true);
    expect(sim.player.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
  });

  it('drops players leaving the approach beside the Eastbrook door', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    const ally = sim.addPlayer('paladin', 'Leave Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_FORGE_APPROACH_ID, sim.player.id)).toBe(true);
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    expect(sim.player.pos.x).toBeCloseTo(DOOR_POS.x);
    expect(sim.player.pos.z).toBeCloseTo(DOOR_POS.z - 4);
  });

  it('drops players leaving a deeper wing beside the Eastbrook door too', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', devCommands: true });
    const ally = sim.addPlayer('paladin', 'Deep Ally');
    formTestRaid(sim, [sim.player.id, ally]);
    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, sim.player.id, true)).toBe(true);
    expect(leaveDungeon(sim.ctx, sim.player.id)).toBe(true);
    expect(sim.player.pos.x).toBeCloseTo(DOOR_POS.x);
    expect(sim.player.pos.z).toBeCloseTo(DOOR_POS.z - 4);
  });
});
