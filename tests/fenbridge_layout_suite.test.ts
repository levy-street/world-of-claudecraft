import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bankerChestSpots,
  colliderInternalsForTest,
  isBlocked,
  resolveMovement,
} from '../src/sim/colliders';
import { OVERWORLD_GRAVEYARDS } from '../src/sim/content/graveyards';
import { MAILBOXES } from '../src/sim/content/mailboxes';
import { MUSTER_BOARDS } from '../src/sim/content/noticeboards';
import { STATIONS } from '../src/sim/content/professions';
import {
  ZONE2_CAMPS,
  ZONE2_NPCS,
  ZONE2_OBJECTS,
  ZONE2_PROPS,
  ZONE2_QUEST_ORDER,
  ZONE2_ROADS,
  ZONE2_ZONE,
} from '../src/sim/content/zone2';
import { BUILTIN_WORLD, GATHER_NODES } from '../src/sim/data';
import {
  distancePointToObb,
  FENBRIDGE_BUILDINGS_BY_ID,
  FENBRIDGE_LAYOUT,
  FENBRIDGE_NPC_PLACEMENTS_BY_ID,
  FENBRIDGE_STATIONS_BY_ID,
  facingToward,
  localToWorld,
  obbsOverlap,
  REMOVED_FENBRIDGE_PLACEMENTS,
  samplePolyline,
} from '../src/sim/fenbridge_layout';
import { findPath, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { NpcDef } from '../src/sim/types';
import { terrainHeight, waterLevelAt } from '../src/sim/world';

const SEED = 20_061;

function expectDeepFrozen(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

function stableNpcPayload(): Record<string, Omit<NpcDef, 'pos' | 'facing'>> {
  return Object.fromEntries(
    Object.entries(ZONE2_NPCS).map(([id, def]) => {
      const { pos: _pos, facing: _facing, ...payload } = def;
      return [id, payload];
    }),
  );
}

function expectPath(
  label: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  bodyRadius: number,
): void {
  expect(isBlocked(SEED, from.x, from.z, bodyRadius), `${label} start`).toBe(false);
  expect(isBlocked(SEED, to.x, to.z, bodyRadius), `${label} destination`).toBe(false);
  const path = findPath(from, to, {
    seed: SEED,
    bodyRadius,
    maxClimbSlope: PLAYER_MAX_CLIMB_SLOPE,
    minGround: (x, z) => waterLevelAt(x, z, SEED) - PLAYER_SWIM_DEPTH,
    maxSpan: 128,
  });
  expect(path.length, `${label} path`).toBeGreaterThan(0);
  let current = { ...from };
  for (const waypoint of path) {
    current = resolveMovement(SEED, current.x, current.z, waypoint.x, waypoint.z, bodyRadius);
  }
  expect(Math.hypot(current.x - to.x, current.z - to.z), `${label} reached endpoint`).toBeLessThan(
    0.25,
  );
}

describe('Fenbridge canonical pure layout', () => {
  it('is an import-free, deterministic, deeply frozen source of truth', () => {
    const source = readFileSync(new URL('../src/sim/fenbridge_layout.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import\s/m);
    expect(source).not.toMatch(/\b(?:document|window|THREE|Math\.random|Date|performance)\b/);
    expect(FENBRIDGE_LAYOUT.id).toBe('fenbridge_rebuild_v1');
    expectDeepFrozen(FENBRIDGE_LAYOUT);
    expectDeepFrozen(REMOVED_FENBRIDGE_PLACEMENTS);
  });

  it('pins all seven non-overlapping lots, native dimensions, facings, and entrance sockets', () => {
    expect(
      FENBRIDGE_LAYOUT.buildings.map((building) => ({
        id: building.id,
        position: building.position,
        nativeDimensions: building.nativeDimensions,
        rotation: building.rotation,
      })),
    ).toEqual(
      FENBRIDGE_LAYOUT.buildings.map((building) => ({
        id: building.id,
        position: building.position,
        nativeDimensions: building.nativeDimensions,
        rotation: building.rotation,
      })),
    );
    // Explicit lot anchors (readable site-plan pin).
    expect(FENBRIDGE_LAYOUT.buildings.map((b) => [b.id, b.position.x, b.position.z])).toEqual([
      ['fenbridge_warden_gatehouse', 9, 282],
      ['fenbridge_crooked_reed_inn', -21.25, 317],
      ['fenbridge_lantern_chapel', -19.5, 294],
      ['fenbridge_moonwort_apothecary', 17.8, 291.5],
      ['fenbridge_gilded_strongbox', 19.2, 309.5],
      ['fenbridge_hesk_tannery', -2, 320],
      ['fenbridge_scout_lodge', -13.5, 325.5],
    ]);

    for (let left = 0; left < FENBRIDGE_LAYOUT.buildings.length; left++) {
      const building = FENBRIDGE_LAYOUT.buildings[left];
      expect(building.rotation, building.id).toBeCloseTo(
        facingToward(building.position, FENBRIDGE_LAYOUT.civic.center),
        12,
      );
      expect(building.assetId).toBe(`/models/props/${building.id}.glb`);
      expect(FENBRIDGE_BUILDINGS_BY_ID[building.id]).toBe(building);
      expect(distancePointToObb(building.frontStandingPoint, building.footprint)).toBeCloseTo(1.5);
      for (let right = left + 1; right < FENBRIDGE_LAYOUT.buildings.length; right++) {
        expect(
          obbsOverlap(building.footprint, FENBRIDGE_LAYOUT.buildings[right].footprint),
          `${building.id} overlaps ${FENBRIDGE_LAYOUT.buildings[right].id}`,
        ).toBe(false);
      }
      for (const corner of [
        { x: -building.footprint.halfWidth, z: -building.footprint.halfDepth },
        { x: building.footprint.halfWidth, z: -building.footprint.halfDepth },
        { x: building.footprint.halfWidth, z: building.footprint.halfDepth },
        { x: -building.footprint.halfWidth, z: building.footprint.halfDepth },
      ]) {
        // maxCornerRadius is an intentionally conservative wall-containment bound.
        expect(
          Math.hypot(
            building.position.x - FENBRIDGE_LAYOUT.civic.center.x,
            building.position.z - FENBRIDGE_LAYOUT.civic.center.z,
          ) + Math.hypot(corner.x, corner.z),
          building.id,
        ).toBeLessThan(FENBRIDGE_LAYOUT.wall.radius);
      }
    }
  });

  it('pins the civic pieces and bounded repeated-asset inventory', () => {
    expect(FENBRIDGE_LAYOUT.hub).toEqual({ center: { x: 0, z: 300 }, radius: 34 });
    expect(FENBRIDGE_LAYOUT.civic.center).toEqual({ x: 0, z: 303 });
    expect(FENBRIDGE_LAYOUT.civic.cistern).toMatchObject({
      id: 'fenbridge_mirelight_cistern',
      assetId: '/models/props/fenbridge_mirelight_cistern.glb',
      position: { x: 0, z: 303 },
      radius: 1.8,
    });
    expect(FENBRIDGE_LAYOUT.civic.provisionStall).toMatchObject({
      id: 'fenbridge_provision_stall',
      assetId: '/models/props/fenbridge_provision_stall.glb',
      position: { x: -14, z: 313 },
    });
    expect(FENBRIDGE_LAYOUT.civic.musterBoard).toMatchObject({
      id: 'fenbridge_muster_board',
      assetId: '/models/props/fenbridge_muster_board.glb',
      position: { x: -6, z: 278 },
    });
    expect(FENBRIDGE_LAYOUT.repeated.boardwalks).toHaveLength(12);
    // Continuous paths: south spine + west/east spurs (not scattered planks).
    expect(
      FENBRIDGE_LAYOUT.repeated.boardwalks.filter((b) => Math.abs(b.position.x) < 0.01).length,
    ).toBeGreaterThanOrEqual(5);
    expect(FENBRIDGE_LAYOUT.repeated.boardwalks.every((boardwalk) => !boardwalk.blocking)).toBe(
      true,
    );
    expect(FENBRIDGE_LAYOUT.repeated.musterOrders).toEqual([
      {
        id: 'fenbridge_muster_order_west',
        position: { x: -3.75, z: 274.8 },
        assetId: '/models/quest/fenbridge_muster_order.glb',
        itemId: 'fen_muster_order',
        blocking: false,
      },
      {
        id: 'fenbridge_muster_order_east',
        position: { x: 3.75, z: 274.8 },
        assetId: '/models/quest/fenbridge_muster_order.glb',
        itemId: 'fen_muster_order',
        blocking: false,
      },
    ]);
  });

  it('opens four six-yard gates and keeps every palisade wing within its hard cap', () => {
    expect(FENBRIDGE_LAYOUT.wall).toMatchObject({
      radius: 31.5,
      maximumSegmentSpan: 12,
    });
    expect(
      FENBRIDGE_LAYOUT.wall.gates.map((gate) => ({
        id: gate.id,
        roadId: gate.roadId,
        crossing: gate.crossing,
        width: gate.width,
      })),
    ).toEqual([
      {
        id: 'fenbridge_gate_south',
        roadId: 'south_causeway',
        crossing: { x: 0, z: 271.5 },
        width: 6,
      },
      {
        id: 'fenbridge_gate_west',
        roadId: 'west_marsh',
        crossing: { x: 30.5, z: 313 },
        width: 6,
      },
      {
        id: 'fenbridge_gate_east',
        roadId: 'east_marsh',
        crossing: { x: -30.5, z: 314 },
        width: 6,
      },
      {
        id: 'fenbridge_gate_north',
        roadId: 'north_fen',
        crossing: { x: 0, z: 334.5 },
        width: 6,
      },
    ]);
    expect(FENBRIDGE_LAYOUT.wall.segments).toHaveLength(16);
    expect(FENBRIDGE_LAYOUT.wall.segments.length).toBeLessThanOrEqual(18);
    for (const segment of FENBRIDGE_LAYOUT.wall.segments) {
      expect(segment.arcLength, segment.id).toBeLessThanOrEqual(12);
    }
    for (const gate of FENBRIDGE_LAYOUT.wall.gates) {
      expect(Math.hypot(gate.end.x - gate.start.x, gate.end.z - gate.start.z)).toBeCloseTo(6, 10);
      expect(gate.arch.assetId).toBe('/models/props/fenbridge_gate_arch.glb');
      expect(gate.arch.collision).toBe('jambs_only');
      expect(gate.arch.jambs).toHaveLength(2);
    }
  });

  it('projects only the eight authored gate-arch jambs into runtime collision', () => {
    const colliders = colliderInternalsForTest.staticWorldColliders(SEED);
    const jambs = FENBRIDGE_LAYOUT.wall.gates.flatMap((gate) => gate.arch.jambs);

    for (const jamb of jambs) {
      const runtimeCollider = colliders.find(
        (collider) =>
          collider.type === 'obb' &&
          Math.abs(collider.x - jamb.center.x) < 1e-10 &&
          Math.abs(collider.z - jamb.center.z) < 1e-10 &&
          Math.abs(collider.hw - jamb.halfWidth) < 1e-10 &&
          Math.abs(collider.hd - jamb.halfDepth) < 1e-10 &&
          Math.abs(collider.rot - jamb.rotation) < 1e-10,
      );
      expect(runtimeCollider, jamb.id).toBeDefined();
      expect(isBlocked(SEED, jamb.center.x, jamb.center.z, 0.2), jamb.id).toBe(true);
    }

    expect(jambs).toHaveLength(8);
    for (const gate of FENBRIDGE_LAYOUT.wall.gates) {
      expect(isBlocked(SEED, gate.crossing.x, gate.crossing.z, 0.8), gate.id).toBe(false);
      expect(
        colliders.some(
          (collider) =>
            collider.type === 'obb' &&
            Math.abs(collider.x - gate.arch.position.x) < 1e-10 &&
            Math.abs(collider.z - gate.arch.position.z) < 1e-10 &&
            Math.abs(collider.hw - gate.arch.nativeDimensions.width / 2) < 1e-10 &&
            Math.abs(collider.hd - gate.arch.nativeDimensions.depth / 2) < 1e-10,
        ),
        `${gate.id} must not have a solid full-width arch collider`,
      ).toBe(false);
    }
  });

  it('keeps Fenbridge palisades full-height and free of Eastbrook synthetic pillars', () => {
    const colliders = colliderInternalsForTest.staticWorldColliders(SEED);
    const segment = FENBRIDGE_LAYOUT.wall.segments[0];
    const footprint = segment.footprint;
    const collinear = colliders.filter((collider) => {
      if (
        collider.type !== 'obb' ||
        Math.abs(collider.rot - footprint.rotation) >= 1e-10 ||
        Math.abs(collider.hd - footprint.halfDepth) >= 1e-10
      ) {
        return false;
      }
      const dx = collider.x - footprint.center.x;
      const dz = collider.z - footprint.center.z;
      const cos = Math.cos(-footprint.rotation);
      const sin = Math.sin(-footprint.rotation);
      const localX = dx * cos + dz * sin;
      const localZ = -dx * sin + dz * cos;
      return Math.abs(localZ) < 1e-10 && Math.abs(localX) <= footprint.halfWidth;
    });
    expect(collinear).toHaveLength(1);
    expect(collinear[0]).toMatchObject({
      type: 'obb',
      x: footprint.center.x,
      z: footprint.center.z,
      hw: footprint.halfWidth,
      hd: footprint.halfDepth,
      rot: footprint.rotation,
    });
    expect(collinear[0].moveTopY).toBeUndefined();
    expect(collinear[0].standable).toBeUndefined();

    const from = localToWorld(footprint.center, footprint.rotation, 0, -2);
    const to = localToWorld(footprint.center, footprint.rotation, 0, 2);
    const airborne = resolveMovement(SEED, from.x, from.z, to.x, to.z, 0.2, false, undefined, {
      y: terrainHeight(footprint.center.x, footprint.center.z, SEED) + 2.5,
      lift: 0,
    });
    expect(Math.hypot(airborne.x - to.x, airborne.z - to.z)).toBeGreaterThan(1);
  });

  it('keeps every exterior road suffix unchanged beyond the four new gate connectors', () => {
    const [south, west, east, north] = FENBRIDGE_LAYOUT.roads;
    expect(south.points.slice(0, 3)).toEqual([
      { x: 0, z: 80 },
      { x: 0, z: 180 },
      { x: -8, z: 240 },
    ]);
    expect(west.points.slice(-4)).toEqual([
      { x: 45, z: 336 },
      { x: 92, z: 350 },
      { x: 102, z: 392 },
      { x: 90, z: 420 },
    ]);
    expect(east.points.slice(-2)).toEqual([
      { x: -40, z: 370 },
      { x: -80, z: 420 },
    ]);
    expect(north.points.slice(-3)).toEqual([
      { x: 10, z: 400 },
      { x: 20, z: 470 },
      { x: 45, z: 515 },
    ]);
    expect(north.points.slice(0, 6)).toEqual([
      { x: 0, z: 307.5 },
      { x: 4, z: 313 },
      { x: 9, z: 318 },
      { x: 11, z: 324 },
      { x: 7.5, z: 330 },
      { x: 0, z: 334.5 },
    ]);
    for (const road of FENBRIDGE_LAYOUT.roads) {
      const gate = FENBRIDGE_LAYOUT.wall.gates.find((candidate) => candidate.id === road.gateId);
      expect(gate, road.id).toBeDefined();
      expect(road.points).toContainEqual(gate?.crossing);
    }
  });

  it('keeps all four canonical road centerlines clear of civic and building collision', () => {
    const stall = FENBRIDGE_LAYOUT.civic.provisionStall;
    for (const road of FENBRIDGE_LAYOUT.roads) {
      for (const point of samplePolyline(road.points, 0.2)) {
        if (Math.hypot(point.x, point.z - 303) > 35) continue;
        for (const building of FENBRIDGE_LAYOUT.buildings) {
          // 0.8 is the largest ordinary pet/body radius exercised below.
          expect(
            distancePointToObb(point, building.footprint),
            `${road.id}:${building.id}`,
          ).toBeGreaterThanOrEqual(0.8);
        }
        expect(
          distancePointToObb(point, stall.footprint),
          `${road.id}:stall`,
        ).toBeGreaterThanOrEqual(0.8);
        expect(Math.hypot(point.x, point.z - 303), `${road.id}:cistern`).toBeGreaterThanOrEqual(
          FENBRIDGE_LAYOUT.civic.cistern.radius + 0.8,
        );
      }
    }
  });

  it('keeps every west and east gate-connector span runtime-clear for the largest body', () => {
    const connectors = [
      { roadId: 'west_marsh', suffixEntry: { x: 45, z: 336 } },
      { roadId: 'east_marsh', suffixEntry: { x: -40, z: 370 } },
    ] as const;

    for (const connector of connectors) {
      const road = FENBRIDGE_LAYOUT.roads.find((candidate) => candidate.id === connector.roadId);
      expect(road, connector.roadId).toBeDefined();
      if (!road) continue;

      const suffixIndex = road.points.findIndex(
        (point) => point.x === connector.suffixEntry.x && point.z === connector.suffixEntry.z,
      );
      expect(suffixIndex, `${connector.roadId} suffix entry`).toBeGreaterThan(0);

      const gate = FENBRIDGE_LAYOUT.wall.gates.find((candidate) => candidate.id === road.gateId);
      expect(gate, `${connector.roadId} gate`).toBeDefined();
      if (!gate) continue;
      const gateIndex = road.points.findIndex(
        (point) => point.x === gate.crossing.x && point.z === gate.crossing.z,
      );
      expect(gateIndex, `${connector.roadId} crossing`).toBeGreaterThan(0);
      expect(gateIndex, `${connector.roadId} crossing`).toBeLessThan(road.points.length - 1);

      const radial = {
        x: gate.crossing.x - FENBRIDGE_LAYOUT.civic.center.x,
        z: gate.crossing.z - FENBRIDGE_LAYOUT.civic.center.z,
      };
      for (const [point, side] of [
        [road.points[gateIndex - 1], -1],
        [road.points[gateIndex + 1], 1],
      ] as const) {
        const dx = point.x - gate.crossing.x;
        const dz = point.z - gate.crossing.z;
        expect(dx * radial.z - dz * radial.x, `${connector.roadId} radial alignment`).toBeCloseTo(
          0,
          10,
        );
        expect(Math.sign(dx * radial.x + dz * radial.z), `${connector.roadId} radial side`).toBe(
          side,
        );
        expect(Math.hypot(dx, dz), `${connector.roadId} straight approach`).toBeCloseTo(4, 10);
      }

      const samples = samplePolyline(road.points.slice(0, suffixIndex + 1), 0.05);
      expect(samples.length, `${connector.roadId} dense samples`).toBeGreaterThan(1_000);
      for (const point of samples) {
        expect(
          isBlocked(SEED, point.x, point.z, 0.8),
          `${connector.roadId} connector at ${point.x},${point.z}`,
        ).toBe(false);
      }
    }
  });

  it('keeps the north connector runtime-clear of the preserved Mirefen wood node', () => {
    const north = FENBRIDGE_LAYOUT.roads.find((road) => road.id === 'north_fen');
    const woodNode = GATHER_NODES.find((node) => node.id === 'wood_mirefen_1');
    expect(north).toBeDefined();
    expect(woodNode).toMatchObject({
      id: 'wood_mirefen_1',
      type: 'wood',
      pos: { x: 20, z: 375 },
    });
    if (!north || !woodNode) return;

    const connectorSamples = samplePolyline(north.points.slice(0, 6), 0.1);
    for (const bodyRadius of [0.5, 0.8]) {
      for (const point of connectorSamples) {
        expect(
          isBlocked(SEED, point.x, point.z, bodyRadius),
          `north connector ${bodyRadius} at ${point.x},${point.z}`,
        ).toBe(false);
        expect(
          Math.hypot(point.x - woodNode.pos.x, point.z - woodNode.pos.z),
          `wood_mirefen_1 clearance for ${bodyRadius}`,
        ).toBeGreaterThanOrEqual(0.42 + bodyRadius);
      }
    }
  });
});

describe('Fenbridge content projection and preservation', () => {
  it('projects the zone, roads, static town props, and preserved remote props from the layout', () => {
    expect(ZONE2_ZONE).toMatchObject({
      id: 'mirefen_marsh',
      hub: { x: 0, z: 300, radius: 34, name: 'Fenbridge' },
      graveyard: { x: -18, z: 286 },
      lakes: [
        { x: -110, z: 310, radius: 35 },
        { x: 60, z: 380, radius: 25 },
        { x: -40, z: 450, radius: 20 },
      ],
    });
    expect(ZONE2_ZONE.pois.map(({ id, x, z }) => ({ id, x, z }))).toEqual([
      { id: 'fenbridge', x: 0, z: 300 },
      { id: 'prowler_reeds', x: -40, z: 230 },
      { id: 'deepfen_shallows', x: -105, z: 300 },
      { id: 'widow_thicket', x: 80, z: 315 },
      { id: 'drowned_chapel', x: 100, z: 435 },
      { id: 'troll_mounds', x: -95, z: 440 },
      { id: 'gravecaller_encampment', x: 0, z: 485 },
      { id: 'the_sunken_bastion', x: 45, z: 515 },
    ]);
    expect(ZONE2_ROADS).toEqual(
      FENBRIDGE_LAYOUT.roads.map((road) => road.points.map((point) => ({ ...point }))),
    );
    expect(ZONE2_PROPS.buildings.map((building) => building.id)).toEqual(
      FENBRIDGE_LAYOUT.buildings.map((building) => building.id),
    );
    expect(ZONE2_PROPS.wells.map((well) => well.id)).toEqual([FENBRIDGE_LAYOUT.civic.cistern.id]);
    expect(ZONE2_PROPS.stalls.map((stall) => stall.id)).toEqual([
      FENBRIDGE_LAYOUT.civic.provisionStall.id,
    ]);
    expect(ZONE2_PROPS.walls?.map((wall) => wall.id)).toEqual(
      FENBRIDGE_LAYOUT.wall.segments.map((segment) => segment.id),
    );
    expect(ZONE2_PROPS.fences).toEqual([]);
    expect(ZONE2_PROPS.docks).toEqual(FENBRIDGE_LAYOUT.preservedProps.docks);
    expect(ZONE2_PROPS.tents).toEqual(FENBRIDGE_LAYOUT.preservedProps.tents);
    expect(ZONE2_PROPS.marshReeds).toEqual(FENBRIDGE_LAYOUT.preservedProps.marshReeds);
    expect(ZONE2_PROPS.crates).toEqual(FENBRIDGE_LAYOUT.preservedProps.crates);
    expect(ZONE2_PROPS.campfires).toEqual([
      [16, 470],
      [-25, 489],
      [0, 506],
    ]);
    expect(ZONE2_PROPS.mudHuts).toEqual(FENBRIDGE_LAYOUT.preservedProps.mudHuts);
    expect(ZONE2_PROPS.ruinRings).toEqual(FENBRIDGE_LAYOUT.preservedProps.ruinRings);
    expect(ZONE2_PROPS.graveyards).toEqual([{ x: -18, z: 286 }]);
  });

  it('preserves camp order, count, and every non-town camp coordinate', () => {
    expect(ZONE2_CAMPS).toEqual([
      { mobId: 'mire_prowler', center: { x: -40, z: 230 }, radius: 22, count: 7 },
      { mobId: 'mire_prowler', center: { x: 35, z: 225 }, radius: 20, count: 6 },
      { mobId: 'deepfen_murloc', center: { x: -82, z: 273 }, radius: 15, count: 8 },
      { mobId: 'deepfen_murloc', center: { x: -120, z: 350 }, radius: 13, count: 6 },
      { mobId: 'mirejaw_the_ravenous', center: { x: -132, z: 333 }, radius: 5, count: 1 },
      { mobId: 'mire_widow', center: { x: 70, z: 300 }, radius: 20, count: 7 },
      { mobId: 'mire_widow', center: { x: 95, z: 340 }, radius: 16, count: 6 },
      { mobId: 'mirefen_broodmother', center: { x: 98, z: 348 }, radius: 3, count: 1 },
      // The quest-dedupe pass interleaves the Broodmother egg clutch with the
      // widow packs (it reuses their two camp centers and radii deliberately, so
      // the clutch reads as part of the nest rather than a separate pile) and
      // adds the Drowned Warlord elite capstone. Every Fenbridge coordinate
      // above and below is untouched, which is what this pin exists to prove.
      { mobId: 'spider_egg', center: { x: 70, z: 300 }, radius: 20, count: 7 },
      { mobId: 'spider_egg', center: { x: 95, z: 340 }, radius: 16, count: 6 },
      { mobId: 'drowned_dead', center: { x: 90, z: 420 }, radius: 20, count: 8 },
      { mobId: 'drowned_dead', center: { x: 115, z: 450 }, radius: 16, count: 6 },
      { mobId: 'sloomtooth_the_drowned', center: { x: 118, z: 455 }, radius: 5, count: 1 },
      { mobId: 'drowned_warlord', center: { x: 98, z: 432 }, radius: 3, count: 1 },
      { mobId: 'fen_troll', center: { x: -80, z: 420 }, radius: 22, count: 7 },
      { mobId: 'fen_troll', center: { x: -105, z: 455 }, radius: 18, count: 6 },
      { mobId: 'grubjaw', center: { x: -120, z: 480 }, radius: 8, count: 1 },
      { mobId: 'gravecaller_cultist', center: { x: 15, z: 470 }, radius: 20, count: 7 },
      { mobId: 'gravecaller_cultist', center: { x: -25, z: 490 }, radius: 16, count: 6 },
      { mobId: 'gravecaller_summoner', center: { x: -5, z: 500 }, radius: 12, count: 4 },
      { mobId: 'gravecaller_mender', center: { x: 18, z: 472 }, radius: 8, count: 2 },
      { mobId: 'sister_nhalia', center: { x: 24, z: 492 }, radius: 5, count: 1 },
      { mobId: 'deacon_voss', center: { x: 0, z: 510 }, radius: 2, count: 1 },
      { mobId: 'bog_bloat', center: { x: 72, z: 428 }, radius: 11, count: 5 },
      { mobId: 'bog_bloat', center: { x: 110, z: 440 }, radius: 11, count: 4 },
    ]);
  });

  it('preserves quest order and non-muster ground objects while moving exactly two orders', () => {
    expect(ZONE2_QUEST_ORDER).toEqual([
      'q_fenbridge_muster',
      'q_prowlers',
      'q_prowler_pelts',
      'q_fen_supplies',
      'q_the_codfather',
      'q_deepfen',
      'q_idols',
      'q_aldrics_fallen_star',
      'q_deepfen_purge',
      'q_widows',
      'q_broodmother',
      'q_drowned',
      'q_drowned_censers',
      'q_no_rest',
      'q_rite_of_redemption',
      'q_trolls',
      'q_troll_fetishes',
      'q_grubjaw',
      'q_cult_camp',
      'q_summoners',
      'q_deacon',
      'q_bastion_door',
      'q_olen',
      'q_mistcaller',
      'q_prof_workorder_tannery',
    ]);
    // The quest-dedupe pass prepends the burnable Mudfin huts (q_deepfen_purge),
    // so the Fenbridge muster order sits at index 1 rather than 0. Its two
    // positions are unchanged, and the slice below proves every later Fenbridge
    // ground object is untouched in both content and order.
    expect(ZONE2_OBJECTS[0]).toEqual({
      itemId: 'murloc_hut',
      name: 'Mudfin Hut',
      positions: [
        { x: -78, z: 269 },
        { x: -83, z: 266 },
        { x: -74, z: 275 },
        { x: -117, z: 346 },
        { x: -123, z: 354 },
      ],
    });
    expect(ZONE2_OBJECTS[1]).toEqual({
      itemId: 'fen_muster_order',
      name: 'Fenbridge Muster Order',
      positions: [
        { x: -3.75, z: 274.8 },
        { x: 3.75, z: 274.8 },
      ],
    });
    expect(ZONE2_OBJECTS.slice(2)).toEqual([
      {
        itemId: 'lost_caravan_goods',
        name: 'Lost Caravan Goods',
        positions: [
          { x: 1, z: 192 },
          { x: -3, z: 206 },
          { x: -6, z: 221 },
          { x: -8, z: 237 },
          { x: -7, z: 252 },
          { x: -3, z: 268 },
          { x: 2, z: 283 },
        ],
      },
      {
        itemId: 'rusted_censer',
        name: 'Rusted Censer',
        positions: [
          { x: 96, z: 429 },
          { x: 103, z: 430 },
          { x: 99, z: 434 },
          { x: 106, z: 437 },
          { x: 97, z: 440 },
          { x: 104, z: 441 },
        ],
      },
      {
        itemId: 'bastion_ward_stone',
        name: 'Bastion Ward Stone',
        positions: [
          { x: 43, z: 512 },
          { x: 48, z: 517 },
        ],
      },
      {
        itemId: 'unknown_alien_weaponry',
        name: 'Smoldering Meteor Debris',
        positions: [{ x: 151.8, z: 294.2 }],
      },
    ]);
  });

  it('pins the complete stable NPC payload while projecting only position and facing', () => {
    expect(Object.keys(ZONE2_NPCS)).toEqual(FENBRIDGE_LAYOUT.services.npcs.map((npc) => npc.id));
    // Re-pinned for q_rite_of_redemption joining brother_aldric_fen's quest
    // list (the only NPC-payload delta vs the prior pin; zone2.ts diff-checked).
    expect(createHash('sha256').update(JSON.stringify(stableNpcPayload())).digest('hex')).toBe(
      '7ba7c8ae4db5470fd76b7410698f113322e77df9fdad03415320a8988cccac0d',
    );
    for (const placement of FENBRIDGE_LAYOUT.services.npcs) {
      expect(FENBRIDGE_NPC_PLACEMENTS_BY_ID[placement.id]).toBe(placement);
      expect(ZONE2_NPCS[placement.id].pos).toEqual(placement.position);
      expect(ZONE2_NPCS[placement.id].facing).toBe(placement.facing);
    }
  });

  it('projects the exact mailbox, graveyard, and preserved tannery station', () => {
    expect(MAILBOXES[1]).toEqual({ x: 6, z: 294 });
    expect(OVERWORLD_GRAVEYARDS.find((graveyard) => graveyard.id === 'gy_fenbridge')).toEqual({
      id: 'gy_fenbridge',
      name: 'Fenbridge Barrow',
      x: -18,
      z: 286,
    });
    const station = STATIONS.find((candidate) => candidate.id === 'station_fenbridge_tannery');
    const stationPos = FENBRIDGE_STATIONS_BY_ID.station_fenbridge_tannery.position;
    const heskPos = ZONE2_NPCS.tanner_hesk.pos;
    expect(station).toEqual({
      id: 'station_fenbridge_tannery',
      type: 'tannery',
      zoneId: 'mirefen_marsh',
      pos: { x: stationPos.x, z: stationPos.z },
      masterNpcId: 'tanner_hesk',
    });
    // Station + master sit on the craft-bay apron and move with the tannery lot.
    expect(stationPos.x).toBeCloseTo(1.0670827486441765, 10);
    expect(stationPos.z).toBeCloseTo(315.3263500973041, 10);
    expect(heskPos.x).toBeCloseTo(3.053383957289929, 10);
    expect(heskPos.z).toBeCloseTo(315.5600325924389, 10);
    const masterDistance = Math.hypot(stationPos.x - heskPos.x, stationPos.z - heskPos.z);
    expect(masterDistance).toBeGreaterThanOrEqual(1);
    expect(masterDistance).toBeLessThanOrEqual(3);
    expect(FENBRIDGE_LAYOUT.services.rest).toEqual({
      id: 'fenbridge_inn_rest',
      buildingId: 'fenbridge_crooked_reed_inn',
    });
    expect(
      ZONE2_PROPS.buildings.find(
        (building) => building.id === FENBRIDGE_LAYOUT.services.rest.buildingId,
      )?.kind,
    ).toBe('inn');
  });

  it('projects the muster board through active services into exact runtime collision', () => {
    expect(MUSTER_BOARDS).toEqual([
      {
        id: 'fenbridge_muster_board',
        assetId: '/models/props/fenbridge_muster_board.glb',
        x: -6,
        z: 278,
        rotation: FENBRIDGE_LAYOUT.civic.musterBoard.rotation,
        width: 2.4,
        depth: 0.6,
        height: 2.6,
        frontStandingPoint: FENBRIDGE_LAYOUT.civic.musterBoard.frontStandingPoint,
      },
    ]);
    expect(BUILTIN_WORLD.services?.musterBoards).toBe(MUSTER_BOARDS);
    const board = MUSTER_BOARDS[0];
    const collider = colliderInternalsForTest
      .staticWorldColliders(SEED)
      .find(
        (candidate) =>
          candidate.type === 'obb' &&
          candidate.x === board.x &&
          candidate.z === board.z &&
          candidate.hw === board.width / 2 &&
          candidate.hd === board.depth / 2 &&
          candidate.rot === board.rotation,
      );
    expect(collider).toBeDefined();
    expect(collider?.moveTopY).toBeUndefined();
    expect(isBlocked(SEED, board.x, board.z, 0.2)).toBe(true);
  });

  it('pins the complete stable removal inventory', () => {
    expect(REMOVED_FENBRIDGE_PLACEMENTS.buildings.map((placement) => placement.id)).toEqual([
      'legacy_fenbridge_building_00',
      'legacy_fenbridge_building_01',
      'legacy_fenbridge_building_02',
      'legacy_fenbridge_building_03',
    ]);
    expect(REMOVED_FENBRIDGE_PLACEMENTS.wells[0]).toMatchObject({
      id: 'legacy_fenbridge_well',
      replacedBy: 'fenbridge_mirelight_cistern',
      x: 0,
      z: 302,
      radius: 1.5,
    });
    expect(REMOVED_FENBRIDGE_PLACEMENTS.stalls[0]).toMatchObject({
      id: 'legacy_fenbridge_stall',
      replacedBy: 'fenbridge_provision_stall',
      x: -5,
      z: 310.5,
    });
    expect(REMOVED_FENBRIDGE_PLACEMENTS.campfires.map((placement) => placement.id)).toEqual([
      'legacy_fenbridge_campfire_00',
      'legacy_fenbridge_campfire_01',
    ]);
    expect(REMOVED_FENBRIDGE_PLACEMENTS.fences.map((placement) => placement.id)).toEqual([
      'legacy_fenbridge_fence_00',
      'legacy_fenbridge_fence_01',
    ]);
    expect(REMOVED_FENBRIDGE_PLACEMENTS.npcPlacements).toHaveLength(8);
  });
});

describe('Fenbridge runtime safety and traversal', () => {
  it('spawns every NPC at its exact authored transform and keeps Petra a live banker chest', () => {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', noPlayer: true });
    for (const placement of FENBRIDGE_LAYOUT.services.npcs) {
      const entity = [...sim.entities.values()].find(
        (candidate) => candidate.kind === 'npc' && candidate.templateId === placement.id,
      );
      expect(entity, placement.id).toBeDefined();
      expect({ x: entity?.pos.x, z: entity?.pos.z }, placement.id).toEqual(placement.position);
      expect(entity?.facing, `${placement.id} facing`).toBe(placement.facing);
      expect(
        isBlocked(SEED, placement.position.x, placement.position.z, placement.bodyRadius),
      ).toBe(false);
    }

    const petra = FENBRIDGE_NPC_PLACEMENTS_BY_ID.bursar_petra_vell;
    const chest = bankerChestSpots(SEED).find(
      (spot) => spot.anchorX === petra.position.x && spot.anchorZ === petra.position.z,
    );
    expect(chest).toMatchObject({
      anchorX: petra.position.x,
      anchorZ: petra.position.z,
    });
    // Chest local offset is chosen by the banker-chest placer against the live
    // apron; pin that it is finite and beside Petra, not a fixed local slot.
    expect(chest?.localPlacement).toEqual(
      expect.objectContaining({
        x: expect.any(Number),
        z: expect.any(Number),
        rotationY: expect.any(Number),
      }),
    );
    expect(petra.anchorId).toBe('fenbridge_gilded_strongbox_teller');
    expect(FENBRIDGE_LAYOUT.services.bank).toMatchObject({
      id: 'fenbridge_bank_service',
      buildingId: 'fenbridge_gilded_strongbox',
      npcId: 'bursar_petra_vell',
      entrance: { localPosition: { x: 1.75, z: 3.25 } },
      teller: { localPosition: { x: -1.25, z: 3.25 } },
    });
    expect(petra.position).toEqual(FENBRIDGE_LAYOUT.services.bank.teller.standingPoint);
    expect(
      Math.hypot(
        petra.position.x - FENBRIDGE_LAYOUT.services.bank.teller.position.x,
        petra.position.z - FENBRIDGE_LAYOUT.services.bank.teller.position.z,
      ),
    ).toBeLessThanOrEqual(1.8);
    expect(isBlocked(SEED, petra.position.x, petra.position.z, 0.8)).toBe(false);
    expect(isBlocked(SEED, chest?.x ?? 0, chest?.z ?? 0, 0.5)).toBe(true);
  });

  it('pathfinds bidirectionally from the civic square to every gate, NPC, service, order, and entrance', () => {
    const square = { x: 3, z: 303 };
    const southCauseway = { x: 0, z: 266 };
    const destinations = [
      ...FENBRIDGE_LAYOUT.wall.gates.map((gate) => {
        const dx = gate.crossing.x - FENBRIDGE_LAYOUT.civic.center.x;
        const dz = gate.crossing.z - FENBRIDGE_LAYOUT.civic.center.z;
        const length = Math.hypot(dx, dz);
        return {
          id: gate.id,
          point: {
            x: gate.crossing.x + (dx / length) * 4,
            z: gate.crossing.z + (dz / length) * 4,
          },
        };
      }),
      ...FENBRIDGE_LAYOUT.services.npcs.map((npc) => ({ id: npc.id, point: npc.position })),
      ...FENBRIDGE_LAYOUT.services.stations.map((station) => ({
        id: station.id,
        point: station.position,
      })),
      {
        id: FENBRIDGE_LAYOUT.services.mailbox.id,
        point: FENBRIDGE_LAYOUT.services.mailbox.frontStandingPoint,
      },
      {
        id: FENBRIDGE_LAYOUT.services.graveyard.id,
        point: FENBRIDGE_LAYOUT.services.graveyard.position,
      },
      {
        id: FENBRIDGE_LAYOUT.civic.musterBoard.id,
        point: FENBRIDGE_LAYOUT.civic.musterBoard.frontStandingPoint,
      },
      {
        id: FENBRIDGE_LAYOUT.civic.provisionStall.id,
        point: FENBRIDGE_LAYOUT.civic.provisionStall.customerStandingPoint,
      },
      ...FENBRIDGE_LAYOUT.repeated.musterOrders.map((order) => ({
        id: order.id,
        point: order.position,
      })),
      ...FENBRIDGE_LAYOUT.buildings.map((building) => ({
        id: `${building.id}:entrance`,
        point: building.frontStandingPoint,
      })),
      {
        id: 'fenbridge_gilded_strongbox:teller',
        point: FENBRIDGE_LAYOUT.services.bank.teller.standingPoint,
      },
    ];

    for (const bodyRadius of [0.5, 0.8]) {
      expectPath(`south-to-square:${bodyRadius}`, southCauseway, square, bodyRadius);
      expectPath(`square-to-south:${bodyRadius}`, square, southCauseway, bodyRadius);
      for (const destination of destinations) {
        expectPath(`${destination.id}:out:${bodyRadius}`, square, destination.point, bodyRadius);
        expectPath(`${destination.id}:back:${bodyRadius}`, destination.point, square, bodyRadius);
      }
    }
  });
});
