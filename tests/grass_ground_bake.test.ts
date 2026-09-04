// Behavioral pins for src/render/grass_ground_bake.ts: the one-shot ground
// bake and its context-restore re-bake (issue 3846). A structural fake of
// THREE.WebGLRenderer records which target each offscreen pass rendered
// into, so every pin runs in plain Node.
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bakeGrassGroundTexture,
  disposeGrassGroundBake,
  getGrassGroundBake,
  rebakeGrassGroundTexture,
  setGrassGroundBake,
} from '../src/render/grass_ground_bake';

interface FakeRenderer {
  capabilities: { getMaxAnisotropy(): number };
  toneMapping: THREE.ToneMapping;
  getRenderTarget(): THREE.WebGLRenderTarget | null;
  setRenderTarget: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  readRenderTargetPixels: ReturnType<typeof vi.fn>;
  passes: { target: THREE.WebGLRenderTarget | null; toneMapping: THREE.ToneMapping }[];
}

const FILL = 128;

function fakeRenderer(): FakeRenderer {
  const r: FakeRenderer = {
    capabilities: { getMaxAnisotropy: () => 16 },
    toneMapping: THREE.ACESFilmicToneMapping,
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    readRenderTargetPixels: vi.fn(
      (_rt: unknown, _x: number, _y: number, _w: number, _h: number, px: Uint8Array) => {
        px.fill(FILL);
      },
    ),
    passes: [],
  };
  let current: THREE.WebGLRenderTarget | null = null;
  r.setRenderTarget.mockImplementation((target: THREE.WebGLRenderTarget | null) => {
    current = target;
  });
  r.render.mockImplementation(() => {
    r.passes.push({ target: current, toneMapping: r.toneMapping });
  });
  return r;
}

function asRenderer(r: FakeRenderer): THREE.WebGLRenderer {
  return r as unknown as THREE.WebGLRenderer;
}

afterEach(() => {
  setGrassGroundBake(null);
});

describe('bakeGrassGroundTexture', () => {
  it('renders one albedo pass into a retained target and measures the mean from the readback', () => {
    const r = fakeRenderer();

    const bake = bakeGrassGroundTexture(asRenderer(r), 7);

    expect(bake.target).toBeInstanceOf(THREE.WebGLRenderTarget);
    expect(bake.texture).toBe(bake.target.texture);
    expect(bake.seed).toBe(7);
    expect(r.passes).toHaveLength(1);
    expect(r.passes[0].target).toBe(bake.target);
    // Albedo-space: tone mapping is off for the pass and restored after it.
    expect(r.passes[0].toneMapping).toBe(THREE.NoToneMapping);
    expect(r.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(r.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(r.readRenderTargetPixels).toHaveBeenCalledOnce();
    const expected = FILL / 255;
    expect(bake.mean[0]).toBeCloseTo(expected, 6);
    expect(bake.mean[1]).toBeCloseTo(expected, 6);
    expect(bake.mean[2]).toBeCloseTo(expected, 6);
  });
});

describe('rebakeGrassGroundTexture (context restore)', () => {
  it('re-renders into the SAME target so the terrain materials keep their texture object', () => {
    const r = fakeRenderer();
    const bake = bakeGrassGroundTexture(asRenderer(r), 7);
    setGrassGroundBake(bake);
    const texture = bake.texture;
    const mean = [...bake.mean];
    r.passes.length = 0;
    r.readRenderTargetPixels.mockClear();

    expect(rebakeGrassGroundTexture(asRenderer(r))).toBe(true);

    expect(r.passes).toHaveLength(1);
    expect(r.passes[0].target).toBe(bake.target);
    expect(r.passes[0].toneMapping).toBe(THREE.NoToneMapping);
    expect(r.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(getGrassGroundBake()?.texture).toBe(texture);
    // The field is a pure function of the seed: no second readback, same mean.
    expect(r.readRenderTargetPixels).not.toHaveBeenCalled();
    expect(getGrassGroundBake()?.mean).toEqual(mean);
  });

  it('draws the identical cluster field on every bake (same seed, same instance count)', () => {
    const r = fakeRenderer();
    const bake = bakeGrassGroundTexture(asRenderer(r), 42);
    setGrassGroundBake(bake);
    const countOf = (call: unknown[]): number =>
      ((call[0] as THREE.Scene).children[0] as THREE.InstancedMesh).count;
    const first = countOf(r.render.mock.calls[0]);

    rebakeGrassGroundTexture(asRenderer(r));

    expect(first).toBeGreaterThan(0);
    expect(countOf(r.render.mock.calls[1])).toBe(first);
  });

  it('reports false and renders nothing when no bake is live (dev flag, headless, low tier)', () => {
    const r = fakeRenderer();

    expect(rebakeGrassGroundTexture(asRenderer(r))).toBe(false);

    expect(r.render).not.toHaveBeenCalled();
  });

  it('restores the live render target even when the offscreen pass throws', () => {
    const r = fakeRenderer();
    const bake = bakeGrassGroundTexture(asRenderer(r), 7);
    setGrassGroundBake(bake);
    r.render.mockImplementationOnce(() => {
      throw new Error('context lost mid-bake');
    });

    expect(() => rebakeGrassGroundTexture(asRenderer(r))).toThrow('context lost mid-bake');

    expect(r.setRenderTarget).toHaveBeenLastCalledWith(null);
    expect(r.toneMapping).toBe(THREE.ACESFilmicToneMapping);
  });
});

describe('disposeGrassGroundBake', () => {
  it('releases the live target and clears the singleton', () => {
    const r = fakeRenderer();
    const bake = bakeGrassGroundTexture(asRenderer(r), 7);
    setGrassGroundBake(bake);
    const dispose = vi.spyOn(bake.target, 'dispose');

    disposeGrassGroundBake();

    expect(dispose).toHaveBeenCalledOnce();
    expect(getGrassGroundBake()).toBeNull();
    expect(rebakeGrassGroundTexture(asRenderer(r))).toBe(false);
  });
});
