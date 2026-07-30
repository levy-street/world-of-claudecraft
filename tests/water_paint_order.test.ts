import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The horizon apron and the per-zone surface planes OVERLAP (the apron runs
// under every zone rect) and share one transparent material with depthWrite
// off, so the depth buffer cannot arbitrate between them: whichever paints
// LAST wins the blend outright.
//
// Left to three.js's transparent sort that order is chosen from the view-space
// depth of each object's bounding-sphere centre, and the apron's centre is a
// world-scale sheet near the origin. Measured on the Galecrest cliff with the
// player stationary, orbiting the camera alone flipped the sequence between
// `APRON > zone` (yaw 0.0-1.8) and `zone > APRON` (yaw 4.5), which swaps the
// sea between the apron's constant deep colour and the zone plane's shallow
// tint plus foam band. The paint order must be pinned, not camera-derived.

function mockWaterShaderAssets(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: vi.fn(async () => new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: vi.fn(),
  }));
  vi.doMock('../src/render/gfx', () => ({
    GFX: { standardMaterials: true },
    SUN_DIR: new THREE.Vector3(1, 1, 1).normalize(),
    sharedUniforms: { uTime: { value: 0 } },
  }));
  vi.doMock('../src/render/textures', () => ({
    waterNormalish: vi.fn(() => new THREE.Texture()),
    waterNormalMaps: vi.fn(() => [new THREE.Texture(), new THREE.Texture()]),
  }));
}

const SEED = 20061;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('water paint order is pinned, not camera-derived', () => {
  it('draws the horizon apron under every zone surface plane', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');
    await Promise.resolve();

    const water = buildWater(SEED);
    const [apron] = water.meshes;
    const built = water.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    const [zonePlane] = await built;

    // Both are transparent with depth writes off, so paint order alone decides.
    const material = zonePlane.material as THREE.Material;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(apron.material).toBe(material); // one shared material, one program

    // The apron carries a constant deep shore depth and no foam; the zone plane
    // carries the real shoreline. The zone plane must win, at every camera angle.
    expect(apron.renderOrder).toBeLessThan(zonePlane.renderOrder);
  });

  it('gives every zone surface plane the same order, so zones cannot reorder', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');
    await Promise.resolve();

    const water = buildWater(SEED);
    const first = water.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    const [planeA] = await first;
    const second = water.ensureZone(zoneAt(0, 600));
    await vi.runAllTimersAsync();
    const [planeB] = await second;

    expect(planeB).toBeInstanceOf(THREE.Mesh);
    expect(planeB.renderOrder).toBe(planeA.renderOrder);
  });
});
