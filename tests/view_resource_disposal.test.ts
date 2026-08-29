import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDoorBody, buildRiftPuzzleProp } from '../src/render/door_portal';
import { buildRiftRankBadge } from '../src/render/rift_rank';
import {
  disposeUnsharedMeshResources,
  isSharedMaterial,
  markOwnedMaterial,
  markSharedGeometry,
  markSharedMaterial,
} from '../src/render/shared_resource';

// The renderer's object-view teardown (removeView) and interior retire both
// dispose every geometry/material not tagged shared. These suites are the
// leak guard that was missing when rift interest churn leaked every puzzle
// prop's materials for the session: build the real prop bodies, tear them
// down through the real helper, and assert nothing unshared survives and
// nothing shared is touched.

const RIFT_PROP_TEMPLATES = [
  'rift_beacon',
  'rift_ice_goal',
  'rift_boulder',
  'rift_boulder_placed',
  'rift_boulder_pad',
  'rift_seq_rune',
  'rift_seq_rune_lit',
  'rift_pylon',
  'rift_pylon_lit',
  'rift_roller',
  'rift_locked_chest',
  'rift_chest_open',
  'rift_chest_jammed',
  'rift_treasure',
  'rift_treasure_open',
  'rift_gate',
  'rift_gate_open',
  'rift_switch',
  'rift_switch_on',
  'rift_infernal_orb',
  'rift_infernal_orb_active',
];

interface MaterialCensus {
  shared: Set<THREE.Material>;
  owned: Set<THREE.Material>;
  disposed: Set<THREE.Material>;
}

function watchMaterials(root: THREE.Object3D): MaterialCensus {
  const census: MaterialCensus = { shared: new Set(), owned: new Set(), disposed: new Set() };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      (isSharedMaterial(m) ? census.shared : census.owned).add(m);
      m.addEventListener('dispose', () => census.disposed.add(m));
    }
  });
  return census;
}

describe('disposeUnsharedMeshResources', () => {
  it('disposes unshared geometry and materials, skips shared, dedupes counts', () => {
    const root = new THREE.Group();
    const sharedGeo = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
    const sharedMat = markSharedMaterial(new THREE.MeshBasicMaterial());
    const ownedGeo = new THREE.BoxGeometry(1, 1, 1);
    const ownedMat = new THREE.MeshBasicMaterial();
    root.add(new THREE.Mesh(sharedGeo, sharedMat));
    // The same owned pair on TWO meshes must dispose (and count) once.
    root.add(new THREE.Mesh(ownedGeo, ownedMat));
    root.add(new THREE.Mesh(ownedGeo, ownedMat));
    // Array-material mesh: one shared and one owned entry.
    const arrayOwned = new THREE.MeshBasicMaterial();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [sharedMat, arrayOwned]));
    let sharedDisposed = false;
    sharedMat.addEventListener('dispose', () => {
      sharedDisposed = true;
    });
    const counts = disposeUnsharedMeshResources(root, { geometries: true, materials: true });
    expect(counts.geometries).toBe(2); // ownedGeo once + the array mesh's box
    expect(counts.materials).toBe(2); // ownedMat once + arrayOwned
    expect(sharedDisposed).toBe(false);
  });

  it('never releases InstancedMesh instance buffers (the interior registry owns that)', () => {
    // Boundary pin: view teardown frees unshared geometry/materials only.
    // InstancedMesh.dispose() (the per-build instanceMatrix buffer) belongs to
    // interior teardown via interior_resource_lifecycle.ts, and a view-side
    // dispose here would yank a live interior's instance buffer.
    const root = new THREE.Group();
    const geo = markSharedGeometry(new THREE.BoxGeometry(1, 1, 1));
    const mat = markSharedMaterial(new THREE.MeshBasicMaterial());
    const inst = new THREE.InstancedMesh(geo, mat, 4);
    root.add(inst);
    let disposed = 0;
    inst.addEventListener('dispose', () => {
      disposed++;
    });
    disposeUnsharedMeshResources(root, { geometries: true, materials: true });
    expect(disposed).toBe(0);
  });

  it('markOwnedMaterial strips the shared tag a clone inherits', () => {
    const shared = markSharedMaterial(new THREE.MeshStandardMaterial());
    const clone = shared.clone();
    // Material.copy deep-copies userData: the clone inherits the tag.
    expect(isSharedMaterial(clone)).toBe(true);
    markOwnedMaterial(clone);
    expect(isSharedMaterial(clone)).toBe(false);
    expect(isSharedMaterial(shared)).toBe(true);
  });
});

describe('rift puzzle prop teardown', () => {
  it('frees every material each prop minted and touches nothing shared', () => {
    for (const templateId of RIFT_PROP_TEMPLATES) {
      const { body } = buildRiftPuzzleProp(templateId, false);
      const census = watchMaterials(body);
      expect(census.owned.size + census.shared.size, `${templateId} builds meshes`).toBeGreaterThan(
        0,
      );
      disposeUnsharedMeshResources(body, { geometries: true, materials: true });
      for (const m of census.owned) {
        expect(census.disposed.has(m), `${templateId} leaks an owned material`).toBe(true);
      }
      for (const m of census.shared) {
        expect(census.disposed.has(m), `${templateId} disposed a SHARED material`).toBe(false);
      }
    }
  });

  it('holds material population flat across interest-churn cycles', () => {
    // The regression shape: every enter/leave cycle rebuilt the prop and
    // leaked its materials. With ownership + disposal in place, each cycle
    // frees exactly what it minted, so N cycles strand nothing.
    for (const templateId of ['rift_boulder', 'rift_roller', 'rift_gate']) {
      for (let cycle = 0; cycle < 5; cycle++) {
        const { body } = buildRiftPuzzleProp(templateId, false);
        const census = watchMaterials(body);
        disposeUnsharedMeshResources(body, { geometries: true, materials: true });
        const leaked = [...census.owned].filter((m) => !census.disposed.has(m));
        expect(leaked.length, `${templateId} cycle ${cycle}`).toBe(0);
      }
    }
  });
});

describe('door body teardown', () => {
  it('keeps the shared stone across churn but frees the wildheart recolor clone', () => {
    const plain = buildDoorBody(true, null, false);
    const plainCensus = watchMaterials(plain.body);
    // The procedural arch uses the shared doorStoneMaterial singleton.
    expect(plainCensus.shared.size).toBeGreaterThan(0);
    disposeUnsharedMeshResources(plain.body, { geometries: true, materials: true });
    for (const m of plainCensus.shared) {
      expect(plainCensus.disposed.has(m), 'shared door stone must survive churn').toBe(false);
    }

    const wildheart = buildDoorBody(true, 'wildheart_basin', false);
    const census = watchMaterials(wildheart.body);
    // The wildheart recolor is a per-view CLONE of the shared stone; it must
    // carry no inherited shared tag and must be freed with the view.
    expect(census.owned.size, 'wildheart recolor clone must be owned').toBeGreaterThan(0);
    disposeUnsharedMeshResources(wildheart.body, { geometries: true, materials: true });
    for (const m of census.owned) {
      expect(census.disposed.has(m), 'wildheart recolor clone leaked').toBe(true);
    }
  });
});

describe('rift rank badge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // badgeTexture draws on a real canvas; node has none, so hand it a
  // permissive stub (every method chain no-ops, every property write lands).
  type CallableTarget = ((...args: unknown[]) => unknown) & Record<PropertyKey, unknown>;
  function permissive(): unknown {
    const target = (() => {}) as unknown as CallableTarget;
    return new Proxy(target, {
      get: (t, prop) => {
        if (prop === Symbol.toPrimitive) return () => 0;
        t[prop] ??= permissive();
        return t[prop];
      },
      set: (t, prop, value) => {
        t[prop] = value;
        return true;
      },
      apply: () => permissive(),
    });
  }

  it('shares one tagged SpriteMaterial per tier across badges', () => {
    vi.stubGlobal('document', { createElement: () => permissive() });
    const a = buildRiftRankBadge('S');
    const b = buildRiftRankBadge('S');
    const c = buildRiftRankBadge('A');
    expect(a.material).toBe(b.material);
    expect(a.material).not.toBe(c.material);
    expect(isSharedMaterial(a.material)).toBe(true);
    expect(isSharedMaterial(c.material)).toBe(true);
  });
});
