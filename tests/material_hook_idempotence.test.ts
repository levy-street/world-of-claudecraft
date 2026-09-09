// The dry-compile contract (src/render/CLAUDE.md): the shader warm gate calls
// every live material's onBeforeCompile ONCE against a throwaway shader object
// to collect its GLSL, and three then calls the very same hook again with the
// real one at link time. So a hook that appends instead of replacing, that
// caches part of its work, or that keeps the shader object it was handed would
// ship a different program than the one the warm pass measured, or leak the
// throwaway. This suite pins the contract for the three shader families this
// change touched: the worn-surface layer (per-family scalars moved from GLSL
// literals onto uniforms), the prop kit converter (the haze hook now chained
// UNDER the worn hook) and the foliage impostor material (one collapsed key).
//
// Node-only: nothing here needs a GL context, because a hook is a pure string
// and uniform edit on the object three hands it.

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BiomeHazePreset } from '../src/render/biome_haze_field_core';
import { ZONES } from '../src/sim/data';
import type { BiomeId } from '../src/sim/types';

interface FakeShader {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
}

// Every builder under test produces a MeshStandardMaterial, which three
// compiles from the meshphysical program (ShaderLib.standard and .physical
// carry the same source), so this is the real base each hook patches.
function freshShader(): FakeShader {
  return {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
}

function runHook(material: THREE.Material, shader: FakeShader): void {
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
}

function hazePresets(): Record<BiomeId, BiomeHazePreset> {
  const table = {} as Record<BiomeId, BiomeHazePreset>;
  for (const zone of ZONES) table[zone.biome] = { color: 0x8899aa, far: 400 };
  for (const extra of ['beach', 'desert', 'volcano', 'cave'] as BiomeId[]) {
    table[extra] ??= { color: 0x8899aa, far: 400 };
  }
  return table;
}

// The worn layer resolves its textures asynchronously and gates the whole
// splice on them, so without the loader stub and the awaited preloads every
// hook here would compile to a pass-through and the suite would pin nothing.
// Same recipe as tests/worn_stone_shader.test.ts, widened to the loader
// exports props.ts pulls at module scope.
async function loadRenderModules(preset: string) {
  const pending: Promise<unknown>[] = [];
  vi.resetModules();
  vi.stubGlobal('location', { search: `?gfx=${preset}` });
  vi.doMock('../src/render/assets/loader', () => ({
    loadTexture: () => Promise.resolve(new THREE.Texture()),
    loadKtx2Texture: () => Promise.resolve(new THREE.Texture()),
    loadGltf: () => Promise.reject(new Error('no prop GLB in the node test env')),
    releaseGltf: () => {},
    releaseTexture: () => {},
    releaseKtx2Texture: () => {},
  }));
  vi.doMock('../src/render/assets/preload', () => ({
    registerPreload: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
    registerDeferredPreload: (start: () => Promise<unknown>) => {
      pending.push(Promise.resolve(start()).catch(() => undefined));
    },
  }));

  const worn = await import('../src/render/worn_stone');
  const props = await import('../src/render/props');
  const impostor = await import('../src/render/foliage_impostor');
  const haze = await import('../src/render/biome_haze_field');
  await Promise.all(pending);
  // The haze hook reads hasBiomeHazeField() at compile time and in its cache
  // key, so the field has to exist before any hook runs or the chained cases
  // would compile the field-less arm.
  haze.ensureBiomeHazeField(hazePresets());
  expect(haze.hasBiomeHazeField()).toBe(true);
  return {
    applySurfaceDetail: worn.applySurfaceDetail,
    convertMaterial: props.propMaterialInternalsForTest.convertMaterial,
    impostorMaterial: impostor.foliageImpostorInternalsForTest.impostorMaterial,
  };
}

type RenderModules = Awaited<ReturnType<typeof loadRenderModules>>;

const isTexture = (v: unknown): boolean =>
  (v as { isTexture?: boolean } | null)?.isTexture === true;

/**
 * Same uniform names, same values. `textureIdentity` is off when the two
 * shaders come from separately loaded module graphs (the twin case): each
 * graph resolves its own texture objects, so there identity would compare
 * module instances rather than hook behavior.
 */
function expectSameUniforms(
  actual: FakeShader,
  expected: FakeShader,
  opts: { textureIdentity: boolean },
): void {
  const names = Object.keys(expected.uniforms).sort();
  expect(Object.keys(actual.uniforms).sort()).toEqual(names);
  for (const name of names) {
    const want = expected.uniforms[name].value;
    const got = actual.uniforms[name].value;
    if (isTexture(want) || isTexture(got)) {
      if (opts.textureIdentity) expect(got, `uniform ${name}`).toBe(want);
      else expect(isTexture(got), `uniform ${name}`).toBe(isTexture(want));
    } else {
      expect(got, `uniform ${name}`).toEqual(want);
    }
  }
}

/** Every object the material itself can reach, down `depth` levels of own
 *  enumerable properties (userData and its spec records included). */
function reachableObjects(root: object, depth: number): Set<object> {
  const seen = new Set<object>();
  const visit = (value: unknown, level: number): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (level >= depth) return;
    for (const child of Object.values(value)) visit(child, level + 1);
  };
  visit(root, 0);
  return seen;
}

interface FamilyCase {
  name: string;
  build: (m: RenderModules) => THREE.Material;
  /** Uniforms the hook must install: the non-vacuity floor, and for the two
   *  prop cases the routing premise (worn layer or not) each one rests on. */
  requires: readonly string[];
  forbids?: readonly string[];
}

const kitSource = (name: string): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ name, color: 0xffffff });

const FAMILIES: readonly FamilyCase[] = [
  {
    name: 'worn_stone: stone, world projection',
    build: (m) => {
      const mat = new THREE.MeshStandardMaterial();
      m.applySurfaceDetail(mat, 'stone');
      return mat;
    },
    requires: ['uWornNormal', 'uWornRoughMean', 'uWornAoMean', 'uWornDisp', 'uWornParallaxAmp'],
  },
  {
    name: 'worn_stone: metal',
    build: (m) => {
      const mat = new THREE.MeshStandardMaterial();
      m.applySurfaceDetail(mat, 'metal');
      return mat;
    },
    requires: ['uWornMetalMean', 'uWornMetalMix', 'uWornRoughMean'],
    forbids: ['uWornAoMean'],
  },
  {
    name: 'worn_stone: stone, objectSpace',
    build: (m) => {
      const mat = new THREE.MeshStandardMaterial();
      m.applySurfaceDetail(mat, 'stone', { strength: 0.2, objectSpace: true });
      return mat;
    },
    requires: ['uWornNormal', 'uWornRoughMean'],
    forbids: ['uWornDisp', 'uWornDetStart', 'uWornParallaxAmp'],
  },
  {
    name: 'props: kit material, haze and worn',
    build: (m) => m.convertMaterial(kitSource('Stone_Wall'), 'kfol', false),
    requires: ['uHazeField', 'uHazeRect', 'uWornNormal', 'uWornRoughMean'],
  },
  {
    name: 'props: kit material, haze alone',
    build: (m) => m.convertMaterial(kitSource('Glass_Window'), 'kfol', false),
    requires: ['uHazeField', 'uHazeRect'],
    forbids: ['uWornNormal', 'uWornRoughMean'],
  },
  {
    name: 'foliage_impostor: tree sprites',
    build: (m) => m.impostorMaterial('tree', new THREE.Texture()),
    requires: ['uImpViews', 'uImpWind', 'uImpSwap', 'uHazeField'],
  },
  {
    name: 'foliage_impostor: rock sprites',
    build: (m) => m.impostorMaterial('rock', new THREE.Texture()),
    requires: ['uImpViews', 'uImpWind', 'uImpSwap', 'uHazeField'],
  },
];

let primary: RenderModules;
let twinModules: RenderModules;

beforeAll(async () => {
  primary = await loadRenderModules('ultra');
  // A second, independently loaded graph: both the prop converter and the
  // impostor material memoize per key, so a genuinely fresh twin of the same
  // family only exists in its own module instance.
  twinModules = await loadRenderModules('ultra');
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../src/render/assets/loader');
  vi.doUnmock('../src/render/assets/preload');
});

describe.each(FAMILIES)('$name', ({ build, requires, forbids }) => {
  let material: THREE.Material;
  let shaderA: FakeShader;
  let shaderB: FakeShader;
  let keyBefore = '';
  let keyBetween = '';
  let keyAfter = '';

  beforeAll(() => {
    material = build(primary);
    keyBefore = material.customProgramCacheKey();
    shaderA = freshShader();
    runHook(material, shaderA);
    keyBetween = material.customProgramCacheKey();
    shaderB = freshShader();
    runHook(material, shaderB);
    keyAfter = material.customProgramCacheKey();
  });

  it('patches the shader on both passes, so the pins below are not vacuous', () => {
    const base = freshShader();
    for (const shader of [shaderA, shaderB]) {
      expect(shader.fragmentShader).not.toBe(base.fragmentShader);
      for (const name of requires) expect(Object.keys(shader.uniforms)).toContain(name);
      for (const name of forbids ?? []) expect(Object.keys(shader.uniforms)).not.toContain(name);
    }
  });

  it('splices identical vertex and fragment source on the second pass', () => {
    expect(shaderB.vertexShader).toBe(shaderA.vertexShader);
    expect(shaderB.fragmentShader).toBe(shaderA.fragmentShader);
  });

  it('installs the same uniform names and values on the second pass', () => {
    expectSameUniforms(shaderB, shaderA, { textureIdentity: true });
  });

  it('keeps one program cache key before, between and after the two passes', () => {
    expect(keyBetween).toBe(keyBefore);
    expect(keyAfter).toBe(keyBefore);
  });

  it('keeps no reference to either shader object it was handed', () => {
    const held = reachableObjects(material, 3);
    expect(held.has(shaderA), 'material kept the dry-pass shader').toBe(false);
    expect(held.has(shaderB), 'material kept the real-pass shader').toBe(false);
    expect(held.has(shaderA.uniforms), 'material kept the dry-pass uniforms').toBe(false);
    expect(held.has(shaderB.uniforms), 'material kept the real-pass uniforms').toBe(false);
  });

  it('leaves a freshly built twin compiling the same source, uniforms and key', () => {
    const twin = build(twinModules);
    const twinShader = freshShader();
    runHook(twin, twinShader);
    expect(twinShader.vertexShader).toBe(shaderB.vertexShader);
    expect(twinShader.fragmentShader).toBe(shaderB.fragmentShader);
    expectSameUniforms(twinShader, shaderB, { textureIdentity: false });
    expect(twin.customProgramCacheKey()).toBe(keyAfter);
  });
});
