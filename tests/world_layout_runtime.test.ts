import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {
      eastbrook_bank: {
        path: '/models/tidehold/bank.glb',
        x: -60,
        z: -120,
        rotation: 3.9269908169872414,
        scale: 13.358504545454544,
        lift: -1.35,
        groundY: 50,
      },
      fenbridge_gilded_strongbox: {
        path: '/models/tidehold/fenrire/shop_a.glb',
        x: -47.24921810755174,
        z: 333.4989613563245,
        rotation: -Math.PI / 2,
        scale: 11.099795454545452,
        lift: -2.55,
        groundY: 1.1168982661567985,
      },
    },
    npcs: { fury: { pos: { x: 123, z: 456 }, facing: 1 } },
    stations: { station_eastbrook_loom: { pos: { x: -36, z: 325 }, zoneId: 'mirefen_marsh' } },
    graveyards: { gy_thornpeak: { x: 12.8, z: 738.8 } },
    zoneGraveyards: { thornpeak_heights: { x: 12.8, z: 738.8 } },
    roads: {
      edits: [],
      additions: [
        {
          id: 'runtime-test',
          points: [
            { x: 123, z: 456 },
            { x: 124, z: 457 },
          ],
        },
      ],
    },
    camps: [
      {
        sources: [{ mobId: 'forest_wolf', center: { x: -10, z: 6 } }],
        placements: [{ center: { x: -30, z: 40 }, radius: 2, count: 6 }],
      },
    ],
    groundObjects: { leyline_cache: { positions: [{ x: 480, z: 300 }] } },
    objectMoves: { 'practiceDummy:healing_dummy_tank': { x: 0, z: 0, removed: true } },
  },
}));

import { buildPlacedTownBuilding } from '../src/render/eastbrook_placed_building';
import { interiorCameraInternalsForTest } from '../src/render/interior_camera';
import { placedTownCameraInterior } from '../src/render/placed_town_interior_core';
import { createPlacedTownInteriors } from '../src/render/placed_town_interiors';
import { bakedBoxesForPath } from '../src/sim/asset_collision';
import { buildingRecordColliders } from '../src/sim/authored_town_buildings';
import type { Collider } from '../src/sim/collider_shapes';
import { emitPlacementBoxes } from '../src/sim/colliders_authored/placement_colliders';
import {
  BUILTIN_WORLD,
  CAMPS,
  GROUND_OBJECTS,
  NPCS,
  OVERWORLD_GRAVEYARDS,
  ROADS,
  STATIONS,
  ZONES,
} from '../src/sim/data';
import { FENBRIDGE_LAYOUT } from '../src/sim/fenbridge_layout';
import { placementRampFloorAt } from '../src/sim/placement_ramps';
import { collectCalmAnchorPads } from '../src/sim/terrain_calm_anchors';
import { nearTownWalkIn, townWalkInPlacements, walkInPlacementFor } from '../src/sim/town_walk_in';
import { WORLD_SEED } from '../src/sim/world_seed';

afterEach(() => interiorCameraInternalsForTest.reset());

describe('shared built-in layout activation', () => {
  it('updates canonical exports and the shared world together without replacing gameplay', () => {
    expect(NPCS).toBe(BUILTIN_WORLD.npcs);
    expect(NPCS.fury.pos).toEqual({ x: 123, z: 456 });
    expect(NPCS.fury.vendorItems).toHaveLength(189);
    expect(STATIONS).toBe(BUILTIN_WORLD.services!.stations);
    expect(STATIONS.find((s) => s.id === 'station_eastbrook_loom')).toMatchObject({
      pos: { x: -36, z: 325 },
      zoneId: 'mirefen_marsh',
      type: 'loom',
      masterNpcId: 'weaver_ottilie',
    });
    expect(OVERWORLD_GRAVEYARDS).toBe(BUILTIN_WORLD.services!.graveyards);
    expect(ZONES).toBe(BUILTIN_WORLD.zones);
    expect(OVERWORLD_GRAVEYARDS.find((g) => g.id === 'gy_thornpeak')).toMatchObject({
      x: 12.8,
      z: 738.8,
    });
    expect(ZONES.find((z) => z.id === 'thornpeak_heights')!.graveyard).toEqual({
      x: 12.8,
      z: 738.8,
    });
    expect(collectCalmAnchorPads().filter((p) => p.category === 'graveyard')).toContainEqual(
      expect.objectContaining({ x: 12.8, z: 738.8 }),
    );
    expect(ROADS).toBe(BUILTIN_WORLD.roads);
    expect(ROADS).toHaveLength(104);
    expect(ROADS.at(-1)).toEqual([
      { x: 123, z: 456 },
      { x: 124, z: 457 },
    ]);
    expect(CAMPS).toBe(BUILTIN_WORLD.camps);
    expect(CAMPS[0]).toMatchObject({
      mobId: 'forest_wolf',
      center: { x: -30, z: 40 },
      radius: 2,
      count: 6,
    });
    expect(GROUND_OBJECTS).toBe(BUILTIN_WORLD.groundObjects);
    expect(GROUND_OBJECTS.find((o) => o.itemId === 'leyline_cache')).toMatchObject({
      positions: [{ x: 480, z: 300 }],
      entityIds: [2_147_100_001],
    });
    const eastbrookBank = BUILTIN_WORLD.props.buildings.find((b) => b.id === 'eastbrook_bank')!;
    expect(walkInPlacementFor(eastbrookBank)).toMatchObject({
      x: -60,
      z: -120,
      detached: true,
      groundY: 50,
    });
    expect(BUILTIN_WORLD.objectMoves!['practiceDummy:healing_dummy_tank'].removed).toBe(true);
    expect(Object.isFrozen(BUILTIN_WORLD.objectMoves)).toBe(true);
  });

  it('uses one moved bank record for props, walk-in collision/floor placement and camera', () => {
    const bank = FENBRIDGE_LAYOUT.buildings.find((b) => b.id === 'fenbridge_gilded_strongbox')!;
    const record = BUILTIN_WORLD.props.buildings.find((b) => b.id === bank.id)!;
    const p = walkInPlacementFor(record)!;
    expect(p).toMatchObject({
      x: -47.24921810755174,
      z: 333.4989613563245,
      detached: true,
      groundY: 1.1168982661567985,
      y: -2.55,
    });
    expect(townWalkInPlacements(BUILTIN_WORLD)).toContainEqual(p);
    expect(nearTownWalkIn(p.x, p.z)).toBe(true);
    const expectedWalls: Collider[] = [];
    emitPlacementBoxes(expectedWalls, p, bakedBoxesForPath(p.path)!, p.groundY!);
    expect(expectedWalls.length).toBeGreaterThan(1);
    expect(buildingRecordColliders(record, 100, () => -1000, WORLD_SEED)).toEqual(expectedWalls);
    const genericPlacementWorld = {
      ...BUILTIN_WORLD,
      props: { ...BUILTIN_WORLD.props, buildings: [] },
      placements: [p],
    };
    const expectedFloor = placementRampFloorAt(genericPlacementWorld, WORLD_SEED, p.x, p.z);
    expect(Number.isFinite(expectedFloor)).toBe(true);
    expect(placementRampFloorAt(BUILTIN_WORLD, WORLD_SEED, p.x, p.z)).toBeCloseTo(
      expectedFloor,
      10,
    );
    const terrain = vi.fn(() => -1000);
    const interiors = createPlacedTownInteriors();
    expect(interiors.add(bank, terrain)).toEqual(
      placedTownCameraInterior(bank, 1.1168982661567985),
    );
    expect(terrain).not.toHaveBeenCalled();
    interiors.clear();
  });

  it('draws a detached town building at the same fixed seat even when terrain differs', () => {
    const bank = FENBRIDGE_LAYOUT.buildings.find((b) => b.id === 'fenbridge_gilded_strongbox')!;
    const geometry = new THREE.BoxGeometry(1, 2, 1);
    const material = new THREE.MeshStandardMaterial();
    const model = new THREE.Mesh(geometry, material);
    const terrain = vi.fn(() => -1000);
    const view = buildPlacedTownBuilding('fenbridge', bank, model, terrain);
    expect(view.group.position.y).toBeCloseTo(1.1168982661567985 + bank.placement.scale - 2.55, 10);
    expect(view.group.position.x).toBe(bank.placement.x);
    expect(terrain).not.toHaveBeenCalled();
    view.group.traverse((child) => {
      if (child instanceof THREE.Mesh)
        for (const m of Array.isArray(child.material) ? child.material : [child.material])
          m.dispose();
    });
    geometry.dispose();
    material.dispose();
  });
});
