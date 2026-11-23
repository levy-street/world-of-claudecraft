import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { WaterView } from '../src/render/water';

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

describe('water paint order is pinned, not camera-derived', () => {
  let water: WaterView;
  let apron: THREE.Mesh;
  let zonePlaneA: THREE.Mesh;
  let zoneAtFn: (x: number, z: number) => import('../src/sim/types').ZoneDef;

  beforeAll(async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { zoneAt } = await import('../src/sim/data');
    zoneAtFn = zoneAt;
    await Promise.resolve();

    water = buildWater(SEED);
    [apron] = water.meshes;
    const built = water.ensureZone(zoneAtFn(0, 0));
    [zonePlaneA] = await built;
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('draws the horizon apron under every zone sheet, and never inside one', () => {
    // Neither writes depth: a floor mark a player reacts to (a boss telegraph,
    // a draped ring) draws after the water and must show through shallow water
    // on every tier exactly as on the Phong plane.
    const sheet = zonePlaneA.material as THREE.ShaderMaterial;
    const apronMaterial = apron.material as THREE.ShaderMaterial;
    expect(sheet.transparent).toBe(true);
    expect(sheet.depthWrite).toBe(false);
    expect(apronMaterial.depthWrite).toBe(false);
    // The apron's variant discards inside every built sheet, so the sheet with
    // the real shoreline owns its rect whatever the two displacements do; the
    // rest of its uniforms are the very same objects.
    expect(apronMaterial.defines.OCEAN_APRON).toBe('');
    expect(sheet.defines.OCEAN_APRON).toBeUndefined();
    expect(apronMaterial.uniforms.uOceanCascade).toBe(sheet.uniforms.uOceanCascade);
    expect(apronMaterial.uniforms.uSheetRects).toBeDefined();
    expect(apron.renderOrder).toBeLessThan(zonePlaneA.renderOrder);
  });

  it('lists a sheet for the apron to discard in only once the sheet is visible', () => {
    const rects = (apron.material as THREE.ShaderMaterial).uniforms.uSheetRectCount;
    zonePlaneA.visible = false;
    water.update(1, 0, 0, 100);
    const hidden = rects.value as number;
    zonePlaneA.visible = true;
    water.update(2, 0, 0, 100);
    expect(rects.value).toBe(hidden + 1);
  });

  it('gives every zone surface plane the same order, so zones cannot reorder', async () => {
    const second = water.ensureZone(zoneAtFn(0, 600));
    const [planeB] = await second;

    expect(planeB).toBeInstanceOf(THREE.Mesh);
    expect(planeB.renderOrder).toBe(zonePlaneA.renderOrder);
  });
});
