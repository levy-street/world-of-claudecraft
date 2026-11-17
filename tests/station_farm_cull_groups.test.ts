// Station props and farm patches cull past the fog (render/stations.ts,
// render/farm_patches.ts): both used to be one plain scene group, so every
// crafting hub's barrels and crates and every garden's beds drew from anywhere
// in the world (a town frame on Low drew 16 of them from 345 to 958 yd, past
// the fog at 175). Each now hands the renderer one zone-feature cull group per
// hub cell or per patch, attached through attachZoneFeature without a band bake.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFarmPatchProps } from '../src/render/farm_patches';
import { buildStationProps, STATION_CULL_CELL_YD } from '../src/render/stations';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { STATIONS } from '../src/sim/content/professions';
import { WORLD_SEED } from '../src/sim/world_seed';

const cellOf = (x: number, z: number) =>
  `${Math.floor(x / STATION_CULL_CELL_YD)}:${Math.floor(z / STATION_CULL_CELL_YD)}`;

/** Every drawable under a group, and the world XZ of each instance in it. */
function instancePoints(root: THREE.Object3D): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        v.setFromMatrixPosition(m.premultiply(o.matrixWorld));
        out.push({ x: v.x, z: v.z });
      }
    } else if ((o as THREE.Mesh).isMesh) {
      o.getWorldPosition(v);
      out.push({ x: v.x, z: v.z });
    }
  });
  return out;
}

describe('station props cull groups', () => {
  const view = buildStationProps(WORLD_SEED, STATIONS);

  it('hands over one cull group per occupied cell, and every drawable lives in one', () => {
    expect(view.cullGroups.length).toBeGreaterThan(1);
    expect(view.group.children).toEqual(view.cullGroups);
    for (const cell of view.cullGroups) {
      const key = cell.name.replace('stationProps:cell:', '');
      const points = instancePoints(cell);
      expect(points.length, cell.name).toBeGreaterThan(0);
      // a placement's instance may sit a little off its anchor (the part's own
      // offset), never in another cell's square
      for (const p of points) {
        const [cx, cz] = key.split(':').map(Number);
        expect(p.x).toBeGreaterThan(cx * STATION_CULL_CELL_YD - 10);
        expect(p.x).toBeLessThan((cx + 1) * STATION_CULL_CELL_YD + 10);
        expect(p.z).toBeGreaterThan(cz * STATION_CULL_CELL_YD - 10);
        expect(p.z).toBeLessThan((cz + 1) * STATION_CULL_CELL_YD + 10);
      }
    }
  });

  it('puts each kitchen fire in the cell of its own station', () => {
    expect(view.flames.length).toBeGreaterThan(0);
    for (const flame of view.flames) {
      const holder = flame.parent;
      const cell = holder?.parent;
      expect(cell && view.cullGroups.includes(cell as THREE.Group)).toBe(true);
      if (!holder || !cell) continue;
      expect(cell.name).toBe(`stationProps:cell:${cellOf(holder.position.x, holder.position.z)}`);
    }
  });

  it('builds nothing for a world with no stations', () => {
    const empty = buildStationProps(WORLD_SEED, []);
    expect(empty.cullGroups).toEqual([]);
    expect(empty.group.children.length).toBe(0);
  });
});

describe('farm patch cull groups', () => {
  const view = buildFarmPatchProps(WORLD_SEED, FARM_PATCHES);

  it('hands over one cull group per patch holding exactly its beds and its bin', () => {
    expect(view.cullGroups.map((g) => g.name)).toEqual(
      FARM_PATCHES.map((p) => `farmPatches:patch:${p.id}`),
    );
    expect(view.group.children).toEqual(view.cullGroups);
    for (const [i, patch] of FARM_PATCHES.entries()) {
      const names = new Set(view.cullGroups[i].children.map((c) => c.name));
      expect(names).toEqual(
        new Set([`farmPatches:bed:${patch.id}`, `farmPatches:bin:${patch.id}`]),
      );
    }
  });

  it('keeps the bed ids the editor preview finds a bed instance by', () => {
    for (const [i, patch] of FARM_PATCHES.entries()) {
      const beds = view.cullGroups[i].children.filter(
        (c) => c.name === `farmPatches:bed:${patch.id}`,
      );
      expect(beds.length).toBeGreaterThan(0);
      for (const b of beds) expect(b.userData.farmBedIds).toEqual(patch.beds.map((bed) => bed.id));
    }
  });
});

describe('the renderer attaches both as zone features', () => {
  it('through attachZoneFeature with no band bake, never a bare scene.add', () => {
    const src = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/this\.attachZoneFeature\(stationProps, false\);/);
    expect(src).toMatch(/this\.attachZoneFeature\(farmPatchProps, false\);/);
    expect(src).not.toMatch(/this\.scene\.add\((stationProps|farmPatchProps)\.group\)/);
  });
});
