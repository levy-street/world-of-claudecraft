import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostShed } from '../src/render/post_shed';
import { POST_SHED_BLOOM_MIPS_FULL } from '../src/render/post_shed_core';

// The live chain is built through buildComposer under the same mocks
// tests/post_pipeline.test.ts uses (real three passes and targets, no GL);
// the clears are recorded through the renderer stub, which is the one seam
// the painter touches the GPU through.
const disabledLayers = new Set<string>();
const gfxSettings = vi.hoisted(() => ({
  ao: true,
  aoFullRes: true,
  bloom: true,
  composer: true,
  msaaSamples: 0,
  smaa: true,
  fxaa: false,
}));

vi.mock('../src/render/gfx', () => ({
  GFX: gfxSettings,
  sharedUniforms: {
    uTime: { value: 0 },
  },
}));

vi.mock('../src/render/render_dev_flags', () => ({
  renderLayerDisabled: (name: string) => disabledLayers.has(name),
}));

interface RecordedClear {
  target: THREE.WebGLRenderTarget | null;
  hex: number;
  alpha: number;
}

function rendererStub(clears: RecordedClear[]): THREE.WebGLRenderer {
  let currentTarget: THREE.WebGLRenderTarget | null = null;
  const clearColor = new THREE.Color(0x102030);
  let clearAlpha = 0.5;
  return {
    capabilities: { isWebGL2: true },
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1280, 720),
    getPixelRatio: () => 1,
    getRenderTarget: () => currentTarget,
    setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
      currentTarget = target;
    },
    getClearColor: (out: THREE.Color) => out.copy(clearColor),
    getClearAlpha: () => clearAlpha,
    setClearColor: (color: THREE.Color, alpha = 1) => {
      clearColor.copy(color);
      clearAlpha = alpha;
    },
    clear: () => {
      clears.push({ target: currentTarget, hex: clearColor.getHex(), alpha: clearAlpha });
    },
    // Read back by the tests: the state the painter must leave behind.
    debugClearState: () => ({ target: currentTarget, hex: clearColor.getHex(), alpha: clearAlpha }),
  } as unknown as THREE.WebGLRenderer;
}

interface BloomInternals {
  renderTargetsHorizontal: THREE.WebGLRenderTarget[];
  renderTargetsVertical: THREE.WebGLRenderTarget[];
  activeMips: number;
  nMips: number;
}

interface AoInternals {
  occlusionPassthrough: boolean;
  occlusionTarget: THREE.WebGLRenderTarget;
}

async function insaneChain(clears: RecordedClear[]) {
  vi.stubGlobal('Image', class {});
  const { buildComposer } = await import('../src/render/post');
  const webgl = rendererStub(clears);
  const post = buildComposer(webgl, new THREE.Scene(), new THREE.PerspectiveCamera(), 1280, 720);
  const passes = post.composer.passes;
  return {
    post,
    webgl,
    ao: passes[0] as unknown as AoInternals,
    bloom: passes[1] as unknown as BloomInternals,
    grade: passes[2],
    gradeFxaa: passes[3],
    screenFx: passes[4],
    smaa: passes[5],
  };
}

describe('post shed painter over the live chain', () => {
  beforeEach(() => {
    disabledLayers.clear();
    gfxSettings.ao = true;
    gfxSettings.aoFullRes = true;
    gfxSettings.bloom = true;
    gfxSettings.smaa = true;
    gfxSettings.fxaa = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds the FXAA grade twin disabled and leaves the chain untouched at level 1', async () => {
    const clears: RecordedClear[] = [];
    const { post, grade, gradeFxaa, smaa, bloom, ao } = await insaneChain(clears);
    expect((gradeFxaa as unknown as { fxaa: boolean }).fxaa).toBe(true);
    expect(gradeFxaa.enabled).toBe(false);
    post.setShedLevel(1);
    expect(smaa.enabled).toBe(true);
    expect(grade.enabled).toBe(true);
    expect(gradeFxaa.enabled).toBe(false);
    expect(bloom.activeMips).toBe(5);
    // The core plans the full mip count as a literal; the live pass agrees.
    expect(bloom.nMips).toBe(POST_SHED_BLOOM_MIPS_FULL);
    expect(ao.occlusionPassthrough).toBe(false);
    expect(clears).toEqual([]);
    expect(post.shedRung()).toBe('full');
  });

  it('rung 1 trades the SMAA tail for the FXAA grade twin with no clear', async () => {
    const clears: RecordedClear[] = [];
    const { post, grade, gradeFxaa, smaa, bloom, ao } = await insaneChain(clears);
    post.setShedLevel(0.75);
    expect(smaa.enabled).toBe(false);
    expect(grade.enabled).toBe(false);
    expect(gradeFxaa.enabled).toBe(true);
    expect((bloom as unknown as { enabled: boolean }).enabled).toBe(true);
    expect(bloom.activeMips).toBe(5);
    expect(ao.occlusionPassthrough).toBe(false);
    expect(clears).toEqual([]);
    expect(post.shedRung()).toBe('smaa-to-fxaa');
  });

  it('rung 2 keeps three bloom mips and clears the two skipped tail mips once, to transparent black', async () => {
    const clears: RecordedClear[] = [];
    const { post, bloom } = await insaneChain(clears);
    post.setShedLevel(0.5);
    expect(bloom.activeMips).toBe(3);
    expect((bloom as unknown as { enabled: boolean }).enabled).toBe(true);
    expect(clears).toEqual([
      { target: bloom.renderTargetsVertical[3], hex: 0x000000, alpha: 0 },
      { target: bloom.renderTargetsVertical[4], hex: 0x000000, alpha: 0 },
    ]);
    // Holding the rung re-clears nothing: the clear is a transition, not a per-frame cost.
    post.setShedLevel(0.5);
    expect(clears).toHaveLength(2);
    expect(post.shedRung()).toBe('bloom-mips');
  });

  it('rung 3 skips bloom and clears its composite target once so the grade adds black', async () => {
    const clears: RecordedClear[] = [];
    const { post, bloom } = await insaneChain(clears);
    post.setShedLevel(0.25);
    expect((bloom as unknown as { enabled: boolean }).enabled).toBe(false);
    expect(clears).toEqual([{ target: bloom.renderTargetsHorizontal[0], hex: 0x000000, alpha: 0 }]);
    expect(post.shedRung()).toBe('bloom-off');
  });

  it('rung 4 puts N8AO in passthrough and clears its occlusion target once, to white', async () => {
    const clears: RecordedClear[] = [];
    const { post, ao, bloom } = await insaneChain(clears);
    post.setShedLevel(0);
    expect(ao.occlusionPassthrough).toBe(true);
    expect(clears).toEqual([
      { target: bloom.renderTargetsHorizontal[0], hex: 0x000000, alpha: 0 },
      { target: ao.occlusionTarget, hex: 0xffffff, alpha: 1 },
    ]);
    expect(post.shedRung()).toBe('ao-off');
  });

  it('restoring from the floor re-enables every pass and the full mip chain with no clear', async () => {
    const clears: RecordedClear[] = [];
    const { post, grade, gradeFxaa, smaa, bloom, ao } = await insaneChain(clears);
    post.setShedLevel(0);
    clears.length = 0;
    post.setShedLevel(1);
    expect(smaa.enabled).toBe(true);
    expect(grade.enabled).toBe(true);
    expect(gradeFxaa.enabled).toBe(false);
    expect((bloom as unknown as { enabled: boolean }).enabled).toBe(true);
    expect(bloom.activeMips).toBe(5);
    expect(ao.occlusionPassthrough).toBe(false);
    expect(clears).toEqual([]);
    expect(post.shedRung()).toBe('full');
  });

  it('coming back up from bloom-off to bloom-mips clears the stale tail mips again', async () => {
    const clears: RecordedClear[] = [];
    const { post, bloom } = await insaneChain(clears);
    post.setShedLevel(0.25);
    clears.length = 0;
    post.setShedLevel(0.5);
    expect(clears).toEqual([
      { target: bloom.renderTargetsVertical[3], hex: 0x000000, alpha: 0 },
      { target: bloom.renderTargetsVertical[4], hex: 0x000000, alpha: 0 },
    ]);
  });

  it('a resize re-runs the clears the rung in force relies on', async () => {
    const clears: RecordedClear[] = [];
    const { post, bloom, ao } = await insaneChain(clears);
    post.setShedLevel(0);
    clears.length = 0;
    post.setSize(1600, 900, 1);
    expect(clears).toEqual([
      { target: bloom.renderTargetsHorizontal[0], hex: 0x000000, alpha: 0 },
      { target: ao.occlusionTarget, hex: 0xffffff, alpha: 1 },
    ]);
    post.setShedLevel(1);
    clears.length = 0;
    post.setSize(1280, 720, 1);
    expect(clears).toEqual([]);
  });

  it('every clear restores the render target and the clear colour it found', async () => {
    const clears: RecordedClear[] = [];
    const { post, webgl } = await insaneChain(clears);
    const state = (webgl as unknown as { debugClearState: () => RecordedClear }).debugClearState;
    const before = state();
    post.setShedLevel(0);
    expect(clears.length).toBeGreaterThan(0);
    expect(state()).toEqual(before);
    expect(before).toEqual({ target: null, hex: 0x102030, alpha: 0.5 });
  });

  it('a chain without SMAA has no twin, and its first rung moves nothing', async () => {
    gfxSettings.smaa = false;
    const clears: RecordedClear[] = [];
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(clears),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    expect(post.composer.passes.map((pass) => pass.constructor.name)).toEqual([
      'StaticOpaqueN8AOPass',
      'PreparedBloomPass',
      'OutputGradePass',
      'ShaderPass',
    ]);
    const flags = () => post.composer.passes.map((pass) => pass.enabled);
    post.setShedLevel(0.75);
    expect(flags()).toEqual([true, true, true, true]);
    expect(clears).toEqual([]);
    // The readout names no pass the chain never built.
    expect(post.shedRung()).toBe('full');
    post.setShedLevel(0.5);
    expect(clears).toHaveLength(2);
    expect(post.shedRung()).toBe('bloom-mips');
  });

  it('never touches a pass its chain disowns, even when handed one', () => {
    const passes = {
      smaa: { enabled: true },
      grade: { enabled: true },
      gradeFxaa: { enabled: false },
      bloom: { enabled: true, activeMips: 5, nMips: 5 },
      ao: { occlusionPassthrough: false },
    };
    const clears: RecordedClear[] = [];
    const shed = new PostShed(
      rendererStub(clears),
      passes as unknown as ConstructorParameters<typeof PostShed>[1],
      { smaa: true, bloom: false, ao: false },
    );
    shed.apply(0);
    expect(passes.smaa.enabled).toBe(false);
    expect(passes.gradeFxaa.enabled).toBe(true);
    expect(passes.bloom).toEqual({ enabled: true, activeMips: 5, nMips: 5 });
    expect(passes.ao.occlusionPassthrough).toBe(false);
    expect(clears).toEqual([]);
    shed.reclear();
    expect(clears).toEqual([]);
  });

  it('the ?postshed=off kill switch builds no twin and reports an empty chain', async () => {
    disabledLayers.add('postshed');
    const clears: RecordedClear[] = [];
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(clears),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    expect(post.composer.passes.map((pass) => pass.constructor.name)).toEqual([
      'StaticOpaqueN8AOPass',
      'PreparedBloomPass',
      'OutputGradePass',
      'ShaderPass',
      'SMAAPass',
    ]);
    expect(post.shedChain).toEqual({ smaa: false, bloom: false, ao: false });
    post.setShedLevel(0);
    expect(post.composer.passes.map((pass) => pass.enabled)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(clears).toEqual([]);
  });
});

describe('post shed painter: the twin prewarm', () => {
  function fakePasses() {
    return {
      smaa: { enabled: true },
      grade: { enabled: true },
      gradeFxaa: { enabled: false },
      bloom: null,
      ao: null,
    };
  }

  it('renders once on the smaa-to-fxaa rung, then restores the level in force', () => {
    const passes = fakePasses();
    const shed = new PostShed(
      {} as unknown as THREE.WebGLRenderer,
      passes as unknown as ConstructorParameters<typeof PostShed>[1],
      { smaa: true, bloom: false, ao: false },
    );
    const seen: boolean[][] = [];
    shed.prewarm(() => {
      seen.push([passes.smaa.enabled, passes.grade.enabled, passes.gradeFxaa.enabled]);
    });
    expect(seen).toEqual([[false, false, true]]);
    expect([passes.smaa.enabled, passes.grade.enabled, passes.gradeFxaa.enabled]).toEqual([
      true,
      true,
      false,
    ]);
    expect(shed.rung()).toBe('full');
  });

  it('restores the level even when the render throws, and skips a chain with no twin', () => {
    const passes = fakePasses();
    const shed = new PostShed(
      {} as unknown as THREE.WebGLRenderer,
      passes as unknown as ConstructorParameters<typeof PostShed>[1],
      { smaa: true, bloom: false, ao: false },
    );
    expect(() =>
      shed.prewarm(() => {
        throw new Error('context lost');
      }),
    ).toThrow('context lost');
    expect(passes.smaa.enabled).toBe(true);
    expect(passes.gradeFxaa.enabled).toBe(false);

    const noTwin = { ...fakePasses(), gradeFxaa: null };
    const render = vi.fn();
    new PostShed(
      {} as unknown as THREE.WebGLRenderer,
      noTwin as unknown as ConstructorParameters<typeof PostShed>[1],
      { smaa: false, bloom: false, ao: false },
    ).prewarm(render);
    expect(render).not.toHaveBeenCalled();
  });
});
