// The compile gate's shadow arm as its own module (src/render/shadow_depth_compile.ts,
// extracted from renderer.ts at Masterwrought phase 18). The renderer-level
// behaviour (the harness wrapper, GFX.dynamicShadows, the async-compile guard)
// stays pinned in tests/renderer_shadow_prewarm.test.ts and
// tests/renderer_compile_gate.test.ts; this file drives the arm directly with
// the render state it takes as arguments, so the swap, the render-state
// bracket and the restore-before-await contract are proved without a Renderer.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { prewarmDepthMaterialKey } from '../src/render/prewarm_depth_material';
import {
  compileShadowDepthPrograms,
  type ShadowCompileRenderer,
} from '../src/render/shadow_depth_compile';

function webglSpy(compileAsync: ShadowCompileRenderer['compileAsync']) {
  const targets: (THREE.WebGLRenderTarget | null)[] = [];
  const current = { target: null as THREE.WebGLRenderTarget | null };
  const webgl: ShadowCompileRenderer = {
    getRenderTarget: () => current.target,
    setRenderTarget: (target) => {
      current.target = target;
      targets.push(target);
    },
    compileAsync,
  };
  return { webgl, targets, current };
}

describe('compileShadowDepthPrograms', () => {
  it('swaps a cached depth twin onto every mesh for the prologue, binds the prewarm target and drops the fog, then restores all three BEFORE the link resolves', async () => {
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x000000, 1, 10);
    scene.fog = fog;
    const shadowCamera = new THREE.OrthographicCamera();
    const prewarmTarget = new THREE.WebGLRenderTarget(8, 8);
    const cache = new Map<string, THREE.MeshDepthMaterial>();
    const seenAtPrologue: {
      fog: THREE.Scene['fog'];
      target: THREE.WebGLRenderTarget | null;
      materials: THREE.Material[];
      camera: THREE.Camera;
      targetScene: unknown;
    }[] = [];
    let resolveLink!: (root: THREE.Object3D) => void;
    const { webgl, current } = webglSpy((root, camera, targetScene) => {
      const materials: THREE.Material[] = [];
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) materials.push(mesh.material as THREE.Material);
      });
      seenAtPrologue.push({
        fog: scene.fog,
        target: current.target,
        materials,
        camera,
        targetScene,
      });
      return new Promise<THREE.Object3D>((resolve) => {
        resolveLink = resolve;
      });
    });
    const caster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    caster.castShadow = true;
    const nonCaster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    nonCaster.castShadow = false;
    const casterMaterial = caster.material;
    const nonCasterMaterial = nonCaster.material;
    const root = new THREE.Group();
    root.add(caster, nonCaster);

    const pending = compileShadowDepthPrograms(
      webgl,
      scene,
      shadowCamera,
      cache,
      prewarmTarget,
      root,
    );

    // The prologue saw: no fog, the prewarm target bound, every mesh (the
    // non-caster too) in a depth twin, the shadow camera, the world scene.
    expect(seenAtPrologue).toHaveLength(1);
    expect(seenAtPrologue[0].fog).toBeNull();
    expect(seenAtPrologue[0].target).toBe(prewarmTarget);
    expect(seenAtPrologue[0].camera).toBe(shadowCamera);
    expect(seenAtPrologue[0].targetScene).toBe(scene);
    expect(seenAtPrologue[0].materials).toHaveLength(2);
    for (const m of seenAtPrologue[0].materials) {
      expect((m as THREE.MeshDepthMaterial).isMeshDepthMaterial).toBe(true);
    }
    // Same shape and inputs, same cached twin: one instance, a cache hit.
    expect(seenAtPrologue[0].materials[0]).toBe(seenAtPrologue[0].materials[1]);
    expect(cache.size).toBe(1);
    expect(cache.get(prewarmDepthMaterialKey(casterMaterial as THREE.Material, caster))).toBe(
      seenAtPrologue[0].materials[0],
    );
    // Restored while the link is still pending.
    expect(scene.fog).toBe(fog);
    expect(current.target).toBeNull();
    expect(caster.material).toBe(casterMaterial);
    expect(nonCaster.material).toBe(nonCasterMaterial);
    resolveLink(root);
    await pending;
  });

  it('compiles nothing for a root without material carriers and never touches the render state', async () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 1, 10);
    const compileAsync = vi.fn(() => Promise.resolve(new THREE.Group()));
    const { webgl, targets } = webglSpy(compileAsync);
    const bare = new THREE.Mesh(new THREE.BufferGeometry());
    bare.material = null as unknown as THREE.Material;
    const root = new THREE.Group();
    root.add(new THREE.Group(), bare);
    await compileShadowDepthPrograms(
      webgl,
      scene,
      new THREE.OrthographicCamera(),
      new Map(),
      new THREE.WebGLRenderTarget(8, 8),
      root,
    );
    expect(compileAsync).not.toHaveBeenCalled();
    // The finally still restores the (unchanged) previous target: one write,
    // back to what getRenderTarget answered.
    expect(targets).toEqual([null]);
    expect(scene.fog).not.toBeNull();
  });

  it('restores every swap and the render state when the walk throws part-way, and rejects', async () => {
    const scene = new THREE.Scene();
    const fog = new THREE.Fog(0x000000, 1, 10);
    scene.fog = fog;
    const compileAsync = vi.fn(() => Promise.resolve(new THREE.Group()));
    const { webgl, current } = webglSpy(compileAsync);
    const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const boom = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    Object.defineProperty(boom, 'material', {
      configurable: true,
      get: () => {
        throw new Error('walk exploded mid-traverse');
      },
    });
    const firstMaterial = first.material;
    const root = new THREE.Group();
    root.add(first, boom);
    await expect(
      compileShadowDepthPrograms(
        webgl,
        scene,
        new THREE.OrthographicCamera(),
        new Map(),
        new THREE.WebGLRenderTarget(8, 8),
        root,
      ),
    ).rejects.toThrow('walk exploded mid-traverse');
    expect(first.material).toBe(firstMaterial);
    expect(scene.fog).toBe(fog);
    expect(current.target).toBeNull();
    expect(compileAsync).not.toHaveBeenCalled();
  });

  it('propagates a rejected link after restoring (the gate stays fail-soft one level up)', async () => {
    const scene = new THREE.Scene();
    const { webgl } = webglSpy(() => Promise.reject(new Error('link rejected')));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const material = mesh.material;
    const root = new THREE.Group();
    root.add(mesh);
    await expect(
      compileShadowDepthPrograms(
        webgl,
        scene,
        new THREE.OrthographicCamera(),
        new Map(),
        new THREE.WebGLRenderTarget(8, 8),
        root,
      ),
    ).rejects.toThrow('link rejected');
    expect(mesh.material).toBe(material);
  });
});
