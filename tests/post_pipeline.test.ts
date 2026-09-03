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

function rendererStub(): THREE.WebGLRenderer {
  return {
    capabilities: { isWebGL2: true },
    getDrawingBufferSize: (out: THREE.Vector2) => out.set(1280, 720),
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
      'SMAAPass',
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

interface SmaaInternals {
  _edgesRT: THREE.WebGLRenderTarget;
  _weightsRT: THREE.WebGLRenderTarget;
  _materialEdges: THREE.ShaderMaterial;
  _materialWeights: THREE.ShaderMaterial;
  _materialBlend: THREE.ShaderMaterial;
}

interface N8AOQuadInternals {
  effectShaderQuad: { material: THREE.ShaderMaterial };
  poissonBlurQuad: { material: THREE.ShaderMaterial };
  depthDownsampleTarget?: THREE.WebGLRenderTarget | null;
}

interface BloomMaterialInternals {
  materialHighPassFilter: THREE.ShaderMaterial;
  separableBlurMaterials: THREE.ShaderMaterial[];
}

describe('live post pipeline: the allocation-path resize contract', () => {
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

  it('reports the allocation mode on the composer chains and the region mode on medium', async () => {
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const composer = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    expect(composer.dynamicResolution).toBe('allocation');
    expect(composer.supportsDynamicResolution).toBe(false);

    gfxSettings.ao = false;
    gfxSettings.bloom = false;
    gfxSettings.smaa = false;
    const medium = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
      { gradeOnly: true },
    );
    expect(medium.dynamicResolution).toBe('region');
    expect(medium.supportsDynamicResolution).toBe(true);
  });

  it('locks the mode under ?dynres=off without changing the chain', async () => {
    vi.stubGlobal('Image', class {});
    disabledLayers.add('dynres');
    const { buildComposer } = await import('../src/render/post');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    expect(post.dynamicResolution).toBe('locked');
    expect(post.composer.passes).toHaveLength(5);
  });

  it('resizes every target of the insane chain coherently and relinks no program', async () => {
    vi.stubGlobal('Image', class {});
    const { buildComposer } = await import('../src/render/post');
    const { postPipelinePlan } = await import('../src/render/post_plan_core');
    const post = buildComposer(
      rendererStub(),
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    const ao = post.ao as unknown as N8AOInternals & N8AOQuadInternals;
    const bloom = post.bloom as unknown as BloomInternals & BloomMaterialInternals;
    const smaa = post.composer.passes[4] as unknown as SmaaInternals;
    const screenFx = post.composer.passes[3] as unknown as { material: THREE.ShaderMaterial };
    const materials = [
      post.grade.material,
      screenFx.material,
      smaa._materialEdges,
      smaa._materialWeights,
      smaa._materialBlend,
      bloom.materialHighPassFilter,
      ...bloom.separableBlurMaterials,
      bloom.compositeMaterial,
      ao.effectShaderQuad.material,
      ao.poissonBlurQuad.material,
      ao.effectCompositerQuad.material,
    ];
    const versions = materials.map((material) => material.version);

    // The allocation step: the renderer's applyResolution hands the composer
    // the new pixel ratio; a rung of 0.8 at 1280x720 logical pixels.
    post.setSize(1280, 720, 0.8);

    const plan = postPipelinePlan({
      gradeOnly: false,
      ao: true,
      aoFullRes: true,
      bloom: true,
      smaa: true,
      fxaa: false,
      n8aoDisabled: false,
      smaaDisabled: false,
      fxaaDisabled: false,
      dynamicResolutionDisabled: false,
      isWebGL2: true,
      msaaSamples: 0,
    });
    expect(plan.dynamicResolution).toBe('allocation');
    const width = 1024;
    const height = 576;
    const live: Record<string, THREE.WebGLRenderTarget> = {
      'composer-a': post.composer.renderTarget1,
      'composer-b': post.composer.renderTarget2,
      'n8ao-beauty': ao.beautyRenderTarget,
      'n8ao-ao-a': ao.writeTargetInternal,
      'n8ao-ao-b': ao.readTargetInternal,
      'bloom-bright': bloom.renderTargetBright,
      'smaa-edges': smaa._edgesRT,
      'smaa-weights': smaa._weightsRT,
    };
    for (let mip = 0; mip < 5; mip++) {
      live[`bloom-h-${mip}`] = bloom.renderTargetsHorizontal[mip];
      live[`bloom-v-${mip}`] = bloom.renderTargetsVertical[mip];
    }
    // Every planned target is resized to its planned scale of the new
    // drawing buffer (bloom halves by rounding per mip, as UnrealBloomPass
    // does), so no pass reads a stale-sized neighbour after the step.
    for (const target of plan.renderTargets) {
      const rt = live[target.id];
      expect(rt, target.id).toBeTruthy();
      let expectedWidth = width;
      let expectedHeight = height;
      if (target.id.startsWith('bloom')) {
        const mip = target.id === 'bloom-bright' ? 0 : Number(target.id.slice(-1));
        expectedWidth = Math.round(width / 2);
        expectedHeight = Math.round(height / 2);
        for (let i = 0; i < mip; i++) {
          expectedWidth = Math.round(expectedWidth / 2);
          expectedHeight = Math.round(expectedHeight / 2);
        }
      } else {
        expectedWidth = Math.floor(width * target.scale);
        expectedHeight = Math.floor(height * target.scale);
      }
      expect([rt.width, rt.height], target.id).toEqual([expectedWidth, expectedHeight]);
    }
    expect(Object.keys(live).sort()).toEqual(plan.renderTargets.map((t) => t.id).sort());

    // Texel sizes ride uniforms; no material was flagged for a relink.
    expect(materials.map((material) => material.version)).toEqual(versions);
    expect(smaa._materialEdges.uniforms.resolution.value.x).toBeCloseTo(1 / width);
    expect(bloom.separableBlurMaterials[0].uniforms.invSize.value.x).toBeCloseTo(1 / 512);

    // The grade's remap stays the identity on the allocation path: the whole
    // target is the frame.
    expect(post.grade.uniforms.uInputUvRect.value.toArray()).toEqual([1, 1, 1, 1]);
  });
});
