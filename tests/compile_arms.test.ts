// The two compile arms (src/render/compile_arms.ts): the renderer state each
// one sets around its operation (bound target, fog, shadow camera, depth
// twins), restored before the operation's result is consumed, whether the
// operation links (compileAsync) or only reads (the dry compile).

import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CompileArmHost,
  colorArmTargets,
  linkColorPrograms,
  linkShadowPrograms,
  runColorArm,
  runShadowArm,
  setCompileArmObserver,
  underRenderTarget,
} from '../src/render/compile_arms';

interface Stub {
  host: CompileArmHost;
  log: string[];
  compileAsync: ReturnType<typeof vi.fn>;
  scene: THREE.Scene;
  offscreenTarget: THREE.WebGLRenderTarget;
  liveTarget: THREE.WebGLRenderTarget;
  current: () => THREE.WebGLRenderTarget | null;
  /** Resolve every deferred link the stub is still holding. */
  settle: () => void;
}

function stub(options: { offscreen?: boolean; shadowArm?: boolean; defer?: boolean } = {}): Stub {
  const log: string[] = [];
  const liveTarget = { name: 'live' } as unknown as THREE.WebGLRenderTarget;
  const offscreenTarget = { name: 'offscreen' } as unknown as THREE.WebGLRenderTarget;
  let current: THREE.WebGLRenderTarget | null = liveTarget;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const camera = new THREE.PerspectiveCamera();
  camera.name = 'world';
  const shadowCamera = new THREE.OrthographicCamera();
  shadowCamera.name = 'shadow';
  const targetName = () => (current as { name?: string } | null)?.name ?? 'canvas';
  // A deferred link stands in for the real one: three's compileAsync resolves
  // frames later, so anything the arm restores AFTER the await is restored
  // while live frames are already drawing.
  const pending: Array<() => void> = [];
  const compileAsync = vi.fn((root: THREE.Object3D, cam: THREE.Camera, target: THREE.Scene) => {
    log.push(`compile:${cam.name}:fog=${target.fog ? 'on' : 'off'}:target=${targetName()}`);
    if (!options.defer) return Promise.resolve(root);
    return new Promise<THREE.Object3D>((resolve) => {
      pending.push(() => resolve(root));
    });
  });
  const host: CompileArmHost = {
    webgl: () => ({
      getRenderTarget: () => current,
      setRenderTarget: (target) => {
        current = target;
        log.push(`target:${targetName()}`);
      },
      compileAsync,
    }),
    camera: () => camera,
    scene: () => scene,
    shadowCamera: () => shadowCamera,
    offscreen: () => options.offscreen ?? false,
    offscreenTarget: () => offscreenTarget,
    depthMaterials: () => new Map(),
    shadowArm: () => options.shadowArm ?? true,
  };
  return {
    host,
    log,
    compileAsync,
    scene,
    offscreenTarget,
    liveTarget,
    current: () => current,
    settle: () => {
      for (const resolve of pending.splice(0)) resolve();
    },
  };
}

function meshRoot(): { root: THREE.Group; meshes: THREE.Mesh[] } {
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  const b = new THREE.SkinnedMesh(new THREE.BufferGeometry(), [
    new THREE.MeshStandardMaterial(),
    new THREE.MeshBasicMaterial(),
  ]);
  root.add(a, b);
  return { root, meshes: [a, b] };
}

// The observer slot is module-owned, so a case that installs one must not
// leave it behind for the next.
afterEach(() => {
  setCompileArmObserver(null);
});

describe('colour arm', () => {
  it('covers the canvas variant alone on a direct tier', () => {
    const s = stub({ offscreen: false });
    expect(colorArmTargets(s.host, false)).toEqual([null]);
  });

  it('covers the offscreen variant alone on a composer tier', () => {
    const s = stub({ offscreen: true });
    expect(colorArmTargets(s.host, false)).toEqual([s.offscreenTarget]);
    expect(colorArmTargets(s.host, true)).toEqual([s.offscreenTarget]);
  });

  it('adds the offscreen variant after the canvas one when a direct tier asks for it', () => {
    const s = stub({ offscreen: false });
    expect(colorArmTargets(s.host, true)).toEqual([null, s.offscreenTarget]);
  });

  it('links under each target and restores the live target before awaiting', async () => {
    const s = stub({ offscreen: false });
    const { root } = meshRoot();
    await linkColorPrograms(s.host, root, true);
    expect(s.log).toEqual([
      'target:canvas',
      'compile:world:fog=on:target=canvas',
      'target:live',
      'target:offscreen',
      'compile:world:fog=on:target=offscreen',
      'target:live',
    ]);
    expect(s.compileAsync).toHaveBeenCalledTimes(2);
    expect(s.compileAsync.mock.calls[0]?.[0]).toBe(root);
    expect(s.current()).toBe(s.liveTarget);
  });

  it('holds nothing of its own state while the link is still pending', async () => {
    // The decisive shape: the restore must happen BEFORE the await, not after
    // it. With the link deferred, an `await op()` inside underRenderTarget
    // would leave the throwaway target bound across every frame the driver
    // spends linking.
    const s = stub({ offscreen: false, defer: true });
    const { root, meshes } = meshRoot();
    const originalFog = s.scene.fog;
    const originalMaterials = meshes.map((mesh) => mesh.material);
    const link = linkColorPrograms(s.host, root, false);
    expect(s.compileAsync).toHaveBeenCalledTimes(1);
    expect(s.current()).toBe(s.liveTarget);
    expect(s.scene.fog).toBe(originalFog);
    expect(meshes[0]?.material).toBe(originalMaterials[0]);
    expect(meshes[1]?.material).toBe(originalMaterials[1]);
    s.settle();
    await link;
    expect(s.current()).toBe(s.liveTarget);
    expect(s.scene.fog).toBe(originalFog);
  });

  it('runs any operation under the same targets, one result per target', () => {
    const s = stub({ offscreen: true });
    const { root } = meshRoot();
    const results = runColorArm(s.host, root, false, (target, camera, scene) => {
      return `${target === root}:${camera.name}:${(s.current() as { name?: string })?.name}:${scene.fog ? 'fog' : 'nofog'}`;
    });
    expect(results).toEqual(['true:world:offscreen:fog']);
    expect(s.current()).toBe(s.liveTarget);
  });

  it('restores the target when the operation throws', () => {
    const s = stub();
    expect(() =>
      underRenderTarget(s.host, s.offscreenTarget, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(s.current()).toBe(s.liveTarget);
  });
});

describe('shadow arm', () => {
  it('runs the operation with depth twins on every mesh, no fog, the offscreen target and the shadow camera', () => {
    const s = stub();
    const { root, meshes } = meshRoot();
    const originals = meshes.map((mesh) => mesh.material);
    const originalFog = s.scene.fog;
    const seen: string[] = [];
    const result = runShadowArm(s.host, root, (target, camera, scene) => {
      for (const mesh of meshes) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) seen.push(material.type);
      }
      return `${target === root}:${camera.name}:${scene.fog === null}:${(s.current() as { name?: string })?.name}`;
    });
    expect(result).toBe('true:shadow:true:offscreen');
    expect(seen).toEqual(['MeshDepthMaterial', 'MeshDepthMaterial', 'MeshDepthMaterial']);
    // Everything restored before the result is consumed.
    expect(meshes.map((mesh) => mesh.material)).toEqual(originals);
    expect(s.scene.fog).toBe(originalFog);
    expect(s.current()).toBe(s.liveTarget);
  });

  it('links with compileAsync under that state and restores before awaiting', async () => {
    const s = stub();
    const { root, meshes } = meshRoot();
    const originals = meshes.map((mesh) => mesh.material);
    const originalFog = s.scene.fog;
    await linkShadowPrograms(s.host, root);
    expect(s.log).toEqual([
      'target:offscreen',
      'compile:shadow:fog=off:target=offscreen',
      'target:live',
    ]);
    expect(meshes.map((mesh) => mesh.material)).toEqual(originals);
    // The same fog OBJECT, not merely a non-null one: the arm nulls it and
    // must put back what it took, never a fresh stand-in.
    expect(s.scene.fog).toBe(originalFog);
  });

  it('holds no depth twin, no suppressed fog and no target while the link is pending', async () => {
    const s = stub({ defer: true });
    const { root, meshes } = meshRoot();
    const originalFog = s.scene.fog;
    const originalMaterials = meshes.map((mesh) => mesh.material);
    const link = linkShadowPrograms(s.host, root);
    expect(s.compileAsync).toHaveBeenCalledTimes(1);
    // A swap held across an awaited link would draw these visible meshes as
    // depth noise, and the suppressed fog would follow the scene's live pass.
    expect(s.current()).toBe(s.liveTarget);
    expect(s.scene.fog).toBe(originalFog);
    expect(meshes[0]?.material).toBe(originalMaterials[0]);
    expect(meshes[1]?.material).toBe(originalMaterials[1]);
    s.settle();
    await link;
    expect(s.scene.fog).toBe(originalFog);
    expect(s.current()).toBe(s.liveTarget);
  });

  it('does nothing without the arm, and nothing for a root without meshes', async () => {
    const off = stub({ shadowArm: false });
    const { root } = meshRoot();
    expect(runShadowArm(off.host, root, () => 'ran')).toBeNull();
    await linkShadowPrograms(off.host, root);
    expect(off.compileAsync).not.toHaveBeenCalled();

    const on = stub();
    expect(runShadowArm(on.host, new THREE.Group(), () => 'ran')).toBeNull();
    // Only what was touched is restored: nothing bound a target here, and
    // three's setRenderTarget rebinds the framebuffer even for the same
    // target, so a blanket restore would be a real cost on an empty root.
    expect(on.log).toEqual([]);
    expect(on.compileAsync).not.toHaveBeenCalled();
  });

  it('restores what it already swapped when the walk itself throws mid-root', () => {
    // A partial walk: the first mesh is already wearing its depth twin when
    // the second mesh's material getter throws, so the restore has to cover
    // the swaps made so far rather than only a completed walk.
    const s = stub();
    const root = new THREE.Group();
    const first = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    const trap = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
    Object.defineProperty(trap, 'material', {
      configurable: true,
      get: () => {
        throw new Error('material gone');
      },
    });
    root.add(first, trap);
    const original = first.material;
    const originalFog = s.scene.fog;
    expect(() => runShadowArm(s.host, root, () => 'ran')).toThrow('material gone');
    expect(first.material).toBe(original);
    expect(s.scene.fog).toBe(originalFog);
    expect(s.current()).toBe(s.liveTarget);
    // The throw landed before anything was bound, so nothing was rebound.
    expect(s.log).toEqual([]);
    expect(s.compileAsync).not.toHaveBeenCalled();
  });

  it('restores the swaps, the fog and the target when the operation throws', () => {
    const s = stub();
    const { root, meshes } = meshRoot();
    const originals = meshes.map((mesh) => mesh.material);
    const originalFog = s.scene.fog;
    expect(() =>
      runShadowArm(s.host, root, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(meshes.map((mesh) => mesh.material)).toEqual(originals);
    expect(s.scene.fog).toBe(originalFog);
    expect(s.current()).toBe(s.liveTarget);
  });
});

describe('compile arm observer', () => {
  it('is told before each LINK of a root, never for a dry pass, and can be removed', async () => {
    const s = stub();
    const { root } = meshRoot();
    const seen: string[] = [];
    setCompileArmObserver((node, arm) => seen.push(`${arm}:${node === root}`));
    await linkColorPrograms(s.host, root, false);
    await linkShadowPrograms(s.host, root);
    runColorArm(s.host, root, false, () => null);
    runShadowArm(s.host, root, () => null);
    expect(seen).toEqual(['color:true', 'shadow:true']);
    setCompileArmObserver(null);
    await linkColorPrograms(s.host, root, false);
    expect(seen).toHaveLength(2);
  });

  it('is told for a shadow link only when the arm actually links something', async () => {
    // The announcement rides INSIDE the arm, so a root the arm skips (no mesh
    // to swap, or the arm switched off) tells the observer nothing at all. An
    // observer told from the top of linkShadowPrograms would count both.
    const seen: string[] = [];
    setCompileArmObserver((_node, arm) => seen.push(arm));

    const empty = stub();
    await linkShadowPrograms(empty.host, new THREE.Group());
    expect(seen).toEqual([]);
    expect(empty.compileAsync).not.toHaveBeenCalled();

    const off = stub({ shadowArm: false });
    await linkShadowPrograms(off.host, meshRoot().root);
    expect(seen).toEqual([]);
    expect(off.compileAsync).not.toHaveBeenCalled();

    const live = stub();
    const { root } = meshRoot();
    await linkShadowPrograms(live.host, root);
    expect(seen).toEqual(['shadow']);
    expect(live.compileAsync).toHaveBeenCalledTimes(1);
  });
});
