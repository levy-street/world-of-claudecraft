// Share identical KTX2 textures across a kit's GLBs.
//
// The Tidehold town kit takes part (houses, taverns, smithy, market, hall,
// shops and their Edit-pieces twins; scripts/assets/blender_tidehold/bl_town.py).
// It is built from ONE set of tiling maps and one detail atlas, but a GLB
// embeds its own copy of every map it wears, and the loader keeps each GLB's
// textures to itself: the same 1024 ashlar was on the GPU once per piece, ~45 MB of copies
// across the kit. After a kit GLB parses, this swaps each texture for the
// first byte-identical one already loaded and drops the copy before it is
// ever uploaded.
//
// Deliberately NARROW: only kit URLs take part. A texture shared between two
// arbitrary assets would leak any per-asset tweak (a repeat, an offset, a
// filter) from one into the other; the kit's maps are never mutated per piece.
import type * as THREE from 'three';
import { dismissKtx2Source } from './ktx2_mip_release';

const KIT_URL =
  /\/tidehold\/(?:house_[a-e]|tavern(?:_b)?|smithy|market|hall|shop_[ab]|bank)(?:\.parts)?(?:\.[0-9a-f]+)?\.glb$/i;

export function isSharedKitTextureUrl(url: string): boolean {
  return KIT_URL.test(url.split('?')[0]);
}

const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const;

interface MipLike {
  data?: ArrayBufferView;
  width?: number;
  height?: number;
}

interface TextureLike {
  isCompressedTexture?: boolean;
  mipmaps?: MipLike[];
  format?: number;
  colorSpace?: string;
  wrapS?: number;
  wrapT?: number;
  flipY?: boolean;
  channel?: number;
  image?: { width?: number; height?: number };
  addEventListener?: (type: 'dispose', cb: () => void) => void;
  dispose?: () => void;
}

/** A content key for a transcoded KTX2 texture: its shape, sampling and an
 *  FNV-1a hash of its top mip (sampled with a stride past 64 KB, which on
 *  block-compressed data is still thousands of distinct blocks). Null for
 *  anything that is not a compressed texture with data in hand. */
export function kitTextureKey(tex: TextureLike): string | null {
  if (!tex?.isCompressedTexture || !tex.mipmaps?.length) return null;
  const top = tex.mipmaps[0]?.data;
  if (!top) return null;
  const bytes = new Uint8Array(top.buffer, top.byteOffset, top.byteLength);
  const stride = Math.max(1, Math.floor(bytes.length / 65536));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += stride) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  let total = 0;
  for (const m of tex.mipmaps) total += m.data?.byteLength ?? 0;
  return [
    tex.format,
    tex.image?.width,
    tex.image?.height,
    tex.mipmaps.length,
    total,
    tex.colorSpace,
    tex.wrapS,
    tex.wrapT,
    tex.flipY,
    tex.channel,
    (h >>> 0).toString(16),
  ].join(':');
}

const canonical = new Map<string, TextureLike>();

/** Swap every kit texture in `scene` for its first-loaded identical twin. */
export function shareKitTextures(scene: THREE.Object3D | undefined, url: string): number {
  if (!scene || typeof scene.traverse !== 'function' || !isSharedKitTextureUrl(url)) return 0;
  let shared = 0;
  const dropped = new Set<TextureLike>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const slots = mat as unknown as Record<string, TextureLike | null | undefined>;
      for (const slot of SLOTS) {
        const tex = slots[slot];
        if (!tex) continue;
        const key = kitTextureKey(tex);
        if (!key) continue;
        const twin = canonical.get(key);
        if (twin && twin !== tex) {
          slots[slot] = twin;
          if (!dropped.has(tex)) {
            dropped.add(tex);
            shared++;
          }
          continue;
        }
        if (!twin) {
          canonical.set(key, tex);
          tex.addEventListener?.('dispose', () => {
            if (canonical.get(key) === tex) canonical.delete(key);
          });
        }
      }
    }
  });
  // The copies were never uploaded: release their stashed KTX2 sources (the
  // mip-release registry would otherwise hold them) and their data.
  for (const tex of dropped) {
    dismissKtx2Source(tex);
    tex.dispose?.();
  }
  return shared;
}

/** Test seam: forget every canonical texture. */
export function resetSharedKitTextures(): void {
  canonical.clear();
}
