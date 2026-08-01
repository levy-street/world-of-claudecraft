import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCREE_CELL, screeSpotAt } from '../src/render/cliff_scree_core';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
  // Deferred lane: start the thunk immediately so the existing registration
  // assertions still observe the same in-flight promise they did eagerly.
  registerDeferredPreload: (start: () => Promise<unknown>) => mocks.registerPreload(start()),
}));

vi.mock('../src/render/worn_stone', () => ({
  applySurfaceDetail: vi.fn(),
}));

function rockGltf(): { scene: THREE.Group } {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x777777 });
  scene.add(new THREE.Mesh(geometry, material));
  return { scene };
}

function expectedCountsAt(seed: number, px: number, pz: number, variants: number): number[] {
  const radius = 65;
  const gridWidth = Math.ceil((radius * 2) / SCREE_CELL);
  const baseI = Math.floor(px / SCREE_CELL) - (gridWidth >> 1);
  const baseJ = Math.floor(pz / SCREE_CELL) - (gridWidth >> 1);
  const expectedCounts = new Array(variants).fill(0);
  for (let gj = 0; gj < gridWidth; gj++) {
    for (let gi = 0; gi < gridWidth; gi++) {
      const ci = baseI + ((((gi - baseI) % gridWidth) + gridWidth) % gridWidth);
      const cj = baseJ + ((((gj - baseJ) % gridWidth) + gridWidth) % gridWidth);
      const spot = screeSpotAt(seed, ci, cj);
      if (spot) expectedCounts[spot.variant]++;
    }
  }
  return expectedCounts;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('cliff scree renderer', () => {
  it('gates the view by tier, places instanced rocks, and can invalidate unchanged slots', async () => {
    mocks.loadGltf.mockImplementation(() => Promise.resolve(rockGltf()));
    const { GFX } = await import('../src/render/gfx');
    const original = GFX.cliffScree;
    const mutableGfx = GFX as unknown as { cliffScree: boolean };
    try {
      mutableGfx.cliffScree = false;
      const module = await import('../src/render/cliff_scree');
      await Promise.all(mocks.registerPreload.mock.calls.map(([promise]) => promise));

      const low = module.buildCliffScree(1337);
      expect(low.group.children).toEqual([]);
      expect(() => low.invalidate()).not.toThrow();

      mutableGfx.cliffScree = true;
      const high = module.buildCliffScree(1337);
      expect(high.group.children).toHaveLength(3);
      expect(high.group.children.every((child) => child instanceof THREE.InstancedMesh)).toBe(true);

      for (let pass = 0; pass < 8; pass++) high.update(0, 0);
      const meshes = high.group.children as THREE.InstancedMesh[];
      expect(meshes.map((mesh) => mesh.count)).toEqual(expectedCountsAt(1337, 0, 0, meshes.length));
      expect(
        meshes.every((mesh) =>
          mesh.instanceMatrix.updateRanges.some(
            (range) => range.start === 0 && range.count === mesh.count * 16,
          ),
        ),
      ).toBe(true);
      const matrix = new THREE.Matrix4();
      let visibleInstances = 0;
      for (const mesh of meshes) {
        for (let index = 0; index < mesh.count; index++) {
          mesh.getMatrixAt(index, matrix);
          expect(Math.abs(matrix.determinant())).toBeGreaterThan(1e-8);
          visibleInstances++;
        }
      }
      expect(visibleInstances).toBeGreaterThan(0);

      const versions = meshes.map((mesh) => mesh.instanceMatrix.version);
      high.update(0, 0);
      expect(meshes.map((mesh) => mesh.instanceMatrix.version)).toEqual(versions);

      // Walking reassigns live slots to empty cells as well as the reverse.
      // Exact second-position counts prove stale matrices cannot survive.
      const movedX = SCREE_CELL * 7;
      const movedZ = SCREE_CELL * 5;
      for (let pass = 0; pass < 8; pass++) high.update(movedX, movedZ);
      expect(meshes.map((mesh) => mesh.count)).toEqual(
        expectedCountsAt(1337, movedX, movedZ, meshes.length),
      );

      high.invalidate();
      high.update(movedX, movedZ);
      expect(meshes.every((mesh, index) => mesh.instanceMatrix.version > versions[index])).toBe(
        true,
      );
    } finally {
      mutableGfx.cliffScree = original;
    }
  });

  it('is mounted and advanced by Renderer', () => {
    const renderer = readFileSync(path.join(__dirname, '../src/render/renderer.ts'), 'utf8');
    expect(renderer).toContain('this.cliffScree = buildCliffScree(this.sim.cfg.seed);');
    expect(renderer).toContain('this.scene.add(this.cliffScree.group);');
    expect(renderer).toContain('this.cliffScree.update(p.pos.x, p.pos.z);');
  });
});
