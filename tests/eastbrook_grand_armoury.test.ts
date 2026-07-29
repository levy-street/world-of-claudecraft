// Eastbrook Grand Armoury integration contract. The visual landmark keeps its
// measured southeast lot while the rebuilt town gives the rest role to a real inn.
// These tests pin the shared authored footprint before the Three adapter and
// shipping GLB are allowed to diverge from simulation collision or terrain.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { eastbrookGrandArmouryInternalsForTest } from '../src/render/eastbrook_grand_armoury';
import { GFX } from '../src/render/gfx';
import { stationPropPlacements } from '../src/render/stations_core';
import {
  BUILDING_TERRAIN_SAMPLE_STEP,
  buildingCameraHeight,
  buildingContainsPoint,
  buildingContainsRestPoint,
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
import { EASTBROOK_BUILDINGS_BY_ID } from '../src/sim/eastbrook_layout';
import {
  findPlayerPath,
  PLAYER_BODY_RADIUS,
  PLAYER_MAX_CLIMB_SLOPE,
  PLAYER_SWIM_DEPTH,
} from '../src/sim/pathfind';
import { isResting } from '../src/sim/progression/xp';
import type { BuildingDef, Entity } from '../src/sim/types';
import { groundHeight, terrainHeight, waterLevelAt } from '../src/sim/world';

const SEED = 20061;
const ALTERNATE_SEED = 4717;

afterEach(() => setActiveWorldContent(null));

function armouryBuilding() {
  const building = PROPS.buildings.find(isEastbrookGrandArmoury);
  if (!building) throw new Error('Eastbrook Grand Armoury building is missing');
  return building;
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
  ).toBeGreaterThanOrEqual(waterLevelAt(current.x, current.z) - PLAYER_SWIM_DEPTH);
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
    ).toBeGreaterThanOrEqual(waterLevelAt(resolved.x, resolved.z) - PLAYER_SWIM_DEPTH);
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

describe('Eastbrook Grand Armoury lot', () => {
  it('keeps the southeast civic lot as a measured non-resting landmark footprint', () => {
    const building = armouryBuilding();
    expect(building).toMatchObject({
      kind: 'house',
      landmark: 'eastbrook_grand_armoury',
      x: 17.5,
      z: -5.5,
      w: 13,
      d: 9,
      rot: -Math.PI / 2,
    });
    expect(ZONE1_PROPS.buildings).toHaveLength(7);
    expect(PROPS.buildings.some((b) => b.x === 12 && b.z === -6)).toBe(false);
    expect(PROPS.buildings.filter(isEastbrookGrandArmoury)).toHaveLength(1);
  });

  it('is several times a typical Eastbrook house and keeps one yard equal to one model unit', () => {
    const building = armouryBuilding();
    const houses = ZONE1_PROPS.buildings.filter(
      (candidate) => candidate.kind === 'house' && !isEastbrookGrandArmoury(candidate),
    );
    const averageHouseArea = houses.reduce((sum, b) => sum + b.w * b.d, 0) / houses.length;
    expect((building.w * building.d) / averageHouseArea).toBeGreaterThanOrEqual(3);
    expect(EASTBROOK_GRAND_ARMOURY.nativeBounds).toEqual({ width: 13, height: 16.35, depth: 9 });
    expect(EASTBROOK_GRAND_ARMOURY.aboveGradeHeight).toBe(15);
    expect(EASTBROOK_GRAND_ARMOURY.foundationDepth).toBe(1.35);
    expect(EASTBROOK_GRAND_ARMOURY.modelUnitsPerWorldYard).toBe(1);
  });

  it('shares one exact footprint and camera height across placement and collision math', () => {
    const building = armouryBuilding();
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
    expect(isBlocked(SEED, building.x, building.z, 0)).toBe(true);
    expect(isBlocked(SEED, 13.01, -5.5, 0)).toBe(true);
    expect(isBlocked(SEED, 12.99, -5.5, 0)).toBe(false);
    expect(isBlocked(SEED, 17.5, -11.99, 0)).toBe(true);
    expect(isBlocked(SEED, 17.5, -12.01, 0)).toBe(false);

    const collider = colliderInternalsForTest
      .staticWorldColliders(SEED)
      .find(
        (candidate) => candidate.type === 'obb' && candidate.x === 17.5 && candidate.z === -5.5,
      );
    expect(collider).toMatchObject({
      type: 'obb',
      hw: 6.5,
      hd: 4.5,
      rot: -Math.PI / 2,
      cameraTopY: 16.5,
    });
  });

  it('seats the front sill at town grade and keeps the foundation under every sampled terrain point', () => {
    const building = armouryBuilding();
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
    const building = armouryBuilding();
    const alternatePlacement = eastbrookGrandArmouryInternalsForTest.placementForBuilding(
      building,
      (x, z) => terrainHeight(x, z, ALTERNATE_SEED),
    );
    expect(alternatePlacement.entranceGroundY).toBeCloseTo(1.5, 8);
    expect(alternatePlacement.minGroundY).toBeCloseTo(-0.8266606569, 8);
    expect(alternatePlacement.y).toBeCloseTo(0.15, 8);
    expect(alternatePlacement.foundationSkirtDepth).toBeCloseTo(0.9766606569, 8);

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
});

describe('Eastbrook Grand Armoury gameplay preservation', () => {
  it('retires the garrison rest area and gives resting to the authored Eastbrook inn', () => {
    const building = armouryBuilding();
    const exteriorRestPoint = { x: 12.4, z: -5.5 };
    expect(isBlocked(SEED, exteriorRestPoint.x, exteriorRestPoint.z, PLAYER_BODY_RADIUS)).toBe(
      false,
    );
    const player = {
      inCombat: false,
      pos: {
        x: exteriorRestPoint.x,
        y: terrainHeight(exteriorRestPoint.x, exteriorRestPoint.z, SEED),
        z: exteriorRestPoint.z,
      },
    } as Entity;
    expect(isResting(player)).toBe(false);

    const innRestPoint = EASTBROOK_BUILDINGS_BY_ID.eastbrook_inn.frontStandingPoint;
    player.pos.x = innRestPoint.x;
    player.pos.z = innRestPoint.z;
    expect(isResting(player)).toBe(true);
    player.inCombat = true;
    expect(isResting(player)).toBe(false);

    player.inCombat = false;
    player.pos.x = NPCS.card_master.pos.x;
    player.pos.z = NPCS.card_master.pos.z;
    expect(buildingRestPadding(building)).toBe(0.9);
    expect(isResting(player)).toBe(false);
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
    const building = { ...armouryBuilding(), x: 47.5, z: 24.5 };
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

  it('preserves the legacy rest footprint of unrelated rotated inns', () => {
    const fenbridgeInn = PROPS.buildings.find(
      (building) => building.x === 13 && building.z === 306,
    );
    if (!fenbridgeInn) throw new Error('Fenbridge inn fixture is missing');
    expect(buildingContainsRestPoint(fenbridgeInn, 6, 306.8, 2)).toBe(true);
    expect(buildingContainsRestPoint(fenbridgeInn, 6, 304.6, 2)).toBe(false);

    const player = {
      inCombat: false,
      pos: { x: 6, y: terrainHeight(6, 306.8, SEED), z: 306.8 },
    } as Entity;
    expect(isResting(player)).toBe(true);
    player.pos.z = 304.6;
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
    ];
    for (const id of ids) {
      const npc = NPCS[id];
      if (!npc) throw new Error(`missing pinned Eastbrook NPC ${id}`);
      expect(isBlocked(SEED, npc.pos.x, npc.pos.z, 0.6), `${id} overlaps collision`).toBe(false);
    }
    // The strongbox is a SOLID standable prop now (banker_chest_layout): the
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

  it('keeps the square, card table, toolworks, and armoury approach mutually reachable', () => {
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
    // The anchor prop stands BESIDE the station point now (solid furniture
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
    for (const prop of props) {
      expect(buildingContainsPoint(armouryBuilding(), prop.x, prop.z, 0.25), prop.kind).toBe(false);
    }
  });

  it('keeps the approach and Card Master route anchors on dry, walkable terrain', () => {
    const points = [EASTBROOK_GRAND_ARMOURY.frontApproachWorld, NPCS.card_master.pos];
    for (const point of points) {
      expect(terrainHeight(point.x, point.z, SEED)).toBeGreaterThan(
        waterLevelAt(point.x, point.z) - 0.8,
      );
      expect(isBlocked(SEED, point.x, point.z, PLAYER_BODY_RADIUS)).toBe(false);
    }
  });
});

describe('Eastbrook Grand Armoury render seam', () => {
  it('preloads one exact-scale GLB and derives placement from the shared building data', () => {
    const building = armouryBuilding();
    const entrance = buildingLocalToWorld(building, 0, building.d / 2);
    expect(eastbrookGrandArmouryInternalsForTest.assetUrl).toBe(
      '/models/props/eastbrook_grand_armoury.glb',
    );
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

  it('clones an immutable source, preserves Standard material factors, and excludes emissives from shadows', () => {
    const mutableGfx = GFX as unknown as { standardMaterials: boolean };
    const originalStandardMaterials = mutableGfx.standardMaterials;
    mutableGfx.standardMaterials = true;
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
      mutableGfx.standardMaterials = originalStandardMaterials;
    }
  });

  it('uses the Lambert-compatible Low/native-iOS arm without losing vertex colors or emissive cues', () => {
    const mutableGfx = GFX as unknown as { standardMaterials: boolean };
    const originalStandardMaterials = mutableGfx.standardMaterials;
    mutableGfx.standardMaterials = false;
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
      mutableGfx.standardMaterials = originalStandardMaterials;
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
    // The legacy per-kind asset resolution (the `inn` entry now rides a
    // kindAsset lookup rather than an inline ternary, so the Veiled Hollow set
    // can share it) must stay BELOW the landmark dispatch, which `continue`s.
    const legacyAssetDispatch = source.indexOf('kindAsset[b.kind] ??');
    expect(armouryDispatch).toBeGreaterThan(0);
    expect(legacyAssetDispatch).toBeGreaterThan(armouryDispatch);
    expect(source).toMatch(
      /const armoury = buildEastbrookGrandArmouryView\(b, ground\);\s*if \(armoury\) \{\s*group\.add\(armoury\.group\);\s*registerHideable\(\s*armoury\.group,\s*obbFootprint\(b\.x, b\.z, b\.w \/ 2, b\.d \/ 2, b\.rot, armoury\.cameraTopY\),\s*\);\s*continue;\s*\}/,
    );
  });
});
