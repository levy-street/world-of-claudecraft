import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeightStamp } from '../src/sim/types';

// The editor's per-stroke water refresh (WaterView.refreshRegion, called from
// Editor3DViewport.finishTerrainStroke). A zone sheet bakes its shore depth
// and drops its dry quads ONCE at build, so ground a maker lowered under the
// waterline afterwards showed bare seabed through a hole in the sea (SPACEY's
// Deepglass, 2026-09-15: "visible gaps in the water ... should update each
// time the user edits terrain"). The refresh re-bakes just the edited rect.

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

describe('water sheets follow terrain edits (refreshRegion)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    const { setActiveWorldContent } = await import('../src/sim/data');
    setActiveWorldContent(null);
  });

  it('gives lowered ground its water back, and only inside the edited rect', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { BUILTIN_WORLD, setActiveWorldContent, zoneAt } = await import('../src/sim/data');
    const { terrainHeight, waterLevel } = await import('../src/sim/world');
    await Promise.resolve();

    const SEED = 20061;
    const edits: HeightStamp[] = [];
    setActiveWorldContent({ ...BUILTIN_WORLD, terrainEdits: edits });
    const water = buildWater(SEED);
    const task = water.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    const [mesh] = await task;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const depth = mesh.geometry.attributes.aShoreDepth as THREE.BufferAttribute;

    // A sheet vertex deep inside dry ground: every quad touching it (and its
    // neighbours' quads) was culled at build.
    const columns = Math.round(Math.sqrt(pos.count));
    const dryAround = (i: number): boolean => {
      const r = Math.floor(i / columns);
      const c = i % columns;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= columns || cc >= columns) return false;
          if (depth.getX(rr * columns + cc) > -0.75) return false;
        }
      }
      return terrainHeight(pos.getX(i), pos.getZ(i), SEED) > waterLevel() + 4;
    };
    let v = -1;
    for (let i = 0; i < pos.count && v < 0; i += 7) if (dryAround(i)) v = i;
    expect(v).toBeGreaterThanOrEqual(0);
    const p = { x: pos.getX(v), z: pos.getZ(v) };
    const drawn = (): boolean => Array.from(mesh.geometry.getIndex()?.array ?? []).includes(v);
    expect(depth.getX(v)).toBeLessThan(0);
    expect(drawn()).toBe(false);

    // Sink it well under the waterline IN PLACE, the way a stroke pushes.
    edits.push({ x: p.x, z: p.z, radius: 12, delta: -40, falloff: 'flat' });
    expect(terrainHeight(p.x, p.z, SEED)).toBeLessThan(waterLevel() - 5);
    const before = Float32Array.from(depth.array as Float32Array);
    expect(depth.getX(v)).toBeLessThan(0); // stale until refreshed

    water.refreshRegion(p.x - 12, p.z - 12, p.x + 12, p.z + 12);
    expect(depth.getX(v)).toBeGreaterThan(5);
    expect(drawn()).toBe(true);
    // Nothing outside the rect (plus the slope probe) was re-sampled.
    for (let i = 0; i < pos.count; i++) {
      const far = Math.abs(pos.getX(i) - p.x) > 14 || Math.abs(pos.getZ(i) - p.z) > 14;
      if (far) expect(depth.getX(i)).toBe(before[i]);
    }
  });

  it('is a no-op for a rect with no sheet under it', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { BUILTIN_WORLD, setActiveWorldContent, zoneAt } = await import('../src/sim/data');
    await Promise.resolve();
    setActiveWorldContent({ ...BUILTIN_WORLD, terrainEdits: [] });
    const water = buildWater(20061);
    const task = water.ensureZone(zoneAt(0, 0));
    await vi.runAllTimersAsync();
    const [mesh] = await task;
    const index = mesh.geometry.getIndex();
    water.refreshRegion(90000, 90000, 90010, 90010);
    // The kept-quad buffer is the same object: nothing re-uploaded.
    expect(mesh.geometry.getIndex()).toBe(index);
  });
});
