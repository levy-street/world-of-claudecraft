import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isSharedKitTextureUrl,
  kitTextureKey,
  resetSharedKitTextures,
  shareKitTextures,
} from '../src/render/assets/shared_kit_textures';

function ktx(bytes: number[], w = 4, h = 4): THREE.CompressedTexture {
  const data = new Uint8Array(bytes);
  return new THREE.CompressedTexture(
    [{ data, width: w, height: h }],
    w,
    h,
    THREE.RGBA_ASTC_4x4_Format,
  );
}

function sceneWith(...textures: THREE.Texture[]): THREE.Group {
  const g = new THREE.Group();
  for (const t of textures) {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: t })));
  }
  return g;
}

const mapOf = (g: THREE.Object3D, i: number) =>
  ((g.children[i] as THREE.Mesh).material as THREE.MeshStandardMaterial).map;

afterEach(() => resetSharedKitTextures());

describe('shared kit textures', () => {
  it('only takes the Tidehold town kit GLBs', () => {
    expect(isSharedKitTextureUrl('/models/tidehold/bank.glb?x=1')).toBe(true);
    expect(isSharedKitTextureUrl('/models/tidehold_kit/wall_section.glb')).toBe(false);
    expect(isSharedKitTextureUrl('/models/props/barrel.glb')).toBe(false);
    // the Tidehold town kit and its Edit-pieces twins; the older castles are not in it
    expect(isSharedKitTextureUrl('/media/models/tidehold/tavern_b.3fa2c1d0e9ab.glb')).toBe(true);
    expect(isSharedKitTextureUrl('/models/tidehold/house_c.parts.glb')).toBe(true);
    expect(isSharedKitTextureUrl('/models/tidehold/castle_b.glb')).toBe(false);
  });

  it('keys by content, shape and sampling', () => {
    expect(kitTextureKey(ktx([1, 2, 3, 4]))).toBe(kitTextureKey(ktx([1, 2, 3, 4])));
    expect(kitTextureKey(ktx([1, 2, 3, 4]))).not.toBe(kitTextureKey(ktx([1, 2, 3, 5])));
    const srgb = ktx([1, 2, 3, 4]);
    srgb.colorSpace = THREE.SRGBColorSpace;
    expect(kitTextureKey(srgb)).not.toBe(kitTextureKey(ktx([1, 2, 3, 4])));
    expect(kitTextureKey(new THREE.Texture())).toBeNull();
  });

  it('swaps a later GLB onto the first identical texture and drops the copy', () => {
    const first = ktx([9, 9, 9, 9]);
    const a = sceneWith(first);
    expect(shareKitTextures(a, '/models/tidehold/house_a.glb')).toBe(0);
    const copy = ktx([9, 9, 9, 9]);
    let disposed = false;
    copy.addEventListener('dispose', () => {
      disposed = true;
    });
    const other = ktx([7, 7, 7, 7]);
    const b = sceneWith(copy, other, copy);
    expect(shareKitTextures(b, '/models/tidehold/house_b.glb')).toBe(1);
    expect(mapOf(b, 0)).toBe(first);
    expect(mapOf(b, 2)).toBe(first);
    expect(mapOf(b, 1)).toBe(other);
    expect(disposed).toBe(true);
  });

  it('leaves every other asset alone', () => {
    shareKitTextures(sceneWith(ktx([5, 5, 5, 5])), '/models/tidehold/tavern.glb');
    const mine = ktx([5, 5, 5, 5]);
    const g = sceneWith(mine);
    expect(shareKitTextures(g, '/models/props/crate.glb')).toBe(0);
    expect(mapOf(g, 0)).toBe(mine);
  });

  it('forgets a canonical texture once it is disposed', () => {
    const first = ktx([3, 3, 3, 3]);
    shareKitTextures(sceneWith(first), '/models/tidehold/tavern.glb');
    first.dispose();
    const next = ktx([3, 3, 3, 3]);
    const g = sceneWith(next);
    expect(shareKitTextures(g, '/models/tidehold/smithy.glb')).toBe(0);
    expect(mapOf(g, 0)).toBe(next);
  });
});
