// Moonwing Form's crown (characters/spore_halo.ts): worn only by that form, and held
// to the rig and prewarm contracts every rig-parented FX piece keeps.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  buildSporeHaloStandIn,
  SporeHalo,
  sporeHaloMaterials,
} from '../src/render/characters/spore_halo';

describe('Moonwing crown', () => {
  it('is worn by the Moonwing rig and no other', () => {
    const wearers = Object.entries(VISUALS)
      .filter(([, def]) => def.sporeHalo)
      .map(([key]) => key);
    expect(wearers).toEqual(['form_moonwing']);
  });

  it('rides the Head bone as rig FX that casts no shadow', () => {
    const model = new THREE.Group();
    const head = new THREE.Bone();
    head.name = 'Head';
    model.add(head);
    const halo = new SporeHalo(model);
    expect(halo.root?.parent).toBe(head);
    const meshes: THREE.Mesh[] = [];
    halo.root?.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    expect(meshes).toHaveLength(4);
    for (const mesh of meshes) {
      expect(mesh.userData.weaponVfxMesh).toBe(true);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.frustumCulled).toBe(false);
    }
    halo.dispose();
    expect(head.children).toHaveLength(0);
  });

  it('places the crown over the head whatever the bone axes are', () => {
    // A Tripo-style bone: lying down in bind, at head height.
    const head = new THREE.Bone();
    head.name = 'Head';
    head.position.set(0, 0.88, 0);
    head.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2));
    const root = new THREE.Group();
    root.add(head);
    root.updateMatrixWorld(true);
    const mesh = new THREE.SkinnedMesh();
    // The skeleton holds a copy, as on a cloned rig: only the name ties it to the bone.
    const skeletonBone = head.clone();
    skeletonBone.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([skeletonBone]));
    root.add(mesh);
    const halo = new SporeHalo(root);
    root.updateMatrixWorld(true);
    const at = new THREE.Vector3();
    halo.root?.getWorldPosition(at);
    expect(at.x).toBeCloseTo(0, 4);
    expect(at.y).toBeCloseTo(1.012, 4);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(halo.root?.matrixWorld ?? root.matrix);
    expect(up.y).toBeGreaterThan(0.95);
  });

  it('turns only when animated, visible and motion is allowed', () => {
    const model = new THREE.Group();
    const head = new THREE.Bone();
    head.name = 'Head';
    model.add(head);
    const halo = new SporeHalo(model);
    const scatter = halo.root?.getObjectByName('spore_halo_scatter_0') as THREE.Mesh;
    halo.update(1, true, true);
    halo.update(1, false, false);
    expect(scatter.rotation.y).toBe(0);
    halo.update(1, false, true);
    expect(scatter.rotation.y).toBeGreaterThan(0);
  });

  it('goes without a crown on a rig with no Head bone', () => {
    const halo = new SporeHalo(new THREE.Group());
    expect(halo.root).toBeNull();
    expect(() => halo.update(1, false, true)).not.toThrow();
    expect(() => halo.dispose()).not.toThrow();
  });

  it('prewarms every material the crown draws, all in the shared glow program', () => {
    const drawn = new Set<THREE.Material>();
    buildSporeHaloStandIn().traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        drawn.add(mesh.material as THREE.Material);
        expect(mesh.userData.renderCategory).toBe('vfx');
      }
    });
    expect([...drawn].sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      [...sporeHaloMaterials()].sort((a, b) => a.name.localeCompare(b.name)),
    );
    for (const material of sporeHaloMaterials()) {
      expect(material.type).toBe('MeshBasicMaterial');
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
    }
  });
});
