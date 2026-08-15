import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/assets/loader')>();
  return {
    ...actual,
    loadGltf: () => new Promise(() => {}),
    loadTexture: () => new Promise(() => {}),
    releaseGltf: () => {},
  };
});
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: () => {},
  registerDeferredPreload: () => {},
}));
vi.mock('../src/render/textures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/textures')>();
  return {
    ...actual,
    grassTuftTexture: () => new THREE.Texture(),
    flowerTuftTexture: () => new THREE.Texture(),
  };
});
vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  return {
    ...actual,
    GFX: actual.gfxInternalsForTest.settingsFor('low'),
  };
});

describe('streamed grass perceptual density', () => {
  it('keeps near chunks full and changes only existing immutable instance buffers', async () => {
    const { foliageGrassInternalsForTest } = await import('../src/render/foliage');
    const parent = new THREE.Group();
    // Frozen injected build clock (the unsliced reference pacing from
    // tests/grass_build_slicing.test.ts): the sliced builder checks its frame
    // budget BEFORE every sub-unit on this clock, so on the real clock a slow
    // CI machine can leave the streamed window part-built after any fixed
    // frame count. Freezing the clock means the budget deadline never
    // arrives, so the whole queued window builds deterministically in the
    // first update (builds continue while budget remains), giving this
    // suite the fully built window its assertions were written against.
    const grass = foliageGrassInternalsForTest.buildGrassRing(parent, 20_061, () => 0);
    const px = 15;
    const pz = 45;
    for (let frame = 0; frame < 64; frame++) {
      grass.update(px, pz, 8, 6, 40, 623.54, 1 / 60);
    }
    // The density and immutability assertions below stand on a fully built
    // streamed window: nothing may still be queued or mid-build here.
    expect(grass.perfStats().grassQueuedChunks).toBe(0);

    const collectAllMeshes = (): THREE.InstancedMesh[] => {
      const result: THREE.InstancedMesh[] = [];
      parent.traverse((object) => {
        const mesh = object as THREE.InstancedMesh;
        if (mesh.isInstancedMesh) result.push(mesh);
      });
      return result;
    };
    const collectMeshes = (): THREE.InstancedMesh[] =>
      collectAllMeshes().filter((mesh) => mesh.userData.instanceFamily);
    const meshes = collectMeshes();
    const families = ['grass-card', 'ground-flower'] as const;
    const submittedByFamily = (): Record<(typeof families)[number], number> => ({
      'grass-card': meshes
        .filter((mesh) => mesh.userData.instanceFamily === 'grass-card')
        .reduce((sum, mesh) => sum + mesh.count, 0),
      'ground-flower': meshes
        .filter((mesh) => mesh.userData.instanceFamily === 'ground-flower')
        .reduce((sum, mesh) => sum + mesh.count, 0),
    });
    expect(meshes.length).toBeGreaterThan(8);
    expect(collectAllMeshes()).toHaveLength(meshes.length);
    for (const family of families) {
      expect(meshes.some((mesh) => mesh.userData.instanceFamily === family)).toBe(true);
    }

    const fullCount = (mesh: THREE.InstancedMesh): number => mesh.instanceMatrix.array.length / 16;
    const fullTotal = meshes.reduce((sum, mesh) => sum + fullCount(mesh), 0);
    const fullByFamily = {
      'grass-card': meshes
        .filter((mesh) => mesh.userData.instanceFamily === 'grass-card')
        .reduce((sum, mesh) => sum + fullCount(mesh), 0),
      'ground-flower': meshes
        .filter((mesh) => mesh.userData.instanceFamily === 'ground-flower')
        .reduce((sum, mesh) => sum + fullCount(mesh), 0),
    };
    const submittedAt720p = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    const submittedByFamilyAt720p = submittedByFamily();
    expect(submittedAt720p / fullTotal).toBeGreaterThan(0.7);
    expect(submittedAt720p / fullTotal).toBeLessThan(0.9);
    for (const family of families) {
      expect(submittedByFamilyAt720p[family]).toBeLessThan(fullByFamily[family]);
    }

    const nearMeshes = meshes.filter((mesh) => {
      const matrices = mesh.instanceMatrix.array as Float32Array;
      for (let index = 0; index < fullCount(mesh); index++) {
        if (Math.hypot(matrices[index * 16 + 12] - px, matrices[index * 16 + 14] - pz) < 40) {
          return true;
        }
      }
      return false;
    });
    expect(nearMeshes.length).toBeGreaterThan(0);
    for (const mesh of nearMeshes) expect(mesh.count).toBe(fullCount(mesh));

    const objectSet = new Set(meshes);
    const matrixVersions = meshes.map((mesh) => mesh.instanceMatrix.version);
    const colorVersions = meshes.map((mesh) => mesh.instanceColor?.version);
    const matrixSnapshots = meshes.map((mesh) =>
      Array.from(mesh.instanceMatrix.array as Float32Array),
    );
    const colorSnapshots = meshes.map((mesh) => Array.from(mesh.instanceColor?.array ?? []));

    for (let frame = 0; frame < 30; frame++) {
      grass.update(px, pz, 8, 6, 40, 320, 1 / 60);
    }
    const submittedAtSmallProjection = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    const submittedByFamilyAtSmallProjection = submittedByFamily();
    expect(submittedAtSmallProjection).toBeLessThan(submittedAt720p);
    expect(submittedByFamilyAtSmallProjection['grass-card']).toBeLessThan(
      submittedByFamilyAt720p['grass-card'],
    );
    expect(submittedByFamilyAtSmallProjection['ground-flower']).toBeLessThanOrEqual(
      submittedByFamilyAt720p['ground-flower'],
    );

    const meshesAfterDensityChange = collectMeshes();
    expect(meshesAfterDensityChange).toHaveLength(meshes.length);
    expect(new Set(meshesAfterDensityChange)).toEqual(objectSet);
    expect(meshes.map((mesh) => mesh.instanceMatrix.version)).toEqual(matrixVersions);
    expect(meshes.map((mesh) => mesh.instanceColor?.version)).toEqual(colorVersions);
    expect(meshes.map((mesh) => Array.from(mesh.instanceMatrix.array as Float32Array))).toEqual(
      matrixSnapshots,
    );
    expect(meshes.map((mesh) => Array.from(mesh.instanceColor?.array ?? []))).toEqual(
      colorSnapshots,
    );

    const familyPerChunk = new Set(
      meshes.map((mesh) => `${mesh.userData.grassChunkKey}:${mesh.userData.instanceFamily}`),
    );
    expect(familyPerChunk.size).toBe(meshes.length);

    // A normal streamed-window change must retain immutable chunk objects.
    // Re-entry at dt=0 must snap the hidden mesh to its new smaller target,
    // proving the target is applied before the cached mesh can draw again.
    for (const mesh of meshes) mesh.count = fullCount(mesh);
    const submittedBeforeCacheHide = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    const submittedByFamilyBeforeCacheHide = submittedByFamily();
    grass.update(-500, pz, -500, 6, 40, 1, 0);
    expect(meshes.some((mesh) => !mesh.visible)).toBe(true);
    grass.update(px, pz, 8, 6, 40, 1, 0);
    const afterReentry = new Set(collectMeshes());
    const submittedAfterCacheReentry = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    const submittedByFamilyAfterCacheReentry = submittedByFamily();
    expect(submittedAfterCacheReentry).toBeLessThan(submittedBeforeCacheHide);
    for (const family of families) {
      expect(submittedByFamilyAfterCacheReentry[family]).toBeLessThan(
        submittedByFamilyBeforeCacheHide[family],
      );
    }
    for (let index = 0; index < meshes.length; index++) {
      const mesh = meshes[index];
      expect(afterReentry.has(mesh)).toBe(true);
      expect(Array.from(mesh.instanceMatrix.array as Float32Array)).toEqual(matrixSnapshots[index]);
      expect(Array.from(mesh.instanceColor?.array ?? [])).toEqual(colorSnapshots[index]);
    }
    expect(meshes.map((mesh) => mesh.instanceMatrix.version)).toEqual(matrixVersions);
    expect(meshes.map((mesh) => mesh.instanceColor?.version)).toEqual(colorVersions);

    // Dungeon suppression also hides every cached mesh. Returning at dt=0
    // with a 4K focal scale must immediately restore the larger target.
    grass.update(200_000, pz, 200_000, 6, 40, 1, 0);
    expect(parent.visible).toBe(false);
    expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
    grass.update(px, pz, 8, 6, 40, 1_870.61, 0);
    expect(parent.visible).toBe(true);
    const submittedAfterDungeonReentry = meshes.reduce((sum, mesh) => sum + mesh.count, 0);
    const submittedByFamilyAfterDungeonReentry = submittedByFamily();
    expect(submittedAfterDungeonReentry).toBeGreaterThan(submittedAfterCacheReentry);
    for (const family of families) {
      expect(submittedByFamilyAfterDungeonReentry[family]).toBeGreaterThan(
        submittedByFamilyAfterCacheReentry[family],
      );
    }
    expect(meshes.map((mesh) => mesh.instanceMatrix.version)).toEqual(matrixVersions);
    expect(meshes.map((mesh) => mesh.instanceColor?.version)).toEqual(colorVersions);

    // Restore the minimum projected-size target, then cross into the protected
    // band. A visible prefix does nothing at dt=0 and grows with elapsed time.
    grass.update(-500, pz, -500, 6, 40, 1, 0);
    grass.update(px, pz, 8, 6, 40, 1, 0);
    const thinned = meshes.find((mesh) => mesh.visible && fullCount(mesh) - mesh.count > 1);
    expect(thinned).toBeDefined();
    if (!thinned) return;
    const [cx, cz] = String(thinned.userData.grassChunkKey).split(':').map(Number);
    const chunkX = (cx + 0.5) * 48;
    const chunkZ = (cz + 0.5) * 48;
    const beforeProtectedEntry = thinned.count;
    grass.update(chunkX, chunkZ, chunkX, 6, chunkZ, 1, 0);
    expect(thinned.count).toBe(beforeProtectedEntry);
    for (let frame = 0; frame < 12; frame++) {
      grass.update(chunkX, chunkZ, chunkX, 6, chunkZ, 1, 1 / 60);
    }
    expect(thinned.count).toBeGreaterThan(beforeProtectedEntry);
  }, 20_000);
});
