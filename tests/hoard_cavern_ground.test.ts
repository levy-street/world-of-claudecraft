import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildHoardCavernGround } from '../src/render/hoard_cavern_ground';
import { HOARD_VALLEY_ZONE_PROFILES } from '../src/render/hoard_valley_core';

describe('cavern ground ownership', () => {
  it('shares the graded material until the last owner retires and disposes each mesh once', () => {
    const source = new THREE.MeshBasicMaterial({ vertexColors: true });
    const layout = { zMin: 0, zMax: 60, wallX: 20, dais: { x: 0, z: 50, r: 4 } };
    const a = buildHoardCavernGround(layout, HOARD_VALLEY_ZONE_PROFILES.frostveil, 7, source, true);
    const b = buildHoardCavernGround(
      layout,
      HOARD_VALLEY_ZONE_PROFILES.frostveil,
      7,
      source,
      false,
    );
    const mesh = a.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const other = b.group.children[0] as THREE.Mesh;
    expect(mesh.material).toBe(other.material);
    expect(mesh.material.color).toBe(source.color);
    expect(a.group.children).toHaveLength(2);
    expect(b.group.children).toHaveLength(1);
    const c = buildHoardCavernGround(layout, HOARD_VALLEY_ZONE_PROFILES.frostveil, 7, source, true);
    const shadow = (a.group.children[1] as THREE.Mesh).material as THREE.ShadowMaterial;
    expect(shadow).toBe((c.group.children[1] as THREE.Mesh).material);
    const shadowDispose = vi.spyOn(shadow, 'dispose');
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose');
    const materialDispose = vi.spyOn(mesh.material, 'dispose');
    const textureDispose = vi.spyOn(mesh.material.map!, 'dispose');
    a.dispose();
    a.dispose();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).not.toHaveBeenCalled();
    b.dispose();
    expect(materialDispose).not.toHaveBeenCalled();
    expect(shadowDispose).not.toHaveBeenCalled();
    c.dispose();
    expect(shadowDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
