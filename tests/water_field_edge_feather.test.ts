import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WATER_FIELD_EDGE_FEATHER_UV, waterFieldPlan } from '../src/render/water_core';

// The shader tier only builds when the real water normal maps are present, so
// stand them up the way tests/water_paint_order.test.ts does.
function mockWaterShaderAssets(): void {
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: vi.fn(async () => new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({ registerPreload: vi.fn() }));
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

afterEach(() => {
  vi.restoreAllMocks();
});

// The interactive height field is a camera-anchored WINDOW on a continuous sea,
// so whatever happens at its border happens along a straight, square, world
// space edge that follows the camera. Cutting the field off hard steps the
// surface NORMAL there, and the normal drives fresnel (up to a 42% mix toward
// sky) plus the sun glints.
//
// Measured honestly: on near-calm water the border is INVISIBLE (colour step
// across it 11.84 vs 11.78 for open sea, ratio 1.01), so this was never the
// shore-parallel line that motivated the surrounding water work: that one is
// the bathymetric shelf break, see WATER_DEPTH_COLOR_AUTHORITY. The step only
// has something to show when the field carries real energy, which is exactly
// when a crowded shoreline puts energy in it. Feathered defensively.
describe('interactive water field edge', () => {
  it('feathers its contribution to zero at the window border', () => {
    expect(WATER_FIELD_EDGE_FEATHER_UV).toBeGreaterThan(0);
    // Wide enough to span several yards of world, or it is still a visible step.
    const yards = waterFieldPlan('high').size * WATER_FIELD_EDGE_FEATHER_UV;
    expect(yards).toBeGreaterThan(3);
  });

  it('never samples the field through a hard in/out boolean', async () => {
    vi.resetModules();
    mockWaterShaderAssets();
    const { buildWater } = await import('../src/render/water');
    await Promise.resolve();
    const view = buildWater(20061);
    const mat = view.meshes
      .map((m) => m.material as { fragmentShader?: string; vertexShader?: string })
      .find((m) => typeof m.fragmentShader === 'string');
    expect(mat, 'expected a shader-tier water material').toBeTruthy();
    const frag = mat?.fragmentShader ?? '';
    const vert = mat?.vertexShader ?? '';

    // A weight, not a predicate: `bool waveSampleAt` is the regression.
    expect(frag).toContain('float waveSampleAt');
    expect(frag).not.toContain('bool waveSampleAt');
    // The ramp has to be INSIDE waveSampleAt, not just somewhere in the shader
    // (the fragment stage uses smoothstep for foam, distance and sheen too).
    const body = frag.slice(frag.indexOf('float waveSampleAt'));
    const fn = body.slice(0, body.indexOf('\n  }'));
    expect(fn).toMatch(/smoothstep\(0\.0, [0-9.]+, min\(toEdge\.x, toEdge\.y\)\)/);
    expect(fn).toContain('return 0.0;');

    // Both stages must ride the weight. Displacing geometry or perturbing the
    // normal at full strength up to the border reinstates the seam.
    // waveSampleAt writes `wave` as an out param, so it must be called in its
    // own statement: reading wave.r in the same expression is undefined in GLSL.
    expect(vert).toMatch(/float waveW = uWaveEnabled \* waveSampleAt\(pos\.xz, wave\);/);
    expect(vert).toMatch(/pos\.y \+= wave\.r \* waveW;/);
    expect(frag).toMatch(/waveSlope = wave\.ba \* waveW/);
    expect(frag).toMatch(/waveEnergy = .*\* waveW/);
    view.dispose();
  });
});
