import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  disposeOwnedWeaponSkinMaterials,
  markOwnedWeaponSkinMaterials,
} from '../src/render/characters/weapon_skin_materials';

describe('owned weapon-skin material disposal', () => {
  it('disposes preview clones once while preserving unowned cached materials', () => {
    const owned = new THREE.MeshBasicMaterial();
    const shared = new THREE.MeshBasicMaterial();
    const ownedDispose = vi.spyOn(owned, 'dispose');
    const sharedDispose = vi.spyOn(shared, 'dispose');
    const root = new THREE.Group();
    const first = new THREE.Mesh(new THREE.BufferGeometry(), owned);
    const second = new THREE.Mesh(new THREE.BufferGeometry(), owned);
    const unowned = new THREE.Mesh(new THREE.BufferGeometry(), shared);
    markOwnedWeaponSkinMaterials(first);
    markOwnedWeaponSkinMaterials(second);
    root.add(first, second, unowned);

    disposeOwnedWeaponSkinMaterials(root);

    expect(ownedDispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled();
  });

  it('also disposes original and effect materials retained by an equipped visual', () => {
    const base = new THREE.MeshBasicMaterial();
    const ghost = new THREE.MeshBasicMaterial();
    const soul = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), ghost);
    markOwnedWeaponSkinMaterials(mesh);
    const root = new THREE.Group();
    root.add(mesh);
    const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>([[mesh, base]]);
    const ghosts = new Map<THREE.Material, THREE.Material>([[base, ghost]]);
    const souls = new Map<THREE.Material, THREE.Material>([[base, soul]]);
    const spies = [base, ghost, soul].map((material) => vi.spyOn(material, 'dispose'));

    disposeOwnedWeaponSkinMaterials(root, originals, [ghosts, souls]);

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(ghosts.size).toBe(0);
    expect(souls.size).toBe(0);
  });
});
