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

/** A square texture shaped like an ETC1S map transcoded to BC7 mode 5, the
 *  form every colour map takes on a desktop GPU: 16-byte blocks whose FIRST
 *  byte is the constant mode byte, the picture in the other fifteen. */
function bc7(size: number, seed: number): THREE.CompressedTexture {
  const data = new Uint8Array((size / 4) ** 2 * 16);
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    if (i % 16 === 0) {
      data[i] = 0x20;
      continue;
    }
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    data[i] = s >>> 24;
  }
  return new THREE.CompressedTexture(
    [{ data, width: size, height: size }],
    size,
    size,
    THREE.RGBA_BPTC_Format,
  );
}

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

  // The key samples the top mip with a stride once it passes 64 KB. On a
  // power-of-two map from 1024 up that stride was a whole number of 16-byte
  // blocks, so it only ever read the mode byte, which is the same in every
  // block of every such map: all of a kit's 1024 colour maps keyed alike and
  // every building wore the first one loaded (plaster, timber and roof as
  // stone; one building's atlas on three others).
  it.each([1024, 2048, 3072])('tells two different %i px BC7 maps apart', (size) => {
    expect(kitTextureKey(bc7(size, 1))).not.toBe(kitTextureKey(bc7(size, 2)));
    expect(kitTextureKey(bc7(size, 1))).toBe(kitTextureKey(bc7(size, 1)));
  });

  it('keeps two different same-size maps of one GLB on their own materials', () => {
    const walls = bc7(1024, 11);
    const roof = bc7(1024, 12);
    const g = sceneWith(walls, roof);
    expect(shareKitTextures(g, '/models/tidehold/smithy.glb')).toBe(0);
    expect(mapOf(g, 0)).toBe(walls);
    expect(mapOf(g, 1)).toBe(roof);
    // and the pieces twin still shares the building's own copy of each
    const twin = sceneWith(bc7(1024, 11), bc7(1024, 12));
    expect(shareKitTextures(twin, '/models/tidehold/smithy.parts.glb')).toBe(2);
    expect(mapOf(twin, 0)).toBe(walls);
    expect(mapOf(twin, 1)).toBe(roof);
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
