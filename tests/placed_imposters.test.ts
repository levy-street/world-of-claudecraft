import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PlacedImposters } from '../src/render/placed_imposters';

describe('placed imposter shader seed', () => {
  it.each([64, 128])(
    'has the eventual mapped shader shape before a %i px atlas exists',
    (cellPx) => {
      const view = new PlacedImposters({ cellPx });
      try {
        const map = (view.mesh.material as THREE.MeshLambertMaterial).map;
        expect(map).toBeInstanceOf(THREE.DataTexture);
        if (!(map instanceof THREE.DataTexture)) throw new Error('Missing shader seed');
        expect(map.colorSpace).toBe(THREE.NoColorSpace);
        expect(map.channel).toBe(0);
        expect(map.image.width).toBe(1);
        expect(map.image.height).toBe(1);
        expect(map.image.data).toEqual(new Uint8Array([0, 0, 0, 0]));
        expect(view.mesh.visible).toBe(false);
        expect(view.instanceCount).toBe(0);
        expect(view.bakedCount).toBe(0);
      } finally {
        view.dispose();
      }
    },
  );

  it('keeps the seed alive through clear and releases it with its owner', () => {
    const view = new PlacedImposters();
    const map = (view.mesh.material as THREE.MeshLambertMaterial).map;
    expect(map).not.toBeNull();
    const disposed = vi.fn();
    map?.addEventListener('dispose', disposed);
    view.clear();
    expect(disposed).not.toHaveBeenCalled();
    view.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });
});
