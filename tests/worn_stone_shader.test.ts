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
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: (promise: Promise<unknown>) => {
      pending.push(promise);
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
    expect(fragmentShader).toContain('if ( wornCamD < 42.6 )');
    expect(fragmentShader).toContain('smoothstep( 23.4, 42.6, wornCamD )');
    expect(fragmentShader).toContain('smoothstep( 38.0, 63.3, wornCamD )');
  });

  it.each([
    ['high', 'high', 3],
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
