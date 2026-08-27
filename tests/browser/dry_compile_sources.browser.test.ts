// The premise of the shader warm-up, pinned on a real WebGL2 context: the
// sources the patched three returns WITHOUT linking (`collectProgramSources`,
// patches/three@0.185.1.patch) are byte for byte the sources the link then
// hands the driver, under the same cache keys, and a second collection after
// the link reports none of them. The browser's shared program cache is keyed
// on that text, so this equality is what makes a worker's warm-up a hit.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DryCompileRenderer, DryProgramSource } from '../../src/render/program_sources';

type PatchedRenderer = THREE.WebGLRenderer & Required<DryCompileRenderer>;

interface MintedProgram {
  cacheKey: string;
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
      const entry = dryByKey.get(program.cacheKey);
      expect(entry, `announced key for ${program.cacheKey.slice(0, 40)}`).toBeDefined();
      if (!entry) continue;
      expect(gl.getShaderSource(program.vertexShader)).toBe(entry.vertexGlsl);
      expect(gl.getShaderSource(program.fragmentShader)).toBe(entry.fragmentGlsl);
    }
    // Everything the link minted is now a linked key: the collection skips it.
    expect(renderer.collectProgramSources(root, camera, world)).toEqual([]);
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
