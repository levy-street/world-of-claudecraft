import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildEastbrookWeeklyVault,
  WEEKLY_VAULT_TRIANGLES,
} from '../src/render/eastbrook_weekly_vault';
import { colliderInternalsForTest } from '../src/sim/colliders';
import { ZONE1_NPCS, ZONE1_PROPS, ZONE1_ROADS } from '../src/sim/content/zone1';
import { setActiveWorldContent } from '../src/sim/data';
import {
  distancePointToObb,
  EASTBROOK_LAYOUT,
  localToWorld,
  obbsOverlap,
  samplePolyline,
} from '../src/sim/eastbrook_layout';
import { terrainHeight, terrainHeightWithForcedCalm } from '../src/sim/world';

describe('Eastbrook independent stone vault', () => {
  afterEach(() => setActiveWorldContent(null));
  it('shares an unobstructed keeper location and solid footprint with collision', () => {
    const hall = EASTBROOK_LAYOUT.weeklyVault;
    const obb = {
      id: hall.id,
      center: { x: hall.x, z: hall.z },
      halfWidth: hall.w / 2,
      halfDepth: hall.d / 2,
      rotation: hall.rot,
    };
    expect({ x: hall.x, z: hall.z }).toEqual({ x: 21, z: -119 });
    expect(ZONE1_PROPS.buildings.at(-1)?.id).toBe(hall.id);
    expect(ZONE1_NPCS.eastbrook_vault_keeper.banker).toBeUndefined();
    expect(ZONE1_NPCS.eastbrook_vault_keeper.pos).toEqual(hall.keeper);
    expect(distancePointToObb(hall.keeper, obb)).toBeCloseTo(3);
    for (const b of EASTBROOK_LAYOUT.buildings) {
      expect(
        obbsOverlap(obb, {
          id: b.id,
          center: b.position,
          halfWidth: b.nativeDimensions.width / 2,
          halfDepth: b.nativeDimensions.depth / 2,
          rotation: b.rotation,
        }),
        b.id,
      ).toBe(false);
    }
    const colliders = colliderInternalsForTest.staticWorldColliders(1337);
    expect(
      colliders.some(
        (c) =>
          c.type === 'obb' &&
          c.x === hall.x &&
          c.z === hall.z &&
          c.hw === hall.w / 2 &&
          c.hd === hall.d / 2,
      ),
    ).toBe(true);
    for (const p of samplePolyline(ZONE1_ROADS[2], 0.5))
      expect(distancePointToObb(p, obb)).toBeGreaterThan(2.5);
    setActiveWorldContent(null);
    for (const seed of [1337, 42, 1])
      for (let x = -7; x <= 7; x += 2)
        for (let z = -6; z <= 9; z += 1) {
          const p = localToWorld(hall, hall.rot, x, z);
          expect(terrainHeight(p.x, p.z, seed)).toBeCloseTo(
            terrainHeight(hall.keeper.x, hall.keeper.z, seed),
            7,
          );
        }
  });
  it('keeps normal grading independent of forced calm probe order', () => {
    setActiveWorldContent(null);
    const { x, z } = EASTBROOK_LAYOUT.weeklyVault;
    const normal = terrainHeight(x, z, 1337);
    for (const calm of [0, 1]) {
      setActiveWorldContent(null);
      terrainHeightWithForcedCalm(x, z, 1337, calm);
      expect(terrainHeight(x, z, 1337)).toBeCloseTo(normal, 10);
    }
  });
  it('builds a substantial hall within the declared bounds and accounts for every triangle and fade material', () => {
    const { group, hideTarget } = buildEastbrookWeeklyVault(() => 0);
    group.rotation.y = 0;
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    expect(size.x).toBeLessThanOrEqual(14.1);
    expect(size.x).toBeGreaterThan(13);
    expect(size.y).toBeGreaterThan(11);
    expect(size.z).toBeLessThan(12.5);
    let triangles = 0;
    let meshes = 0;
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        triangles +=
          (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
        meshes++;
        expect(object.castShadow).toBe(true);
        expect(object.receiveShadow).toBe(true);
      }
    });
    expect(triangles).toBe(WEEKLY_VAULT_TRIANGLES);
    expect(meshes).toBe(8);
    expect(hideTarget.mats).toHaveLength(8);
    expect(hideTarget.x).toBe(EASTBROOK_LAYOUT.weeklyVault.x);
  });
});
