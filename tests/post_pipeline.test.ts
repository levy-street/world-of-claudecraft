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
    expect(
      bloom.compositeMaterial.fragmentShader.match(
        /lerpBloomFactor\(bloomFactors\[\d]\) \* texture2D/g,
      ),
    ).toHaveLength(5);
  });

  it('gives medium tail SMAA without multisampling the geometry target', async () => {
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
      'ShaderPass',
      'SMAAPass',
    ]);
    expect(post.composer.renderTarget1).not.toBe(post.composer.renderTarget2);
    expect(post.composer.renderTarget1.samples).toBe(0);
    expect(post.composer.renderTarget2.samples).toBe(0);
    expect(post.composer.renderTarget1.depthBuffer).toBe(true);
    expect(post.composer.renderTarget2.depthBuffer).toBe(true);
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

  it('removes tail SMAA through the attribution kill switch', async () => {
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
    expect(post.composer.renderTarget1).toBe(post.composer.renderTarget2);
  });
});
