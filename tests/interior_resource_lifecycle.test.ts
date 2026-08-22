import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { attachSceneGroupGated } from '../src/render/gated_scene_attach';
import { gfxInternalsForTest, surfaceMat } from '../src/render/gfx';
import {
  collectOwnedInteriorResources,
  createOwnedInteriorResourceRegistry,
  runInteriorBuildTransaction,
} from '../src/render/interior_resource_lifecycle';
import {
  isSharedMaterial,
  markSharedGeometry,
  markSharedMaterial,
} from '../src/render/shared_resource';
import { detailedSurfaceMat } from '../src/render/worn_stone';

describe('owned interior resource lifecycle', () => {
  it('rolls back a partially built root and preserves the asset error when disposal fails', async () => {
    const scene = { remove: vi.fn() };
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    vi.spyOn(material, 'dispose').mockImplementation(() => {
      throw new Error('material release failed');
    });
    group.add(new THREE.Mesh(geometry, material));
    const registry = createOwnedInteriorResourceRegistry();
    const onFailure = vi.fn();
    const assetError = new Error('asset decode failed');

    await expect(
      runInteriorBuildTransaction(
        scene,
        group,
        registry,
        async () => {
          throw assetError;
        },
        onFailure,
      ),
    ).rejects.toBe(assetError);

    expect(scene.remove).toHaveBeenCalledOnce();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(registry.size).toBe(0);
    expect(registry.isRetired).toBe(true);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0]?.[0]).toBe(group);
    expect(onFailure.mock.calls[0]?.[1]).toEqual({
      attempted: 2,
      disposed: 1,
      errors: [expect.any(Error)],
    });
  });

  it('disposes each owned resource once and keeps going after an error', () => {
    const first = { dispose: vi.fn() };
    const failing = {
      dispose: vi.fn(() => {
        throw new Error('failing resource');
      }),
    };
    const last = { dispose: vi.fn() };
    const registry = createOwnedInteriorResourceRegistry();
    registry.add(first);
    registry.add(first);
    registry.add(failing);
    registry.add(last);

    const firstReport = registry.dispose();
    const secondReport = registry.dispose();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(failing.dispose).toHaveBeenCalledOnce();
    expect(last.dispose).toHaveBeenCalledOnce();
    expect(firstReport).toEqual({ attempted: 3, disposed: 2, errors: [expect.any(Error)] });
    expect(secondReport).toEqual({ attempted: 0, disposed: 0, errors: [] });
  });

  it('disposes a resource added after retirement immediately', () => {
    const resource = { dispose: vi.fn() };
    const registry = createOwnedInteriorResourceRegistry();

    registry.dispose();
    registry.add(resource);

    expect(resource.dispose).toHaveBeenCalledOnce();
  });

  it('leaves shared kit resources untouched while releasing root resources', () => {
    const root = new THREE.Group();
    const sharedGeometry = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
    const sharedMaterial = markSharedMaterial(new THREE.MeshBasicMaterial());
    const ownedGeometry = new THREE.BoxGeometry(1, 1, 1);
    const ownedMaterial = new THREE.MeshBasicMaterial();
    const sharedGeometryDispose = vi.spyOn(sharedGeometry, 'dispose');
    const sharedMaterialDispose = vi.spyOn(sharedMaterial, 'dispose');
    const ownedGeometryDispose = vi.spyOn(ownedGeometry, 'dispose');
    const ownedMaterialDispose = vi.spyOn(ownedMaterial, 'dispose');
    root.add(
      new THREE.Mesh(sharedGeometry, sharedMaterial),
      new THREE.Mesh(ownedGeometry, ownedMaterial),
    );
    const registry = createOwnedInteriorResourceRegistry();

    collectOwnedInteriorResources(root, registry);
    registry.dispose();

    expect(ownedGeometryDispose).toHaveBeenCalledOnce();
    expect(ownedMaterialDispose).toHaveBeenCalledOnce();
    expect(sharedGeometryDispose).not.toHaveBeenCalled();
    expect(sharedMaterialDispose).not.toHaveBeenCalled();
  });

  it('returns owned resources to baseline across repeated streamed roots', () => {
    const sharedGeometry = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
    const sharedMaterial = markSharedMaterial(new THREE.MeshBasicMaterial());
    const ownedDisposals: ReturnType<typeof vi.fn>[] = [];

    for (let cycle = 0; cycle < 3; cycle++) {
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      const material = new THREE.MeshBasicMaterial();
      const geometryDispose = vi.spyOn(geometry, 'dispose');
      const materialDispose = vi.spyOn(material, 'dispose');
      ownedDisposals.push(geometryDispose, materialDispose);
      const root = new THREE.Group();
      root.add(new THREE.Mesh(sharedGeometry, sharedMaterial), new THREE.Mesh(geometry, material));
      const registry = createOwnedInteriorResourceRegistry();
      collectOwnedInteriorResources(root, registry);
      expect(registry.dispose().attempted).toBe(2);
      expect(registry.size).toBe(0);
    }

    expect(ownedDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(sharedGeometry.userData.sharedRendererResource).toBe(true);
    expect(sharedMaterial.userData.sharedRendererResource).toBe(true);
  });

  it('releases each per-build InstancedMesh once without disposing ordinary Mesh objects', () => {
    const sharedGeometry = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
    const sharedMaterial = markSharedMaterial(new THREE.MeshBasicMaterial());
    const sharedGeometryDispose = vi.spyOn(sharedGeometry, 'dispose');
    const sharedMaterialDispose = vi.spyOn(sharedMaterial, 'dispose');
    const instancedDisposals: ReturnType<typeof vi.fn>[] = [];
    const ordinaryDisposals: ReturnType<typeof vi.fn>[] = [];

    for (let cycle = 0; cycle < 3; cycle++) {
      const instanced = new THREE.InstancedMesh(sharedGeometry, sharedMaterial, 2);
      const instancedDispose = vi.spyOn(instanced, 'dispose');
      const ordinary = new THREE.Mesh(sharedGeometry, sharedMaterial) as unknown as THREE.Mesh & {
        dispose: ReturnType<typeof vi.fn>;
      };
      ordinary.dispose = vi.fn();
      instancedDisposals.push(instancedDispose);
      ordinaryDisposals.push(ordinary.dispose);
      const root = new THREE.Group();
      root.add(instanced, ordinary);
      const registry = createOwnedInteriorResourceRegistry();

      collectOwnedInteriorResources(root, registry);
      expect(registry.dispose()).toEqual({ attempted: 1, disposed: 1, errors: [] });
      expect(registry.size).toBe(0);
    }

    expect(instancedDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(ordinaryDisposals.every((dispose) => dispose.mock.calls.length === 0)).toBe(true);
    expect(sharedGeometryDispose).not.toHaveBeenCalled();
    expect(sharedMaterialDispose).not.toHaveBeenCalled();
  });

  it('reports an InstancedMesh disposal error truthfully and continues retirement', () => {
    const geometry = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
    const material = markSharedMaterial(new THREE.MeshBasicMaterial());
    const instanced = new THREE.InstancedMesh(geometry, material, 1);
    const dispose = vi.spyOn(instanced, 'dispose').mockImplementation(() => {
      throw new Error('instance buffer failure');
    });
    const root = new THREE.Group();
    root.add(instanced);
    const registry = createOwnedInteriorResourceRegistry();

    collectOwnedInteriorResources(root, registry);
    const report = registry.dispose();

    expect(dispose).toHaveBeenCalledOnce();
    expect(report).toEqual({ attempted: 1, disposed: 0, errors: [expect.any(Error)] });
    expect(registry.dispose()).toEqual({ attempted: 0, disposed: 0, errors: [] });
  });

  it('cancels a deferred gated attach after retirement without a late root or double disposal', async () => {
    const added: THREE.Object3D[] = [];
    const scene = {
      add: (object: THREE.Object3D) => added.push(object),
      remove: (object: THREE.Object3D) => {
        const index = added.indexOf(object);
        if (index >= 0) added.splice(index, 1);
      },
    };
    const group = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const flame = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const fireLight = new THREE.PointLight();
    group.add(new THREE.Mesh(geometry, material), flame, fireLight);
    const flames = [flame];
    const fireLights = [fireLight];
    const registry = createOwnedInteriorResourceRegistry();
    const onFailure = vi.fn();
    // The resolver is deliberately held outside the promise so the test uses
    // a real deferred gate, not a synchronous mock gate.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = runInteriorBuildTransaction(
      scene,
      group,
      registry,
      async () => {
        collectOwnedInteriorResources(group, registry);
        await attachSceneGroupGated(
          scene,
          group,
          () => gate,
          () => registry.isRetired,
        );
        return group;
      },
      onFailure,
    );
    await Promise.resolve();
    expect(added).toEqual([group]);
    expect(group.visible).toBe(false);

    // This mirrors Renderer.retireInteriorGroup: detach external references
    // and retire the registry while the compile gate is still unresolved.
    const doomed = new Set<THREE.Object3D>();
    group.traverse((object) => doomed.add(object));
    for (let index = flames.length - 1; index >= 0; index--) {
      if (doomed.has(flames[index])) flames.splice(index, 1);
    }
    for (let index = fireLights.length - 1; index >= 0; index--) {
      if (doomed.has(fireLights[index])) fireLights.splice(index, 1);
    }
    expect(flames).toEqual([]);
    expect(fireLights).toEqual([]);
    registry.dispose();
    release();

    await expect(pending).rejects.toThrow('Gated scene attach cancelled');
    expect(added).toEqual([]);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(registry.dispose()).toEqual({ attempted: 0, disposed: 0, errors: [] });
  });
});

// The collector claims everything WITHOUT a shared marker, so its correctness
// rests entirely on every shared input actually carrying one. That is an
// invariant about producers, not about the collector, and the synthetic cases
// above cannot see it: they mark their own fixtures. These drive the REAL
// shared caches an interior root draws from.
describe('shared caches an interior root draws from are not claimable', () => {
  it('marks every material surfaceMat hands back', () => {
    // One instance per key, reused process-wide. Unmarked, retiring one
    // interior disposes a material the overworld is still drawing with.
    const a = surfaceMat({ color: 0x336699, roughness: 0.5 });
    const b = surfaceMat({ color: 0x336699, roughness: 0.5 });
    expect(b).toBe(a);
    expect(isSharedMaterial(a)).toBe(true);
  });

  it('marks the detailed clone too, not just its base', () => {
    const restore = gfxInternalsForTest.overrideSettings({
      standardMaterials: true,
      surfaceDetail: true,
    });
    try {
      const detailed = detailedSurfaceMat({ color: 0x223344 }, 'stone');
      expect(isSharedMaterial(detailed)).toBe(true);
    } finally {
      restore();
    }
  });

  it('claims neither a cache material nor a marked kit geometry off a real root', () => {
    // The shape the defect took: a dressing module clones a cached GLB kit
    // (clone(true) shares geometry and material BY REFERENCE) and skins other
    // props from the surfaceMat cache, all under the interior group the
    // registry sweeps.
    const kitGeometry = markSharedGeometry(new THREE.BufferGeometry());
    const kitMaterial = markSharedMaterial(new THREE.MeshBasicMaterial());
    const cacheMaterial = surfaceMat({ color: 0x8899aa });
    const ownedGeometry = new THREE.BufferGeometry();

    const root = new THREE.Group();
    root.add(new THREE.Mesh(kitGeometry, kitMaterial));
    root.add(new THREE.Mesh(ownedGeometry, cacheMaterial));

    const registry = createOwnedInteriorResourceRegistry();
    collectOwnedInteriorResources(root, registry);

    const kitGeometryDispose = vi.spyOn(kitGeometry, 'dispose');
    const kitMaterialDispose = vi.spyOn(kitMaterial, 'dispose');
    const cacheMaterialDispose = vi.spyOn(cacheMaterial, 'dispose');
    const ownedGeometryDispose = vi.spyOn(ownedGeometry, 'dispose');

    registry.dispose();

    expect(kitGeometryDispose).not.toHaveBeenCalled();
    expect(kitMaterialDispose).not.toHaveBeenCalled();
    expect(cacheMaterialDispose).not.toHaveBeenCalled();
    // The genuinely per-root resource still goes, or the registry would be
    // doing nothing at all.
    expect(ownedGeometryDispose).toHaveBeenCalledTimes(1);
  });

  it('has every interior dressing module mark its kit (source pin)', () => {
    // delve_marsh_dressing shipped with no shared_resource import at all while
    // its three siblings had one, which is exactly how the defect got in. A
    // module that lands under an interior root and clones a cached kit has to
    // mark it; this pin is what makes a new one notice.
    for (const module of [
      'delve_marsh_dressing',
      'dawnhold_dressing',
      'lastkeep_dressing',
      'rift_decor',
      'wildheart_props',
    ]) {
      const source = readFileSync(new URL(`../src/render/${module}.ts`, import.meta.url), 'utf8');
      expect(source, `${module} must mark its shared kit`).toContain('markSharedGeometry');
      expect(source, `${module} must mark its shared kit`).toContain('markSharedMaterial');
    }
  });
});
