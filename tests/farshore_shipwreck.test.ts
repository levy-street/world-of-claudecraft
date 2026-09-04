import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  FARSHORE_SHIPWRECK_PLAN,
  farshoreShipwreckInternalsForTest,
} from '../src/render/farshore_shipwreck';
import { WORLD_QUESTS_BY_ID } from '../src/sim/data';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

function triangleScene(zValues: readonly number[]): THREE.Group {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (const z of zValues) {
    positions.push(0, 0, z, 0.2, 0, z + 0.2, 0.1, 0, z + 0.1);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  return group;
}

describe('Farshore moored shipwreck', () => {
  it('reuses the shipped pirate ship and broken dock assets', () => {
    const manifest = readFileSync('src/render/assets/manifest.generated.ts', 'utf8');
    expect(farshoreShipwreckInternalsForTest.assetUrls).toEqual({
      ship: '/models/biome/sea_boat_sail_b.glb',
      dock: '/models/biome/beach_dock_broken.glb',
    });
    for (const url of Object.values(farshoreShipwreckInternalsForTest.assetUrls)) {
      expect(existsSync(path.join(process.cwd(), 'public', url))).toBe(true);
      expect(manifest).toContain(url.slice(1));
    }
  });

  it('places both structures in the shallows beside the salvage quest', () => {
    const quest = WORLD_QUESTS_BY_ID.wq_farshore_salvage;
    for (const seed of [1, 42, 1337, 8_675_309]) {
      expect(
        terrainHeight(FARSHORE_SHIPWRECK_PLAN.ship.x, FARSHORE_SHIPWRECK_PLAN.ship.z, seed),
      ).toBeLessThan(WATER_LEVEL);
      expect(
        terrainHeight(FARSHORE_SHIPWRECK_PLAN.dock.x, FARSHORE_SHIPWRECK_PLAN.dock.z, seed),
      ).toBeLessThan(WATER_LEVEL);
    }
    expect(
      Math.hypot(
        FARSHORE_SHIPWRECK_PLAN.ship.x - quest.area.x,
        FARSHORE_SHIPWRECK_PLAN.ship.z - quest.area.z,
      ),
    ).toBeLessThan(30);
    expect(
      Math.hypot(
        FARSHORE_SHIPWRECK_PLAN.ship.x - FARSHORE_SHIPWRECK_PLAN.dock.x,
        FARSHORE_SHIPWRECK_PLAN.ship.z - FARSHORE_SHIPWRECK_PLAN.dock.z,
      ),
    ).toBeLessThan(14);
  });

  it('removes the seaward triangles and preserves the render attributes', () => {
    const source = (triangleScene([-1, 1]).children[0] as THREE.Mesh).geometry;
    const sourcePositions = source.getAttribute('position').array.slice();
    const clipped = farshoreShipwreckInternalsForTest.clipGeometryPastBrokenBow(source, 0);

    expect(clipped.getAttribute('position').count).toBe(3);
    expect(clipped.getAttribute('normal').count).toBe(3);
    expect(clipped.getAttribute('uv').count).toBe(3);
    const clippedPositions = clipped.getAttribute('position');
    expect(
      Math.min(
        ...Array.from({ length: clippedPositions.count }, (_, i) => clippedPositions.getZ(i)),
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(source.getAttribute('position').array).toEqual(sourcePositions);
  });

  it('builds a visibly damaged ship and a separate mooring without mutating the sources', () => {
    const shipSource = triangleScene([-1.2, -0.4, 0.4, 1.2]);
    const dockSource = triangleScene([-0.5, 0.5]);
    const originalShip = Array.from(
      (
        (shipSource.children[0] as THREE.Mesh).geometry.getAttribute(
          'position',
        ) as THREE.BufferAttribute
      ).array,
    );

    const root = farshoreShipwreckInternalsForTest.buildFromScenes(shipSource, dockSource);
    const ship = root.getObjectByName('farshore-broken-ship') as THREE.Group;
    const dock = root.getObjectByName('farshore-broken-dock') as THREE.Group;

    expect(root.name).toBe('farshore-shipwreck');
    expect(ship).toBeDefined();
    expect(dock).toBeDefined();
    expect(ship.getObjectByName('farshore-exposed-ribs')).toBeDefined();
    expect(ship.getObjectByName('farshore-broken-plank-ends')).toBeDefined();
    expect(ship.getObjectByName('farshore-fallen-mast')).toBeDefined();
    expect(root.getObjectByName('farshore-mooring-lines')?.children).toHaveLength(4);
    expect(ship.position).toMatchObject({
      x: FARSHORE_SHIPWRECK_PLAN.ship.x,
      y: FARSHORE_SHIPWRECK_PLAN.ship.y,
      z: FARSHORE_SHIPWRECK_PLAN.ship.z,
    });
    expect(dock.position).toMatchObject({
      x: FARSHORE_SHIPWRECK_PLAN.dock.x,
      y: FARSHORE_SHIPWRECK_PLAN.dock.y,
      z: FARSHORE_SHIPWRECK_PLAN.dock.z,
    });
    expect(
      Array.from(
        (
          (shipSource.children[0] as THREE.Mesh).geometry.getAttribute(
            'position',
          ) as THREE.BufferAttribute
        ).array,
      ),
    ).toEqual(originalShip);
  });

  it('is composed by the existing Farshore feature builder', () => {
    const source = readFileSync('src/render/farshore_features.ts', 'utf8');
    expect(source).toContain("import { buildFarshoreShipwreck } from './farshore_shipwreck';");
    expect(source).toContain('const shipwreck = buildFarshoreShipwreck();');
    expect(source).toContain('if (shipwreck) group.add(shipwreck);');
  });
});
