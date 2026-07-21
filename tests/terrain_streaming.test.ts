import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockEmptyAssetLoads(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn(() => new Promise(() => {})),
    loadHdr: vi.fn(() => new Promise(() => {})),
    loadTexture: vi.fn(() => new Promise(() => {})),
    releaseGltf: vi.fn(),
  }));
  const texture = (): THREE.DataTexture => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    groundDetailTexture: vi.fn(texture),
    groundSplatMaps: vi.fn(() => ({
      grass: texture(),
      dirt: texture(),
      rock: texture(),
      sand: texture(),
      mud: texture(),
      snow: texture(),
    })),
    macroNoiseTexture: vi.fn(texture),
    skyTexture: vi.fn(texture),
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
  }));
}

// No requestIdleCallback in the plain-Node test env, so idle_queue's default
// scheduler falls back to setTimeout(0); fake timers drain it deterministically.
describe('progressive terrain build', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds only the near ring synchronously, then streams the rest in', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');

    const terrain = buildTerrain(20061);
    const nearCount = terrain.group.children.length;
    expect(nearCount).toBeGreaterThan(0);

    await vi.runAllTimersAsync();
    await terrain.streamingDone;

    const fullCount = terrain.group.children.length;
    expect(fullCount).toBeGreaterThan(nearCount);
  });

  it('cancelStreaming stops far chunks from ever being added', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');

    const terrain = buildTerrain(20061);
    const nearCount = terrain.group.children.length;
    terrain.cancelStreaming();

    await vi.runAllTimersAsync();
    await terrain.streamingDone;

    expect(terrain.group.children.length).toBe(nearCount);
  });

  it('streamed-in chunks are visible to update()/rebuildRegion() via the same live chunk list', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');

    const terrain = buildTerrain(20061);
    await vi.runAllTimersAsync();
    await terrain.streamingDone;

    // update() must not throw once far chunks (added after the initial return)
    // are folded into fog culling.
    expect(() => terrain.update(0, 0, 1000)).not.toThrow();
  });

  it('freezes matrixAutoUpdate on every streamed-in chunk, not just the near ring', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');

    const terrain = buildTerrain(20061);
    await vi.runAllTimersAsync();
    await terrain.streamingDone;

    for (const child of terrain.group.children) {
      expect(child.matrixAutoUpdate).toBe(false);
    }
  });

  it('streams the chunk nearest a given priority point before farther ones', async () => {
    vi.resetModules();
    mockEmptyAssetLoads();
    const { buildTerrain } = await import('../src/render/terrain');

    // Anchor near one corner of the map so the ordering effect is unambiguous.
    const terrain = buildTerrain(20061, { x: -170, z: 20 });
    const nearCount = terrain.group.children.length;

    // Advance one idle-queue batch only: the first few streamed chunks should
    // already include ones far closer to the priority point than a plain
    // row-major walk would produce this early.
    await vi.advanceTimersByTimeAsync(0);
    const afterFirstBatch = terrain.group.children.length;
    expect(afterFirstBatch).toBeGreaterThan(nearCount);

    const distToPriority = (mesh: THREE.Object3D): number => {
      const box = new THREE.Box3().setFromObject(mesh);
      const center = box.getCenter(new THREE.Vector3());
      return Math.hypot(center.x - -170, center.z - 20);
    };
    const firstStreamed = terrain.group.children.slice(nearCount, afterFirstBatch);
    const closest = Math.min(...firstStreamed.map(distToPriority));

    await vi.runAllTimersAsync();
    await terrain.streamingDone;
    const allStreamed = terrain.group.children.slice(nearCount);
    const overallClosest = Math.min(...allStreamed.map(distToPriority));

    expect(closest).toBeCloseTo(overallClosest, 5);
  });
});
