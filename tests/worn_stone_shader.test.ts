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

  it('keeps the existing distance tap culling, now driven by fade uniforms and live taps', () => {
    // The per-family fade bands are uniforms, so the structure reads uniform
    // names, never the baked band values. The live tap count still gates the
    // parallax walk without selecting a different program.
    expect(fragmentShader).toContain('if ( uWornTaps > 0.0 && wornCamD < uWornParEnd )');
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

describe('terrain-detail shed (governed uWornTaps / uWornClampK)', () => {
  // Same compile path as compileWornShader, but returns the FakeShader (not
  // just its fragment source) so these tests can inspect shader.uniforms
  // too. compileWornShader's own vi.resetModules() means a fresh './gfx'
  // module graph loads each call, so sharedUniforms is re-imported from that
  // SAME fresh graph rather than reused from this file's top-level scope
  // (there is none here; each test imports it locally for that reason).
  async function compileWornShaderFull(
    preset: string,
    family: 'stone' | 'metal' = 'stone',
  ): Promise<{
    shader: FakeShader;
    sharedUniforms: typeof import('../src/render/gfx').sharedUniforms;
  }> {
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
    const { sharedUniforms: liveShared } = await import('../src/render/gfx');
    await Promise.all(pending);
    const material = new THREE.MeshStandardMaterial();
    applySurfaceDetail(material, family);
    lastMaterial = material;
    const shader: FakeShader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    material.onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
    return { shader, sharedUniforms: liveShared };
  }

  let lastMaterial: THREE.MeshStandardMaterial | null = null;

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../src/render/assets/loader');
    vi.doUnmock('../src/render/assets/preload');
  });

  it('the program cache key is byte-identical across shed levels (the level never selects a program)', async () => {
    const { sharedUniforms: live } = await compileWornShaderFull('ultra');
    const material = lastMaterial as THREE.MeshStandardMaterial;
    const keyAtRequest = material.customProgramCacheKey();
    expect(keyAtRequest).toContain('|p3c');
    live.uWornDetailTaps.value = 0;
    live.uWornDetailClampK.value = 0;
    expect(material.customProgramCacheKey()).toBe(keyAtRequest);
    live.uWornDetailTaps.value = 1.98;
    live.uWornDetailClampK.value = 0.66;
    expect(material.customProgramCacheKey()).toBe(keyAtRequest);
  });

  it('an ultra (parallax) material shares the live uWornTaps / uWornClampK uniforms by reference', async () => {
    const { shader, sharedUniforms: live } = await compileWornShaderFull('ultra');
    expect(shader.uniforms.uWornTaps).toBe(live.uWornDetailTaps);
    expect(shader.uniforms.uWornClampK).toBe(live.uWornDetailClampK);
  });

  it('a high (0-tap) material never attaches the uniforms: no parallax code compiled at all', async () => {
    const { shader } = await compileWornShaderFull('high');
    expect(shader.uniforms.uWornTaps).toBeUndefined();
    expect(shader.uniforms.uWornClampK).toBeUndefined();
    expect(shader.fragmentShader).not.toContain('uniform float uWornTaps;');
  });

  it('gates each refinement tap on the live count, fades the walk by min(taps, 1), and scales the baked clamp by the live share', async () => {
    const { shader } = await compileWornShaderFull('ultra');
    const frag = shader.fragmentShader;
    expect(frag).toContain('uniform float uWornTaps;');
    expect(frag).toContain('uniform float uWornClampK;');
    // Ultra compiles 3 taps: the first always runs inside the > 0.0 block,
    // taps 2 and 3 each behind their own live gate, weighed by the
    // fractional live count so a crossing blends the tap in, and the average
    // divides by the LIVE weight sum, never the compiled tap count.
    expect(frag).toContain('if ( uWornTaps > 1.0 ) {');
    expect(frag).toContain('float wornTapW = min( uWornTaps - 1.0, 1.0 );');
    expect(frag).toContain('if ( uWornTaps > 2.0 ) {');
    expect(frag).toContain('float wornTapW = min( uWornTaps - 2.0, 1.0 );');
    expect(frag).not.toContain('if ( uWornTaps > 3.0 ) {');
    expect(frag).toContain('wornHAcc += wornH * wornTapW;');
    expect(frag).toContain('wornHN += wornTapW;');
    expect(frag).toContain('wornV * ( wornHAcc * uWornParallaxAmp / wornHN )');
    expect(frag).not.toMatch(/uWornTaps\s*>=/);
    expect(frag).toContain('* min( uWornTaps, 1.0 );');
    // The family clamp rides a uniform now, and the live uniform is a share of
    // it, so 1 is exactly the static program.
    expect(frag).toContain(
      'vec3( -uWornParallaxClamp ) * uWornClampK, vec3( uWornParallaxClamp ) * uWornClampK',
    );
  });

  it('an insane (4-tap) material gates its fourth tap on the live count too', async () => {
    const { shader } = await compileWornShaderFull('insane');
    expect(shader.fragmentShader).toContain('if ( uWornTaps > 3.0 ) {');
    expect(shader.fragmentShader).toContain('float wornTapW = min( uWornTaps - 3.0, 1.0 );');
  });

  it('writing the shared uniforms changes only the values the ALREADY-compiled ultra program reads, never its source', async () => {
    const { shader, sharedUniforms: live } = await compileWornShaderFull('ultra');
    const before = shader.fragmentShader;
    live.uWornDetailTaps.value = 1;
    live.uWornDetailClampK.value = 0;
    expect(shader.fragmentShader).toBe(before);
    expect(shader.uniforms.uWornTaps.value).toBe(1);
    expect(shader.uniforms.uWornClampK.value).toBe(0);
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
