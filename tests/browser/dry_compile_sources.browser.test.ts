// The premise of the shader warm-up, pinned on a real WebGL2 context: the
// sources the patched three returns WITHOUT linking (`collectProgramSources`,
// patches/three@0.185.1.patch) are byte for byte the sources the link then
// hands the driver, under the same cache keys, and a second collection after
// the link reports none of them. The browser's shared program cache is keyed
// on that text, so this equality is what makes a worker's warm-up a hit.
//
// The scene also carries ONE real game shader, the monument impostor's
// hand-written ShaderMaterial, and the link assertion below covers it. Two
// reasons, and the second is why it rides here rather than in a file of its
// own. First, the mirror has to hold for a hand-written ShaderMaterial too,
// which reaches the assembly by a different path than three's stock materials.
// Second, several browser files link shipped shaders, but none of them ASSERTS
// the link succeeded, and nothing else does either: renderer.ts keeps three's
// link diagnostic off outside ?shaderdebug (a synchronous info-log roundtrip
// per link, a quarter of main-thread time on a streaming walk), so a shader
// that never compiles ships silently and is drawn with on every frame. That is
// exactly what the impostor did for all of v0.42. Adding it to this scene
// costs one program link on a context this file already builds; a separate
// browser file would have cost a whole context, measured at 0.65 s of the
// 0.98 s this file takes.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DryCompileRenderer, DryProgramSource } from '../../src/render/program_sources';
import {
  MONUMENT_IMPOSTOR_FRAGMENT,
  MONUMENT_IMPOSTOR_VERTEX,
} from '../../src/render/realm_builder_monument_impostor_glsl';

type PatchedRenderer = THREE.WebGLRenderer & Required<DryCompileRenderer>;

interface MintedProgram {
  cacheKey: string;
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
}

let renderer: PatchedRenderer;

beforeEach(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false }) as PatchedRenderer;
});

afterEach(() => {
  renderer.dispose();
});

function scene(): { scene: THREE.Scene; camera: THREE.PerspectiveCamera; root: THREE.Group } {
  const world = new THREE.Scene();
  world.fog = new THREE.Fog(0x334455, 10, 200);
  world.add(new THREE.DirectionalLight(0xffffff, 1));
  world.add(new THREE.PointLight(0xffaa00, 1, 20));
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
  const root = new THREE.Group();
  root.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a7f70 })),
    new THREE.Mesh(new THREE.SphereGeometry(1, 8, 8), new THREE.MeshLambertMaterial()),
    new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
    ),
    // The shipped monument impostor GLSL, uniforms shaped as buildImpostor
    // shapes them (the atlas sampler may be null: a link needs the declaration,
    // not the texture). See the header for why it rides in this scene.
    new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: MONUMENT_IMPOSTOR_VERTEX,
        fragmentShader: MONUMENT_IMPOSTOR_FRAGMENT,
        fog: true,
        uniforms: {
          ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
          uAtlas: { value: null },
          uCell: { value: new THREE.Vector2(0, 0) },
          uCellSize: { value: new THREE.Vector2(1, 1) },
        },
      }),
    ),
  );
  world.add(root);
  return { scene: world, camera, root };
}

function minted(): MintedProgram[] {
  return (renderer.info.programs ?? []) as unknown as MintedProgram[];
}

describe('the dry compile against the real link', () => {
  it('yields the exact sources and keys the link then mints, and nothing once linked', async () => {
    expect(typeof renderer.collectProgramSources).toBe('function');
    const { scene: world, camera, root } = scene();
    const before = new Set(minted().map((program) => program.cacheKey));
    const dry = renderer.collectProgramSources(root, camera, world);
    expect(dry.length).toBeGreaterThanOrEqual(4);
    // A transparent double-sided material is two programs (prepareMaterial's
    // side branch), and every material's side is back where it was.
    const plane = root.children[2] as THREE.Mesh;
    expect((plane.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const dryByKey = new Map<string, DryProgramSource>(dry.map((entry) => [entry.cacheKey, entry]));
    expect(dryByKey.size).toBe(dry.length);
    // Nothing was created on the context by the collection.
    expect(minted().length).toBe(before.size);

    await renderer.compileAsync(root, camera, world);
    const gl = renderer.getContext();
    const linked = minted().filter((program) => !before.has(program.cacheKey));
    expect(linked.length).toBe(dry.length);
    for (const program of linked) {
      // First: it linked at all. Three reports a failed link only under
      // debug.checkShaderErrors, which production keeps off, so without this
      // the driver's verdict is read by nobody and an uncompilable shader
      // reaches players. The info logs name the line when it fails.
      expect(
        gl.getProgramParameter(program.program, gl.LINK_STATUS),
        `link failed for ${program.cacheKey.slice(0, 40)}: program ${gl.getProgramInfoLog(
          program.program,
        )} vertex ${gl.getShaderInfoLog(program.vertexShader)} fragment ${gl.getShaderInfoLog(
          program.fragmentShader,
        )}`,
      ).toBe(true);
      const entry = dryByKey.get(program.cacheKey);
      expect(entry, `announced key for ${program.cacheKey.slice(0, 40)}`).toBeDefined();
      if (!entry) continue;
      expect(gl.getShaderSource(program.vertexShader)).toBe(entry.vertexGlsl);
      expect(gl.getShaderSource(program.fragmentShader)).toBe(entry.fragmentGlsl);
    }
    // Everything the link minted is now a linked key: the collection skips it.
    expect(renderer.collectProgramSources(root, camera, world)).toEqual([]);
  });

  it('reads the shadow-casting lights the link will see, and the link agrees byte for byte', async () => {
    // The light and shadow gathering in collectProgramSources mirrors three's
    // compile() rather than sharing it (compile() inlines the walk), so the
    // shadow branch of the mirror is exercised here: a casting light changes
    // the keys, and the link then mints exactly the sources collected.
    renderer.shadowMap.enabled = true;
    const { scene: world, camera, root } = scene();
    const sun = world.children[0] as THREE.DirectionalLight;
    for (const child of root.children) child.receiveShadow = true;
    sun.castShadow = false;
    const unshadowedKeys = renderer
      .collectProgramSources(root, camera, world)
      .map((entry) => entry.cacheKey);
    sun.castShadow = true;
    const shadowed = renderer.collectProgramSources(root, camera, world);
    expect(shadowed.length).toBe(unshadowedKeys.length);
    const shadowedKeys = shadowed.map((entry) => entry.cacheKey);
    // The lit programs read the shadow: at least one key moved.
    expect(shadowedKeys.some((key) => !unshadowedKeys.includes(key))).toBe(true);
    const before = new Set(minted().map((program) => program.cacheKey));
    await renderer.compileAsync(root, camera, world);
    const gl = renderer.getContext();
    const linked = minted().filter((program) => !before.has(program.cacheKey));
    expect(linked.map((program) => program.cacheKey).sort()).toEqual(shadowedKeys.slice().sort());
    const byKey = new Map(shadowed.map((entry) => [entry.cacheKey, entry]));
    for (const program of linked) {
      const entry = byKey.get(program.cacheKey);
      expect(entry).toBeDefined();
      if (!entry) continue;
      expect(gl.getShaderSource(program.vertexShader)).toBe(entry.vertexGlsl);
      expect(gl.getShaderSource(program.fragmentShader)).toBe(entry.fragmentGlsl);
    }
  });

  it('carries the renderer state the link will see: a bound target changes the keys', () => {
    const { scene: world, camera, root } = scene();
    const canvasKeys = renderer
      .collectProgramSources(root, camera, world)
      .map((entry) => entry.cacheKey);
    const target = new THREE.WebGLRenderTarget(8, 8);
    renderer.setRenderTarget(target);
    const targetKeys = renderer
      .collectProgramSources(root, camera, world)
      .map((entry) => entry.cacheKey);
    renderer.setRenderTarget(null);
    target.dispose();
    expect(targetKeys.length).toBe(canvasKeys.length);
    for (const key of targetKeys) expect(canvasKeys).not.toContain(key);
  });

  it('is fail-soft: a throwing hook restores the borrowed side and leaves the render state balanced', () => {
    const { scene: world, camera, root } = scene();
    const plane = root.children[2] as THREE.Mesh;
    const material = plane.material as THREE.MeshBasicMaterial;
    material.onBeforeCompile = () => {
      throw new Error('hook exploded');
    };
    expect(() => renderer.collectProgramSources(root, camera, world)).toThrow('hook exploded');
    expect(material.side).toBe(THREE.DoubleSide);
    material.onBeforeCompile = () => {};
    // The render-state stack was popped on the way out: the next real render
    // and the next collection (of a fresh root, the rendered one is linked
    // now) run on their own state, not the aborted one.
    expect(() => renderer.render(world, camera)).not.toThrow();
    const fresh = new THREE.Group();
    fresh.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhongMaterial()));
    world.add(fresh);
    expect(renderer.collectProgramSources(fresh, camera, world).length).toBe(1);
  });
});
