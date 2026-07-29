// @vitest-environment jsdom
//
// The splat material packs its six albedo photos through a 2D canvas
// (buildSplatAlbedoArray), so compiling it needs a document. Without this
// docblock the whole suite errors out in the default Node env before a single
// pin runs, which is how it was sitting: every assertion below was reporting
// nothing at all. jsdom stays scoped to this file per tests/CLAUDE.md.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface FakeShader {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

let material: THREE.MeshStandardMaterial;
let vertexShader = '';
let fragmentShader = '';
let finishChunkGeometry: typeof import('../src/render/terrain').terrainInternalsForTest.finishChunkGeometry;

function braceDepthAt(source: string, offset: number): number {
  let depth = 0;
  for (let i = 0; i < offset; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
  }
  return depth;
}

async function compileTerrainShader(preset: string): Promise<FakeShader> {
  vi.resetModules();
  vi.stubGlobal('location', { search: `?gfx=${preset}` });
  const { terrainInternalsForTest } = await import('../src/render/terrain');
  const shader: FakeShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  terrainInternalsForTest
    .createSplatMaterial()
    .onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      null as unknown as THREE.WebGLRenderer,
    );
  return shader;
}

beforeAll(async () => {
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: () => Promise.resolve(new THREE.Texture()),
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: () => undefined,
    registerDeferredPreload: () => undefined,
  }));
  vi.doMock('../src/render/textures', () => ({
    groundDetailTexture: () => new THREE.Texture(),
    groundSplatMaps: () => ({}),
    macroNoiseTexture: () => new THREE.Texture(),
  }));

  const shader = await compileTerrainShader('insane');
  const { terrainInternalsForTest } = await import('../src/render/terrain');
  material = terrainInternalsForTest.createSplatMaterial();
  finishChunkGeometry = terrainInternalsForTest.finishChunkGeometry;
  vertexShader = shader.vertexShader;
  fragmentShader = shader.fragmentShader;
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/assets/preload');
  vi.doUnmock('../src/render/textures');
});

describe('insane terrain fragment shader', () => {
  it('culls only chunk-uniform absent splat and extra layers', () => {
    expect(vertexShader).toContain('attribute float aTerrainPresenceMask;');
    expect(vertexShader).toContain(
      `vTerrainSplatPresence = mod(
          floor(vec4(aTerrainPresenceMask) / vec4(1.0, 2.0, 4.0, 8.0)), 2.0);`,
    );
    expect(vertexShader).toContain(
      `vTerrainExtraPresence = mod(
          floor(vec2(aTerrainPresenceMask) / vec2(16.0, 32.0)), 2.0);`,
    );
    expect(fragmentShader).toContain('flat varying vec4 vTerrainSplatPresence;');
    expect(fragmentShader).toContain('flat varying vec2 vTerrainExtraPresence;');
    expect(fragmentShader).toContain(
      'if ( vTerrainSplatPresence.x > 0.5 || vTerrainSplatPresence.w > 0.5 )',
    );
    expect(fragmentShader).toContain('if ( vTerrainSplatPresence.y > 0.5 )');
    expect(fragmentShader).toContain('if ( vTerrainSplatPresence.z > 0.5 )');
    expect(fragmentShader).toContain('if ( wocHasGrass ) {');
    expect(fragmentShader).toContain('if ( wocHasDirt ) {');
    expect(fragmentShader).toContain('if ( wocHasRock ) {');
    expect(fragmentShader).toContain('if ( wocHasSand )');
    expect(fragmentShader).toContain('if ( wocHasMud )');
    expect(fragmentShader).toContain('if ( wocHasSnow )');
    expect(fragmentShader).toContain(
      `if ( wocHasGrass || wocHasRock )
          macro2 = texture2D(uMacro, vWPos.xz * 0.0045 + 0.37).r;`,
    );
    // The presence-mask cull composes with the detail-distance fade: the
    // fine octave taps skip both when a layer is chunk-uniform absent AND
    // past the wocDetailFade band where their maps have mipped flat.
    expect(fragmentShader).toContain(
      `if ( (wocHasDirt || wocHasRock) && wocNearDetail )
          fineHard = texture2D(uRockN, tuv * 2.4).xy * 2.0 - 1.0;`,
    );
  });

  it('stores independent packed presence masks on consecutive chunk geometries', () => {
    const common = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
    };
    const grassMud = finishChunkGeometry({
      ...common,
      splats: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      extras: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
    });
    const rockSandSnow = finishChunkGeometry({
      ...common,
      splats: new Float32Array([0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]),
      extras: new Float32Array([0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]),
    });

    expect(Array.from(grassMud.getAttribute('aTerrainPresenceMask').array)).toEqual([17, 17, 17]);
    expect(Array.from(rockSandSnow.getAttribute('aTerrainPresenceMask').array)).toEqual([
      44, 44, 44,
    ]);
  });

  it('keeps the insane relief and final shading equations intact', () => {
    expect(fragmentShader.match(/wocGroundHeightSmooth\(tuv/g)).toHaveLength(2);
    expect(fragmentShader).toContain('const float WOC_PARALLAX_CLAMP = 0.04;');
    expect(fragmentShader).toContain('wocGroundHeight(tuv + sunStep, swShade) - cavH - 0.02');
    expect(fragmentShader).toContain(
      '(wocGroundHeight(tuv + sunStep * 2.2, swShade) - cavH) * 0.55 - 0.02',
    );
    expect(fragmentShader).toContain(
      'groundShade *= 1.0 - min(max(occl, 0.0) * 4.5, 0.42) * cavW * microFade;',
    );
    expect(fragmentShader).toContain(
      'diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35) * macro * groundShade;',
    );
    expect(fragmentShader).toContain('normal = normalize(normal + tbn * vec3(detN, 0.0));');
  });

  it('keeps relief guards away from the base albedo path', () => {
    const mapDepth = braceDepthAt(fragmentShader, fragmentShader.indexOf('vec2 tuv ='));
    const parallaxSampleDepth = braceDepthAt(fragmentShader, fragmentShader.indexOf('vec2 pOff ='));
    const grassAlbedoDepth = braceDepthAt(
      fragmentShader,
      fragmentShader.indexOf('vec3 grassAlb ='),
    );
    const albedoBlendDepth = braceDepthAt(fragmentShader, fragmentShader.indexOf('vec3 alb ='));
    const finalAccumulationDepth = braceDepthAt(
      fragmentShader,
      fragmentShader.indexOf('diffuseColor.rgb *= alb'),
    );

    expect(fragmentShader).not.toContain('bvec3 active');
    expect(fragmentShader).not.toContain('pActive');
    expect(fragmentShader).toContain('vec3 wocReliefUnitN = normalize(vWNorm);');
    expect(fragmentShader.match(/normalize\(vWNorm\)/g)).toHaveLength(2);
    expect(fragmentShader).toContain('float wocCamDist = length(pRay);');
    expect(fragmentShader).toContain('if (upW > 0.55 && pDist < 36.0) {');
    expect(fragmentShader).toContain(
      'vec3 alb = grassAlb * vSplatR.x\n' +
        '                 + dirtAlb * vSplatR.y\n' +
        '                 + rockAlb * vSplatR.z\n' +
        '                 + sandAlb * vSplatR.w;',
    );
    expect(fragmentShader).toContain(
      'diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35) * macro * groundShade;',
    );
    expect(parallaxSampleDepth).toBeGreaterThan(mapDepth);
    expect(grassAlbedoDepth).toBe(mapDepth);
    expect(albedoBlendDepth).toBe(mapDepth);
    expect(finalAccumulationDepth).toBe(mapDepth);
  });

  it('skips the near-field-only relief taps once their signal has mipped away', () => {
    // Both gates exist to stop the shader paying texture taps for a value the
    // mip chain has already flattened. Each one has to be a real branch (the
    // taps must sit INSIDE it, not behind a multiply-by-zero) and each has to
    // carry a smoothstep so the boundary can never draw a ring.
    expect(fragmentShader).toContain('const float WOC_MICRO_SHADOW_NEAR = 40.0;');
    expect(fragmentShader).toContain('const float WOC_MICRO_SHADOW_FAR = 70.0;');
    expect(fragmentShader).toContain(
      'smoothstep(WOC_MICRO_SHADOW_NEAR, WOC_MICRO_SHADOW_FAR, wocCamDist)',
    );
    expect(fragmentShader).toContain('if (microFade > 0.0) {');
    const microGate = fragmentShader.indexOf('if (microFade > 0.0) {');
    expect(microGate).toBeGreaterThan(-1);
    expect(fragmentShader.indexOf('wocGroundHeight(tuv + sunStep')).toBeGreaterThan(microGate);

    expect(fragmentShader).toContain('const float WOC_DETAIL_N_NEAR = 120.0;');
    expect(fragmentShader).toContain('const float WOC_DETAIL_N_FAR = 220.0;');
    expect(fragmentShader).toContain(
      'float wocDetailN = 1.0 - smoothstep(WOC_DETAIL_N_NEAR, WOC_DETAIL_N_FAR, wocCamDist);',
    );
    expect(fragmentShader).toContain('if (wocDetailN > 0.0) {');
    const detailGate = fragmentShader.indexOf('if (wocDetailN > 0.0) {');
    for (const tap of [
      'texture2D(uGrassN, combT + grassJitter)',
      'texture2D(uDirtN, tuv * 0.55)',
      'texture2D(uRockN, tuv * 0.6)',
      'texture2D(uSandN, tuv)',
      'texture2D(uRockN, tuv * 2.4)',
      'texture2D(uGrassN, combT * 3.0)',
      'texture2D(uRockN, tuv * 1.8)',
    ]) {
      expect(fragmentShader.indexOf(tap)).toBeGreaterThan(detailGate);
    }
    // The distance fade rides the same multiply as the slope fade, so a
    // fragment at the gate edge reaches it continuously.
    expect(fragmentShader).toContain('detN *= smoothstep(0.5, 0.82, vWNorm.y) * wocDetailN;');
    // The CLIFF wall normals stay OUTSIDE the gate: wall relief is what keeps
    // a mountainside reading as rock right out to the detail horizon.
    expect(fragmentShader.indexOf('texture2D(uRockN, vWPos.yz * 0.132)')).toBeGreaterThan(
      fragmentShader.indexOf('normal = normalize(normal + tbn * vec3(detN, 0.0));'),
    );
  });

  it('keeps the shared terrain material opaque and depth-writing', () => {
    expect(material.transparent).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(true);
  });

  it.each([
    ['medium', 'medium', 0, false],
    ['high', 'high', 0, false],
    ['ultra', 'ultra', 2, true],
    ['advanced relief 1', 'high&gfxo=terrainRelief:1', 0, false],
  ] as const)(
    'emits a balanced %s splat shader',
    async (_name, search, parallaxCalls, microShadow) => {
      const shader = await compileTerrainShader(search);

      expect(shader.vertexShader).toContain('attribute float aTerrainPresenceMask;');
      expect(shader.fragmentShader.match(/wocGroundHeightSmooth\(tuv/g) ?? []).toHaveLength(
        parallaxCalls,
      );
      expect(shader.fragmentShader.includes('// micro sun-shadow:')).toBe(microShadow);
      expect(shader.fragmentShader.match(/{/g) ?? []).toHaveLength(
        (shader.fragmentShader.match(/}/g) ?? []).length,
      );
    },
  );
});
