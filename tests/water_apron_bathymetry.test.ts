import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The world is only WORLD_SIZE yards across, so every zone water plane ENDS a
// few dozen yards offshore, in plain view. Beyond that edge the horizon apron
// takes over. The apron used to assert a constant deep seabed, which stepped
// against whatever the zone plane actually had there: measured off Eastbrook,
// 1.51 yards on the plane's last vertex against the apron's 6. A rectangle edge
// is straight, so that step drew a ruler-straight line across open sea, and no
// amount of colour tuning could remove it because it is a GEOMETRY seam, not a
// shading one. Proven by tinting each water mesh: green (zone plane) on one
// side of the line, red (apron) on the other, exactly at x = -180.
//
// The apron now samples the same terrain function the zone planes sample, so
// the two agree at the boundary by construction.
function mockWaterShaderAssets(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: vi.fn(async () => new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: vi.fn(),
    registerDeferredPreload: vi.fn((start: () => unknown) => start()),
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
  vi.restoreAllMocks();
});

describe('horizon apron carries real bathymetry', () => {
  it('agrees with the seabed at the world edge instead of asserting a constant', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { shoreDepthAt, WATER_SEABED_CLAMP_YARDS } = await import('../src/render/water_core');
    const { WORLD_SIZE, WORLD_MAX_Z, WORLD_MIN_Z } = await import('../src/sim/data');
    await Promise.resolve();

    const view = buildWater(SEED);
    const apron = view.meshes[0];
    const pos = apron.geometry.attributes.position as THREE.BufferAttribute;
    const depth = apron.geometry.attributes.aShoreDepth as THREE.BufferAttribute;

    // A 4 vertex sheet cannot represent a seabed at all.
    expect(pos.count).toBeGreaterThan(1000);

    // Every apron vertex sitting INSIDE the world must read what the seabed
    // actually is there, which is what the zone plane covering it reads.
    const half = WORLD_SIZE / 2;
    let insideChecked = 0;
    let worstError = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      if (Math.abs(x) > half || z > WORLD_MAX_Z || z < WORLD_MIN_Z) continue;
      insideChecked++;
      worstError = Math.max(worstError, Math.abs(depth.getX(i) - shoreDepthAt(x, z, SEED)));
    }
    expect(insideChecked).toBeGreaterThan(100);
    expect(worstError).toBeLessThan(0.001);

    // And it must still settle to open sea far out, or the horizon reads as an
    // endless shallow (or worse, as the neighbouring landmass out there).
    let far = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const outside = Math.max(0, Math.abs(x) - half, z - WORLD_MAX_Z, WORLD_MIN_Z - z);
      if (outside < 600) continue;
      far++;
      expect(depth.getX(i)).toBe(WATER_SEABED_CLAMP_YARDS);
    }
    expect(far).toBeGreaterThan(100);
    view.dispose();
  });

  it('never paints surf on open water', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { WATER_FOAM_WIDTH_YARDS } = await import('../src/render/water_core');
    const { WORLD_SIZE, WORLD_MAX_Z, WORLD_MIN_Z } = await import('../src/sim/data');
    await Promise.resolve();

    const view = buildWater(SEED);
    const apron = view.meshes[0];
    const pos = apron.geometry.attributes.position as THREE.BufferAttribute;
    const depth = apron.geometry.attributes.aShoreDepth as THREE.BufferAttribute;
    const slope = apron.geometry.attributes.aShoreSlope as THREE.BufferAttribute;

    // Only OUTSIDE the world, where the apron is the surface you actually see.
    // Inside it, the apron lies under the zone plane and correctly mirrors that
    // plane's own shelf and surf.
    const half = WORLD_SIZE / 2;
    // The shader reads surf as depth/slope, so a slope of zero or a constant
    // slope against real shelf depths would flood the open sea with foam.
    let checked = 0;
    let foamOnOpenWater = 0;
    for (let i = 0; i < depth.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const outside = Math.max(0, Math.abs(x) - half, z - WORLD_MAX_Z, WORLD_MIN_Z - z);
      if (outside <= 0) continue;
      const d = depth.getX(i);
      if (d <= 0.5) continue; // genuine coastline running off the map edge
      checked++;
      expect(slope.getX(i)).toBeGreaterThan(0);
      if (d / slope.getX(i) < WATER_FOAM_WIDTH_YARDS) foamOnOpenWater++;
    }
    expect(checked).toBeGreaterThan(1000);
    expect(foamOnOpenWater).toBe(0);
    view.dispose();
  });
});
