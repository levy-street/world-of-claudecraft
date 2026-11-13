import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
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
    // Re-pinned 2026-10 for the Tidehold rebuild: six placed buildings replaced
    // the eleven kit shells, and the Weekly Vault moved off the bank's new
    // ground at (21, -119) onto the green south of the civic square. Re-pinned
    // again for the World of ClaudeCraft Studio map's arrangement: it stands
    // against the bank's harbour-side flank, half a yard off its wall.
    expect({ x: hall.x, z: hall.z }).toEqual({ x: -73.73, z: -103.4 });
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
      // A placed building is solid past its wall box too (a bell tower, a
      // strongroom, a forge shelter): the hall shares ground with none of them.
      for (const annex of b.annexes) expect(obbsOverlap(obb, annex), annex.id).toBe(false);
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
  it('draws nothing in the shipped world: the strong-house carries the great round door itself', async () => {
    // The hall is no longer the town's to draw: it is the hand-built strong-house the
    // live-world document stands on this spot (eastbrook_weekly_vault.ts
    // activeWorldStandsLiveTouchup, and scripts/assets/eastbrook_houses/houses.py
    // vault_house). The town keeps the slot and the record's collider and nothing else,
    // so a flat code-drawn door can never hang on a painted building again.
    const { group, hideTarget } = buildEastbrookWeeklyVault(() => 0);
    let meshes = 0;
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBe(0);
    expect(WEEKLY_VAULT_TRIANGLES).toBe(0);
    expect(hideTarget.mats).toHaveLength(0);
    expect(hideTarget.x).toBe(EASTBROOK_LAYOUT.weeklyVault.x);

    // The door is an object of the shipped model: a round door of nearly seven yards
    // across its stone ring, centred on the front, standing proud of the wall by under a
    // yard, its sill at the ground and its crown well under the jettied loft.
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(
      path.join(process.cwd(), 'public/models/eastbrook_houses/vault_house.glb'),
    );
    const nodes = doc.getRoot().listNodes();
    const door = nodes.find((node) => node.getName() === 'V_GreatDoor');
    const house = nodes.find((node) => node.getName() === 'vault_house');
    if (!door || !house) throw new Error('vault_house.glb has no V_GreatDoor or vault_house');
    const d = getBounds(door);
    const h = getBounds(house);
    const width = d.max[0] - d.min[0];
    expect(width).toBeGreaterThan(6.6);
    expect(width).toBeLessThan(7.2);
    expect((d.min[0] + d.max[0]) / 2).toBeCloseTo(0, 1);
    // round: as tall as it is wide, less what the ground hides of the ring
    expect(d.max[1] - d.min[1]).toBeGreaterThan(width - 1);
    expect(d.min[1]).toBeLessThan(0.1);
    expect(d.max[1]).toBeLessThan(7.6);
    // on the front (+z in the file): proud of the stone, never a room deep
    const through = d.max[2] - d.min[2];
    expect(through).toBeGreaterThan(0.4);
    expect(through).toBeLessThan(1.6);
    expect(d.max[2]).toBeGreaterThan(5.7);
    expect(d.max[2]).toBeLessThan(h.max[2] + 0.01);
    // twice a player's height (2.6): a door to look up at
    expect(width / 2.6).toBeGreaterThan(2.5);
  });
});
