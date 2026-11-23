import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { shardpikeProp } from '../src/render/characters/shardpike_prop';

function model() {
  const root = new THREE.Group(),
    hand = new THREE.Group(),
    holder = new THREE.Group();
  holder.userData = { heldPropHolder: true, heldSlot: 0 };
  const geometry = new THREE.BoxGeometry(0.1, 3, 0.1);
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.weaponMesh = true;
  holder.add(mesh);
  hand.add(holder);
  root.add(hand);
  return { root, hand, holder, mesh, geometry, material };
}
describe('Shardpike display-only release', () => {
  it('retires before drawing a material disposed by a skin or equipment replacement', () => {
    const h = model();
    const prop = shardpikeProp(h.root);
    expect(prop?.isUsable()).toBe(true);
    h.material.dispose();
    expect(prop?.isUsable()).toBe(false);
    expect(prop?.root.children).toHaveLength(0);
    expect(h.holder.visible).toBe(true);
  });
  it('lands its point exactly at the animated eye with a scaled, rotated rig', () => {
    const h = model();
    h.root.scale.setScalar(1.4);
    h.hand.rotation.z = 0.7;
    const prop = shardpikeProp(h.root);
    expect(prop).not.toBeNull();
    const point = new THREE.Vector3(5, 7, 12),
      target = new THREE.Vector3(5, 7, 15);
    prop?.moveTip(point, target);
    expect(prop?.sampleTip(new THREE.Vector3()).distanceTo(point)).toBeLessThan(1e-6);
    prop?.moveTip(target, target);
    expect(prop?.sampleTip(new THREE.Vector3()).distanceTo(target)).toBeLessThan(1e-6);
    prop?.dispose();
  });
  it('shares already-prepared resources and restores after an interrupted flight', () => {
    const h = model();
    const materialDispose = vi.spyOn(h.material, 'dispose');
    const geometryDispose = vi.spyOn(h.geometry, 'dispose');
    const prop = shardpikeProp(h.root);
    expect(prop).not.toBeNull();
    expect(h.holder.visible).toBe(false);
    const copy = prop?.root.children[0] as THREE.Mesh;
    expect(copy.material).toBe(h.material);
    expect(copy.geometry).toBe(h.geometry);
    prop?.dispose();
    prop?.dispose();
    expect(h.holder.visible).toBe(true);
    expect(materialDispose).not.toHaveBeenCalled();
    expect(geometryDispose).not.toHaveBeenCalled();
  });
  it('never resurrects an old weapon after an equipment replacement', () => {
    const h = model();
    const prop = shardpikeProp(h.root);
    h.holder.removeFromParent();
    const replacement = new THREE.Group();
    h.hand.add(replacement);
    prop?.dispose();
    expect(h.hand.children).toEqual([replacement]);
    expect(h.holder.parent).toBeNull();
  });
  it('does not reveal an already-hidden holder', () => {
    const h = model();
    h.holder.visible = false;
    expect(shardpikeProp(h.root)).toBeNull();
    expect(h.holder.visible).toBe(false);
  });
});
