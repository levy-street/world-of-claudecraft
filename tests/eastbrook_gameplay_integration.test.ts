import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildingContainsPoint } from '../src/sim/building_layout';
import {
  colliderInternalsForTest,
  isBlocked,
  lineOfSightClear,
  pathCrossesFence,
  resolveMovement,
} from '../src/sim/colliders';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { STATION_RADIUS, STATIONS } from '../src/sim/content/professions';
import { FURY_ENTITY_ID, FURY_NPC_ID } from '../src/sim/content/pvp_honor';
import { ZONE1_CAMPS, ZONE1_NPCS, ZONE1_PROPS, ZONE1_ROADS } from '../src/sim/content/zone1';
import { BUILTIN_WORLD, CAMPS, PLAYER_START, QUESTS, setActiveWorldContent } from '../src/sim/data';
import {
  EASTBROOK_LAYOUT,
  EASTBROOK_NPC_PLACEMENTS_BY_ID,
  EASTBROOK_STATIONS_BY_ID,
  localToWorld,
  samplePolyline,
} from '../src/sim/eastbrook_layout';
import {
  findPath,
  PLAYER_BODY_RADIUS,
  PLAYER_MAX_CLIMB_SLOPE,
  PLAYER_SWIM_DEPTH,
} from '../src/sim/pathfind';
import { petOf, setPetMode, summonPet } from '../src/sim/pet/pet_commands';
import { isAtStation } from '../src/sim/professions/stations';
import { isResting } from '../src/sim/progression/xp';
import { Sim } from '../src/sim/sim';
import {
  dist2d,
  type Entity,
  INTERACT_RANGE,
  type NpcDef,
  type ZonePropsDef,
} from '../src/sim/types';
import { groundHeight, waterLevelAt } from '../src/sim/world';

const SEED = 20061;
const ZONE1_TOWN_NPC_IDS = EASTBROOK_LAYOUT.services.npcs
  .map((npc) => npc.id)
  .filter((id) => id in ZONE1_NPCS);

afterEach(() => setActiveWorldContent(null));

function npcEntity(sim: Sim, templateId: string): Entity {
  const entity = [...sim.entities.values()].find(
    (candidate) => candidate.kind === 'npc' && candidate.templateId === templateId,
  );
  if (!entity) throw new Error(`missing NPC entity ${templateId}`);
  return entity;
}

function standAt(sim: Sim, pid: number, target: { x: number; z: number }): Entity {
  const player = sim.entities.get(pid);
  if (!player) throw new Error(`missing player ${pid}`);
  player.pos = sim.groundPos(target.x, target.z);
  player.prevPos = { ...player.pos };
  sim.rebucket(player);
  return player;
}

function stableTownNpcPayload(): Record<string, Omit<NpcDef, 'pos' | 'facing'> | NpcDef> {
  return Object.fromEntries(
    Object.entries(ZONE1_NPCS).map(([id, def]) => {
      if (def.dynamic) return [id, def];
      const { pos: _pos, facing: _facing, ...stable } = def;
      return [id, stable];
    }),
  );
}

function midpoint(a: { x: number; z: number }, b: { x: number; z: number }) {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function expectWalkableRoute(
  label: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  bodyRadius: number,
): void {
  const options = {
    seed: SEED,
    bodyRadius,
    maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
    minGround: (x: number, z: number) => waterLevelAt(x, z) - PLAYER_SWIM_DEPTH,
    maxSpan: 128,
  } as const;
  let route = findPath(from, to, options);
  expect(route.length, `${label} has no route`).toBeGreaterThan(0);
  let current = { ...from };
  let waypointIndex = 0;
  let stalledTicks = 0;
  expect(isBlocked(SEED, current.x, current.z, bodyRadius), `${label} start blocked`).toBe(false);
  expect(isBlocked(SEED, to.x, to.z, bodyRadius), `${label} destination blocked`).toBe(false);

  // Follow the path through the real collision resolver. This mirrors runtime
  // movement: a tangent grid waypoint may slide around a collider before the
  // follower reaches it, so proof is based on actual resolved positions.
  for (let stepIndex = 0; stepIndex < 2_000; stepIndex++) {
    if (Math.hypot(to.x - current.x, to.z - current.z) <= 0.2) break;
    while (
      waypointIndex < route.length - 1 &&
      Math.hypot(route[waypointIndex].x - current.x, route[waypointIndex].z - current.z) <= 0.25
    ) {
      waypointIndex++;
    }
    const waypoint = route[waypointIndex] ?? to;
    const dx = waypoint.x - current.x;
    const dz = waypoint.z - current.z;
    const distance = Math.max(Math.hypot(dx, dz), Number.EPSILON);
    const stride = Math.min(0.2, distance);
    const desired = {
      x: current.x + (dx / distance) * stride,
      z: current.z + (dz / distance) * stride,
    };
    const resolved = resolveMovement(SEED, current.x, current.z, desired.x, desired.z, bodyRadius);
    expect(
      pathCrossesFence(current.x, current.z, resolved.x, resolved.z, bodyRadius),
      `${label} crosses a fence`,
    ).toBe(false);
    expect(isBlocked(SEED, resolved.x, resolved.z, bodyRadius), `${label} resolved blocked`).toBe(
      false,
    );
    const moved = Math.hypot(resolved.x - current.x, resolved.z - current.z);
    const previousGround = groundHeight(current.x, current.z, SEED);
    const nextGround = groundHeight(resolved.x, resolved.z, SEED);
    expect(nextGround, `${label} enters deep water`).toBeGreaterThanOrEqual(
      waterLevelAt(resolved.x, resolved.z) - PLAYER_SWIM_DEPTH,
    );
    expect(
      (nextGround - previousGround) / Math.max(moved, Number.EPSILON),
      `${label} exceeds climb slope`,
    ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
    current = resolved;
    stalledTicks = moved < 1e-4 ? stalledTicks + 1 : 0;
    if (stalledTicks >= 4) {
      route = findPath(current, to, options);
      waypointIndex = 0;
      stalledTicks = 0;
    }
  }
  expect(Math.hypot(to.x - current.x, to.z - current.z), `${label} endpoint`).toBeLessThanOrEqual(
    0.2,
  );
}

function placeEntity(sim: Sim, entity: Entity, point: { x: number; z: number }): void {
  entity.pos = sim.groundPos(point.x, point.z);
  entity.prevPos = { ...entity.pos };
  entity.vx = 0;
  entity.vy = 0;
  entity.vz = 0;
  entity.onGround = true;
  entity.fallStartY = entity.pos.y;
  sim.rebucket(entity);
}

function legacyEastbrookProps(current: ZonePropsDef): ZonePropsDef {
  const townBuildingIds = new Set(
    [...EASTBROOK_LAYOUT.preservedBuildings, ...EASTBROOK_LAYOUT.buildings].map(
      (building) => building.id,
    ),
  );
  return {
    ...current,
    buildings: [
      { kind: 'house', x: 10, z: 12, w: 7, d: 6, rot: -0.4 },
      { kind: 'house', x: -10, z: 10, w: 6, d: 5, rot: 0.5 },
      {
        kind: 'inn',
        landmark: 'eastbrook_grand_armoury',
        x: 17.5,
        z: -5.5,
        w: 13,
        d: 9,
        rot: -Math.PI / 2,
      },
      { kind: 'chapel', x: -16, z: -8, w: 5, d: 7, rot: 0.9 },
      ...current.buildings.filter((building) => !building.id || !townBuildingIds.has(building.id)),
    ],
    wells: [
      { x: 0, z: 2, r: 1.5 },
      ...current.wells.filter((well) => well.id !== EASTBROOK_LAYOUT.civic.wellBeacon.id),
    ],
    stalls: [
      { x: -8.5, z: 3, rot: Math.PI / 2, r: 1.7 },
      { x: 9.5, z: 17.5, rot: -2.7, r: 1.7, smithy: true },
      { x: 0, z: 11.5, rot: Math.PI, r: 1.8 },
      ...current.stalls.filter((stall) => !stall.id?.startsWith('eastbrook_market_stall_')),
    ],
    campfires: [[3, -4], ...current.campfires],
    fences: [
      { x1: 16, z1: 16, x2: 22, z2: 4 },
      { x1: -16, z1: 14, x2: -20, z2: 2 },
      ...current.fences.filter((fence) => !fence.id?.startsWith('eastbrook_fence_')),
    ],
    benches: current.benches?.filter((bench) => !bench.id.startsWith('eastbrook_')),
    walls: current.walls?.filter((wall) => !wall.id.startsWith('eastbrook_wall_')),
  };
}

describe('Eastbrook authored gameplay data integration', () => {
  it('replaces only the town prop inventory and preserves every exterior prop row in order', () => {
    expect(ZONE1_PROPS.buildings.map((building) => building.id)).toEqual([
      'eastbrook_grand_armoury',
      ...EASTBROOK_LAYOUT.buildings.map((building) => building.id),
    ]);
    expect(ZONE1_PROPS.buildings[0]).toMatchObject({
      id: 'eastbrook_grand_armoury',
      kind: 'house',
      landmark: 'eastbrook_grand_armoury',
      x: 17.5,
      z: -5.5,
      w: 13,
      d: 9,
      rot: -Math.PI / 2,
    });
    expect(ZONE1_PROPS.wells).toEqual([
      expect.objectContaining({
        id: EASTBROOK_LAYOUT.civic.wellBeacon.id,
        x: -0.75,
        z: 2,
        r: 1.5,
      }),
    ]);
    expect(
      ZONE1_PROPS.stalls.map((stall) => [stall.id, stall.x, stall.z, stall.w, stall.d]),
    ).toEqual(
      EASTBROOK_LAYOUT.market.stalls.map((stall) => [
        stall.id,
        stall.position.x,
        stall.position.z,
        stall.width,
        stall.depth,
      ]),
    );
    expect(ZONE1_PROPS.stalls.map((stall) => stall.id)).not.toContain(
      'eastbrook_market_stall_artisans',
    );
    expect(ZONE1_PROPS.benches?.map((bench) => bench.id)).toEqual(
      EASTBROOK_LAYOUT.civic.benches.map((bench) => bench.id),
    );
    expect(ZONE1_PROPS.walls?.map((wall) => wall.id)).toEqual(
      EASTBROOK_LAYOUT.wall.segments.map((segment) => segment.id),
    );
    expect(ZONE1_PROPS.fences.map((fence) => fence.id)).toEqual(
      EASTBROOK_LAYOUT.fences.map((fence) => fence.id),
    );

    expect(ZONE1_PROPS.mines).toEqual([{ x: -88, z: -68, rot: 0.8 }]);
    expect(ZONE1_PROPS.docks).toEqual([
      { x: -64, z: 60, rot: -2.2, hutLocal: { x: 2.8, z: 2.4, hw: 1.7, hd: 1.5 } },
    ]);
    expect(ZONE1_PROPS.tents).toEqual([
      { x: 62, z: -61, rot: 0.4, scale: 1 },
      { x: 69, z: -69, rot: 2.1, scale: 1 },
      { x: 88, z: -86, rot: 1.2, scale: 1.3 },
      { x: 95, z: -94, rot: -0.6, scale: 1 },
    ]);
    expect(ZONE1_PROPS.crates).toEqual([
      [60, -63],
      [66, -67],
      [87, -88],
      [93, -90],
      [70, -72],
    ]);
    expect(ZONE1_PROPS.campfires).toEqual([
      [65, -65],
      [90, -90],
      [-80, -60],
      [-61, 56],
    ]);
    expect(ZONE1_PROPS.mudHuts).toEqual([
      [-73, 59],
      [-78, 54],
      [-69, 55],
    ]);
    expect(ZONE1_PROPS.ruinRings).toEqual([
      { x: 80, z: 78, ringR: 7, columns: 7 },
      { x: -5, z: -60, ringR: 8, columns: 6 },
    ]);
    expect(ZONE1_PROPS.graveyards).toEqual([
      { x: -14, z: -14 },
      { x: 4, z: -56 },
    ]);
    expect(ZONE1_PROPS.delveMarkers).toEqual([{ x: -5, z: -52, delveId: 'collapsed_reliquary' }]);
  });

  it('routes every preserved exterior road through its authoritative five-yard gate', () => {
    expect(ZONE1_ROADS).toHaveLength(6);
    for (let index = 0; index < EASTBROOK_LAYOUT.roads.length; index++) {
      const authored = EASTBROOK_LAYOUT.roads[index];
      expect(ZONE1_ROADS[index].slice(0, authored.points.length)).toEqual(authored.points);
      const gate = EASTBROOK_LAYOUT.wall.gates.find(
        (candidate) => candidate.id === authored.gateId,
      );
      if (!gate) throw new Error(`missing gate ${authored.gateId}`);
      expect(ZONE1_ROADS[index]).toContainEqual(gate.crossing);
    }
    expect(ZONE1_ROADS.map((road) => road.at(-1))).toEqual([
      { x: -2, z: 78 },
      { x: 55, z: 12 },
      { x: 65, z: -65 },
      { x: -66, z: 58 },
      { x: -70, z: -55 },
      { x: 78, z: 74 },
    ]);
  });

  it('moves only the 15 town NPC placement fields and preserves key order and all other payload', () => {
    expect(Object.keys(ZONE1_NPCS)).toEqual([
      'the_merchant',
      'marshal_redbrook',
      'trader_wilkes',
      'apothecary_lin',
      'brother_aldric',
      'smith_haldren',
      'fisherman_brandt',
      'foreman_odell',
      'bursar_fernando',
      'card_master',
      'groundskeeper_bram',
      'chronicler_saul',
      'forgemistress_darva',
      'cook_marlow',
      'weaver_ottilie',
      'tinker_gizzel',
    ]);
    expect(createHash('sha256').update(JSON.stringify(stableTownNpcPayload())).digest('hex')).toBe(
      '92c37779f6a29982ec3541169d995fc4365c9696a9b7a0e2fd32713094073db1',
    );
    expect(ZONE1_TOWN_NPC_IDS).toHaveLength(15);
    for (const id of ZONE1_TOWN_NPC_IDS) {
      const placement = EASTBROOK_NPC_PLACEMENTS_BY_ID[id];
      expect(ZONE1_NPCS[id].pos).toEqual(placement.position);
      expect(ZONE1_NPCS[id].facing).toBe(placement.facing);
    }
    expect(ZONE1_NPCS.groundskeeper_bram).toMatchObject({
      pos: { x: -6, z: -82 },
      facing: Math.PI,
      dynamic: true,
    });
  });

  it('spawns layout-authored FURY under a reserved id without shifting nextId or RNG', () => {
    expect(EASTBROOK_NPC_PLACEMENTS_BY_ID.fury).toEqual({
      id: 'fury',
      position: { x: -22.5, z: -7.5 },
      facing: 1.171280832795522,
      anchorId: 'eastbrook_chapel',
      bodyRadius: 0.6,
    });
    expect(BUILTIN_WORLD.npcs[FURY_NPC_ID]).toMatchObject({
      id: 'fury',
      pos: { x: -22.5, z: -7.5 },
      facing: 1.171280832795522,
      dynamic: true,
    });
    expect(FURY_ENTITY_ID).toBe(1_000_000_001);

    const npcsWithoutFury = { ...BUILTIN_WORLD.npcs };
    delete npcsWithoutFury[FURY_NPC_ID];
    const worldWithoutFury = { ...BUILTIN_WORLD, npcs: npcsWithoutFury };
    setActiveWorldContent(worldWithoutFury);
    const withoutFury = new Sim({
      seed: SEED,
      playerClass: 'warrior',
      noPlayer: true,
      world: worldWithoutFury,
    });
    setActiveWorldContent(BUILTIN_WORLD);
    const withFury = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });

    expect(withoutFury.entities.has(FURY_ENTITY_ID)).toBe(false);
    const fury = withFury.entities.get(FURY_ENTITY_ID);
    if (!fury) throw new Error('missing reserved FURY entity');
    expect({
      id: fury.id,
      kind: fury.kind,
      templateId: fury.templateId,
      x: fury.pos.x,
      z: fury.pos.z,
      spawnX: fury.spawnPos.x,
      spawnZ: fury.spawnPos.z,
      facing: fury.facing,
      prevFacing: fury.prevFacing,
    }).toEqual({
      id: 1_000_000_001,
      kind: 'npc',
      templateId: 'fury',
      x: -22.5,
      z: -7.5,
      spawnX: -22.5,
      spawnZ: -7.5,
      facing: 1.171280832795522,
      prevFacing: 1.171280832795522,
    });
    expect([...withFury.entities.keys()].filter((id) => id !== FURY_ENTITY_ID)).toEqual([
      ...withoutFury.entities.keys(),
    ]);
    expect(withFury.nextId).toBe(withoutFury.nextId);
    expect(withFury.rng.next()).toBe(withoutFury.rng.next());
  });

  it('moves the four Eastbrook stations with their masters and preserves every other station field', () => {
    for (const station of STATIONS.slice(0, 4)) {
      const placement = EASTBROOK_STATIONS_BY_ID[station.id];
      expect(station.pos).toEqual(placement.position);
      expect(station.type).toBe(placement.type);
      expect(station.masterNpcId).toBe(placement.masterNpcId);
      expect(
        Math.hypot(
          station.pos.x - ZONE1_NPCS[station.masterNpcId].pos.x,
          station.pos.z - ZONE1_NPCS[station.masterNpcId].pos.z,
        ),
      ).toBeGreaterThanOrEqual(1);
      expect(
        Math.hypot(
          station.pos.x - ZONE1_NPCS[station.masterNpcId].pos.x,
          station.pos.z - ZONE1_NPCS[station.masterNpcId].pos.z,
        ),
      ).toBeLessThanOrEqual(3);
    }
    expect(STATIONS.slice(4)).toEqual([
      {
        id: 'station_fenbridge_tannery',
        type: 'tannery',
        zoneId: 'mirefen_marsh',
        pos: { x: -13, z: 314 },
        masterNpcId: 'tanner_hesk',
      },
      {
        id: 'station_highwatch_apothecary',
        type: 'apothecary',
        zoneId: 'thornpeak_heights',
        pos: { x: 7, z: 660 },
        masterNpcId: 'alchemist_verane',
      },
    ]);
    expect(STATION_RADIUS).toBe(20);
  });

  it('moves only the Eastbrook mailbox and keeps the player and graveyard contracts', () => {
    expect(MAILBOXES).toEqual([
      {
        x: EASTBROOK_LAYOUT.services.mailbox.position.x,
        z: EASTBROOK_LAYOUT.services.mailbox.position.z,
      },
      { x: 6, z: 294 },
      { x: 6, z: 654 },
    ]);
    expect(PLAYER_START).toEqual({ x: 2, z: -2 });
    expect(EASTBROOK_LAYOUT.services.graveyard.position).toEqual({ x: -14, z: -14 });
    expect(EASTBROOK_LAYOUT.services.graveyard.legacyReleasePoint).toEqual({ x: -12, z: -14 });
  });
});

describe('Eastbrook runtime collision, spawn, and services', () => {
  it('spawns every moved NPC exactly at its authored point and facing without safe-position drift', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    for (const placement of EASTBROOK_LAYOUT.services.npcs) {
      const entity = npcEntity(sim, placement.id);
      expect({ x: entity.pos.x, z: entity.pos.z }, placement.id).toEqual(placement.position);
      expect(entity.facing, `${placement.id} facing`).toBe(placement.facing);
      expect(entity.prevFacing, `${placement.id} previous facing`).toBe(placement.facing);
      expect(isBlocked(SEED, entity.pos.x, entity.pos.z, placement.bodyRadius), placement.id).toBe(
        false,
      );
    }
  });

  it('blocks every wall wing while players and pets pass through all six exact gate centers', () => {
    for (const segment of EASTBROOK_LAYOUT.wall.segments) {
      expect(
        isBlocked(SEED, segment.footprint.center.x, segment.footprint.center.z, 0.5),
        segment.id,
      ).toBe(true);
    }
    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      const length = Math.hypot(gate.crossing.x, gate.crossing.z);
      const ux = gate.crossing.x / length;
      const uz = gate.crossing.z / length;
      const from = { x: ux * 26.5, z: uz * 26.5 };
      const to = { x: ux * 32.5, z: uz * 32.5 };
      for (const bodyRadius of [0.5, 0.6]) {
        const result = resolveMovement(SEED, from.x, from.z, to.x, to.z, bodyRadius);
        expect(
          Math.hypot(result.x - to.x, result.z - to.z),
          `${gate.id} radius ${bodyRadius}`,
        ).toBeLessThan(0.05);
      }
    }
  });

  it('uses exact authored collider shapes and visual heights', () => {
    const colliders = colliderInternalsForTest.staticWorldColliders(SEED);
    const stall = EASTBROOK_LAYOUT.market.stalls[0];
    const stallCollider = colliders.find(
      (collider) =>
        collider.type === 'obb' &&
        collider.x === stall.position.x &&
        collider.z === stall.position.z,
    );
    expect(stallCollider).toMatchObject({
      type: 'obb',
      hw: stall.width / 2,
      hd: stall.depth / 2,
      rot: stall.rotation,
    });
    expect(
      colliders.find(
        (collider) =>
          collider.type === 'obb' &&
          collider.x === 3.5 &&
          collider.z === 11.5 &&
          collider.hw === 1.4 &&
          collider.hd === 1.1 &&
          collider.rot === -2.788602,
      ),
      'retired artisan stall collider',
    ).toBeUndefined();

    const well = EASTBROOK_LAYOUT.civic.wellBeacon;
    const wellCollider = colliders.find(
      (collider) =>
        collider.type === 'circle' &&
        collider.x === well.position.x &&
        collider.z === well.position.z,
    );
    expect(wellCollider).toMatchObject({ type: 'circle', r: well.radius });
    expect(wellCollider?.cameraTopY).toBeCloseTo(
      groundHeight(well.position.x, well.position.z, SEED) + well.height,
    );

    const wall = EASTBROOK_LAYOUT.wall.segments[0];
    const wallCollider = colliders.find(
      (collider) =>
        collider.type === 'obb' &&
        collider.x === wall.footprint.center.x &&
        collider.z === wall.footprint.center.z,
    );
    expect(wallCollider).toMatchObject({
      type: 'obb',
      hw: wall.footprint.halfWidth,
      hd: wall.footprint.halfDepth,
      rot: wall.footprint.rotation,
    });

    const fence = EASTBROOK_LAYOUT.fences[0];
    const fenceCenter = midpoint(fence.start, fence.end);
    const fenceCollider = colliders.find(
      (collider) =>
        collider.type === 'obb' &&
        collider.isFence === true &&
        collider.x === fenceCenter.x &&
        collider.z === fenceCenter.z,
    );
    expect(fenceCollider).toMatchObject({
      type: 'obb',
      hd: fence.width / 2,
      isFence: true,
    });
    expect(fenceCollider?.cameraTopY).toBeCloseTo(
      groundHeight(fenceCenter.x, fenceCenter.z, SEED) + fence.height,
    );

    const board = EASTBROOK_LAYOUT.services.noticeboard;
    const boardCollider = colliders.find(
      (collider) =>
        collider.type === 'obb' &&
        collider.x === board.position.x &&
        collider.z === board.position.z,
    );
    expect(boardCollider).toMatchObject({
      type: 'obb',
      hw: board.nativeDimensions.width / 2,
      hd: board.nativeDimensions.depth / 2,
      rot: board.rotation,
    });
    expect(boardCollider?.cameraTopY).toBeCloseTo(
      groundHeight(board.position.x, board.position.z, SEED) + board.nativeDimensions.height,
    );
  });

  it('keeps every standing point, station, service route, quest NPC, and graveyard route clear', () => {
    for (const building of [
      ...EASTBROOK_LAYOUT.preservedBuildings,
      ...EASTBROOK_LAYOUT.buildings,
    ]) {
      expect(
        isBlocked(SEED, building.frontStandingPoint.x, building.frontStandingPoint.z, 0.6),
        building.id,
      ).toBe(false);
    }
    for (const stall of EASTBROOK_LAYOUT.market.stalls) {
      expect(
        isBlocked(SEED, stall.frontStandingPoint.x, stall.frontStandingPoint.z, 0.5),
        stall.id,
      ).toBe(false);
    }
    const boardStanding = EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint;
    expect(isBlocked(SEED, boardStanding.x, boardStanding.z, 0.6), 'noticeboard').toBe(false);
    for (const station of EASTBROOK_LAYOUT.services.stations) {
      expect(isBlocked(SEED, station.position.x, station.position.z, 0.8), station.id).toBe(false);
      expect(isAtStation(STATIONS, station.position, station.type), station.id).toBe(true);
    }
    for (const route of EASTBROOK_LAYOUT.services.routes) {
      for (const point of samplePolyline(route.points, 0.2)) {
        expect(isBlocked(SEED, point.x, point.z, route.bodyRadius), route.id).toBe(false);
      }
    }
    const questNpcIds = new Set<string>();
    for (const quest of Object.values(QUESTS)) {
      questNpcIds.add(quest.giverNpcId);
      questNpcIds.add(quest.turnInNpcId);
      for (const id of quest.turnInNpcIds ?? []) questNpcIds.add(id);
    }
    for (const id of ZONE1_TOWN_NPC_IDS.filter((candidate) => questNpcIds.has(candidate))) {
      const npc = ZONE1_NPCS[id];
      expect(isBlocked(SEED, npc.pos.x, npc.pos.z, 0.6), id).toBe(false);
    }
  });

  it('pathfinds bidirectionally from the square to every gate, service, NPC, station, and entrance', () => {
    // East side of the civic ring: inside the square, clear of the offset well
    // and benches, and directly connected to the start/east-road circulation.
    const square = { x: 3, z: 0 };
    const destinations = [
      ...EASTBROOK_LAYOUT.wall.gates.map((gate) => ({ id: gate.id, point: gate.crossing })),
      ...EASTBROOK_LAYOUT.services.npcs.map((npc) => ({ id: npc.id, point: npc.position })),
      ...EASTBROOK_LAYOUT.services.stations.map((station) => ({
        id: station.id,
        point: station.position,
      })),
      {
        id: EASTBROOK_LAYOUT.services.mailbox.id,
        point: EASTBROOK_LAYOUT.services.mailbox.frontStandingPoint,
      },
      {
        id: EASTBROOK_LAYOUT.services.noticeboard.id,
        point: EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint,
      },
      {
        id: EASTBROOK_LAYOUT.services.graveyard.id,
        point: EASTBROOK_LAYOUT.services.graveyard.position,
      },
      ...[...EASTBROOK_LAYOUT.preservedBuildings, ...EASTBROOK_LAYOUT.buildings].map(
        (building) => ({ id: `${building.id}:entrance`, point: building.frontStandingPoint }),
      ),
    ];
    expect(destinations).toHaveLength(36);
    const moverProfiles = [
      { id: 'player', bodyRadius: PLAYER_BODY_RADIUS },
      // Pet locomotion deliberately shares PLAYER_BODY_RADIUS; keep this
      // explicit so the town route proof cannot drift to a guessed pet size.
      { id: 'pet', bodyRadius: PLAYER_BODY_RADIUS },
    ] as const;
    for (const destination of destinations) {
      for (const mover of moverProfiles) {
        expectWalkableRoute(
          `${destination.id} outbound ${mover.id} r${mover.bodyRadius}`,
          square,
          destination.point,
          mover.bodyRadius,
        );
        expectWalkableRoute(
          `${destination.id} inbound ${mover.id} r${mover.bodyRadius}`,
          destination.point,
          square,
          mover.bodyRadius,
        );
      }
    }
  });

  it('summons a passive pet and follows its owner through every gate in both directions', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Gatekeeper');
    const owner = sim.entities.get(pid);
    if (!owner) throw new Error('missing pet owner');
    summonPet(sim.ctx, owner, 'gloomshade');
    const pet = petOf(sim.ctx, pid);
    if (!pet) throw new Error('missing summoned pet');
    setPetMode(sim.ctx, 'passive', pid);

    const follow = (ownerPoint: { x: number; z: number }, petPoint: { x: number; z: number }) => {
      placeEntity(sim, owner, ownerPoint);
      placeEntity(sim, pet, petPoint);
      pet.aggroTargetId = null;
      pet.petPath = [];
      pet.inCombat = false;
      for (let tick = 0; tick < 100 && dist2d(owner.pos, pet.pos) > 3.5; tick++) sim.tick();
      expect(dist2d(owner.pos, pet.pos)).toBeLessThanOrEqual(3.5);
    };

    for (const gate of EASTBROOK_LAYOUT.wall.gates) {
      const length = Math.hypot(gate.crossing.x, gate.crossing.z);
      const ux = gate.crossing.x / length;
      const uz = gate.crossing.z / length;
      const inside = { x: ux * 24, z: uz * 24 };
      const outside = { x: ux * 32, z: uz * 32 };
      follow(outside, inside);
      expect(Math.hypot(pet.pos.x, pet.pos.z), `${gate.id} outward`).toBeGreaterThan(
        EASTBROOK_LAYOUT.wall.radius,
      );
      follow(inside, outside);
      expect(Math.hypot(pet.pos.x, pet.pos.z), `${gate.id} return`).toBeLessThan(
        EASTBROOK_LAYOUT.wall.radius,
      );
    }
  });

  it('makes the new inn the sole Eastbrook rest area and uses rotation-correct local transforms', () => {
    const inn = ZONE1_PROPS.buildings.find((building) => building.id === 'eastbrook_inn');
    const armoury = ZONE1_PROPS.buildings.find(
      (building) => building.id === 'eastbrook_grand_armoury',
    );
    if (!inn || !armoury) throw new Error('missing Eastbrook rest fixtures');
    const innPlacement = EASTBROOK_LAYOUT.buildings.find(
      (building) => building.id === 'eastbrook_inn',
    );
    if (!innPlacement) throw new Error('missing authored Eastbrook inn');
    const restPoint = innPlacement.frontStandingPoint;
    const armouryPoint = EASTBROOK_LAYOUT.preservedBuildings[0].frontStandingPoint;
    expect(isBlocked(SEED, restPoint.x, restPoint.z, 0.5)).toBe(false);
    expect(isResting({ inCombat: false, pos: { ...restPoint, y: 0 } } as Entity)).toBe(true);
    expect(isResting({ inCombat: false, pos: { ...armouryPoint, y: 0 } } as Entity)).toBe(false);

    const arbitrary = { kind: 'inn', x: 37, z: -19, w: 8, d: 3, rot: 0.731 } as const;
    const inside = localToWorld({ x: arbitrary.x, z: arbitrary.z }, arbitrary.rot, 3.9, 1.4);
    const outside = localToWorld({ x: arbitrary.x, z: arbitrary.z }, arbitrary.rot, 4.1, 1.4);
    expect(buildingContainsPoint(arbitrary, inside.x, inside.z)).toBe(true);
    expect(buildingContainsPoint(arbitrary, outside.x, outside.z)).toBe(false);
  });

  it('keeps targetless Saul interaction outside mailbox reach at his measured face point', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const pid = sim.addPlayer('warrior', 'Chronicler Visitor');
    const saul = npcEntity(sim, 'chronicler_saul');
    const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
    if (!mailbox) throw new Error('missing Eastbrook mailbox');
    const facePoint = { x: -0.44414815667112084, z: -13.06726401073832 };

    expect(Math.hypot(facePoint.x - saul.pos.x, facePoint.z - saul.pos.z)).toBeCloseTo(1.5, 12);
    const mailboxDistance = Math.hypot(facePoint.x - mailbox.pos.x, facePoint.z - mailbox.pos.z);
    expect(mailboxDistance).toBe(5.584952654260954);
    expect(mailboxDistance).toBeGreaterThan(INTERACT_RANGE);

    const talkToNpc = vi.spyOn(sim, 'talkToNpc');
    const visitor = standAt(sim, pid, facePoint);
    visitor.targetId = null;
    sim.drainEvents();
    sim.interact(pid);
    expect(talkToNpc).toHaveBeenCalledTimes(1);
    expect(talkToNpc).toHaveBeenCalledWith(saul.id, pid);
    expect(sim.drainEvents()).not.toContainEqual(expect.objectContaining({ type: 'mailbox' }));
  });

  it('keeps bank, market, mail, noticeboard, card, vendor, quest, and crafting interactions live', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    const first = sim.addPlayer('warrior', 'First');
    const second = sim.addPlayer('mage', 'Second');

    const banker = npcEntity(sim, 'bursar_fernando');
    const firstPlayer = standAt(sim, first, banker.pos);
    firstPlayer.targetId = banker.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual(expect.objectContaining({ type: 'bank', pid: first }));

    const merchant = npcEntity(sim, 'the_merchant');
    standAt(sim, first, merchant.pos);
    expect(sim.marketInfoFor(first)).not.toBeNull();

    const mailbox = sim.entities.get(sim.postOffice.mailboxIds[0]);
    if (!mailbox) throw new Error('missing Eastbrook mailbox');
    const atMailbox = standAt(sim, first, mailbox.pos);
    atMailbox.targetId = mailbox.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'mailbox', pid: first }),
    );

    const noticeboard = [...sim.entities.values()].find(
      (entity) => entity.kind === 'object' && entity.templateId === 'noticeboard_eastbrook',
    );
    if (!noticeboard) throw new Error('missing Eastbrook noticeboard');
    const atNoticeboard = standAt(
      sim,
      first,
      EASTBROOK_LAYOUT.services.noticeboard.frontStandingPoint,
    );
    atNoticeboard.targetId = noticeboard.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual({
      type: 'noticeboard',
      noticeboardId: 'noticeboard_eastbrook',
      state: 'empty',
      pid: first,
    });
    expect(noticeboard.lootable).toBe(true);

    const trader = npcEntity(sim, 'trader_wilkes');
    const buyer = standAt(sim, first, trader.pos);
    buyer.targetId = trader.id;
    const buyerMeta = sim.meta(first);
    if (!buyerMeta) throw new Error('missing buyer metadata');
    buyerMeta.copper = 10_000;
    sim.buyItem(trader.id, 'baked_bread', first);
    expect(sim.countItem('baked_bread', first)).toBeGreaterThan(0);

    const marshal = npcEntity(sim, 'marshal_redbrook');
    const quester = standAt(sim, first, marshal.pos);
    quester.targetId = marshal.id;
    sim.interact(first);
    expect(sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'questAccepted', questId: 'q_wolves', pid: first }),
    );

    const cardMaster = npcEntity(sim, 'card_master');
    standAt(sim, first, cardMaster.pos);
    standAt(sim, second, cardMaster.pos);
    sim.joinCardDuelQueue(first);
    sim.joinCardDuelQueue(second);
    sim.tick();
    expect(sim.cardDuelMatchFor(first)).not.toBeNull();
    expect(sim.cardDuelMatchFor(second)).not.toBeNull();

    for (const station of EASTBROOK_LAYOUT.services.stations) {
      expect(isAtStation(STATIONS, station.position, station.type), station.id).toBe(true);
    }
  });

  it('keeps the fixed-seed world projection stable through wandering and respawn', {
    timeout: 90000,
  }, () => {
    const stabilitySeed = 4_242;
    const legacyWorld = {
      ...BUILTIN_WORLD,
      props: legacyEastbrookProps(BUILTIN_WORLD.props),
      services: {
        ...BUILTIN_WORLD.services,
        mailboxes: [{ x: 7, z: -8 }, ...MAILBOXES.slice(1)],
      },
    };
    setActiveWorldContent(legacyWorld);
    const legacy = new Sim({
      seed: stabilitySeed,
      playerClass: 'warrior',
      noPlayer: true,
      world: legacyWorld,
    });
    setActiveWorldContent(BUILTIN_WORLD);
    const rebuilt = new Sim({ seed: stabilitySeed, playerClass: 'warrior', noPlayer: true });

    const stableProjection = (sim: Sim) =>
      [...sim.entities.values()]
        .filter((entity) => entity.kind === 'mob' || entity.kind === 'object')
        .filter((entity) => entity.templateId !== 'mailbox')
        .map((entity) => ({
          id: entity.id,
          kind: entity.kind,
          templateId: entity.templateId,
          x: entity.pos.x,
          z: entity.pos.z,
          facing: entity.facing,
          level: entity.level,
          dead: entity.dead,
          hp: entity.hp,
          spawnPos: entity.spawnPos,
          wanderTarget: entity.wanderTarget,
          wanderTimer: entity.wanderTimer,
          respawnTimer: entity.respawnTimer,
        }));
    expect(stableProjection(rebuilt)).toEqual(stableProjection(legacy));
    expect(rebuilt.postOffice.mailboxIds).toEqual(legacy.postOffice.mailboxIds);
    expect(rebuilt.entities.get(rebuilt.postOffice.mailboxIds[0])?.pos).toMatchObject({
      x: EASTBROOK_LAYOUT.services.mailbox.position.x,
      z: EASTBROOK_LAYOUT.services.mailbox.position.z,
    });
    expect(CAMPS).toEqual(BUILTIN_WORLD.camps);
    expect(ZONE1_CAMPS).toHaveLength(14);

    for (let tick = 0; tick < 2_500; tick++) {
      setActiveWorldContent(legacyWorld);
      legacy.tick();
      setActiveWorldContent(BUILTIN_WORLD);
      rebuilt.tick();
    }
    expect(rebuilt.tickCount).toBe(2_500);
    expect(legacy.tickCount).toBe(2_500);
    expect(stableProjection(rebuilt)).toEqual(stableProjection(legacy));
    expect(rebuilt.nextId).toBe(legacy.nextId);

    const rebuiltWolf = [...rebuilt.entities.values()].find(
      (entity) => entity.kind === 'mob' && entity.templateId === 'forest_wolf',
    );
    const legacyWolf = rebuiltWolf ? legacy.entities.get(rebuiltWolf.id) : undefined;
    if (!rebuiltWolf || !legacyWolf) throw new Error('missing fixed-seed wolf pair');
    for (const wolf of [legacyWolf, rebuiltWolf]) {
      wolf.dead = true;
      wolf.hp = 0;
      wolf.lootable = false;
      wolf.corpseTimer = 0;
      wolf.respawnTimer = 0;
    }
    setActiveWorldContent(legacyWorld);
    legacy.ctx.respawnMob(legacyWolf);
    setActiveWorldContent(BUILTIN_WORLD);
    rebuilt.ctx.respawnMob(rebuiltWolf);
    expect(stableProjection(rebuilt)).toEqual(stableProjection(legacy));
    expect(rebuilt.rng.next()).toBe(legacy.rng.next());
  });
});

describe('the first sixty seconds: starter pull lanes from spawn', () => {
  // The town is furnished with solid props now, so pin explicitly what the
  // fixtures that moved to open ground implied: a new character can walk out
  // of the spawn square to each nearby starter camp, and at the camp's edge
  // a ranged pull has a clear 25 yd sight lane to the camp's heart.
  it('walks out to the starter camps and sights a ranged pull at each', () => {
    // The level-1 quest targets: the first camps a fresh character is sent
    // at. (The spider wood is a later, longer walk whose winding route the
    // simple follower here cannot prove; its lane is covered by the
    // route-existence check below.)
    const starterMobs = new Set(['wild_boar', 'forest_wolf']);
    const nearest = [...CAMPS]
      .map((camp) => ({
        camp,
        d: Math.hypot(camp.center.x - PLAYER_START.x, camp.center.z - PLAYER_START.z),
      }))
      .filter(({ camp }) => starterMobs.has(camp.mobId))
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    expect(nearest.length).toBe(2);
    for (const { camp } of nearest) {
      // The pull spot as a player finds it: walk the pathfinder's own route
      // out of town and stop at the first waypoint inside ranged pull
      // distance of the camp's heart. That keeps the spot on walkable
      // ground even where the beeline crosses a rim.
      const route = findPath(PLAYER_START, camp.center, {
        seed: SEED,
        bodyRadius: 0.5,
        maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
        minGround: (x: number, z: number) => waterLevelAt(x, z) - PLAYER_SWIM_DEPTH,
        maxSpan: 160,
      });
      expect(route.length, `${camp.mobId} has a route from spawn`).toBeGreaterThan(0);
      const pull =
        route.find((p) => Math.hypot(p.x - camp.center.x, p.z - camp.center.z) <= 25) ??
        route[route.length - 1];
      expect(isBlocked(SEED, pull.x, pull.z, 0.5), `${camp.mobId} pull spot`).toBe(false);
      expectWalkableRoute(`${camp.mobId} camp approach`, PLAYER_START, pull, 0.5);
      expect(lineOfSightClear(SEED, pull, camp.center), `${camp.mobId} pull sight lane`).toBe(true);
      expect(
        Math.hypot(pull.x - camp.center.x, pull.z - camp.center.z),
        `${camp.mobId} pull distance`,
      ).toBeLessThanOrEqual(25);
    }
  });

  it('every camp within 90 yd of spawn keeps a route and a pull sight lane', () => {
    for (const camp of CAMPS) {
      const d = Math.hypot(camp.center.x - PLAYER_START.x, camp.center.z - PLAYER_START.z);
      if (d > 90) continue;
      const route = findPath(PLAYER_START, camp.center, {
        seed: SEED,
        bodyRadius: 0.5,
        maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
        minGround: (x: number, z: number) => waterLevelAt(x, z) - PLAYER_SWIM_DEPTH,
        maxSpan: 160,
      });
      expect(route.length, `${camp.mobId} at ${camp.center.x},${camp.center.z}`).toBeGreaterThan(0);
      const pull =
        route.find((p) => Math.hypot(p.x - camp.center.x, p.z - camp.center.z) <= 25) ??
        route[route.length - 1];
      expect(lineOfSightClear(SEED, pull, camp.center), `${camp.mobId} pull sight lane`).toBe(true);
    }
  });
});
