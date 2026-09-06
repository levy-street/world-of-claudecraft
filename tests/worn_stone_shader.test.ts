import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SurfaceDetailOpts, SurfaceFamily } from '../src/render/worn_stone';

interface FakeShader {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

interface CompiledWorn {
  shader: FakeShader;
  key: string;
}

let fragmentShader = '';

// Compile the worn layer for a full family (and optional opts) and hand back
// the whole shader object plus the material's program cache key, so the
// program-collapse tests can compare source, uniforms, and keys across
// families.
async function compileWornObject(
  preset: string,
  family: SurfaceFamily,
  opts?: SurfaceDetailOpts,
): Promise<CompiledWorn> {
  const pending: Promise<unknown>[] = [];
  vi.resetModules();
  vi.stubGlobal('location', { search: `?gfx=${preset}` });
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: () => Promise.resolve(new THREE.Texture()),
    loadKtx2Texture: () => Promise.resolve(new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    registerDeferredPreload: (start: () => Promise<unknown>) => {
      pending.push(start());
    },
  }));

  const { applySurfaceDetail } = await import('../src/render/worn_stone');
  await Promise.all(pending);
  const material = new THREE.MeshStandardMaterial();
  applySurfaceDetail(material, family, opts);
  const shader: FakeShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return { shader, key: material.customProgramCacheKey() };
}

async function compileWornShader(
  preset: string,
  family: 'stone' | 'metal' = 'stone',
): Promise<string> {
  const pending: Promise<unknown>[] = [];
  vi.resetModules();
  vi.stubGlobal('location', { search: `?gfx=${preset}` });
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: () => Promise.resolve(new THREE.Texture()),
    // worn_stone requests the compressed sibling of every family channel.
    loadKtx2Texture: () => Promise.resolve(new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    registerDeferredPreload: (start: () => Promise<unknown>) => {
      pending.push(start());
    },
  }));

  const { applySurfaceDetail } = await import('../src/render/worn_stone');
  await Promise.all(pending);
  const material = new THREE.MeshStandardMaterial();
  applySurfaceDetail(material, family);
  const shader: FakeShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader.fragmentShader;
}

beforeAll(async () => {
  fragmentShader = await compileWornShader('insane');
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/assets/preload');
});

describe('insane worn-surface fragment shader', () => {
  it('keeps four dependent parallax samples and the uniform-driven clamp', () => {
    expect(fragmentShader.match(/wornTriR\( uWornDisp/g)).toHaveLength(4);
    // The per-family clamp rides a uniform now, so no family scalar bakes into
    // source; only the structural clamp bound uWornParallaxClamp appears.
    expect(fragmentShader).toContain('vec3( -uWornParallaxClamp )');
    expect(fragmentShader).toContain('vec3( uWornParallaxClamp )');
  });

  it('uses exact-zero two-plane fast paths for scalar and normal maps', () => {
    expect(fragmentShader).toContain('if ( axis.x <= 0.0 )');
    expect(fragmentShader).toContain('if ( axis.y <= 0.0 )');
    expect(fragmentShader).toContain('if ( axis.z <= 0.0 )');
    expect(fragmentShader).toContain('else if ( wornAxis.x <= 0.0 )');
    expect(fragmentShader).toContain('else if ( wornAxis.y <= 0.0 )');
    expect(fragmentShader).toContain('else if ( wornAxis.z <= 0.0 )');
    expect(fragmentShader).toContain('vec3 wornGN = wornUnitN * faceDirection;');
    expect(fragmentShader).toContain(
      'return texture2D( tex, p.xz ).r * w.y + texture2D( tex, p.xy ).r * w.z;',
    );
    expect(fragmentShader).toContain(
      'return texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xy ).r * w.z;',
    );
    expect(fragmentShader).toContain(
      'return texture2D( tex, p.zy ).r * w.x + texture2D( tex, p.xz ).r * w.y;',
    );
    expect(fragmentShader).toContain(
      'wornWorldN = normalize( wornNy.xzy * wornW.y + wornNz.xyz * wornW.z );',
    );
    expect(fragmentShader).toContain(
      'wornWorldN = normalize( wornNx.zyx * wornW.x + wornNz.xyz * wornW.z );',
    );
    expect(fragmentShader).toContain(
      'wornWorldN = normalize( wornNx.zyx * wornW.x + wornNy.xzy * wornW.y );',
    );
  });

  it('keeps the existing distance tap culling, now driven by fade uniforms', () => {
    // The per-family fade bands are uniforms, so the structure (a parallax
    // cutoff and the two smoothstep fades) reads uniform names, never the
    // baked band values (42.6 / 23.4 / 38.0 / 63.3 that used to appear here).
    expect(fragmentShader).toContain('if ( wornCamD < uWornParEnd )');
    expect(fragmentShader).toContain('smoothstep( uWornParStart, uWornParEnd, wornCamD )');
    expect(fragmentShader).toContain('smoothstep( uWornDetStart, uWornDetEnd, wornCamD )');
  });

  it.each([
    ['high', 'high', 0],
    ['ultra', 'ultra', 3],
    ['advanced basic', 'high&gfxo=surfaceDetail:1,surfaceDetailTaps:0,surfaceDetailClampK:0', 0],
  ] as const)('emits a balanced %s worn shader', async (_name, search, parallaxCalls) => {
    const shader = await compileWornShader(search);

    expect(shader.match(/wornTriR\( uWornDisp/g) ?? []).toHaveLength(parallaxCalls);
    expect(shader).toContain('if ( axis.x <= 0.0 )');
    expect(shader.match(/{/g) ?? []).toHaveLength((shader.match(/}/g) ?? []).length);
  });

  it('passes the cached axis through the metalness path', async () => {
    const shader = await compileWornShader('insane', 'metal');

    expect(shader).toContain('wornTriR( uWornMetal, wornP, wornW, wornAxis ), wornDetK');
    expect(shader).not.toContain('uniform sampler2D uWornAo;');
  });
});

// The whole point of moving per-family scalars to uniforms: families that share
// a STRUCTURE now compile ONE program instead of one each. These pin that the
// source and key no longer depend on the family, only on the structural flags.
describe('worn-surface program collapse across families', () => {
  // Every non-metal family runs the same structure on ultra: parallax + AO +
  // roughness, world projection, no metalness. Measured shared-structure floor.
  const STRUCTURAL_TWINS: SurfaceFamily[] = ['stone', 'rock', 'wood', 'plaster', 'bark', 'fabric'];

  it('compiles byte-identical source and one shared key for structural twins', async () => {
    const compiled = await Promise.all(
      STRUCTURAL_TWINS.map((family) => compileWornObject('ultra', family)),
    );
    const first = compiled[0];
    for (const c of compiled.slice(1)) {
      expect(c.shader.fragmentShader).toBe(first.shader.fragmentShader);
      expect(c.shader.vertexShader).toBe(first.shader.vertexShader);
      expect(c.key).toBe(first.key);
    }
    // The key carries no family name, only the structural discriminants.
    for (const family of STRUCTURAL_TWINS) {
      expect(first.key).not.toContain(family);
    }
    expect(first.key.startsWith('surface-detail|on|')).toBe(true);
  });

  it('keeps STRUCTURALLY different families on distinct keys and source', async () => {
    // metal: no AO block, adds the metalness block -> different structure.
    const stone = await compileWornObject('ultra', 'stone');
    const metal = await compileWornObject('ultra', 'metal');
    expect(metal.key).not.toBe(stone.key);
    expect(metal.shader.fragmentShader).not.toBe(stone.shader.fragmentShader);
    // objectSpace: no parallax, no normal blend -> different structure.
    const objectSpace = await compileWornObject('ultra', 'stone', {
      strength: 0.2,
      objectSpace: true,
    });
    expect(objectSpace.key).not.toBe(stone.key);
    expect(objectSpace.shader.fragmentShader).not.toBe(stone.shader.fragmentShader);
    // high tier: 0 taps -> no parallax block -> different structure than ultra.
    const highTier = await compileWornObject('high', 'stone');
    expect(highTier.key).not.toBe(stone.key);
    expect(highTier.shader.fragmentShader).not.toBe(stone.shader.fragmentShader);
  });

  it('bakes no per-family tuned scalar into the spliced worn source', async () => {
    // Golden guard: none of a family's tuned scalars (dispCenter, aoMean,
    // roughMean, metalMean, heightShade, and their derived amplitudes/fade
    // bands) may survive as source text; they all ride uniforms. Restated from
    // worn_stone.ts FAMILIES so a tuning change surfaces here. The only decimals
    // allowed in the injected source are the two shared module constants
    // (DOMINANT_PLANE_CUTOFF 0.15, HEIGHT_SHADE_CLAMP_SD 1.5) and the structural
    // GLSL constants (0.0, 1.0, 2.0, 4.0, 0.999); those are the same for every
    // family, which the byte-identity test above already proves.
    const familyScalars: Record<string, string[]> = {
      stone: ['0.456', '0.756', '0.731'],
      rock: ['0.760', '0.982', '0.510'],
      wood: ['0.468', '0.729', '0.535'],
      metal: ['0.271', '0.787', '0.438'],
    };
    for (const [family, scalars] of Object.entries(familyScalars)) {
      const { shader } = await compileWornObject('ultra', family as SurfaceFamily);
      const injected = shader.fragmentShader.slice(
        shader.fragmentShader.indexOf('varying vec3 vWornWorldPos;'),
      );
      for (const s of scalars) {
        expect(injected, `${family} leaked scalar ${s}`).not.toContain(s);
      }
    }
  });

  it('carries each family value on its uniform, unchanged', async () => {
    const { shader } = await compileWornObject('ultra', 'stone');
    const u = shader.uniforms;
    // Values restated from worn_stone.ts FAMILIES.stone so a family tuning
    // change surfaces here too.
    expect(u.uWornAoMean.value).toBeCloseTo(0.756, 6);
    expect(u.uWornRoughMean.value).toBeCloseTo(0.731, 6);
    expect(u.uWornDispCenter.value).toBeCloseTo(0.456, 6);
    expect(u.uWornHeightShade.value).toBeCloseTo(0.15, 6);
    // parallaxAmp = parallaxDepth / dispSd = 0.06 / 0.219.
    expect(u.uWornParallaxAmp.value).toBeCloseTo(0.06 / 0.219, 6);
    // heightNorm = 1 / dispSd.
    expect(u.uWornHeightNorm.value).toBeCloseTo(1 / 0.219, 6);
    // The fade bands match surfaceDetailFadeBands(0.06, 1/2.6): parEnd 42.6.
    expect(u.uWornParEnd.value).toBeCloseTo(42.6, 1);
    expect(u.uWornDetEnd.value).toBeCloseTo(63.3, 1);

    const metal = await compileWornObject('ultra', 'metal');
    expect(metal.shader.uniforms.uWornMetalMean.value).toBeCloseTo(0.787, 6);
    expect(metal.shader.uniforms.uWornRoughMean.value).toBeCloseTo(0.438, 6);
  });
});
