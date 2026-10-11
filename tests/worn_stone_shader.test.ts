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
  withMap = false,
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
  // The cell mask reads the material's own map UV, so it only compiles with a bound map.
  if (withMap) material.map = new THREE.Texture();
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

/** Everything spliced after the sampling block: the roughness, metalness and
 *  normal chunks, which only apply the sampled locals. */
function wornTail(frag: string): string {
  const start = frag.indexOf('#include <roughnessmap_fragment>');
  const end = frag.indexOf('#include <emissivemap_fragment>', start);
  return frag.slice(start, end === -1 ? undefined : end).replace(/\/\/.*$/gm, '');
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

/** The worn block only: from its first varying to the end of the AO composition. */
function injectedWorn(frag: string): string {
  const start = frag.indexOf('varying vec3 vWornWorldPos;');
  const end = frag.indexOf('#include <alphamap_fragment>', start);
  return frag.slice(start, end).replace(/\/\/.*$/gm, '');
}

/** The flat (one-hot) and corner (three-plane) sampling arms of the block. */
function planeArms(frag: string): { flat: string; corner: string } {
  const block = injectedWorn(frag);
  const flatAt = block.indexOf('if ( wornFlat ) {');
  const elseAt = block.indexOf('} else {', flatAt);
  const endAt = block.indexOf('wornHShade = clamp(', elseAt);
  return {
    flat: block.slice(flatAt, elseAt),
    corner: block.slice(
      elseAt,
      endAt === -1 ? block.indexOf('wornViewN = normalize', elseAt) : endAt,
    ),
  };
}

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

// The layer is written for the ANGLE D3D11 compiler as much as for the GPU:
// every branch it emits is HLSL flow the D3D compiler pays to optimize, so the
// pins below hold the BRANCH BUDGET and the per-path fetch counts, not a
// particular spelling.
describe('insane worn-surface fragment shader', () => {
  it('walks the parallax with two height reads per path (a first read and one refinement) and the uniform-driven clamp', () => {
    const { flat, corner } = planeArms(fragmentShader);
    expect(count(flat, /texture2D\( uWornDisp/g)).toBe(2);
    expect(count(corner, /wornTri3\( uWornDisp/g)).toBe(2);
    expect(count(fragmentShader, /uWornDisp,/g)).toBe(4);
    // The refinement is a mix by the live share, never a branch.
    expect(fragmentShader).toContain('float wornRefK = 0.5 * clamp( uWornTaps - 1.0, 0.0, 1.0 );');
    expect(count(fragmentShader, /, wornRefK \);/g)).toBe(2);
    // The per-family clamp rides a uniform scaled by the live share, so no
    // family scalar bakes into source.
    expect(flat).toContain('vec2( -uWornParallaxClamp * uWornClampK )');
    expect(corner).toContain('vec3( -uWornParallaxClamp * uWornClampK )');
  });

  it('spends exactly four branches: the fade, the plane split, and one parallax gate per arm', () => {
    const block = injectedWorn(fragmentShader);
    expect(count(block, /\bif \(/g)).toBe(4);
    expect(block).not.toContain('else if');
    expect(count(block, /if \( wornDetK > 0\.0 \)/g)).toBe(1);
    expect(count(block, /if \( wornFlat \)/g)).toBe(1);
    expect(count(block, /if \( wornParK > 0\.0 \)/g)).toBe(2);
    // ANGLE unfolds short-circuit operators and ternaries into extra HLSL
    // flow, so the block carries none.
    expect(block).not.toMatch(/&&|\|\||\?/);
    expect(block).toContain('float( gl_FrontFacing ) * 2.0 - 1.0');
  });

  it('keeps a flat, axis-aligned facet at one fetch per map and a corner at three', () => {
    const { flat, corner } = planeArms(fragmentShader);
    const block = injectedWorn(fragmentShader);
    for (const map of ['uWornDisp', 'uWornAo', 'uWornRough', 'uWornNormal']) {
      expect(count(flat, new RegExp(`texture2D\\( ${map}, wornUv \\)`, 'g')), map).toBe(1);
    }
    // Four maps at the (offset) UV plus the one refining height read.
    expect(count(flat, /texture2D\(/g)).toBe(5);
    for (const map of ['uWornAo', 'uWornRough']) {
      expect(
        count(corner, new RegExp(`wornTri3\\( ${map}, wornUvX, wornUvY, wornUvZ, wornW \\)`, 'g')),
        map,
      ).toBe(1);
    }
    expect(count(corner, /texture2D\( uWornNormal, wornUv[XYZ] \)/g)).toBe(3);
    // The corner helper is three weighted fetches with one exit, nothing else.
    const helperAt = fragmentShader.indexOf('float wornTri3(');
    const helper = fragmentShader.slice(helperAt, fragmentShader.indexOf('}', helperAt) + 1);
    expect(count(helper, /texture2D\(/g)).toBe(3);
    expect(count(helper, /\breturn\b/g)).toBe(1);
    expect(helper).not.toMatch(/\bif\b|\?/);
    // The arm predicate and the snap share the 0.999 threshold: the dominant
    // weight is one-hot exactly where the flat arm takes over.
    expect(block).toContain('bool wornFlat = max( wornW.x, max( wornW.y, wornW.z ) ) >= 0.999;');
    // The one-hot weight selects the plane's UV, view ray, and reorientation
    // without a second selector.
    expect(flat).toContain('wornW = step( vec3( 0.999 ), wornW );');
    expect(flat).toContain(
      'vec2 wornUv = wornUvX * wornW.x + wornUvY * wornW.y + wornUvZ * wornW.z;',
    );
    expect(flat).toContain(
      'wornWorldN = wornN.zyx * wornW.x + wornN.xzy * wornW.y + wornN.xyz * wornW.z;',
    );
    expect(corner).toContain(
      'wornWorldN = wornNx.zyx * wornW.x + wornNy.xzy * wornW.y + wornNz.xyz * wornW.z;',
    );
    // The corner read is the ONLY function the block declares, and it has one exit.
    expect(count(fragmentShader, /float wornTri3\(/g)).toBe(1);
    expect(fragmentShader).not.toContain('wornTriR');
  });

  it('samples every map inside the fade block and mixes the sampled locals after it, branch-free', () => {
    const block = injectedWorn(fragmentShader);
    // wornTri3 declares its fetches in the prologue; main's first fetch sits
    // behind the fade gate.
    const mainAt = block.indexOf('vec3 wornP = ');
    const fadeAt = block.indexOf('if ( wornDetK > 0.0 ) {', mainAt);
    expect(mainAt).toBeGreaterThan(-1);
    expect(fadeAt).toBeGreaterThan(mainAt);
    expect(block.indexOf('texture2D(', mainAt)).toBeGreaterThan(fadeAt);
    expect(block).toContain('smoothstep( uWornParStart, uWornParEnd, wornCamD )');
    expect(block).toContain('smoothstep( uWornDetStart, uWornDetEnd, wornCamD )');
    expect(block).toContain('float wornAoV = uWornAoMean;');
    expect(block).toContain('float wornRoughV = uWornRoughMean;');
    expect(block).toContain('mix( uWornAoMean, wornAoV, wornDetK )');
    expect(fragmentShader).toContain('mix( uWornRoughMean, wornRoughV, wornDetK )');
    expect(fragmentShader).toContain(
      'normal = normalize( mix( normal, wornViewN, uWornStrength * wornDetK ) );',
    );
    // The roughness, metalness and normal chunks carry no branch, short-circuit
    // or ternary of their own: they only apply the sampled locals.
    const tail = wornTail(fragmentShader);
    expect(tail).toContain('wornRoughV');
    expect(tail).not.toMatch(/\bif \(|&&|\|\||\?/);
  });

  it.each([
    ['high', 'high', 0, 2, 3],
    ['ultra', 'ultra', 2, 4, 5],
    [
      'advanced basic',
      'high&gfxo=surfaceDetail:1,surfaceDetailTaps:0,surfaceDetailClampK:0',
      0,
      2,
      3,
    ],
  ] as const)(
    'emits a balanced %s worn shader',
    async (_name, search, heightReadsPerPath, branches, flatFetches) => {
      const shader = await compileWornShader(search);
      const block = injectedWorn(shader);
      expect(count(block, /texture2D\( uWornDisp/g)).toBe(heightReadsPerPath);
      expect(count(block, /\bif \(/g)).toBe(branches);
      expect(block).toContain('if ( wornFlat )');
      // Flat arm: one fetch per map (normal, AO, rough) plus the height reads.
      expect(count(planeArms(shader).flat, /texture2D\(/g)).toBe(flatFetches);
      expect(wornTail(shader)).not.toMatch(/\bif \(|&&|\|\||\?/);
      expect(count(shader, /{/g)).toBe(count(shader, /}/g));
    },
  );

  it('passes the metalness map through both plane paths', async () => {
    const shader = await compileWornShader('insane', 'metal');
    const { flat, corner } = planeArms(shader);
    expect(flat).toContain('wornMetalV = texture2D( uWornMetal, wornUv ).r;');
    expect(corner).toContain(
      'wornMetalV = wornTri3( uWornMetal, wornUvX, wornUvY, wornUvZ, wornW );',
    );
    expect(shader).toContain('float wornMetalV = uWornMetalMean;');
    expect(shader).toContain('mix( uWornMetalMean, wornMetalV, wornDetK )');
    expect(shader).not.toContain('uniform sampler2D uWornAo;');
    expect(wornTail(shader)).not.toMatch(/\bif \(|&&|\|\||\?/);
  });

  it('object space samples AO and roughness only, with the plane split as its one branch', async () => {
    const { shader } = await compileWornObject('ultra', 'stone', {
      strength: 0.2,
      objectSpace: true,
    });
    const block = injectedWorn(shader.fragmentShader);
    expect(count(block, /\bif \(/g)).toBe(1);
    expect(block).toContain('float wornDetK = 1.0;');
    expect(block).not.toContain('uWornNormal, wornUv');
    expect(block).not.toContain('uWornDisp');
    expect(block).not.toContain('gl_FrontFacing');
    const { flat, corner } = planeArms(shader.fragmentShader);
    expect(flat).toContain('texture2D( uWornAo, wornUv )');
    expect(flat).toContain('texture2D( uWornRough, wornUv )');
    expect(corner).toContain('wornTri3( uWornAo, wornUvX, wornUvY, wornUvZ, wornW )');
    expect(corner).toContain('wornTri3( uWornRough, wornUvX, wornUvY, wornUvZ, wornW )');
  });

  it('bakes the cell mask as a constant array inside the same branch budget and keys it', async () => {
    const cellMask = [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25, 0, 0, 0, 0];
    const masked = await compileWornObject('ultra', 'stone', { cellMask }, true);
    const plain = await compileWornObject('ultra', 'stone', undefined, true);
    const block = injectedWorn(masked.shader.fragmentShader);
    expect(block).toContain(
      'const float wornCellMask[16] = float[16]( 1.000, 1.000, 1.000, 1.000, 0.500, 0.500, 0.500, 0.500, 0.250, 0.250, 0.250, 0.250, 0.000, 0.000, 0.000, 0.000 );',
    );
    expect(block).toContain('wornCellK = wornCellMask[ wornRow * 4 + wornCol ];');
    expect(count(block, /\bif \(/g)).toBe(4);
    expect(masked.key).toContain('|m1,1,1,1,0.5,0.5,0.5,0.5,0.25,0.25,0.25,0.25,0,0,0,0|');
    expect(masked.key).not.toBe(plain.key);
    expect(plain.key).not.toContain('|m');
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

  it('fades the walk by min(taps, 1) and scales the baked clamp by the live share, with no per-tap gate', async () => {
    const { shader } = await compileWornShaderFull('ultra');
    const frag = shader.fragmentShader;
    expect(frag).toContain('uniform float uWornTaps;');
    expect(frag).toContain('uniform float uWornClampK;');
    // Two height reads per path with no branch between them: the live count
    // no longer gates a refinement tap, it fades the whole offset (and weighs
    // the refinement below), and a zero count skips both reads through the
    // wornParK gate.
    expect(frag).not.toMatch(/uWornTaps\s*>/);
    expect(frag).not.toMatch(/uWornTaps\s*>=/);
    expect(frag).toContain('* min( uWornTaps, 1.0 );');
    expect(frag).toContain('if ( wornParK > 0.0 ) {');
    // The refining read weighs by clamp(taps - 1, 0, 1): at a live count of 1
    // the walk is the first read alone, at 2 and above the average of both.
    expect(frag).toContain('clamp( uWornTaps - 1.0, 0.0, 1.0 )');
    // The family clamp rides a uniform, and the live uniform is a share of
    // it, so 1 is exactly the static program.
    expect(frag).toContain(
      'vec2( -uWornParallaxClamp * uWornClampK ), vec2( uWornParallaxClamp * uWornClampK )',
    );
    expect(frag).toContain(
      'vec3( -uWornParallaxClamp * uWornClampK ), vec3( uWornParallaxClamp * uWornClampK )',
    );
  });

  it('an insane material compiles the same two-read walk as ultra: the tier changes the clamp share, never the program text', async () => {
    const ultra = await compileWornShaderFull('ultra');
    const insane = await compileWornShaderFull('insane');
    expect(insane.shader.fragmentShader).toBe(ultra.shader.fragmentShader);
    expect(insane.shader.uniforms.uWornParallaxClamp.value).toBeGreaterThan(
      ultra.shader.uniforms.uWornParallaxClamp.value,
    );
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
    expect(first.key.startsWith('surface-detail|on|p3c0.85|-|-|ao|w|')).toBe(true);
  });

  it('pins the structural key prefix per mode', async () => {
    const prefix = (key: string): string => key.split('|').slice(0, 7).join('|');
    expect(prefix((await compileWornObject('ultra', 'stone')).key)).toBe(
      'surface-detail|on|p3c0.85|-|-|ao|w',
    );
    expect(prefix((await compileWornObject('insane', 'stone')).key)).toBe(
      'surface-detail|on|p4c1|-|-|ao|w',
    );
    expect(prefix((await compileWornObject('high', 'stone')).key)).toBe(
      'surface-detail|on|-|-|-|ao|w',
    );
    expect(prefix((await compileWornObject('ultra', 'metal')).key)).toBe(
      'surface-detail|on|p3c0.85|-|met|-|w',
    );
    expect(
      prefix((await compileWornObject('ultra', 'stone', { strength: 0.2, objectSpace: true })).key),
    ).toBe('surface-detail|on|-|-|-|ao|o');
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
