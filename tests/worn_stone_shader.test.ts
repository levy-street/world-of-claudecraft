import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface FakeShader {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

let fragmentShader = '';

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
  it('keeps four dependent parallax samples and the full clamp', () => {
    expect(fragmentShader.match(/wornTriR\( uWornDisp/g)).toHaveLength(4);
    expect(fragmentShader).toContain('vec3( -0.132 )');
    expect(fragmentShader).toContain('vec3( 0.132 )');
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

  it('keeps the existing distance tap culling', () => {
    expect(fragmentShader).toContain('if ( uWornTaps > 0.0 && wornCamD < 42.6 )');
    expect(fragmentShader).toContain('smoothstep( 23.4, 42.6, wornCamD )');
    expect(fragmentShader).toContain('smoothstep( 38.0, 63.3, wornCamD )');
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
    expect(keyAtRequest).toContain('p3c0.85');
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
    expect(frag).toMatch(/wornV \* \( wornHAcc \* [0-9.]+ \/ wornHN \)/);
    expect(frag).not.toMatch(/uWornTaps\s*>=/);
    expect(frag).toContain('* min( uWornTaps, 1.0 );');
    // The clamp keeps its baked tier factor (0.85 on ultra: 2.2 * depth * 0.85)
    // and the uniform is a share of it, so 1 is exactly the static program.
    expect(frag).toMatch(/vec3\( -[0-9.]+ \) \* uWornClampK, vec3\( [0-9.]+ \) \* uWornClampK \)/);
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
