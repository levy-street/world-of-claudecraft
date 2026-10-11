// The merged WOC head's FRAGMENT UNIFORM budget, counted off the shader text. One merged
// head program carries a row of uniforms per slot of its tables on top of everything
// three declares for a lit material, and WebGL2 guarantees a fragment shader no more than
// 224 uniform vectors (MAX_FRAGMENT_UNIFORM_VECTORS), which is all some phones offer. The
// runtime never asks a driver what a program holds (no program or uniform query in a live
// frame), so the budget is held here, statically:
//   - the layer's own share is derived from its real declarations (the text
//     attachWocHeadMergedTint hands three), a row per slot per table;
//   - three's share is counted off its own fragment source for the material a merged head
//     wraps (a plain standard material; the low tier's Lambert rebuild), with the prefix
//     uniforms WebGLProgram puts in front of it and the layers the tier derivation and the
//     hit response add, under every define the world scene switches on for it and the
//     engine's light census: one sun (casting), one hemisphere, and the point-light
//     carriers at their largest count (the light budget plus the pulse pool);
//   - the sum stays under the guaranteed 224 with room to spare, by the count no
//     implementation can exceed (every element of every uniform in a vector of its own).
// The count is of DECLARED uniforms, so it sits a little above what a driver keeps active:
// tests/browser/woc_merged_head_uniforms.browser.test.ts reads the same budget off the
// program a real context links.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { attachGloamClimb } from '../src/render/characters/gloam_climb';
import {
  createSurfaceResponseMaterial,
  surfaceResponseUniforms,
} from '../src/render/characters/surface_response';
import {
  WOC_HEAD_MERGE_MAX_SLOTS,
  WOC_HEAD_MERGE_ROLES,
} from '../src/render/characters/woc_head_merge_core';
import { attachWocHeadMergedTint } from '../src/render/characters/woc_head_tint';
import {
  activateGfxProfile,
  addRimGlow,
  GFX,
  getActiveGfxProfile,
  gfxInternalsForTest,
} from '../src/render/gfx';
import { lightPulsePoolSize } from '../src/render/light_pulses';
import {
  type GlslUniform,
  type GlslUniforms,
  liveGlslUniforms,
  packedUniformVectors,
  samplerImageUnits,
  uniformsPackInto,
  uniformVectorRows,
} from './helpers/glsl_uniform_budget';

/** What WebGL2 guarantees of MAX_FRAGMENT_UNIFORM_VECTORS, and the room kept under it for
 *  a layer added later (the real-browser suite keeps the same). */
const GUARANTEED_FRAGMENT_UNIFORM_VECTORS = 224;
const HEADROOM = 32;

const LIBS = ['standard', 'lambert'] as const;
type Lib = (typeof LIBS)[number];
const TIERS = ['low', 'medium', 'high', 'ultra', 'insane'] as const;

const profileAtLoad = getActiveGfxProfile();
afterAll(() => {
  activateGfxProfile(profileAtLoad);
});

/** The point-light carriers of a tier: the fixed count of point lights every lit program
 *  of the world scene is compiled for (renderer.ts attachPointLightCarriers). */
function carriersOf(tier: (typeof TIERS)[number]): number {
  activateGfxProfile({
    ...profileAtLoad,
    settings: gfxInternalsForTest.settingsFor(tier, { search: `?gfx=${tier}` }),
  });
  return GFX.maxPointLights + lightPulsePoolSize();
}

/** A shader with every `#include <name>` resolved the way three resolves them
 *  (WebGLProgram: recursively, out of ShaderChunk). */
function resolved(text: string): string {
  return text.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_match, name: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string | undefined>)[name];
    if (chunk === undefined) throw new Error(`three ships no chunk <${name}>`);
    return resolved(chunk);
  });
}

/** The uniforms WebGLProgram declares ahead of every fragment shader (its prefix), with
 *  tone mapping on, as it is for a draw to the canvas. */
const FRAGMENT_PREFIX = [
  'uniform mat4 viewMatrix;',
  'uniform vec3 cameraPosition;',
  'uniform bool isOrthographic;',
  THREE.ShaderChunk.tonemapping_pars_fragment,
].join('\n');

/**
 * Every define the world scene can switch on for a merged head's material, with the light
 * census at `carriers` point lights: a colour map and (where the tier makes the emissive
 * map the colour map) an emissive map, the prefiltered sky as environment, linear fog,
 * the sun's shadow, tone mapping, the two sided draw. The material's OWN defines are read
 * off it (the shader class, the merged layer's one sided variant, whatever a layer added
 * later gates itself with), never typed here.
 */
const worldDefines = (
  material: THREE.Material,
  carriers: number,
): Record<string, string | number> => ({
  ...(material.defines as Record<string, string | number> | undefined),
  USE_MAP: '',
  USE_EMISSIVEMAP: '',
  USE_UV: '',
  USE_ENVMAP: '',
  ENVMAP_TYPE_CUBE_UV: '',
  ENVMAP_MODE_REFLECTION: '',
  ENVMAP_BLENDING_NONE: '',
  USE_FOG: '',
  USE_SHADOWMAP: '',
  SHADOWMAP_TYPE_PCF: '',
  TONE_MAPPING: '',
  DOUBLE_SIDED: '',
  NUM_DIR_LIGHTS: 1,
  NUM_HEMI_LIGHTS: 1,
  NUM_POINT_LIGHTS: carriers,
  NUM_SPOT_LIGHTS: 0,
  NUM_RECT_AREA_LIGHTS: 0,
  NUM_DIR_LIGHT_SHADOWS: 1,
  NUM_POINT_LIGHT_SHADOWS: 0,
  NUM_SPOT_LIGHT_SHADOWS: 0,
  NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS: 0,
  NUM_SPOT_LIGHT_MAPS: 0,
  NUM_SPOT_LIGHT_COORDS: 0,
  NUM_CLIPPING_PLANES: 0,
  UNION_CLIPPING_PLANES: 0,
});

/**
 * The fragment uniforms of a merged head's program as three assembles it: the material a
 * merged head wraps, the layers it wears in the world (the standard tiers' rim, the
 * dormant Gloamveil climb, the merged tint, and with `struck` the hit response over it), run over three's own source
 * for that shader, includes resolved, the prefix in front.
 */
function mergedHeadUniforms(lib: Lib, carriers: number, struck: boolean): GlslUniforms {
  const base =
    lib === 'standard' ? new THREE.MeshStandardMaterial() : new THREE.MeshLambertMaterial();
  // the tier derivation's own layers (assets.ts): the rim on a standard material, a no-op
  // on Lambert, and the dormant Gloamveil climb on both
  addRimGlow(base);
  attachGloamClimb(base);
  attachWocHeadMergedTint(base, true);
  const worn = struck ? createSurfaceResponseMaterial(base, surfaceResponseUniforms()) : base;
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib[lib].vertexShader,
    fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  };
  worn.onBeforeCompile(shader as never, {} as never);
  return liveGlslUniforms(
    `${FRAGMENT_PREFIX}\n${resolved(shader.fragmentShader)}`,
    worldDefines(worn, carriers),
  );
}

/** A uniform as a line of a list: its type, its name, its array size. */
const line = (u: GlslUniform): string => `${u.type} ${u.name}${u.count > 1 ? `[${u.count}]` : ''}`;

/** What three and the tier's own layers declare for a merged head's material in the world
 *  scene, by name (the carriers stand as N): everything the count holds that is not the
 *  merged layer's or the hit response's. Literal: a three that adds a uniform to a lit
 *  fragment, a layer that grows one, or a define typed wrong above shows here by name. */
const THREE_SIDE: Readonly<Record<Lib, readonly string[]>> = {
  standard: [
    'mat4 viewMatrix',
    'vec3 cameraPosition',
    'bool isOrthographic',
    'float toneMappingExposure',
    'vec3 diffuse',
    'vec3 emissive',
    'float roughness',
    'float metalness',
    'float opacity',
    'vec4 uGloamBody',
    'vec2 uGloamState',
    'float uRimBoost',
    'vec3 uRimColor',
    'float envMapIntensity',
    'mat3 envMapRotation',
    'vec3 fogColor',
    'float fogNear',
    'float fogFar',
    'bool receiveShadow',
    'vec3 ambientLightColor',
    'vec3 directionalLights.direction',
    'vec3 directionalLights.color',
    'vec3 pointLights.position[N]',
    'vec3 pointLights.color[N]',
    'float pointLights.distance[N]',
    'float pointLights.decay[N]',
    'vec3 hemisphereLights.direction',
    'vec3 hemisphereLights.skyColor',
    'vec3 hemisphereLights.groundColor',
    'float directionalLightShadows.shadowIntensity',
    'float directionalLightShadows.shadowBias',
    'float directionalLightShadows.shadowNormalBias',
    'float directionalLightShadows.shadowRadius',
    'vec2 directionalLightShadows.shadowMapSize',
  ],
  lambert: [
    'mat4 viewMatrix',
    'vec3 cameraPosition',
    'bool isOrthographic',
    'float toneMappingExposure',
    'vec3 diffuse',
    'vec3 emissive',
    'float opacity',
    'vec4 uGloamBody',
    'vec2 uGloamState',
    'float envMapIntensity',
    'mat3 envMapRotation',
    'float reflectivity',
    'float refractionRatio',
    'vec3 fogColor',
    'float fogNear',
    'float fogFar',
    'bool receiveShadow',
    'vec3 ambientLightColor',
    'vec3 directionalLights.direction',
    'vec3 directionalLights.color',
    'vec3 pointLights.position[N]',
    'vec3 pointLights.color[N]',
    'float pointLights.distance[N]',
    'float pointLights.decay[N]',
    'vec3 hemisphereLights.direction',
    'vec3 hemisphereLights.skyColor',
    'vec3 hemisphereLights.groundColor',
    'float directionalLightShadows.shadowIntensity',
    'float directionalLightShadows.shadowBias',
    'float directionalLightShadows.shadowNormalBias',
    'float directionalLightShadows.shadowRadius',
    'vec2 directionalLightShadows.shadowMapSize',
  ],
};

/** ...and its samplers (the merged layer's three ride beside them). */
const THREE_SAMPLERS: Readonly<Record<Lib, readonly string[]>> = {
  standard: [
    'sampler2D map',
    'sampler2D emissiveMap',
    'sampler2D envMap',
    'sampler2D dfgLUT',
    'sampler2DShadow directionalShadowMap',
  ],
  lambert: [
    'sampler2D map',
    'sampler2D emissiveMap',
    'sampler2D envMap',
    'sampler2DShadow directionalShadowMap',
  ],
};

const named = (uniforms: readonly GlslUniform[], pattern: RegExp): GlslUniform[] =>
  uniforms.filter((u) => pattern.test(u.name));

describe('the merged head program under the guaranteed fragment uniform vectors', () => {
  const carriers = Math.max(...TIERS.map(carriersOf));

  it('counts the point lights at the engine largest carrier count: six lights and four pulses', () => {
    // literal: the light budget of a desktop tier plus the pulse pool of a composer tier
    // (one pulse without the composer). The review that asked for this pin assumed two to
    // six carriers; ten is what a program holds from the high tier up.
    expect(carriers).toBe(10);
    expect(TIERS.map(carriersOf)).toEqual([7, 7, 10, 10, 10]);
  });

  it("derives the layer's own share from its declarations: a row a slot a table", () => {
    const { uniforms, samplers } = mergedHeadUniforms('standard', carriers, false);
    const own = named(uniforms, /^uWocHm/);
    expect(own).toEqual([
      { name: 'uWocHmTint', type: 'vec3', count: WOC_HEAD_MERGE_ROLES.length },
      { name: 'uWocHmMix', type: 'float', count: 1 },
      { name: 'uWocHmRef', type: 'vec4', count: WOC_HEAD_MERGE_MAX_SLOTS },
      { name: 'uWocHmCol', type: 'vec4', count: WOC_HEAD_MERGE_MAX_SLOTS },
      { name: 'uWocHmEmi', type: 'vec4', count: WOC_HEAD_MERGE_MAX_SLOTS },
      { name: 'uWocHmSurf', type: 'vec4', count: WOC_HEAD_MERGE_MAX_SLOTS },
      { name: 'uWocHmEyeHsv', type: 'vec3', count: 1 },
    ]);
    // four tables of a row a slot, the role colours, the strength and the eye's HSV
    expect(uniformVectorRows(own)).toBe(
      4 * WOC_HEAD_MERGE_MAX_SLOTS + WOC_HEAD_MERGE_ROLES.length + 1 + 1,
    );
    // literal: 78 of the 224, of which the slot count is 72
    expect(uniformVectorRows(own)).toBe(78);
    expect(WOC_HEAD_MERGE_MAX_SLOTS).toBe(18);
    // its three textures beside the atlas, which rides three's own `map`
    expect(named(samplers, /^uWocHm/).map((s) => s.name)).toEqual([
      'uWocHmHair',
      'uWocHmBeard',
      'uWocHmScalp',
    ]);
  });

  it.each(LIBS)(
    'holds the whole %s program under the limit with room to spare, struck or not',
    (lib) => {
      const plain = mergedHeadUniforms(lib, carriers, false);
      const struck = mergedHeadUniforms(lib, carriers, true);
      const own = uniformVectorRows(named(plain.uniforms, /^uWocHm/));
      const three = uniformVectorRows(plain.uniforms) - own;
      // by name: what stands behind that count, in the world scene's lit state (the rim
      // on the standard shader, the environment, the fog, the sun and its shadow, the
      // hemisphere, every carrier)
      expect(
        plain.uniforms
          .filter((u) => !u.name.startsWith('uWocHm'))
          .map(line)
          .map((text) => text.replace(`[${carriers}]`, '[N]')),
      ).toEqual(THREE_SIDE[lib]);
      expect(plain.samplers.filter((u) => !u.name.startsWith('uWocHm')).map(line)).toEqual(
        THREE_SAMPLERS[lib],
      );
      // literal: what three and the tier's own layers declare for this material in the world
      // scene (the lights are 46 of it on either shader: 4 a carrier, 2 the sun, 3 the
      // hemisphere, 1 the ambient; the dormant Gloamveil climb is 2 of it on both)
      expect(three).toBe(lib === 'standard' ? 75 : 73);
      expect(uniformVectorRows(named(plain.uniforms, /Lights?\b|ambientLightColor/))).toBe(
        4 * carriers + 2 + 3 + 1,
      );
      // the hit response adds its own seven and nothing else
      const response = named(struck.uniforms, /^uSurface/);
      expect(uniformVectorRows(response)).toBe(7);
      expect(uniformVectorRows(struck.uniforms)).toBe(own + three + 7);
      expect(named(plain.uniforms, /^uSurface/)).toEqual([]);
      for (const { uniforms, samplers } of [plain, struck]) {
        const rows = uniformVectorRows(uniforms);
        // every element a vector of its own: no implementation needs more
        expect(rows).toBeLessThanOrEqual(GUARANTEED_FRAGMENT_UNIFORM_VECTORS - HEADROOM);
        // as an implementation at exactly the guaranteed limit checks a WebGL shader
        expect(uniformsPackInto(GUARANTEED_FRAGMENT_UNIFORM_VECTORS, uniforms, samplers)).toBe(
          true,
        );
        expect(packedUniformVectors(uniforms, samplers)).toBeLessThan(rows);
        // the samplers have a guaranteed limit of their own (16 image units)
        expect(samplerImageUnits(samplers)).toBe(THREE_SAMPLERS[lib].length + 3);
        expect(samplerImageUnits(samplers)).toBeLessThanOrEqual(16 - 4);
      }
      // literal: the largest program a merged head ever links on this shader (the real
      // browser suite reads a few fewer off the linked standard program: a driver drops what
      // a layer declares and leaves unread, the roughness and the metalness here; the camera
      // position is read, by the Gloamveil climb every rig material carries)
      expect(uniformVectorRows(struck.uniforms)).toBe(lib === 'standard' ? 160 : 158);
    },
  );

  it('prices a slot and a carrier at four vectors each: what the room left would take', () => {
    // arithmetic on the count above (the slot count is a constant: no program is rebuilt
    // at another): four tables a slot, so the 64 vectors left under the limit are sixteen
    // more slots and no more, or sixteen more carriers
    const { uniforms } = mergedHeadUniforms('standard', carriers, true);
    const rows = uniformVectorRows(uniforms);
    const left = GUARANTEED_FRAGMENT_UNIFORM_VECTORS - rows;
    expect(left).toBe(64);
    expect(Math.floor(left / 4)).toBe(16);
    // ...and a carrier really costs four of it: the same program under four fewer
    const fewer = mergedHeadUniforms('standard', carriers - 4, true);
    expect(rows - uniformVectorRows(fewer.uniforms)).toBe(16);
  });

  it("three's fragment prefix declares the three uniforms counted here (source pin)", () => {
    // WebGLProgram writes them ahead of every fragment shader; a three that adds one
    // there has to be counted in FRAGMENT_PREFIX
    const source = readFileSync(
      new URL('../node_modules/three/src/renderers/webgl/WebGLProgram.js', import.meta.url),
      'utf8',
    );
    // (the first `prefixFragment` is a raw shader material's, the last the GLSL 3 shim)
    const first = source.indexOf('prefixFragment = [');
    const prefix = source.slice(source.indexOf('prefixFragment = [', first + 1));
    const fragment = prefix.slice(0, prefix.indexOf('].filter( filterEmptyLine )'));
    expect(fragment).toContain("parameters.map ? '#define USE_MAP' : ''");
    expect(fragment.match(/'uniform [^']*'/g)).toEqual([
      "'uniform mat4 viewMatrix;'",
      "'uniform vec3 cameraPosition;'",
      "'uniform bool isOrthographic;'",
    ]);
    expect(fragment).toContain("ShaderChunk[ 'tonemapping_pars_fragment' ]");
    expect(THREE.ShaderChunk.tonemapping_pars_fragment).toContain(
      'uniform float toneMappingExposure;',
    );
    expect(
      liveGlslUniforms(FRAGMENT_PREFIX, { TONE_MAPPING: '' }).uniforms.map((u) => u.name),
    ).toEqual(['viewMatrix', 'cameraPosition', 'isOrthographic', 'toneMappingExposure']);
  });
});
