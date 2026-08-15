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
    const { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } = await import('../src/sim/data');
    await Promise.resolve();

    const view = buildWater(SEED);
    const apron = view.meshes[0];
    const pos = apron.geometry.attributes.position as THREE.BufferAttribute;
    const depth = apron.geometry.attributes.aShoreDepth as THREE.BufferAttribute;

    // A 4 vertex sheet cannot represent a seabed at all.
    expect(pos.count).toBeGreaterThan(1000);

    // Every apron vertex sitting INSIDE the world must read what the seabed
    // actually is there, which is what the zone plane covering it reads.
    // The FULL world rect, side columns included (WORLD_SIZE / 2 is one
    // column's half-width and left the outer coasts unguarded).
    const half = WORLD_MAX_X;
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
    const { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } = await import('../src/sim/data');
    await Promise.resolve();

    const view = buildWater(SEED);
    const apron = view.meshes[0];
    const pos = apron.geometry.attributes.position as THREE.BufferAttribute;
    const depth = apron.geometry.attributes.aShoreDepth as THREE.BufferAttribute;
    const slope = apron.geometry.attributes.aShoreSlope as THREE.BufferAttribute;

    // Only OUTSIDE the world, where the apron is the surface you actually see.
    // Inside it, the apron lies under the zone plane and correctly mirrors that
    // plane's own shelf and surf.
    // The FULL world rect, side columns included (WORLD_SIZE / 2 is one
    // column's half-width and left the outer coasts unguarded).
    const half = WORLD_MAX_X;
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

// The apron is thousands of yards across, so a single mesh's bounds intersect
// the frustum from every camera in the world and every kept triangle is
// submitted every frame, most of it behind the view. It is drawn as a grid of
// blocks over ONE vertex buffer instead. Two things can go wrong silently: a
// block whose bounds are the WHOLE sheet culls nothing (the split becomes pure
// added draw calls), and a partition that loses or repeats a quad puts a hole
// or a double-blended patch in the open sea.
describe('horizon apron draws as frustum-cullable blocks', () => {
  it('splits into blocks with their own tight bounds, over one shared buffer', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    const { buildWaterSurfaceIndex } = await import('../src/render/water_core');
    await Promise.resolve();

    const view = buildWater(SEED);
    // Before any zone streams in, every visible mesh is an apron block (the
    // from-below twins are built hidden).
    const blocks = view.meshes.filter((m) => m.visible);
    expect(blocks.length).toBeGreaterThan(1);

    const material = blocks[0].material;
    const position = blocks[0].geometry.attributes.position as THREE.BufferAttribute;
    const columns = Math.round(Math.sqrt(position.count));
    expect(columns * columns).toBe(position.count);

    let sheetMinX = Number.POSITIVE_INFINITY;
    let sheetMaxX = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < position.count; i++) {
      sheetMinX = Math.min(sheetMinX, position.getX(i));
      sheetMaxX = Math.max(sheetMaxX, position.getX(i));
    }
    const sheetWidth = sheetMaxX - sheetMinX;
    expect(sheetWidth).toBeGreaterThan(1000);

    let drawn = 0;
    let coverMinX = Number.POSITIVE_INFINITY;
    let coverMaxX = Number.NEGATIVE_INFINITY;
    for (const block of blocks) {
      // One material and one program: the split must not multiply state.
      expect(block.material).toBe(material);
      // One vertex buffer: the blocks index into the SAME upload, so the
      // build-time bake and the editor refit still write through all of them.
      expect(block.geometry.attributes.position).toBe(position);
      expect(block.renderOrder).toBeLessThan(0);
      const box = block.geometry.boundingBox;
      expect(box, 'a block without bounds can never be culled').not.toBeNull();
      if (!box) continue;
      // Tight: a block spanning the whole sheet defeats the entire split.
      expect(box.max.x - box.min.x).toBeLessThan(sheetWidth * 0.75);
      expect(box.max.z - box.min.z).toBeLessThan(sheetWidth * 0.75);
      // And it must reach the surface it draws, including the swell lift.
      expect(box.min.y).toBeLessThan(-0.65);
      expect(box.max.y).toBeGreaterThan(0.65);
      coverMinX = Math.min(coverMinX, box.min.x);
      coverMaxX = Math.max(coverMaxX, box.max.x);
      drawn += block.geometry.getIndex()?.count ?? 0;
    }
    // Together the blocks still span the sheet, and still draw exactly the
    // triangle set the whole-sheet dry-tile cull would have drawn.
    expect(coverMinX).toBeCloseTo(sheetMinX, 3);
    expect(coverMaxX).toBeCloseTo(sheetMaxX, 3);
    const depth = blocks[0].geometry.attributes.aShoreDepth as THREE.BufferAttribute;
    const whole = buildWaterSurfaceIndex(depth.array as Float32Array, columns, columns);
    expect(drawn).toBe(whole === null ? (columns - 1) * (columns - 1) * 6 : whole.length);
    view.dispose();
  });
});
