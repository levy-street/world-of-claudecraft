import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GFX } from '../src/render/gfx';
import { Renderer } from '../src/render/renderer';

vi.mock('../src/render/gfx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/gfx')>();
  return {
    ...actual,
    // A LIVE settings object (the module default is frozen): the tests below
    // flip dynamicShadows, which compileShadowPrograms reads at call time.
    GFX: actual.gfxInternalsForTest.settingsFor('high'),
  };
});

// Behavioral pin for the compile gate's shadow arm: at compileAsync time every
// caster carries a prewarm MeshDepthMaterial that is (a) the default depth
// packing three's shadow pass draws and (b) a DISTINCT instance per caster
// shape, so compileAsync awaits every depth program instead of only the last
// one; and the casters' own materials are restored before the link is awaited
// (and even when it rejects). Source greps cannot prove any of that.

interface ShadowPrewarmHarness {
  compileShadowPrograms(root: THREE.Object3D): Promise<void>;
}

function skinnedCaster(morphs: number, material: THREE.Material): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  if (morphs > 0) {
    geometry.morphAttributes.position = Array.from(
      { length: morphs },
      () =>
        new THREE.Float32BufferAttribute(
          new Float32Array(geometry.attributes.position.count * 3),
          3,
        ),
    );
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

interface CompileCall {
  root: THREE.Object3D;
  materialsAtCompile: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
}

function harness(compileAsync: (root: THREE.Object3D) => Promise<THREE.Object3D>) {
  const renderer = Object.create(Renderer.prototype) as ShadowPrewarmHarness &
    Record<string, unknown>;
  renderer.asyncCompileSupported = true;
  renderer.prewarmDepthMaterials = new Map();
  renderer.prewarmRenderTarget = null;
  renderer.scene = new THREE.Scene();
  (renderer.scene as THREE.Scene).fog = new THREE.Fog(0x000000, 1, 10);
  renderer.sun = { shadow: { camera: new THREE.OrthographicCamera() } };
  const targets: unknown[] = [];
  renderer.webgl = {
    getRenderTarget: () => null,
    setRenderTarget: (target: unknown) => targets.push(target),
    compileAsync,
  };
  return { renderer, targets };
}

const live = GFX as { dynamicShadows: boolean } & typeof GFX;
const originalDynamicShadows = live.dynamicShadows;
afterEach(() => {
  live.dynamicShadows = originalDynamicShadows;
  vi.restoreAllMocks();
});

describe('Renderer.compileShadowPrograms', () => {
  it('swaps one distinct default-packed depth material per caster shape, then restores', async () => {
    live.dynamicShadows = true;
    const calls: CompileCall[] = [];
    const { renderer } = harness((root) => {
      const materialsAtCompile = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) materialsAtCompile.set(mesh, mesh.material);
      });
      calls.push({ root, materialsAtCompile });
      return Promise.resolve(root);
    });
    const skin = new THREE.MeshStandardMaterial({ name: 'mod_skin' });
    const cloth = new THREE.MeshStandardMaterial({ name: 'mod_cloth' });
    const root = new THREE.Group();
    const parts = [
      skinnedCaster(0, skin),
      skinnedCaster(4, skin),
      skinnedCaster(9, cloth),
      skinnedCaster(9, skin),
    ];
    const rigid = new THREE.Mesh(new THREE.BoxGeometry(), cloth);
    rigid.castShadow = true;
    const noShadow = new THREE.Mesh(new THREE.BoxGeometry(), cloth);
    noShadow.castShadow = false;
    root.add(...parts, rigid, noShadow);

    await renderer.compileShadowPrograms(root);

    expect(calls).toHaveLength(1);
    const swapped = calls[0].materialsAtCompile;
    // Every caster was compiled through a prewarm depth material...
    for (const mesh of [...parts, rigid]) {
      const material = swapped.get(mesh) as THREE.MeshDepthMaterial;
      expect(material.isMeshDepthMaterial).toBe(true);
      // ...that draws the SAME variant as three's shadow pass (default packing).
      expect(material.depthPacking).toBe(new THREE.MeshDepthMaterial().depthPacking);
    }
    // A non-caster keeps its own material at compile time.
    expect(swapped.get(noShadow)).toBe(cloth);
    // Distinct shapes get distinct instances (skinned x morph 0/4/9, rigid), so
    // compileAsync's per-material currentProgram poll awaits every depth
    // program; identical shapes share one.
    const instances = new Set([...parts, rigid].map((mesh) => swapped.get(mesh)));
    expect(instances.size).toBe(4);
    expect(swapped.get(parts[2])).toBe(swapped.get(parts[3]));
    // The casters' own materials are back before the awaited link resolves.
    for (const mesh of parts) expect(mesh.material).toBe(mesh === parts[2] ? cloth : skin);
    expect(rigid.material).toBe(cloth);
    // The world's fog was suppressed only for the compile prologue.
    expect((renderer.scene as THREE.Scene).fog).not.toBeNull();
  });

  it('restores the casters when compileAsync rejects', async () => {
    live.dynamicShadows = true;
    const { renderer } = harness(() => Promise.reject(new Error('link rejected')));
    const source = new THREE.MeshStandardMaterial();
    const caster = skinnedCaster(2, source);
    const root = new THREE.Group();
    root.add(caster);
    await expect(renderer.compileShadowPrograms(root)).rejects.toThrow('link rejected');
    expect(caster.material).toBe(source);
  });

  it('is a no-op without dynamic shadows', async () => {
    live.dynamicShadows = false;
    const compileAsync = vi.fn(() => Promise.resolve(new THREE.Group()));
    const { renderer } = harness(compileAsync);
    const root = new THREE.Group();
    root.add(skinnedCaster(2, new THREE.MeshStandardMaterial()));
    await renderer.compileShadowPrograms(root);
    expect(compileAsync).not.toHaveBeenCalled();
  });
});
