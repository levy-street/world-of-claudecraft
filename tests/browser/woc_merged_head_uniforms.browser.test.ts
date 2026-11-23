// Real-WebGL count of the merged WOC head program's uniforms. The Node suite counts the
// fragment uniform vectors of a shader it assembles from three's chunks
// (tests/woc_head_uniform_budget.test.ts); only a real driver can say what the program
// three really links for a merged head holds, with every layer the tier derivation and the
// effects put on its material and under the lights, shadow, fog and environment the world
// scene gives every lit program. This suite builds real WOC bodies from the shipped
// files, lets their merged heads mount, draws them, finds the linked merged programs and
// reads their ACTIVE uniforms off the context (getProgramParameter(ACTIVE_UNIFORMS),
// getActiveUniform), for both merged variants (a head with a one sided slot, Type A, and
// an all two sided one, Type B) on the standard shader and on the low tier's Lambert, at
// the engine's largest point-light carrier count, and once more under a hit response (the
// one effect that adds uniforms to a head that stays merged).
//
// Which uniforms are the FRAGMENT stage's: WebGL2 has no per-stage query, so an active
// uniform counts for the fragment stage when the fragment shader's own source declares
// it, under the defines that source carries (three hands the driver the text with its
// `#define` prefix). A uniform both stages declare but only the vertex stage uses is
// counted too: the count errs high. Every element of every uniform takes a whole vector
// here (a float as much as a vec4), which no implementation can exceed.
//
// A test-side read only: nothing under src/ queries a program or a uniform.
import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as assets from '../../src/render/characters/assets';
import { createCharacterVisual } from '../../src/render/characters/index';
import type { CharacterVisual } from '../../src/render/characters/visual';
import * as dressing from '../../src/render/characters/woc_armor_dressing';
import { WOC_HEAD_MERGE_MAX_SLOTS } from '../../src/render/characters/woc_head_merge_core';
import * as heads from '../../src/render/characters/woc_head_packs';
import {
  activateGfxProfile,
  GFX,
  type GfxTier,
  getActiveGfxProfile,
  gfxInternalsForTest,
} from '../../src/render/gfx';
import { lightPulsePoolSize } from '../../src/render/light_pulses';
import { installPbrPointLightShaderPruning } from '../../src/render/pbr_fragment_shader';
import { attachPointLightCarriers, NO_POINT_LIGHTS } from '../../src/render/point_light_carriers';
import type { Entity } from '../../src/sim/types';
import {
  activeGlslUniforms,
  type GlslUniform,
  liveGlslUniforms,
  packedUniformVectors,
  samplerImageUnits,
  uniformBaseName,
  uniformsPackInto,
  uniformVectorRows,
} from '../helpers/glsl_uniform_budget';
import { landWocFiles } from '../helpers/woc_streamed';

/** What WebGL2 guarantees of MAX_FRAGMENT_UNIFORM_VECTORS, and the room this suite keeps
 *  under it for a layer added later. */
const GUARANTEED_FRAGMENT_UNIFORM_VECTORS = 224;
const HEADROOM = 32;

const IDLE = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
} as never;

interface LinkedProgram {
  cacheKey: string;
  program: WebGLProgram;
  fragmentShader: WebGLShader;
}

let renderer: THREE.WebGLRenderer;
let shaderErrors: string[] = [];

beforeAll(async () => {
  // the world renderer's own chunk patch (initGfxTier): the point lights as one loop
  installPbrPointLightShaderPruning();
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    shaderErrors.push(
      `${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertexShader)} ${gl.getShaderInfoLog(fragmentShader)}`,
    );
  };
  await assets.charactersReady();
  await landWocFiles(assets, dressing, heads, ['player_warrior', 'player_warrior_female']);
}, 120_000);

afterAll(() => {
  renderer.dispose();
  renderer.forceContextLoss();
});

/** A world player of the warrior class on the male (Type A head) or female (Type B) body. */
const player = (female: boolean): Entity =>
  ({
    kind: 'player',
    id: female ? 8 : 7,
    templateId: 'warrior',
    color: 0xffffff,
    skin: 0,
    mainhandItemId: null,
    offhandItemId: null,
    auras: [],
    modularAppearance: female ? { gender: 'female' } : {},
  }) as unknown as Entity;

/** The lit state every program of the world scene is compiled under (renderer.ts): the
 *  one sun, casting, the one hemisphere fill, linear fog, a prefiltered environment, and
 *  the point-light carriers at the tier's count (the budget plus the pulse pool). */
function worldScene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; carriers: number } {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x8899aa, 40, 400);
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x332211, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(2, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(256, 256);
  scene.add(sun);
  const carriers = GFX.maxPointLights + lightPulsePoolSize();
  attachPointLightCarriers(scene, carriers, [() => NO_POINT_LIGHTS]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.Scene()).texture;
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 1.6, 4);
  camera.lookAt(0, 1.4, 0);
  return { scene, camera, carriers };
}

/** A world body whose merged head stands: built by the world's factory, behind a gate
 *  that settles at once (nothing here needs a link held back), updated until the head is
 *  one mesh. */
function mergedBody(female: boolean): { visual: CharacterVisual; head: THREE.Mesh } {
  const visual = createCharacterVisual(player(female));
  if (!visual) throw new Error('the WOC body did not build (its files are not resident)');
  visual.setFarBakeGate((_target, settle) => settle());
  let head: THREE.Mesh | null = null;
  for (let frame = 0; frame < 20 && !head; frame++) {
    visual.update(0.016, IDLE, true);
    visual.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && o.userData.wocHeadMerged && o.parent?.visible) head = mesh;
    });
  }
  if (!head) throw new Error('the merged head never mounted');
  return { visual, head };
}

function useTier(tier: GfxTier): void {
  activateGfxProfile({
    ...getActiveGfxProfile(),
    settings: gfxInternalsForTest.settingsFor(tier, { search: `?gfx=${tier}` }),
  });
  assets.resetCharacterProfileCaches();
}

/** The merged head programs the renderer has linked, by the layer's program key. */
const mergedPrograms = (): LinkedProgram[] =>
  ((renderer.info.programs ?? []) as unknown as LinkedProgram[]).filter((program) =>
    program.cacheKey.includes('woc_head_tint|merged'),
  );

interface Counted {
  /** The fragment stage's active uniforms and samplers. */
  uniforms: GlslUniform[];
  samplers: GlslUniform[];
  /** Every element in a vector of its own. */
  rows: number;
  /** The same count of what the fragment source DECLARES (active or not), and the
   *  declared names the driver left out as unread. */
  declaredRows: number;
  inactive: string[];
  /** As the appendix packs them (samplers a component each). */
  packed: number;
  oneSided: boolean;
  source: string;
}

function count(program: LinkedProgram): Counted {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  expect(gl.getProgramParameter(program.program, gl.LINK_STATUS)).toBe(true);
  const source = gl.getShaderSource(program.fragmentShader) ?? '';
  const declared = liveGlslUniforms(source);
  const names = new Set(
    [...declared.uniforms, ...declared.samplers].map((u) => uniformBaseName(u.name)),
  );
  const active = activeGlslUniforms(gl, program.program);
  const mine = (u: GlslUniform): boolean => names.has(uniformBaseName(u.name));
  const uniforms = active.uniforms.filter(mine);
  const samplers = active.samplers.filter(mine);
  const live = new Set(uniforms.map((u) => uniformBaseName(u.name)));
  return {
    uniforms,
    samplers,
    rows: uniformVectorRows(uniforms),
    declaredRows: uniformVectorRows(declared.uniforms),
    inactive: [...new Set(declared.uniforms.map((u) => uniformBaseName(u.name)))].filter(
      (name) => !live.has(name),
    ),
    packed: packedUniformVectors(uniforms, samplers),
    oneSided: /^#define WOC_HM_ONE_SIDED\b/m.test(source),
    source,
  };
}

/** One line a counted program for the run's log: the evidence a reader of a CI run has. */
const summary = (c: Counted): string =>
  `oneSided=${c.oneSided} struck=${c.uniforms.some((u) => u.name === 'uSurfaceKind')} ` +
  `vectors=${c.rows} (declared ${c.declaredRows}, unread: ${c.inactive.join(' ') || 'none'}) ` +
  `packed=${c.packed} samplers=${samplerImageUnits(c.samplers)}`;

describe.each([
  { tier: 'high' as const, shader: 'MeshStandardMaterial' },
  { tier: 'low' as const, shader: 'MeshLambertMaterial' },
])('the merged WOC head program on the $tier tier ($shader)', ({ tier, shader }) => {
  it('links both variants and the struck one, each inside the guaranteed fragment uniform vectors with room to spare', () => {
    useTier(tier);
    shaderErrors = [];
    const known = new Set(mergedPrograms().map((p) => p.cacheKey));
    /** The merged programs linked since the last call. */
    const fresh = (): Counted[] => {
      const linked = mergedPrograms().filter((p) => !known.has(p.cacheKey));
      for (const p of linked) known.add(p.cacheKey);
      return linked.map(count);
    };
    const { scene, camera, carriers } = worldScene();
    // literal: the engine's largest carrier count is the high tier's, six lights and four pulses
    if (tier === 'high') expect(carriers).toBe(10);
    const bodies = [mergedBody(false), mergedBody(true)];
    for (const { visual, head } of bodies) {
      expect((head.material as THREE.Material).type).toBe(shader);
      scene.add(visual.root);
    }
    bodies[1].visual.root.position.x = 1;
    renderer.render(scene, camera);
    const plain = fresh();
    // one program a variant: the head with a one sided slot (Type A), the all two sided one (Type B)
    expect(plain.map((c) => c.oneSided).sort()).toEqual([false, true]);

    // a hit response: the one effect that adds uniforms to a head that stays merged
    const struck = bodies[0];
    struck.visual.respondToElement('fire', 0.75);
    for (let frame = 0; frame < 3; frame++) struck.visual.update(0.016, IDLE, true);
    expect((struck.head.material as THREE.Material).userData.wocSurfaceResponseProgram).toBe(true);
    expect(struck.head.parent?.visible).toBe(true);
    renderer.render(scene, camera);
    const hit = fresh();
    expect(hit).toHaveLength(1);
    expect(hit[0].uniforms.some((u) => u.name === 'uSurfaceKind')).toBe(true);
    expect(plain.some((c) => c.uniforms.some((u) => u.name === 'uSurfaceKind'))).toBe(false);

    expect(shaderErrors).toEqual([]);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    expect(gl.getError()).toBe(0);
    const counted = [...plain, ...hit];
    // which driver counted (a context's own limit is usually far above the guaranteed one,
    // so the bound below is the constant, never this context's answer)
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const driver = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unnamed';
    console.log(
      `[woc_merged_head_uniforms] ${tier}: ${carriers} point-light carriers, this context ` +
        `(${driver}) reports ` +
        `MAX_FRAGMENT_UNIFORM_VECTORS=${gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)}\n` +
        counted.map((c) => `  ${summary(c)}`).join('\n'),
    );
    for (const c of counted) {
      const what = summary(c);
      // the merged layer is whole in the program: its four tables at the slot count
      for (const table of ['uWocHmRef', 'uWocHmCol', 'uWocHmEmi', 'uWocHmSurf']) {
        expect(
          c.uniforms.find((u) => u.name === table),
          `${what}: ${table}`,
        ).toEqual({
          name: table,
          type: 'vec4',
          count: WOC_HEAD_MERGE_MAX_SLOTS,
        });
      }
      // ...under the point lights at the engine's carrier count
      expect(
        c.uniforms.filter((u) => /^pointLights\[\d+\]\.color$/.test(u.name)),
        what,
      ).toHaveLength(carriers);
      // every element a vector of its own: under the guaranteed limit with room to spare
      expect(c.rows, what).toBeLessThanOrEqual(GUARANTEED_FRAGMENT_UNIFORM_VECTORS - HEADROOM);
      // ...and the count is a whole one. Three's own uniforms are in it by name (the lit
      // state the world gives every program: the sun, the hemisphere, the fog, the tone
      // mapping exposure), so the fragment filter above dropped none of them;
      const names = new Set(c.uniforms.map((u) => u.name));
      for (const name of [
        'diffuse',
        'opacity',
        'fogColor',
        'toneMappingExposure',
        'ambientLightColor',
        'directionalLights[0].color',
        'hemisphereLights[0].skyColor',
        'directionalLightShadows[0].shadowBias',
        'uWocHmTint',
        'uWocHmMix',
        'uWocHmEyeHsv',
      ]) {
        expect(names.has(name), `${what}: ${name}`).toBe(true);
      }
      // it is no less than the merged layer's 78 and the lights (four a carrier, the sun's
      // two, the hemisphere's three, the ambient);
      expect(c.rows, what).toBeGreaterThanOrEqual(78 + 4 * carriers + 2 + 3 + 1);
      // and it is what the fragment source declares, less the few a driver finds unread
      // (the roughness and the metalness this layer leaves aside; the camera position is
      // read, by the Gloamveil climb every rig material carries)
      expect(c.declaredRows - c.rows, what).toBeGreaterThanOrEqual(0);
      expect(c.declaredRows - c.rows, what).toBeLessThanOrEqual(6);
      expect(c.declaredRows, what).toBeLessThanOrEqual(
        GUARANTEED_FRAGMENT_UNIFORM_VECTORS - HEADROOM,
      );
      // as a WebGL implementation at exactly the guaranteed limit checks it
      expect(c.packed, what).toBeLessThanOrEqual(c.rows);
      expect(
        uniformsPackInto(GUARANTEED_FRAGMENT_UNIFORM_VECTORS, c.uniforms, c.samplers),
        what,
      ).toBe(true);
      // the samplers have their own guaranteed limit (16 image units a fragment shader)
      expect(samplerImageUnits(c.samplers), what).toBeLessThanOrEqual(16 - 4);
    }
    // the one sided define and the struck layer cost what they say: nothing, and the response's own
    expect(plain[0].rows).toBe(plain[1].rows);
    expect(hit[0].rows - plain[0].rows).toBe(7);
    for (const { visual } of bodies) {
      scene.remove(visual.root);
      visual.dispose();
    }
  }, 120_000);
});
