import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { StaticOpaqueN8AOPass } from '../src/render/post_n8ao';

interface N8AOShaderInternals {
  beautyRenderTarget: THREE.WebGLRenderTarget;
  writeTargetInternal: THREE.WebGLRenderTarget;
  readTargetInternal: THREE.WebGLRenderTarget;
  bluenoise: THREE.DataTexture;
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

  it('disposes owned render targets and textures idempotently', () => {
    const pass = new StaticOpaqueN8AOPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1280,
      720,
    );
    const internals = pass as unknown as N8AOShaderInternals;
    const disposals = [
      vi.spyOn(internals.beautyRenderTarget, 'dispose'),
      vi.spyOn(internals.writeTargetInternal, 'dispose'),
      vi.spyOn(internals.readTargetInternal, 'dispose'),
      vi.spyOn(internals.bluenoise, 'dispose'),
    ];

    pass.dispose();
    pass.dispose();

    for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('reversed-depth premises behind the dropped surgery arm', () => {
  // The static evaluation surgery deletes only the plain c0 declaration since
  // n8ao 2.0.0 removed computeNormal's REVERSEDEPTH arm; that stays sound on
  // exactly two premises, each pinned so a silent return goes red here.
  it('the n8ao dist carries no reversed-depth c0 spelling', () => {
    const dist = readFileSync(path.resolve(__dirname, '../node_modules/n8ao/dist/N8AO.js'), 'utf8');
    expect(dist.includes('1.0 - texelFetch(sceneDepth, p, 0).x')).toBe(false);
  });

  it('the repo never enables three reversed depth', () => {
    for (const file of ['src/render/renderer.ts', 'src/render/gfx.ts']) {
      const source = readFileSync(path.resolve(__dirname, '..', file), 'utf8');
      expect(source.includes('reversedDepthBuffer'), file).toBe(false);
      expect(source.includes('reverseDepthBuffer'), file).toBe(false);
    }
  });
});

describe('degenerate depth-derived normal guard', () => {
  // On Mali-G715 (Android Chrome) the HALFRES compositer wrote exactly one NaN
  // texel per affected frame into the composer beauty while the raw scene target
  // stayed finite: normalize(cross(dpdx, dpdy)) of a zero cross product. Both
  // shaders that reconstruct that normal from depth carry the length-checked
  // form, on the full-resolution and the half-resolution configurations alike.
  // The fallback sits on the `<` branch on purpose: a NaN comparison is
  // implementation-defined in GLSL ES, so the safe branch must be the one a
  // non-finite length lands on wherever the driver sends it.
  const SAFE_RETURN = 'return faceNormalLengthSq < 1e-12';
  const BARE_RETURN = 'return normalize(cross(dpdx, dpdy));';

  interface CompositerInternals {
    effectShaderQuad: { material: THREE.ShaderMaterial };
    effectCompositerQuad: { material: THREE.ShaderMaterial };
    depthDownsampleQuad?: { material: THREE.ShaderMaterial } | null;
  }

  const expectGuarded = (shader: string): void => {
    expect(shader).not.toContain(BARE_RETURN);
    expect(shader.split(SAFE_RETURN)).toHaveLength(2);
    expect(shader).toContain('vec3 faceNormal = cross(dpdx, dpdy);');
    expect(shader).toContain('? vec3(0.0, 1.0, 0.0)');
    expect(shader).toContain(': faceNormal * inversesqrt(faceNormalLengthSq);');
  };

  it.each([
    ['full resolution', false],
    ['half resolution with depth-aware upsampling', true],
  ])('guards the evaluation and compositer normals at %s', (_label, halfRes) => {
    const pass = new StaticOpaqueN8AOPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1279,
      719,
    );
    pass.setQualityMode(halfRes ? 'Low' : 'Medium');
    if (halfRes) {
      pass.configuration.halfRes = true;
      pass.configuration.depthAwareUpsampling = true;
    }
    const shaders = pass as unknown as CompositerInternals;
    expectGuarded(shaders.effectShaderQuad.material.fragmentShader);
    expectGuarded(shaders.effectCompositerQuad.material.fragmentShader);
    if (halfRes) {
      // The half-resolution tiers reconstruct the live normal in the depth
      // downsample pass (a HalfFloat attachment, where a NaN survives), so it
      // must carry the guard as well.
      expect(shaders.depthDownsampleQuad).toBeTruthy();
      expectGuarded(shaders.depthDownsampleQuad?.material.fragmentShader ?? '');
    } else {
      expect(shaders.depthDownsampleQuad ?? null).toBeNull();
    }
    pass.dispose();
  });

  it('applies once per material rebuild and never twice to the same source', () => {
    const pass = new StaticOpaqueN8AOPass(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      1279,
      719,
    );
    pass.setQualityMode('Low');
    pass.configuration.halfRes = true;
    // A second reconfiguration rebuilds every material from the pristine
    // n8ao source; the guard must be present exactly once afterwards.
    pass.configuration.halfRes = false;
    pass.configuration.halfRes = true;
    const shaders = pass as unknown as CompositerInternals;
    expectGuarded(shaders.effectShaderQuad.material.fragmentShader);
    expectGuarded(shaders.effectCompositerQuad.material.fragmentShader);
    expectGuarded(shaders.depthDownsampleQuad?.material.fragmentShader ?? '');
    pass.dispose();
  });
});
