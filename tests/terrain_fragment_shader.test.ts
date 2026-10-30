// @vitest-environment jsdom
//
// The splat material packs its six albedo photos through a 2D canvas
// (buildSplatAlbedoArray), so compiling it needs a document. Without this
// docblock the whole suite errors out in the default Node env before a single
// pin runs, which is how it was sitting: every assertion below was reporting
// nothing at all. jsdom stays scoped to this file per tests/CLAUDE.md.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { sharedUniforms } from '../src/render/gfx';
import { MEADOW_CARPET_FADE_START } from '../src/render/meadow_tuning';
import {
  PAINTED_COBBLE_LANE_SLOTS,
  PAINTED_GROUND_TUNING,
  paintedBumpGlsl,
  paintedCoverGlsl,
  paintedDetailNormalTapsGlsl,
  paintedDirtFlatGlsl,
  paintedGrassGlsl,
  paintedGroundDeclarationsGlsl,
  paintedHeightBlendGlsl,
  paintedSubLayerAlbedoGlsl,
  paintedSubLayerTermsGlsl,
} from '../src/render/terrain_painted_ground_core';

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

async function compileTerrainShader(
  preset: string,
  world: { authored?: boolean; bake?: boolean } = {},
): Promise<FakeShader> {
  vi.resetModules();
  vi.stubGlobal('location', { search: `?gfx=${preset}` });
  // the fresh module graph's own world and bake singletons
  const data = await import('../src/sim/data');
  data.setActiveWorldContent(world.authored ? { ...data.BUILTIN_WORLD } : null);
  const bakeModule = await import('../src/render/grass_ground_bake');
  bakeModule.setGrassGroundBake(
    world.bake
      ? {
          owner: {} as THREE.WebGLRenderer,
          texture: new THREE.Texture(),
          mean: [0.9, 0.9, 0.9],
        }
      : null,
  );
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
}, 30_000);

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
    // painted dirt normal taps skip both when the layer (and every bare-earth
    // patch carved from the grass) is absent AND past the wocDetailFade band
    // where their maps have mipped flat. (The photo-era fine octaves this
    // pinned are authored-map only now; see the near-field test below.)
    expect(fragmentShader).toContain(
      `if ( (wocHasDirt || wocEarthM > 0.0) && wocNearDetail ) {
          vec2 wocUvD = tuv * 0.55;`,
    );
  });

  it('stores independent packed presence masks on consecutive chunk geometries', () => {
    const common = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      colors: new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint16Array([0, 1, 2]),
      rim: null,
      clip: null,
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
    // Studio gates parallax on the ground-UV plane's dominance (its pDir is a
    // world-XZ frame). The built-in world keeps the top-down UV with a zero
    // wocTAN, so `upW >= max(0, 0)` is implied by `upW > 0.55` there and the
    // shipped guard is unchanged in effect.
    expect(fragmentShader).toContain('vec3 wocTAN = vec3(0.0); vec2 wocTPlane = vWPos.xz;');
    expect(fragmentShader).toContain(
      'if (upW >= max(wocTAN.x, wocTAN.z) && upW > 0.55 && pDist < 36.0) {',
    );
    // The Studio merge names the splat weights wocHW so authored maps can
    // height-blend them; in the built-in world the PAINTED height blend runs
    // between the copy and the sum (terrain_painted_ground_core.ts), and the
    // carved cover layers add their terms to the release's weighted sum.
    expect(fragmentShader).toContain(
      `vec4 wocHW = vSplatR;${paintedHeightBlendGlsl()}\n` +
        '        vec3 alb = grassAlb * wocHW.x\n' +
        '                 + dirtAlb * wocHW.y\n' +
        '                 + rockAlb * wocHW.z\n' +
        `                 + sandAlb * wocHW.w${paintedSubLayerTermsGlsl(null)};`,
    );
    expect(fragmentShader).toContain(
      'diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35) * macro * groundShade;',
    );
    expect(parallaxSampleDepth).toBeGreaterThan(mapDepth);
    expect(grassAlbedoDepth).toBe(mapDepth);
    expect(albedoBlendDepth).toBe(mapDepth);
    expect(finalAccumulationDepth).toBe(mapDepth);
  });

  it('skips the near-field-only relief taps once their signal has mipped away', async () => {
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
    // The built-in (painted) program: each painted map at its albedo's two
    // anti-repeat UVs, no fine octaves (a scaled painted stroke is noise).
    for (const tap of [
      'WOC_NRM(tuv, WOC_N_GRASS)',
      'WOC_NRM(wocRotUv(tuv, ',
      'WOC_NRM(wocUvD, WOC_N_DIRT)',
      'WOC_NRM(wocRotUv(wocUvD, ',
      'WOC_NRM(tuv * 0.6, WOC_N_ROCK)',
      'WOC_NRM(tuv, WOC_N_SAND)',
    ]) {
      expect(fragmentShader.indexOf(tap), tap).toBeGreaterThan(detailGate);
    }
    for (const photoEra of [
      'WOC_NRM(combT + grassJitter, WOC_N_GRASS)',
      'WOC_NRM(tuv * 2.4, WOC_N_ROCK)',
      'WOC_NRM(combT * 3.0, WOC_N_GRASS)',
      'WOC_NRM(tuv * 1.8, WOC_N_ROCK)',
    ]) {
      expect(fragmentShader, photoEra).not.toContain(photoEra);
    }
    // An authored map keeps the photo-era taps, all inside the same gate.
    const authoredFrag = (await compileTerrainShader('insane', { authored: true })).fragmentShader;
    const authoredGate = authoredFrag.indexOf('if (wocDetailN > 0.0) {');
    expect(authoredGate).toBeGreaterThan(-1);
    for (const tap of [
      'WOC_NRM(combT + grassJitter, WOC_N_GRASS)',
      'WOC_NRM(tuv * 0.55, WOC_N_DIRT)',
      'WOC_NRM(tuv * 0.6, WOC_N_ROCK)',
      'WOC_NRM(tuv, WOC_N_SAND)',
      'WOC_NRM(tuv * 2.4, WOC_N_ROCK)',
      'WOC_NRM(combT * 3.0, WOC_N_GRASS)',
      'WOC_NRM(tuv * 1.8, WOC_N_ROCK)',
    ]) {
      expect(authoredFrag.indexOf(tap), tap).toBeGreaterThan(authoredGate);
    }
    expect(authoredFrag).toContain(
      `if ( (wocHasDirt || wocHasRock) && wocNearDetail )
          fineHard = WOC_NRM(tuv * 2.4, WOC_N_ROCK).xy * 2.0 - 1.0;`,
    );
    const data = await import('../src/sim/data');
    data.setActiveWorldContent(null);
    // The distance fade rides the same multiply as the slope fade, so a
    // fragment at the gate edge reaches it continuously.
    expect(fragmentShader).toContain('detN *= smoothstep(0.5, 0.82, vWNorm.y) * wocDetailN;');
    // The CLIFF wall normals stay OUTSIDE the gate: wall relief is what keeps
    // a mountainside reading as rock right out to the detail horizon.
    expect(fragmentShader.indexOf('WOC_NRM(vWPos.yz * 0.132, WOC_N_ROCK)')).toBeGreaterThan(
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

  describe('terrain-detail shed (governed uReliefSteps)', () => {
    // compileTerrainShader calls vi.resetModules() and re-imports './gfx'
    // fresh each time, so the module-scope sharedUniforms this file imported
    // at the top is a stale instance by then: re-import it from the SAME
    // fresh module graph terrain.ts just loaded.
    async function liveSharedUniforms(): Promise<typeof sharedUniforms> {
      const mod = await import('../src/render/gfx');
      return mod.sharedUniforms;
    }

    it('an ultra material shares the live uReliefSteps uniform by reference', async () => {
      const shader = await compileTerrainShader('ultra');
      const live = await liveSharedUniforms();
      expect(shader.uniforms.uReliefSteps).toBe(live.uReliefSteps);
    });

    it('a medium/high material never attaches the uniform: no relief 2+ code compiled at all', async () => {
      for (const preset of ['medium', 'high']) {
        const shader = await compileTerrainShader(preset);
        expect(shader.uniforms.uReliefSteps).toBeUndefined();
        expect(shader.fragmentShader).not.toContain('uniform float uReliefSteps;');
      }
    });

    it('scales the EXISTING parallax and micro-shadow fades by the live level, inside the same gates', async () => {
      const shader = await compileTerrainShader('ultra');
      const frag = shader.fragmentShader;
      expect(frag).toContain('uniform float uReliefSteps;');
      // The parallax walk: its distance/incidence fade takes the relief weight
      // (0 at the floor's relief 1, 1 from relief 2 up) and the existing
      // pFade > 0.015 gate is what skips every tap below it.
      const parallaxFade = frag.indexOf('* clamp(uReliefSteps - 1.0, 0.0, 1.0);');
      expect(parallaxFade).toBeGreaterThan(-1);
      expect(frag.indexOf('if (pFade > 0.015) {')).toBeGreaterThan(parallaxFade);
      expect(frag.indexOf('wocGroundHeightSmooth(tuv, pAmp)')).toBeGreaterThan(parallaxFade);
      // The micro sun-shadow: its distance fade takes the level-3 weight and
      // the existing microFade > 0.0 gate skips its taps below relief 3.
      const microFade = frag.indexOf('* clamp(uReliefSteps - 2.0, 0.0, 1.0);');
      expect(microFade).toBeGreaterThan(-1);
      expect(frag.indexOf('if (microFade > 0.0) {')).toBeGreaterThan(microFade);
      expect(frag.indexOf('wocGroundHeight(tuv + sunStep')).toBeGreaterThan(microFade);
      // No `>=` uniform compare anywhere: the shed is a weight on a fade, so
      // a slewing level crossfades instead of switching a branch.
      expect(frag).not.toMatch(/uReliefSteps\s*>=/);
    });

    it('the default program cache key (the hook source) is identical across shed levels', async () => {
      await compileTerrainShader('ultra');
      const { terrainInternalsForTest } = await import('../src/render/terrain');
      const live = await liveSharedUniforms();
      const mat = terrainInternalsForTest.createSplatMaterial();
      const keyAtRequest = mat.customProgramCacheKey();
      live.uReliefSteps.value = 1;
      expect(mat.customProgramCacheKey()).toBe(keyAtRequest);
      live.uReliefSteps.value = 2.32;
      expect(mat.customProgramCacheKey()).toBe(keyAtRequest);
    });

    it('writing the shared uniform changes only the value the ALREADY-compiled ultra program reads, never its source', async () => {
      const shader = await compileTerrainShader('ultra');
      const live = await liveSharedUniforms();
      const before = shader.fragmentShader;
      live.uReliefSteps.value = 1;
      expect(shader.fragmentShader).toBe(before);
      expect(shader.uniforms.uReliefSteps.value).toBe(1);
    });
  });
});

describe('painted ground splice (terrain_painted_ground_core.ts)', () => {
  // The cover breakup, town cobbles and height blend are ONE variant on every
  // splat tier: the generated blocks take no tier input, and each tier's
  // program must carry them byte for byte.
  const blocks = (): string[] => [
    paintedGroundDeclarationsGlsl(),
    paintedCoverGlsl(),
    paintedDirtFlatGlsl(),
    paintedSubLayerAlbedoGlsl(),
    paintedHeightBlendGlsl(),
    paintedDetailNormalTapsGlsl(),
    paintedBumpGlsl(),
  ];

  it.each(['medium', 'high', 'ultra', 'insane'])(
    'the %s built-in program carries every painted block, identically',
    async (preset) => {
      const shader = await compileTerrainShader(preset, { bake: true });
      for (const block of blocks()) expect(shader.fragmentShader).toContain(block);
      expect(shader.fragmentShader).toContain(paintedGrassGlsl(MEADOW_CARPET_FADE_START));
      expect(shader.fragmentShader).toContain(paintedSubLayerTermsGlsl('vtint35'));
      // the painted grass owns the carpet ring: the photo-era ring is gone
      expect(shader.fragmentShader).not.toContain('wocPlainGrain');
      // the photo-era dirt grit and micro-soften taps are not compiled
      expect(shader.fragmentShader).not.toContain('WOC_ALB(tuv * 1.8, WOC_L_ROCK)');
      expect(shader.fragmentShader).not.toContain('vec3(tuv * 0.55, WOC_L_DIRT), 2.0)');
      expect(shader.fragmentShader.match(/{/g) ?? []).toHaveLength(
        (shader.fragmentShader.match(/}/g) ?? []).length,
      );
    },
  );

  it('binds the painted uniforms: the Eastbrook cobble footprint and the macro z-score stats', async () => {
    const shader = await compileTerrainShader('medium');
    const towns = shader.uniforms.uCobbleTowns.value as THREE.Vector4[];
    expect(towns).toHaveLength(2);
    // Eastbrook's hub (-14, -100) with full cobbles to twice its 26 yd town radius
    expect(towns[0].toArray()).toEqual([-14, -100, 26 * 2, 26 * 2.6]);
    // and its main street laid on past the footprint to the docks, a segment a slot: from
    // where it leaves the square's full cobble to its end on the quay walk, then a spare
    const lanes = (shader.uniforms.uCobbleLanes.value as THREE.Vector4[]).map((v) => v.toArray());
    expect(lanes).toHaveLength(PAINTED_COBBLE_LANE_SLOTS);
    expect(lanes[0]).toEqual([-56, -88, -62, -76]);
    expect(lanes[4]).toEqual([-88, -60, -92, -56]);
    expect(lanes[5][0]).toBeGreaterThan(1e4);
    expect(shader.fragmentShader).toContain(
      `uniform vec4 uCobbleLanes[${PAINTED_COBBLE_LANE_SLOTS}];`,
    );
    // the box round them, grown by the lane's reach, gates the loop
    const reach = PAINTED_GROUND_TUNING.cobbleLaneOuter;
    expect((shader.uniforms.uCobbleLaneBox.value as THREE.Vector4).toArray()).toEqual([
      -92 - reach,
      -88 - reach,
      -56 + reach,
      -56 + reach,
    ]);
    const frag = shader.fragmentShader;
    const gate = frag.indexOf('all(greaterThanEqual(vWPos.xz, uCobbleLaneBox.xy))');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(frag.indexOf('vec4 l = uCobbleLanes[i];'));
    // the spare slot can never match a distance
    expect(towns[1].w).toBeLessThan(0);
    expect((shader.uniforms.uPaintedCover.value as THREE.Vector2).toArray()).toEqual([1, 1]);
    // the mocked macro texture has no canvas: the fallback stats, as 1/sd
    expect((shader.uniforms.uMacroStats.value as THREE.Vector2).toArray()).toEqual([0.5, 20]);
    // no bake: the tint-neutral painted grass is recoloured for the 35% arm
    expect(shader.fragmentShader).toContain('uniform vec3 uGrassFallbackTint;');
    expect(shader.uniforms.uGrassFallbackTint).toBeDefined();
  });

  it('derives the height relief at the top level of main, after the detail normals', async () => {
    // Screen-space derivatives are undefined inside non-uniform control flow:
    // the relief block must sit in a bare block straight under main, never
    // inside the detail-normal gate or any other branch.
    const shader = await compileTerrainShader('ultra', { bake: true });
    const frag = shader.fragmentShader;
    const mainDepth = braceDepthAt(frag, frag.indexOf('vec2 tuv ='));
    const detailSum = frag.indexOf('normal = normalize(normal + tbn * vec3(detN, 0.0));');
    const bump = frag.indexOf('vec2 wocBumpD = vec2(dFdx(wocBumpH), dFdy(wocBumpH));');
    expect(detailSum).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(detailSum);
    expect(braceDepthAt(frag, detailSum)).toBe(mainDepth);
    expect(braceDepthAt(frag, bump)).toBe(mainDepth + 1);
    // the bare block opens right before it (no if / for)
    const open = frag.lastIndexOf('{', bump);
    expect(frag.slice(frag.lastIndexOf('\n', open), open).trim()).toBe('');
    // the cliff wall relief still layers on after it
    expect(frag.indexOf('WOC_NRM(vWPos.yz * 0.132, WOC_N_ROCK)')).toBeGreaterThan(bump);
    // the painted detail gains are the named knobs
    const T = PAINTED_GROUND_TUNING;
    expect(frag).toContain(`* wocNW.x * ${T.normalGainGrass.toFixed(4)}`);
    expect(frag).toContain(`* wocNW.y * ${T.normalGainDirt.toFixed(4)} * dirtDetail`);
    expect(frag).toContain(`* wocNW.z * ${T.normalGainRock.toFixed(4)} * (1.0 - wallW)`);
    // the composite relief height is written by the height blend
    expect(frag.indexOf('wocBumpH = dot(wb4,')).toBeGreaterThan(
      frag.indexOf('float bwin = max(win,'),
    );
  });

  it('an authored map keeps the Studio height blend and compiles no painted ground', async () => {
    const shader = await compileTerrainShader('insane', { authored: true, bake: true });
    expect(shader.fragmentShader).not.toContain('wocPaintedTap');
    expect(shader.fragmentShader).not.toContain('uCobbleTowns');
    expect(shader.fragmentShader).not.toContain('uCobbleLanes');
    expect(shader.fragmentShader).not.toContain('uCobbleLaneBox');
    expect(shader.fragmentShader).not.toContain('wocBumpNormal');
    expect(shader.fragmentShader).toContain('* wocNW.x * 0.85');
    expect(shader.fragmentShader).toContain('wocHW = sum > 1e-5 ? b / sum : vSplatR;');
    // the authored bake arm keeps the photo-era carpet ring
    expect(shader.fragmentShader).toContain('wocPlainGrain');
    expect(shader.uniforms.uCobbleTowns).toBeUndefined();
    expect(shader.uniforms.uCobbleLanes).toBeUndefined();
    expect(shader.uniforms.uCobbleLaneBox).toBeUndefined();
    vi.unstubAllGlobals();
    const data = await import('../src/sim/data');
    data.setActiveWorldContent(null);
  });

  it('?tpainted=off is the A/B switch back to the plain built-in composite', async () => {
    const shader = await compileTerrainShader('medium&tpainted=off');
    expect(shader.fragmentShader).not.toContain('wocPaintedTap');
    expect(shader.fragmentShader).toContain(
      'vec4 wocHW = vSplatR;\n' +
        '        vec3 alb = grassAlb * wocHW.x\n' +
        '                 + dirtAlb * wocHW.y\n' +
        '                 + rockAlb * wocHW.z\n' +
        '                 + sandAlb * wocHW.w;',
    );
  });
});

// The Lambert terrain (Terrain Detail Low on the Advanced mix, or any tier
// above low with the splat assets missing) runs under the standard-materials
// light rig, whose shadow fill is the IBL environment MeshLambertMaterial
// never samples. Without the fill boost every slope facing away from a low
// sun went solid black and the whole ground blacked out at dusk.
describe('lambert terrain fill under the standard-materials rig', () => {
  async function compileLambert(overrides: {
    standardMaterials: boolean;
    composer: boolean;
    gradePass: boolean;
  }): Promise<{
    shader: FakeShader;
    boost: number;
    shared: THREE.IUniform;
    sharedDayNight: THREE.IUniform;
    uniform: THREE.IUniform;
  }> {
    vi.resetModules();
    vi.stubGlobal('location', { search: '?gfx=high' });
    const { gfxInternalsForTest } = await import('../src/render/gfx');
    const restore = gfxInternalsForTest.overrideSettings(overrides);
    try {
      const { terrainInternalsForTest } = await import('../src/render/terrain');
      const shader: FakeShader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.lambert.vertexShader,
        fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
      };
      terrainInternalsForTest
        .createLambertMaterial()
        .onBeforeCompile(
          shader as unknown as THREE.WebGLProgramParametersWithUniforms,
          null as unknown as THREE.WebGLRenderer,
        );
      return {
        shader,
        boost: shader.uniforms.uWocFillBoost.value as number,
        shared: gfxInternalsForTest.sharedUniforms().uTerrainFillBoost,
        sharedDayNight: gfxInternalsForTest.sharedUniforms().uDayNight,
        uniform: shader.uniforms.uWocFillBoost,
      };
    } finally {
      restore();
    }
  }

  it('scales the hemisphere irradiance, not the sun, and only after the lights are summed', async () => {
    const { shader } = await compileLambert({
      standardMaterials: true,
      composer: false,
      gradePass: true,
    });
    const begin = shader.fragmentShader.indexOf('#include <lights_fragment_begin>');
    const boost = shader.fragmentShader.indexOf('irradiance *= uWocFillBoost;');
    const end = shader.fragmentShader.indexOf('#include <lights_fragment_end>');
    expect(begin).toBeGreaterThan(-1);
    expect(boost).toBeGreaterThan(begin);
    expect(end).toBeGreaterThan(boost);
    expect(shader.fragmentShader).toContain('uniform float uWocFillBoost;');
    // irradiance only exists inside that chunk's RE_IndirectDiffuse block: a
    // three upgrade that moves the guard must degrade to a no-op, never a
    // compile failure (blank terrain).
    expect(shader.fragmentShader).toContain(
      `#if defined( RE_IndirectDiffuse )
        irradiance *= uWocFillBoost;
        #endif`,
    );
  });

  it('binds the SHARED renderer-eased uniform, not a build-time constant', async () => {
    // The renderer eases sharedUniforms.uTerrainFillBoost every frame (1 under
    // an interior rig, the rig ratio outdoors); the material must alias that
    // object so the easing reaches the shader without a per-frame lookup.
    const built = await compileLambert({
      standardMaterials: true,
      composer: false,
      gradePass: true,
    });
    expect(built.uniform).toBe(built.shared);
    expect(built.boost).toBe(1);
  });

  it('routes low-tier road and beach masks via vWocLowMask and restricts seabed tint below the waterline', async () => {
    const { shader, sharedDayNight } = await compileLambert({
      standardMaterials: false,
      composer: false,
      gradePass: false,
    });
    expect(shader.uniforms.uWocDayNight).toBe(sharedDayNight);
    expect(shader.vertexShader).toContain('varying vec2 vWocLowMask;');
    expect(shader.fragmentShader).toContain('diffuseColor *= texture2D( map, wocDetailUv );');
    expect(shader.fragmentShader).toContain('float wocRoadRaw = clamp(vWocLowMask.x, 0.0, 1.0);');
    expect(shader.fragmentShader).toContain('float wocSandRaw = clamp(vWocLowMask.y, 0.0, 1.0);');
    expect(shader.fragmentShader).toContain('float wocSubW = smoothstep(-0.06, -1.65, wocRelY);');
    expect(shader.fragmentShader).not.toContain('wocSurfFoam');
  });
});
