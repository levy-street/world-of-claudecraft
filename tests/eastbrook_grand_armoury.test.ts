// Eastbrook Grand Armoury contract, round 4: the armoury is RETIRED from
// built-in placement. The KayKit barracks and a watch tower garrison its Wolf
// Run lot at (17.5, -5.5) as zone1 decorProps, while the armoury GLB, its
// exporter, and the render adapter stay shipped for custom worlds that place
// the landmark themselves. Provenance note: the authored landmark data lives
// on in src/sim/building_layout.ts (EASTBROOK_GRAND_ARMOURY: nativeBounds
// 13 x 16.35 x 9, lot (17.5, -5.5) rot -PI/2, foundationDepth 1.35, shipped
// asset /models/props/eastbrook_grand_armoury.glb); the old lot-ratio pins
// retired with the placement. These tests pin the retirement, the garrison
// colliders that replaced the lot, and the still-shipping adapter seam.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { eastbrookGrandArmouryInternalsForTest } from '../src/render/eastbrook_grand_armoury';
import { gfxInternalsForTest } from '../src/render/gfx';
import { stationPropPlacements } from '../src/render/stations_core';
import {
  BUILDING_TERRAIN_SAMPLE_STEP,
  buildingCameraHeight,
  buildingContainsPoint,
  buildingGroundOffset,
  buildingLocalToWorld,
  buildingRestPadding,
  buildingTerrainEnvelope,
  EASTBROOK_GRAND_ARMOURY,
  isEastbrookGrandArmoury,
} from '../src/sim/building_layout';
import {
  bankerChestSpots,
  colliderInternalsForTest,
  isBlocked,
  pathCrossesFence,
  resolveMovement,
} from '../src/sim/colliders';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { BUILTIN_WORLD, NPCS, PROPS, STATIONS, setActiveWorldContent } from '../src/sim/data';
import { EASTBROOK_BUILDINGS_BY_ID, EASTBROOK_LAYOUT } from '../src/sim/eastbrook_layout';
import {
  FENBRIDGE_BUILDINGS_BY_ID,
  FENBRIDGE_LAYOUT,
  localToWorld,
} from '../src/sim/fenbridge_layout';
import {
  findPlayerPath,
  PLAYER_BODY_RADIUS,
  PLAYER_MAX_CLIMB_SLOPE,
  PLAYER_SWIM_DEPTH,
} from '../src/sim/pathfind';
import { isResting } from '../src/sim/progression/xp';
import type { BuildingDef, Entity } from '../src/sim/types';
import { groundHeight, terrainHeight, waterLevelAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;
// Re-pinned 2026-08 for the Eastbrook harbor move (d19aa33f76,
// docs/design/eastbrook-revamp/site-plan.md): the wave A terrain re-sculpt is
// seed-independent world-gen, and under it seed 4717 lost the positive-skirt
// premise this suite exercises (its envelope now yields foundationSkirtDepth
// 0, which nulls the skirt). Seed 162 restores a skirt depth nearly identical
// to the old fixture's.
const ALTERNATE_SEED = 162;

// The retired placement, kept as a local fixture: custom worlds may still
// place the landmark, so the adapter seam keeps its coverage against the
// exact authored lot even though no built-in building row carries it.
const LANDMARK_FIXTURE = {
  id: 'eastbrook_grand_armoury',
  assetId: '/models/props/eastbrook_grand_armoury.glb',
  kind: 'house',
  landmark: EASTBROOK_GRAND_ARMOURY.landmark,
  ...EASTBROOK_GRAND_ARMOURY.lot,
  height: EASTBROOK_GRAND_ARMOURY.aboveGradeHeight,
} satisfies BuildingDef;

const BARRACKS_LOT = { x: 17.5, z: -5.5 } as const;
const BARRACKS_FRONT = { x: 12, z: -5.5 } as const;

afterEach(() => setActiveWorldContent(null));

function garrisonDecorProp(key: string) {
  const prop = (ZONE1_PROPS.decorProps ?? []).find(
    (candidate) => candidate.key === key && candidate.x > 0 && candidate.z > -30,
  );
  if (!prop) throw new Error(`missing Wolf Run garrison decor prop ${key}`);
  return prop;
}

function expectWalkableRoute(from: { x: number; z: number }, to: { x: number; z: number }): void {
  let route = findPlayerPath(SEED, from, to, 128);
  expect(route.length, 'route has no waypoints').toBeGreaterThan(0);
  let current = { ...from };
  let waypointIndex = 0;
  let stalledTicks = 0;
  expect(isBlocked(SEED, current.x, current.z, PLAYER_BODY_RADIUS), 'route start is blocked').toBe(
    false,
  );
  expect(
    groundHeight(current.x, current.z, SEED),
    'route start is in deep water',
  ).toBeGreaterThanOrEqual(waterLevelAt(current.x, current.z, SEED) - PLAYER_SWIM_DEPTH);
  expect(isBlocked(SEED, to.x, to.z, PLAYER_BODY_RADIUS), 'route destination is blocked').toBe(
    false,
  );

  // Runtime movement resolves each short stride against collision and replans
  // after a tangent waypoint stalls. Follow that same seam so the route proof
  // remains decisive around small rotated props such as the noticeboard.
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
    const resolved = resolveMovement(
      SEED,
      current.x,
      current.z,
      desired.x,
      desired.z,
      PLAYER_BODY_RADIUS,
    );
    expect(
      pathCrossesFence(current.x, current.z, resolved.x, resolved.z, PLAYER_BODY_RADIUS),
      `route leg crosses a fence from ${current.x},${current.z} to ${resolved.x},${resolved.z}`,
    ).toBe(false);
    expect(
      isBlocked(SEED, resolved.x, resolved.z, PLAYER_BODY_RADIUS),
      `blocked resolved route sample at ${resolved.x},${resolved.z}`,
    ).toBe(false);
    const moved = Math.hypot(resolved.x - current.x, resolved.z - current.z);
    const previousGround = groundHeight(current.x, current.z, SEED);
    const nextGround = groundHeight(resolved.x, resolved.z, SEED);
    expect(
      nextGround,
      `deep-water route sample at ${resolved.x},${resolved.z}`,
    ).toBeGreaterThanOrEqual(waterLevelAt(resolved.x, resolved.z, SEED) - PLAYER_SWIM_DEPTH);
    expect(
      (nextGround - previousGround) / Math.max(moved, Number.EPSILON),
      `route sample exceeds climb slope at ${resolved.x},${resolved.z}`,
    ).toBeLessThanOrEqual(PLAYER_MAX_CLIMB_SLOPE);
    current = resolved;
    stalledTicks = moved < 1e-4 ? stalledTicks + 1 : 0;
    if (stalledTicks >= 4) {
      route = findPlayerPath(SEED, current, to, 128);
      expect(route.length, 'route replan has no waypoints').toBeGreaterThan(0);
      waypointIndex = 0;
      stalledTicks = 0;
    }
  }
  expect(Math.hypot(to.x - current.x, to.z - current.z), 'route endpoint').toBeLessThanOrEqual(0.2);
}

describe('Eastbrook Grand Armoury retirement (round 4)', () => {
  it('retires the armoury from every built-in placement table', () => {
    expect(PROPS.buildings.filter(isEastbrookGrandArmoury)).toHaveLength(0);
    expect(PROPS.buildings.some((building) => building.landmark)).toBe(false);
    expect(EASTBROOK_LAYOUT.preservedBuildings).toEqual([]);
    expect(EASTBROOK_BUILDINGS_BY_ID.eastbrook_grand_armoury).toBeUndefined();
    // Round 4: the round-3 table held ten rows (armoury + nine layout lots);
    // the armoury row left, so the table is exactly the authored lots.
    // Round 6 (owner) then removed eastbrook_home_rise from the layout after
    // live review, dropping the authored lots to eight rows, and afterwards
    // appended the harbour quarter's three coastal buildings, so the table is
    // eleven rows now.
    expect(ZONE1_PROPS.buildings).toHaveLength(11);
    expect(ZONE1_PROPS.buildings.map((building) => building.id)).toEqual(
      EASTBROOK_LAYOUT.buildings.map((building) => building.id),
    );
  });

  it('pins the KayKit barracks and watch tower garrison on the freed Wolf Run lot', () => {
    expect(garrisonDecorProp('hexBarracks')).toEqual({
      key: 'hexBarracks',
      x: 17.5,
      z: -5.5,
      rot: -1.5707963267948966,
      scale: 6.5,
      r: 5.2,
      h: 11,
      hw: 4.7,
      hd: 4.5,
    });
    expect(garrisonDecorProp('hexWatchtower')).toEqual({
      key: 'hexWatchtower',
      x: 27,
      z: -13,
      rot: 2.2,
      scale: 6.5,
      r: 2.4,
      h: 12,
    });
  });

  it('collides the garrison as the authored box and circle with visual-height tops', () => {
    const colliders = colliderInternalsForTest.staticWorldColliders(SEED);
    const barracks = colliders.find(
      (collider) =>
        collider.type === 'obb' && collider.x === BARRACKS_LOT.x && collider.z === BARRACKS_LOT.z,
    );
    expect(barracks).toMatchObject({
      type: 'obb',
      hw: 4.7,
      hd: 4.5,
      rot: -1.5707963267948966,
      cameraTopY: terrainHeight(BARRACKS_LOT.x, BARRACKS_LOT.z, SEED) + 11,
    });
    const watchtower = colliders.find(
      (collider) => collider.type === 'circle' && collider.x === 27 && collider.z === -13,
    );
    expect(watchtower).toMatchObject({
      type: 'circle',
      r: 2.4,
      cameraTopY: terrainHeight(27, -13, SEED) + 12,
    });

    // The lot center blocks (the barracks stands there), the approach front
    // keeps the route body radius clear of the facade, and ground the old
    // armoury footprint walled off past the barracks box is walkable again.
    expect(isBlocked(SEED, BARRACKS_LOT.x, BARRACKS_LOT.z, 0)).toBe(true);
    expect(isBlocked(SEED, BARRACKS_FRONT.x, BARRACKS_FRONT.z, 0.8)).toBe(false);
    expect(isBlocked(SEED, 13.5, -11, 0.5)).toBe(false);
    expect(isBlocked(SEED, 27, -13, 0.5)).toBe(true);
  });

  it('grants no rest anywhere on the garrison lot', () => {
    for (const point of [BARRACKS_LOT, BARRACKS_FRONT]) {
      const player = {
        inCombat: false,
        pos: { x: point.x, y: terrainHeight(point.x, point.z, SEED), z: point.z },
      } as Entity;
      expect(isResting(player)).toBe(false);
    }
  });
});

describe('Eastbrook Grand Armoury gameplay preservation', () => {
  it('keeps resting with the authored Eastbrook inn', () => {
    const innRestPoint = EASTBROOK_BUILDINGS_BY_ID.eastbrook_inn.frontStandingPoint;
    const player = {
      inCombat: false,
      pos: {
        x: innRestPoint.x,
        y: terrainHeight(innRestPoint.x, innRestPoint.z, SEED),
        z: innRestPoint.z,
      },
    } as Entity;
    expect(isResting(player)).toBe(true);
    player.inCombat = true;
    expect(isResting(player)).toBe(false);

    // The inn's rest footprint is the authored one and nothing else grants
    // rest: the inn row plus its 2 yard padding is the whole area.
    player.inCombat = false;
    player.pos.x = EASTBROOK_BUILDINGS_BY_ID.eastbrook_inn.position.x;
    player.pos.z = EASTBROOK_BUILDINGS_BY_ID.eastbrook_inn.position.z;
    expect(isResting(player)).toBe(true);

    player.pos.x = NPCS.card_master.pos.x;
    player.pos.z = NPCS.card_master.pos.z;
    // The card table USED to sit on the inn porch (anchored to eastbrook_inn),
    // inside the inn's authored rest footprint. Owner refinement round 6b
    // redistributed the town's NPCs by role and moved the Card Master across
    // to the bank at (20, -98), sixty yards off the inn at (-38, -88), so the
    // authored behavior at his stand is now NO rest. The move is deliberate,
    // and this row follows it rather than the reverse: rest belongs to the
    // inn, not to the Card Master.
    expect(isResting(player)).toBe(false);
    // The landmark's narrow threshold halo stays the adapter's rule for
    // custom worlds that place it.
    expect(buildingRestPadding(LANDMARK_FIXTURE)).toBe(0.9);
  });

  it('does not leak the built-in rest area into a custom world without buildings', () => {
    const player = {
      inCombat: false,
      pos: { x: 17.5, y: terrainHeight(17.5, -5.5, SEED), z: -5.5 },
    } as Entity;
    try {
      setActiveWorldContent({
        ...BUILTIN_WORLD,
        props: { ...BUILTIN_WORLD.props, buildings: [] },
      });
      expect(isResting(player)).toBe(false);
    } finally {
      setActiveWorldContent(null);
    }
  });

  it('does not turn a custom-world armoury landmark into an implicit rest area', () => {
    const building = { ...LANDMARK_FIXTURE, x: 47.5, z: 24.5 };
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      props: { ...BUILTIN_WORLD.props, buildings: [building] },
    });
    const player = {
      inCombat: false,
      pos: { x: 42.4, y: terrainHeight(42.4, 24.5, SEED), z: 24.5 },
    } as Entity;
    expect(isBlocked(SEED, player.pos.x, player.pos.z, PLAYER_BODY_RADIUS)).toBe(false);
    expect(isResting(player)).toBe(false);
  });

  it('uses the collider-correct rest footprint for the rebuilt Fenbridge inn', () => {
    const authoredInn = FENBRIDGE_BUILDINGS_BY_ID.fenbridge_crooked_reed_inn;
    const fenbridgeInn = PROPS.buildings.find(
      (building) => building.id === FENBRIDGE_LAYOUT.services.rest.buildingId,
    );
    if (!fenbridgeInn) throw new Error('missing Fenbridge inn fixture');
    expect(fenbridgeInn).toMatchObject({
      id: 'fenbridge_crooked_reed_inn',
      assetId: '/models/props/fenbridge_crooked_reed_inn.glb',
      x: -21.25,
      z: 317,
      w: 9,
      d: 8,
      rot: FENBRIDGE_BUILDINGS_BY_ID.fenbridge_crooked_reed_inn.rotation,
    });

    const restPadding = buildingRestPadding(fenbridgeInn);
    const restPoint = authoredInn.frontStandingPoint;
    const outsideRestPoint = localToWorld(
      authoredInn.position,
      authoredInn.rotation,
      authoredInn.sockets.entrance.localPosition.x,
      authoredInn.nativeDimensions.depth / 2 + restPadding + 0.25,
    );
    expect(restPadding).toBe(2);
    expect(buildingContainsPoint(fenbridgeInn, restPoint.x, restPoint.z, restPadding)).toBe(true);
    expect(
      buildingContainsPoint(fenbridgeInn, outsideRestPoint.x, outsideRestPoint.z, restPadding),
    ).toBe(false);

    const player = {
      inCombat: false,
      pos: {
        x: restPoint.x,
        y: terrainHeight(restPoint.x, restPoint.z, SEED),
        z: restPoint.z,
      },
    } as Entity;
    expect(isResting(player)).toBe(true);
    player.pos = {
      x: outsideRestPoint.x,
      y: terrainHeight(outsideRestPoint.x, outsideRestPoint.z, SEED),
      z: outsideRestPoint.z,
    };
    expect(isResting(player)).toBe(false);
  });

  it('keeps nearby NPC bodies, the banker, and the banker chest approach outside collision', () => {
    const ids = [
      'card_master',
      'tinker_gizzel',
      'chronicler_saul',
      'apothecary_lin',
      'bursar_fernando',
      'smith_haldren',
      'forgemistress_darva',
      'marshal_redbrook',
      'cook_marlow',
    ];
    for (const id of ids) {
      const npc = NPCS[id];
      if (!npc) throw new Error(`missing pinned Eastbrook NPC ${id}`);
      expect(isBlocked(SEED, npc.pos.x, npc.pos.z, 0.6), `${id} overlaps collision`).toBe(false);
    }
    // The strongbox is a SOLID standable prop (banker_chest_layout): the
    // chest spot itself blocks, and the approach that must stay clear is the
    // banker's own interaction point beside it, at route body radius.
    const chest = bankerChestSpots(SEED).find(
      (s) =>
        Math.hypot(s.anchorX - NPCS.bursar_fernando.pos.x, s.anchorZ - NPCS.bursar_fernando.pos.z) <
        0.75,
    );
    expect(chest, 'fernando chest spot resolved').toBeDefined();
    if (!chest) return;
    expect(isBlocked(SEED, chest.x, chest.z, 0.5), 'chest spot is solid').toBe(true);
    expect(
      isBlocked(SEED, chest.anchorX, chest.anchorZ, 0.8),
      'banker approach overlaps collision',
    ).toBe(false);
  });

  it('keeps the square, card table, toolworks, and barracks approach mutually reachable', () => {
    const approach = EASTBROOK_GRAND_ARMOURY.frontApproachWorld;
    const square = { x: 4, z: -2 };
    const toolworksStation = STATIONS.find(
      (station) => station.id === 'station_eastbrook_toolworks',
    );
    if (!toolworksStation) throw new Error('Eastbrook toolworks station is missing');
    const toolworks = toolworksStation.pos;
    for (const destination of [square, NPCS.card_master.pos, toolworks]) {
      expectWalkableRoute(approach, destination);
      expectWalkableRoute(destination, approach);
    }
  });

  it('keeps the toolworks prop cluster attached to the authored station anchor', () => {
    const station = STATIONS.find((candidate) => candidate.id === 'station_eastbrook_toolworks');
    if (!station) throw new Error('Eastbrook toolworks station is missing');
    const props = stationPropPlacements(STATIONS).filter(
      (placement) => placement.stationId === 'station_eastbrook_toolworks',
    );
    // The anchor prop stands BESIDE the station point (solid furniture
    // may not wall off the interaction point routes end on), so the cluster
    // hangs off the authored anchor by its authored offsets.
    expect(props).toEqual([
      {
        stationId: 'station_eastbrook_toolworks',
        kind: 'workbench',
        x: station.pos.x + 1.5,
        z: station.pos.z + 0.6,
        rot: -0.4,
      },
      {
        stationId: 'station_eastbrook_toolworks',
        kind: 'crate',
        x: station.pos.x - 0.9,
        z: station.pos.z + 0.4,
        rot: 0.2,
      },
      {
        stationId: 'station_eastbrook_toolworks',
        kind: 'barrel',
        x: station.pos.x - 1,
        z: station.pos.z + 1.1,
        rot: -0.8,
      },
    ]);
  });

  it('keeps the approach and Card Master route anchors on dry, walkable terrain', () => {
    const points = [EASTBROOK_GRAND_ARMOURY.frontApproachWorld, NPCS.card_master.pos];
    for (const point of points) {
      expect(terrainHeight(point.x, point.z, SEED)).toBeGreaterThan(
        waterLevelAt(point.x, point.z, SEED) - 0.8,
      );
      expect(isBlocked(SEED, point.x, point.z, PLAYER_BODY_RADIUS)).toBe(false);
    }
  });
});

describe('Eastbrook Grand Armoury render seam (custom-world adapter)', () => {
  it('keeps the authored landmark data and one exact-scale GLB for custom placements', () => {
    expect(EASTBROOK_GRAND_ARMOURY.nativeBounds).toEqual({ width: 13, height: 16.35, depth: 9 });
    expect(EASTBROOK_GRAND_ARMOURY.aboveGradeHeight).toBe(15);
    expect(EASTBROOK_GRAND_ARMOURY.foundationDepth).toBe(1.35);
    expect(EASTBROOK_GRAND_ARMOURY.modelUnitsPerWorldYard).toBe(1);
    expect(eastbrookGrandArmouryInternalsForTest.assetUrl).toBe(
      '/models/props/eastbrook_grand_armoury.glb',
    );

    const building = LANDMARK_FIXTURE;
    expect(buildingCameraHeight(building)).toBe(15);
    expect(buildingGroundOffset(building)).toBe(-1.35);
    expect(buildingContainsPoint(building, building.x, building.z)).toBe(true);
    expect(buildingContainsPoint(building, 13, -5.5)).toBe(true);
    expect(buildingContainsPoint(building, 22, -5.5)).toBe(true);
    expect(buildingContainsPoint(building, 12.99, -5.5)).toBe(false);
    expect(buildingContainsPoint(building, 22.01, -5.5)).toBe(false);
    expect(buildingContainsPoint(building, 17.5, -12)).toBe(true);
    expect(buildingContainsPoint(building, 17.5, 1)).toBe(true);
    expect(buildingContainsPoint(building, 17.5, -12.01)).toBe(false);
    expect(buildingContainsPoint(building, 17.5, 1.01)).toBe(false);

    const entrance = buildingLocalToWorld(building, 0, building.d / 2);
    const placement = eastbrookGrandArmouryInternalsForTest.placementForBuilding(building, (x, z) =>
      terrainHeight(x, z, SEED),
    );
    expect(placement).toMatchObject({
      x: 17.5,
      z: -5.5,
      rotationY: -Math.PI / 2,
      scale: 1,
      cameraTopY: terrainHeight(entrance.x, entrance.z, SEED) + 15,
      foundationSkirtDepth: 0,
    });
    expect(placement.y).toBeCloseTo(terrainHeight(entrance.x, entrance.z, SEED) - 1.35, 8);

    const ordinary = { ...building, landmark: undefined } as BuildingDef;
    expect(() =>
      eastbrookGrandArmouryInternalsForTest.placementForBuilding(ordinary, () => 0),
    ).toThrow('requires its authored landmark building');
    expect(
      // The public adapter must return before touching the preloaded template,
      // otherwise ordinary inns could double-render as the landmark.
      eastbrookGrandArmouryInternalsForTest.buildView(ordinary, () => 0),
    ).toBeNull();
  });

  it('seats the front sill at town grade and keeps the foundation under every sampled terrain point', () => {
    const building = LANDMARK_FIXTURE;
    expect(BUILDING_TERRAIN_SAMPLE_STEP).toBe(0.5);
    const terrain = buildingTerrainEnvelope(building, (x, z) => terrainHeight(x, z, SEED));
    const placementY = terrain.modelBottomY;
    const sillY = placementY + EASTBROOK_GRAND_ARMOURY.foundationDepth;
    expect(terrain.entranceWorld).toEqual({ x: 13, z: -5.5 });
    expect(sillY).toBeCloseTo(terrainHeight(13, -5.5, SEED), 8);
    expect(terrain.foundationSkirtDepth).toBe(0);

    for (let x = 13; x <= 22; x += 1.5) {
      for (let z = -12; z <= 1; z += 2) {
        if (!buildingContainsPoint(building, x, z)) continue;
        const ground = terrainHeight(x, z, SEED);
        expect(placementY, `foundation floats at ${x},${z}`).toBeLessThanOrEqual(ground + 0.02);
        expect(
          sillY - ground,
          `foundation cannot cover terrain fall at ${x},${z}`,
        ).toBeLessThanOrEqual(EASTBROOK_GRAND_ARMOURY.foundationDepth);
      }
    }
  });

  it('extends a solid adaptive foundation to alternate-seed and custom-terrain minima', () => {
    const building = LANDMARK_FIXTURE;
    const alternatePlacement = eastbrookGrandArmouryInternalsForTest.placementForBuilding(
      building,
      (x, z) => terrainHeight(x, z, ALTERNATE_SEED),
    );
    // Re-pinned 2026-08 to the seed-162 envelope after the Eastbrook harbor
    // move's terrain re-sculpt (d19aa33f76,
    // docs/design/eastbrook-revamp/site-plan.md). Re-pinned again for the
    // round-6 camp and POI moves (wild boar and vale bandit centers, the
    // boar_meadow and bandit_camp markers): the world-gen draws they feed
    // shift the sampled ground under this lot by a fraction of a unit, so the
    // envelope minimum and the skirt depth it derives both move. The entrance
    // sample and the placement height are unchanged.
    // Re-pinned once more for round 6b (the delve and reliquary_hill POI moved
    // to the Mirror Lake shore, three town NPCs were redistributed): those
    // draws land the sampled ground under this lot back on the exact
    // pre-round-6 envelope, so the minimum and the skirt depth return to the
    // values they carried before the camp and POI moves. The entrance sample
    // and the placement height never moved through either round.
    expect(alternatePlacement.entranceGroundY).toBeCloseTo(7.886894391475175, 8);
    expect(alternatePlacement.minGroundY).toBeCloseTo(5.559724942256701, 8);
    expect(alternatePlacement.y).toBeCloseTo(6.536894391475174, 8);
    expect(alternatePlacement.foundationSkirtDepth).toBeCloseTo(0.977169449218473, 8);

    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ vertexColors: true });
    stone.name = 'ArmouryStone';
    group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), stone));
    expect(
      eastbrookGrandArmouryInternalsForTest.addAdaptiveFoundationSkirt(group, building, 0),
    ).toBeNull();
    expect(group.children).toHaveLength(1);
    const skirt = eastbrookGrandArmouryInternalsForTest.addAdaptiveFoundationSkirt(
      group,
      building,
      alternatePlacement.foundationSkirtDepth,
    );
    expect(skirt).not.toBeNull();
    expect(skirt?.material).toBe(stone);
    expect(skirt?.geometry.getAttribute('color')).toBeDefined();
    const skirtBounds = new THREE.Box3().setFromObject(skirt as THREE.Mesh);
    expect(skirtBounds.max.x - skirtBounds.min.x).toBeCloseTo(13, 8);
    expect(skirtBounds.max.z - skirtBounds.min.z).toBeCloseTo(9, 8);
    expect(alternatePlacement.y + skirtBounds.min.y).toBeCloseTo(alternatePlacement.minGroundY, 7);
    expect(skirtBounds.max.y).toBeCloseTo(0.03, 7);
    const skirtColor = skirt?.geometry.getAttribute('color') as THREE.BufferAttribute;
    const expectedSkirtColor = new THREE.Color(0x46505e);
    expect(skirtColor.getX(0)).toBeCloseTo(expectedSkirtColor.r, 8);
    expect(skirtColor.getY(0)).toBeCloseTo(expectedSkirtColor.g, 8);
    expect(skirtColor.getZ(0)).toBeCloseTo(expectedSkirtColor.b, 8);

    const interiorDip = buildingLocalToWorld(building, 1, 0.5);
    setActiveWorldContent({
      ...BUILTIN_WORLD,
      terrainEdits: [
        {
          x: interiorDip.x,
          z: interiorDip.z,
          radius: 0.2,
          delta: -7,
          falloff: 'flat',
          mode: 'add',
        },
      ],
    });
    const edited = eastbrookGrandArmouryInternalsForTest.placementForBuilding(building, (x, z) =>
      terrainHeight(x, z, SEED),
    );
    expect(buildingContainsPoint(building, interiorDip.x, interiorDip.z)).toBe(true);
    expect(edited.minGroundY).toBeCloseTo(terrainHeight(interiorDip.x, interiorDip.z, SEED), 8);
    expect(edited.minGroundY).toBeLessThan(-5);
    expect(edited.foundationSkirtDepth).toBeGreaterThan(5);
    expect(edited.y - edited.foundationSkirtDepth).toBeCloseTo(edited.minGroundY, 8);
  });

  it('clones an immutable source, preserves Standard material factors, and excludes emissives from shadows', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: true });
    const source = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stone = new THREE.MeshStandardMaterial({
      color: 0x77808d,
      vertexColors: true,
      roughness: 0.37,
      metalness: 0.63,
    });
    stone.name = 'Stone';
    const warm = new THREE.MeshStandardMaterial({
      color: 0xffae48,
      emissive: 0xff9a35,
      emissiveIntensity: 1.05,
      vertexColors: true,
    });
    warm.name = 'WarmEmissive';
    const crystal = new THREE.MeshStandardMaterial({
      color: 0x44c9ff,
      emissive: 0x2ebeff,
      emissiveIntensity: 1.35,
      vertexColors: true,
    });
    crystal.name = 'ArcaneEmissive';
    source.add(
      new THREE.Mesh(geometry, stone),
      new THREE.Mesh(geometry, stone),
      new THREE.Mesh(geometry, warm),
      new THREE.Mesh(geometry, crystal),
    );

    try {
      const built = eastbrookGrandArmouryInternalsForTest.buildArmouryFromSource(source);
      const meshes: THREE.Mesh[] = [];
      built.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });

      expect(meshes).toHaveLength(4);
      expect(meshes.every((mesh) => mesh.geometry === geometry)).toBe(true);
      expect(meshes.every((mesh) => mesh.geometry.getAttribute('color') !== undefined)).toBe(true);
      expect(meshes.map((mesh) => mesh.castShadow)).toEqual([true, true, false, false]);
      expect(meshes.every((mesh) => mesh.receiveShadow)).toBe(true);
      expect(
        meshes.every((mesh) => (mesh.material as THREE.Material).type === 'MeshStandardMaterial'),
      ).toBe(true);
      expect(meshes[0].material).toBe(meshes[1].material);
      expect((meshes[0].material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
      expect((meshes[0].material as THREE.MeshStandardMaterial).color.getHex()).toBe(
        stone.color.getHex(),
      );
      expect((meshes[0].material as THREE.MeshStandardMaterial).roughness).toBe(stone.roughness);
      expect((meshes[0].material as THREE.MeshStandardMaterial).metalness).toBe(stone.metalness);
      expect((meshes[2].material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(
        warm.emissive.getHex(),
      );
      expect((meshes[3].material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(
        crystal.emissiveIntensity,
      );
      expect(source.children.map((child) => (child as THREE.Mesh).material)).toEqual([
        stone,
        stone,
        warm,
        crystal,
      ]);
    } finally {
      restoreGfx();
    }
  });

  it('uses the Lambert-compatible Low/native-iOS arm without losing vertex colors or emissive cues', () => {
    const restoreGfx = gfxInternalsForTest.overrideSettings({ standardMaterials: false });
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(
        new Float32Array(geometry.getAttribute('position').count * 3).fill(0.6),
        3,
      ),
    );
    const source = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({
      color: 0x77808d,
      vertexColors: true,
      roughness: 0.82,
      metalness: 0.1,
    });
    stone.name = 'StoneLowFixture';
    const warm = new THREE.MeshStandardMaterial({
      color: 0xffae48,
      vertexColors: true,
      emissive: 0xff9a35,
      emissiveIntensity: 1.05,
    });
    warm.name = 'WarmFactorFixture';
    source.add(new THREE.Mesh(geometry, stone), new THREE.Mesh(geometry, warm));

    try {
      const built = eastbrookGrandArmouryInternalsForTest.buildArmouryFromSource(source);
      const meshes: THREE.Mesh[] = [];
      built.traverse((child) => {
        if (child instanceof THREE.Mesh) meshes.push(child);
      });
      expect(meshes).toHaveLength(2);
      expect(
        meshes.every((mesh) => (mesh.material as THREE.Material).type === 'MeshLambertMaterial'),
      ).toBe(true);
      expect(
        meshes.every((mesh) => (mesh.material as THREE.MeshLambertMaterial).vertexColors),
      ).toBe(true);
      expect((meshes[0].material as THREE.MeshLambertMaterial).color.getHex()).toBe(
        stone.color.getHex(),
      );
      expect((meshes[1].material as THREE.MeshLambertMaterial).color.getHex()).toBe(
        warm.color.getHex(),
      );
      expect((meshes[1].material as THREE.MeshLambertMaterial).emissive.getHex()).toBe(
        warm.emissive.getHex(),
      );
      expect((meshes[1].material as THREE.MeshLambertMaterial).emissiveIntensity).toBe(
        warm.emissiveIntensity,
      );
      expect(meshes.map((mesh) => mesh.castShadow)).toEqual([true, false]);
    } finally {
      restoreGfx();
    }
  });

  it('recognizes emissive material names and factors independently', () => {
    const named = new THREE.MeshStandardMaterial({ emissive: 0x000000 });
    named.name = 'DecorativeEmissive';
    const factored = new THREE.MeshStandardMaterial({ emissive: 0x111111 });
    factored.name = 'WarmWindow';
    const dark = new THREE.MeshStandardMaterial({ emissive: 0x000000 });
    dark.name = 'ArmouryStone';
    expect(eastbrookGrandArmouryInternalsForTest.materialIsEmissive(named)).toBe(true);
    expect(eastbrookGrandArmouryInternalsForTest.materialIsEmissive(factored)).toBe(true);
    expect(eastbrookGrandArmouryInternalsForTest.materialIsEmissive(dark)).toBe(false);
  });

  it('dispatches the landmark before the old inn asset branch', () => {
    const source = readFileSync(new URL('../src/render/props.ts', import.meta.url), 'utf8');
    const armouryDispatch = source.indexOf('buildEastbrookGrandArmouryView(b, ground)');
    // The legacy per-kind asset resolution (now the shared buildingAssetPick
    // helper, so the impostor collector resolves the SAME asset) must stay
    // BELOW the landmark dispatch in the building loop, which `continue`s:
    // an armoury building must never fall through to a generic house pick.
    // The scan anchors on the loop's CALL SITE, not the helper's internals.
    const legacyAssetDispatch = source.indexOf('const asset = buildingAssetPick(b);');
    expect(armouryDispatch).toBeGreaterThan(0);
    expect(legacyAssetDispatch).toBeGreaterThan(armouryDispatch);
    expect(source).toMatch(
      /const armoury = buildEastbrookGrandArmouryView\(b, ground\);\s*if \(armoury\) \{\s*group\.add\(armoury\.group\);\s*registerHideable\(\s*armoury\.group,\s*obbFootprint\(b\.x, b\.z, b\.w \/ 2, b\.d \/ 2, b\.rot, armoury\.cameraTopY\),\s*\);\s*continue;\s*\}/,
    );
  });
});
