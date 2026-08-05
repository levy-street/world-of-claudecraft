import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { StaticOpaqueN8AOPass } from '../src/render/post_n8ao';

interface N8AOShaderInternals {
  beautyRenderTarget: THREE.WebGLRenderTarget;
  effectShaderQuad: {
    material: THREE.ShaderMaterial;
  };
  poissonBlurQuad: {
    material: THREE.ShaderMaterial;
  };
}

interface StaticN8AOConfiguration {
  accumulate: boolean;
  biasMultiplier: number;
  biasOffset: number;
  denoiseIterations: number;
  screenSpaceRadius: boolean;
}

describe('static N8AO shader specialization', () => {
  it('removes only work made redundant by the shipped static configuration', () => {
    const pass = new StaticOpaqueN8AOPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    pass.setQualityMode('Medium');

    const shaders = pass as unknown as N8AOShaderInternals;
    const evaluate = shaders.effectShaderQuad.material.fragmentShader;
    const denoise = shaders.poissonBlurQuad.material.fragmentShader;

    expect(pass.configuration as unknown as StaticN8AOConfiguration).toMatchObject({
      accumulate: false,
      biasMultiplier: 0,
      biasOffset: 0,
      denoiseIterations: 2,
      screenSpaceRadius: false,
    });
    expect(shaders.beautyRenderTarget.depthTexture?.minFilter).toBe(THREE.NearestFilter);
    expect(shaders.beautyRenderTarget.depthTexture?.magFilter).toBe(THREE.NearestFilter);
    expect(evaluate).toContain('#define SAMPLES 16');
    expect(evaluate).not.toContain('vec4 diffuse = texture2D(sceneDiffuse, vUv);');
    expect(evaluate).toContain('vec3 computeNormal(vec3 worldPos, float c0, vec2 vUv)');
    expect(evaluate).not.toContain('float c0 =');
    expect(evaluate).toContain('vec3 ce = worldPos;');
    expect(evaluate).toContain('vec3 normal = computeNormal(worldPos, depth, vUv);');
    expect(evaluate).not.toContain('vec3 ce = getWorldPos(c0, vUv).xyz;');
    expect(evaluate).toContain('float radiusToUse = radius;');
    expect(evaluate).toContain('float distanceFalloffToUse = radius * distanceFalloff * 0.2;');
    expect(evaluate).not.toContain('screenSpaceRadius ?');
    expect(evaluate).toContain('float bias = 0.0;');
    expect(evaluate).not.toContain('biasAdjustment.x');
    expect(evaluate).not.toContain('harmoniousNumbers');

    expect(denoise).toContain('#define NUM_SAMPLES 8');
    expect(denoise).toContain('float radiusToUse = worldRadius;');
    expect(denoise).toContain('float distanceFalloffToUse = worldRadius * distanceFalloff * 0.2;');
    expect(denoise).not.toContain('screenSpaceRadius ?');
    expect(denoise).not.toContain('if (count > 0.0)');
    expect(denoise).toContain('occlusion /= count;');
  });

  it('retains the specializations when the shipped half-resolution path rebuilds shaders', () => {
    const pass = new StaticOpaqueN8AOPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1279,
      719,
    );
    pass.setQualityMode('Low');
    pass.configuration.halfRes = true;

    const shaders = pass as unknown as N8AOShaderInternals;
    const evaluate = shaders.effectShaderQuad.material.fragmentShader;
    const denoise = shaders.poissonBlurQuad.material.fragmentShader;

    expect(evaluate).toContain('#define HALFRES');
    expect(evaluate).toContain('vec3 computeNormal(vec3 worldPos, float c0, vec2 vUv)');
    expect(evaluate).toContain('float radiusToUse = radius;');
    expect(evaluate).toContain('float bias = 0.0;');
    expect(denoise).toContain('#define NUM_SAMPLES 4');
    expect(denoise).toContain('float radiusToUse = worldRadius;');
    expect(denoise).not.toContain('if (count > 0.0)');
  });

  it.each([
    ['accumulate', true],
    ['biasMultiplier', 1],
    ['biasOffset', 1],
    ['screenSpaceRadius', true],
  ] as const)('rejects a nonstatic %s configuration before rebuilding', (field, value) => {
    const pass = new StaticOpaqueN8AOPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    Reflect.set(pass.configuration, field, value);

    expect(() => {
      pass.configuration.aoSamples = 8;
    }).toThrow(
      'Static N8AO shaders require accumulation, bias adjustment, and screen-space radius off',
    );
  });
});
