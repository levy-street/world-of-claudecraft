import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dynamicResolutionRect } from '../src/render/dynamic_resolution_core';

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

function rendererStub(width = 1280, height = 720): THREE.WebGLRenderer {
  return {
    capabilities: { isWebGL2: true },
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(width, height),
    getPixelRatio: () => 1,
  } as unknown as THREE.WebGLRenderer;
}

interface N8AOInternals {
  beautyRenderTarget: THREE.WebGLRenderTarget;
  writeTargetInternal: THREE.WebGLRenderTarget;
  readTargetInternal: THREE.WebGLRenderTarget;
  accumulationRenderTarget: THREE.WebGLRenderTarget;
  effectCompositerQuad: {
    material: THREE.ShaderMaterial;
  };
  transparencyRenderTargetDWFalse?: THREE.WebGLRenderTarget | null;
  transparencyRenderTargetDWTrue?: THREE.WebGLRenderTarget | null;
}

interface BloomInternals {
  renderTargetBright: THREE.WebGLRenderTarget;
  renderTargetsHorizontal: THREE.WebGLRenderTarget[];
  renderTargetsVertical: THREE.WebGLRenderTarget[];
  bloomTexture: THREE.Texture;
  compositeMaterial: THREE.ShaderMaterial;
}

describe('live post pipeline', () => {
  beforeEach(() => {
    disabledLayers.clear();
    gfxSettings.ao = true;
    gfxSettings.aoFullRes = true;
    gfxSettings.bloom = true;
    gfxSettings.smaa = true;
    gfxSettings.fxaa = false;
    gfxSettings.msaaSamples = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs the insane chain with tail SMAA and the pinned pass order', async () => {
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );

    expect(post.composer.passes.map((pass) => pass.constructor.name)).toEqual([
      'StaticOpaqueN8AOPass',
      'PreparedBloomPass',
      'OutputGradePass',
      // The ability-VFX screen-fx pass (ripple / flash) sits between the grade
      // and the tail SMAA, so SMAA keeps anti-aliasing the final image.
      'ShaderPass',
      'ByteTargetSMAAPass',
    ]);
    expect(post.grade.fxaa).toBe(false);
    expect(post.composer.renderTarget1).not.toBe(post.composer.renderTarget2);
    expect(post.composer.renderTarget1.samples).toBe(0);
    expect(post.composer.renderTarget1.depthBuffer).toBe(false);
    expect(post.composer.renderTarget1.resolveDepthBuffer).toBe(true);
    expect(post.supportsDynamicResolution).toBe(false);

    const ao = post.ao as unknown as N8AOInternals;
    expect(ao.beautyRenderTarget.width).toBe(1280);
    expect(ao.beautyRenderTarget.height).toBe(720);
    expect(ao.beautyRenderTarget.texture.type).toBe(THREE.HalfFloatType);
    expect(ao.beautyRenderTarget.depthTexture?.type).toBe(THREE.UnsignedIntType);
    expect(ao.beautyRenderTarget.resolveDepthBuffer).toBe(true);
    expect(ao.writeTargetInternal.texture.type).toBe(THREE.UnsignedByteType);
    expect(ao.readTargetInternal.texture.type).toBe(THREE.UnsignedByteType);
    expect(ao.accumulationRenderTarget).toBe(ao.writeTargetInternal);
    expect(ao.effectCompositerQuad.material.fragmentShader).toContain(
      'quantizeAccumulatedAo(texelFetch(tDiffuse, pixel, 0))',
    );
    expect(ao.transparencyRenderTargetDWFalse).toBeFalsy();
    expect(ao.transparencyRenderTargetDWTrue).toBeFalsy();

    const bloom = post.bloom as unknown as BloomInternals;
    expect(bloom.renderTargetBright.texture.type).toBe(THREE.HalfFloatType);
    expect(bloom.renderTargetsHorizontal).toHaveLength(5);
    expect(bloom.renderTargetsVertical).toHaveLength(5);
    expect(bloom.renderTargetBright).not.toBe(bloom.renderTargetsVertical[0]);
    expect(
      new Set([
        bloom.renderTargetBright,
        ...bloom.renderTargetsHorizontal,
        ...bloom.renderTargetsVertical,
      ]).size,
    ).toBe(11);
    expect(bloom.bloomTexture).toBe(bloom.renderTargetsHorizontal[0].texture);
    expect(post.grade.uniforms.tBloom.value).toBe(bloom.bloomTexture);
    expect(
      [
        bloom.renderTargetBright,
        ...bloom.renderTargetsHorizontal,
        ...bloom.renderTargetsVertical,
      ].every((target) => !target.depthBuffer),
    ).toBe(true);
    expect(bloom.renderTargetsHorizontal.map((target) => [target.width, target.height])).toEqual([
      [640, 360],
      [320, 180],
      [160, 90],
      [80, 45],
      [40, 23],
    ]);
    expect(bloom.compositeMaterial.fragmentShader).not.toContain('bloomTintColors');
    // Each mip factor must still multiply its own blurred sample, so count the
    // pair rather than the two halves independently.
    expect(
      bloom.compositeMaterial.fragmentShader.match(
        /lerpBloomFactor\s*\(\s*bloomFactors\s*\[\s*\d\s*\]\s*\)\s*\*\s*texture2D\s*\(\s*blurTexture[1-5]\s*,/g,
      ),
    ).toHaveLength(5);
  });

  it('keeps medium region-safe with only RenderPass and remapped OutputGrade', async () => {
    gfxSettings.smaa = true;
    gfxSettings.msaaSamples = 0;
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
      { gradeOnly: true },
    );

    expect(post.composer.passes.map((pass) => pass.constructor.name)).toEqual([
      'RenderPass',
      'OutputGradePass',
    ]);
    expect(post.composer.renderTarget1).toBe(post.composer.renderTarget2);
    expect(post.composer.renderTarget1.samples).toBe(0);
    expect(post.composer.renderTarget1.depthBuffer).toBe(true);
    expect(post.composer.renderTarget1.resolveDepthBuffer).toBe(false);
    expect(post.supportsDynamicResolution).toBe(true);

    const rect = dynamicResolutionRect({
      logicalWidth: 1280,
      logicalHeight: 720,
      pixelRatio: 1,
      renderScale: 0.75,
      maxRenderScale: 1,
      minRenderScale: 0.68,
    });
    post.setRenderRegion(rect);
    expect(post.composer.renderTarget1.viewport.toArray()).toEqual([0, 0, 960, 540]);
    expect(post.composer.renderTarget1.scissor.toArray()).toEqual([0, 0, 960, 540]);
    expect(post.composer.renderTarget1.scissorTest).toBe(true);
    expect(post.grade.uniforms.uInputUvRect.value.toArray()).toEqual([
      rect.uvScaleX,
      rect.uvScaleY,
      rect.uvMaxX,
      rect.uvMaxY,
    ]);
  });

  it('anti-aliases the medium chain from inside the grade pass, region intact', async () => {
    gfxSettings.smaa = true;
    gfxSettings.fxaa = true;
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
      { gradeOnly: true },
    );

    // No new pass and no new buffer: the AA is a define on the pass that was
    // already the tail, which is exactly why the region survives it.
    expect(post.composer.passes.map((pass) => pass.constructor.name)).toEqual([
      'RenderPass',
      'OutputGradePass',
    ]);
    expect(post.composer.renderTarget1).toBe(post.composer.renderTarget2);
    expect(post.grade.fxaa).toBe(true);
    expect(post.supportsDynamicResolution).toBe(true);

    const rect = dynamicResolutionRect({
      logicalWidth: 1280,
      logicalHeight: 720,
      pixelRatio: 1,
      renderScale: 0.75,
      maxRenderScale: 1,
      minRenderScale: 0.68,
    });
    post.setRenderRegion(rect);
    expect(post.composer.renderTarget1.viewport.toArray()).toEqual([0, 0, 960, 540]);
    // The taps clamp to uvMax, and under a reduced region uvMax stops half a
    // texel short of the region edge, so a bilinear tap cannot reach the stale
    // pixels outside it.
    expect(post.grade.uniforms.uInputUvRect.value.toArray()).toEqual([
      rect.uvScaleX,
      rect.uvScaleY,
      rect.uvMaxX,
      rect.uvMaxY,
    ]);
    expect(rect.uvMaxX).toBeLessThan(rect.uvScaleX);
    expect(rect.uvMaxY).toBeLessThan(rect.uvScaleY);
  });

  it('drops the fused FXAA for the perf-attribution kill switch', async () => {
    gfxSettings.fxaa = true;
    disabledLayers.add('fxaa');
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
      { gradeOnly: true },
    );

    expect(post.grade.fxaa).toBe(false);
    expect(post.supportsDynamicResolution).toBe(true);
  });

  it('gives SMAA 8-bit edges and weights, the reference storage', async () => {
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const { smaaIntermediateTargets } = await import('../src/render/post_smaa');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    const smaa = post.composer.passes.at(-1) as unknown as Parameters<
      typeof smaaIntermediateTargets
    >[0];
    const targets = smaaIntermediateTargets(smaa);
    expect(targets).toHaveLength(2);
    // Both are [0,1] masks the reference implementation stores 8-bit; three
    // ships them HalfFloat, which is twice the bytes for precision no shader
    // in the SMAA chain reads.
    for (const target of targets) expect(target.texture.type).toBe(THREE.UnsignedByteType);
  });

  it('keeps ultra AO full-res at 1080p and drops it to half-res at 4K', async () => {
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const { AO_FULL_RES_MAX_PIXELS } = await import('../src/render/post_pixel_budget_core');
    expect(1920 * 1080).toBeLessThanOrEqual(AO_FULL_RES_MAX_PIXELS);
    expect(3840 * 2160).toBeGreaterThan(AO_FULL_RES_MAX_PIXELS);

    const readHalfRes = (width: number, height: number): boolean => {
      const post = buildComposer(
        rendererStub(width, height),
        new THREE.Scene(),
        new THREE.PerspectiveCamera(),
        width,
        height,
      );
      const ao = post.ao as unknown as { configuration: { halfRes: boolean; aoSamples: number } };
      return ao.configuration.halfRes;
    };

    // The tier request is unchanged in both cases; only the resolved value moves.
    expect(gfxSettings.aoFullRes).toBe(true);
    expect(readHalfRes(1920, 1080)).toBe(false);
    expect(readHalfRes(3840, 2160)).toBe(true);
    expect(gfxSettings.aoFullRes).toBe(true);
  });

  it('leaves the high tier half-res whatever the panel is', async () => {
    gfxSettings.aoFullRes = false;
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    for (const [width, height] of [
      [1920, 1080],
      [3840, 2160],
    ]) {
      const post = buildComposer(
        rendererStub(width, height),
        new THREE.Scene(),
        new THREE.PerspectiveCamera(),
        width,
        height,
      );
      const ao = post.ao as unknown as { configuration: { halfRes: boolean } };
      expect(ao.configuration.halfRes).toBe(true);
    }
  });

  it('re-resolves the AO arm when a resize crosses the pixel budget', async () => {
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(1920, 1080),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1920,
      1080,
    );
    const ao = post.ao as unknown as { configuration: { halfRes: boolean } };
    expect(ao.configuration.halfRes).toBe(false);

    post.setSize(3840, 2160, 1);
    expect(ao.configuration.halfRes).toBe(true);

    post.setSize(1920, 1080, 1);
    expect(ao.configuration.halfRes).toBe(false);

    // The pixel count, not the CSS size, is what the budget reads: a 1080p
    // window on a 2x display is a 4K drawing buffer.
    post.setSize(1920, 1080, 2);
    expect(ao.configuration.halfRes).toBe(true);
  });

  it('keeps high half-resolution AO depth available to every AO stage', async () => {
    gfxSettings.aoFullRes = false;
    gfxSettings.smaa = true;
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    const ao = post.ao as unknown as N8AOInternals & {
      configuration: { halfRes: boolean };
    };

    expect(post.composer.renderTarget1).not.toBe(post.composer.renderTarget2);
    expect(post.composer.renderTarget1.resolveDepthBuffer).toBe(true);
    expect(post.composer.renderTarget2.resolveDepthBuffer).toBe(true);
    expect(ao.configuration.halfRes).toBe(true);
    expect(ao.beautyRenderTarget.depthTexture).toBeTruthy();
    expect(ao.beautyRenderTarget.resolveDepthBuffer).toBe(true);
    expect(post.supportsDynamicResolution).toBe(false);
  });

  it('keeps every neighboring-sample effect chain out of dynamic resolution', async () => {
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const cases = [
      { name: 'AO only', ao: true, bloom: false, smaa: false },
      { name: 'bloom only', ao: false, bloom: true, smaa: false },
      { name: 'SMAA only', ao: false, bloom: false, smaa: true },
    ];

    for (const settings of cases) {
      gfxSettings.ao = settings.ao;
      gfxSettings.bloom = settings.bloom;
      gfxSettings.smaa = settings.smaa;
      const post = buildComposer(
        rendererStub(),
        new THREE.Scene(),
        new THREE.PerspectiveCamera(),
        1280,
        720,
      );

      expect(post.supportsDynamicResolution, settings.name).toBe(false);
    }
  });

  it('keeps ScreenFx on distinct buffers when the SMAA attribution switch is off', async () => {
    disabledLayers.add('smaa');
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
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
    expect(post.composer.renderTarget1).not.toBe(post.composer.renderTarget2);
  });

  it('disposes every pass and the composer exactly once', async () => {
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
      { gradeOnly: true },
    );
    const passDisposals = post.composer.passes.map((pass) => vi.spyOn(pass, 'dispose'));
    const composerDispose = vi.spyOn(post.composer, 'dispose');

    post.dispose();
    post.dispose();

    for (const dispose of passDisposals) expect(dispose).toHaveBeenCalledTimes(1);
    expect(composerDispose).toHaveBeenCalledTimes(1);
  });
});
