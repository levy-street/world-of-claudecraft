import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createFluidPickMaterial, volumeOverlayMaterial } from '../src/editor/3d/fluid_pick_proxy';

describe('fluid pick proxies', () => {
  it('keeps the invisible water proxy raycastable without writing color or depth', () => {
    const material = createFluidPickMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 8), material);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0));
    expect(raycaster.intersectObject(mesh).length).toBeGreaterThan(0);
    expect(mesh.visible).toBe(true);
    expect(material.opacity).toBe(0);
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(false);
    mesh.geometry.dispose();
    material.dispose();
  });

  it.each(['fluid/water', 'fluid/lava', 'fluid/acid', 'fluid/spectral'])(
    'never gives %s a filled collider overlay while selecting or deselecting',
    (assetId) => {
      const normal = new THREE.MeshBasicMaterial();
      const selected = new THREE.MeshBasicMaterial();
      const fluid = createFluidPickMaterial();
      expect(volumeOverlayMaterial(assetId, false, normal, selected, fluid)).toBe(fluid);
      expect(volumeOverlayMaterial(assetId, true, normal, selected, fluid)).toBe(fluid);
      expect(volumeOverlayMaterial('collider/box', false, normal, selected, fluid)).toBe(normal);
      expect(volumeOverlayMaterial('collider/box', true, normal, selected, fluid)).toBe(selected);
      normal.dispose();
      selected.dispose();
      fluid.dispose();
    },
  );
});
