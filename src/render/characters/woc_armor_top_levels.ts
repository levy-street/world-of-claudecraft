// The high armor tier, assembled (woc_armor_core.ts, 2026-10-03): a set's medium file carries
// every map at half resolution with its whole mip chain, and its top file carries the top mip
// level of the same maps and nothing else. A texture's top level is three quarters of its
// bytes and only a close-up samples it, so every character draws the medium file and the few
// seen up close have the top level laid over it here: one new CompressedTexture per map whose
// levels are [the top file's level 0, ...the medium texture's own levels], sampled exactly as
// the medium texture is, on clones of the medium file's materials.
//
// Nothing is copied: level 0 is the top parse's own block data (the caller lets that parse go
// once this returns) and the levels below are the medium texture's own level objects, shared.
// The medium file's textures, materials and geometry are never written to (every other wearer
// keeps drawing them), so what this module makes (the combined textures, the material clones,
// the scene over them) is exactly what its owner frees (woc_armor_packs.ts).
//
// Textures pair by NAME: the build gives a map the same image name in both files
// (scripts/assets/woc_character/build_woc_split.mjs). A pair is used only when it fits: both
// plain compressed 2D textures of one format, level 0 exactly the size the half's level 0
// halves from, and real block data in it (the GPU sizes the whole chain off level 0). A
// texture with no partner that fits keeps drawing the medium file's own, and is named for the
// caller to log. Three-side only: the store and its tests drive it with real textures, no GL.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/** What an assembly made, all of it owned by the caller. */
export interface WocArmorTopAssembly {
  /** A clone of the medium scene's nodes wearing the material clones: what a high pack's parts
   *  are prepared from. Its geometry is the medium parse's own. */
  readonly scene: THREE.Object3D;
  /** One clone per medium material, drawing the combined textures where a pair fit. */
  readonly materials: readonly THREE.Material[];
  /** Every combined texture (one per medium texture a pair fit for; the medium textures of one
   *  image share one Source, so one GPU texture). */
  readonly textures: readonly THREE.CompressedTexture[];
  /** The medium textures drawn as they are, by name: the top file has no partner that fits. */
  readonly unpaired: readonly string[];
}

/** Every texture a material draws, by the slot it fills (map, normalMap, aoMap, ...). */
export function wocMaterialTextures(material: THREE.Material): [string, THREE.Texture][] {
  const out: [string, THREE.Texture][] = [];
  for (const [slot, value] of Object.entries(material)) {
    if (value && (value as THREE.Texture).isTexture) out.push([slot, value as THREE.Texture]);
  }
  return out;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/** A plain 2D compressed texture with its levels in hand (never an array or a cube). */
function plainCompressed(texture: THREE.Texture | undefined): texture is THREE.CompressedTexture {
  const t = texture as
    | (THREE.CompressedTexture & {
        isCompressedArrayTexture?: boolean;
        isCompressedCubeTexture?: boolean;
      })
    | undefined;
  return (
    t?.isCompressedTexture === true &&
    t.isCompressedArrayTexture !== true &&
    t.isCompressedCubeTexture !== true &&
    Array.isArray(t.mipmaps) &&
    t.mipmaps.length > 0
  );
}

/** Sample `to` exactly as `from` samples: everything a texture carries but its levels and its
 *  source. A compressed texture brings its own levels, so three never generates any. */
function copySampling(to: THREE.Texture, from: THREE.Texture): void {
  to.name = from.name;
  to.mapping = from.mapping;
  to.channel = from.channel;
  to.wrapS = from.wrapS;
  to.wrapT = from.wrapT;
  to.magFilter = from.magFilter;
  to.minFilter = from.minFilter;
  to.anisotropy = from.anisotropy;
  to.colorSpace = from.colorSpace;
  to.flipY = from.flipY;
  to.premultiplyAlpha = from.premultiplyAlpha;
  to.unpackAlignment = from.unpackAlignment;
  to.internalFormat = from.internalFormat;
  to.offset.copy(from.offset);
  to.repeat.copy(from.repeat);
  to.center.copy(from.center);
  to.rotation = from.rotation;
  to.matrixAutoUpdate = from.matrixAutoUpdate;
  to.matrix.copy(from.matrix);
  to.userData = { ...from.userData };
  to.generateMipmaps = false;
}

/**
 * The full texture of one map: the top file's level 0 over the medium texture's levels, as a
 * new CompressedTexture on a new Source that samples as the medium texture does. Null when the
 * pair does not fit (see the header): the medium texture then draws on its own.
 */
export function combineWocTopLevel(
  half: THREE.Texture,
  top: THREE.Texture | undefined,
): THREE.CompressedTexture | null {
  if (!plainCompressed(half) || !plainCompressed(top)) return null;
  if (top.format !== half.format || top.type !== half.type) return null;
  const level0 = top.mipmaps[0];
  const below = half.mipmaps[0];
  if (!(level0.data?.length > 0)) return null;
  if (below.width !== Math.max(1, level0.width >> 1)) return null;
  if (below.height !== Math.max(1, level0.height >> 1)) return null;
  const out = new THREE.CompressedTexture(
    [level0, ...half.mipmaps],
    level0.width,
    level0.height,
    half.format,
    half.type,
  );
  copySampling(out, half);
  out.needsUpdate = true;
  return out;
}

/**
 * Lay the top file's levels over the medium file (see the header). `medium` is the medium
 * parse's scene and `top` the top parse's: neither is written to. Every texture of every
 * material the medium scene draws looks for its partner by name; the scene returned is a clone
 * of the medium scene's nodes with each mesh wearing its material's clone.
 */
export function assembleWocArmorTop(
  medium: THREE.Object3D,
  top: THREE.Object3D,
): WocArmorTopAssembly {
  // by name; two different textures of one name pair neither (never a guess between them)
  const tops = new Map<string, THREE.Texture | null>();
  top.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of materialsOf(mesh)) {
      for (const [, texture] of wocMaterialTextures(material)) {
        if (!texture.name) continue;
        const seen = tops.get(texture.name);
        tops.set(texture.name, seen === undefined || seen === texture ? texture : null);
      }
    }
  });
  // one verdict per medium texture, and one Source per medium image: the medium textures of
  // one image (GLTFLoader clones a texture per sampler) stay one GPU texture at high too
  const combined = new Map<THREE.Texture, THREE.CompressedTexture | null>();
  const byImage = new Map<THREE.Texture['source'], THREE.CompressedTexture>();
  const textures: THREE.CompressedTexture[] = [];
  const unpaired = new Set<string>();
  const full = (half: THREE.Texture): THREE.CompressedTexture | null => {
    if (combined.has(half)) return combined.get(half) ?? null;
    const first = byImage.get(half.source);
    let out: THREE.CompressedTexture | null = null;
    if (first) {
      out = first.clone();
      copySampling(out, half);
    } else {
      out = combineWocTopLevel(half, tops.get(half.name) ?? undefined);
      if (out) byImage.set(half.source, out);
    }
    combined.set(half, out);
    if (out) textures.push(out);
    else unpaired.add(half.name || '(unnamed)');
    return out;
  };
  const clones = new Map<THREE.Material, THREE.Material>();
  const cloneOf = (material: THREE.Material): THREE.Material => {
    let out = clones.get(material);
    if (out) return out;
    // the same program key as the material it clones, so a high pack links nothing its medium
    // pack has not: clone() drops an instance onBeforeCompile (material_clone_hooks.ts), which
    // a file material straight from the loader never carries, and one that does is kept
    out = material.clone();
    if (Object.hasOwn(material, 'onBeforeCompile')) out.onBeforeCompile = material.onBeforeCompile;
    if (Object.hasOwn(material, 'customProgramCacheKey')) {
      out.customProgramCacheKey = material.customProgramCacheKey;
    }
    for (const [slot, half] of wocMaterialTextures(material)) {
      const texture = full(half);
      if (texture) (out as unknown as Record<string, THREE.Texture>)[slot] = texture;
    }
    clones.set(material, out);
    return out;
  };
  const scene = cloneSkinned(medium);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(cloneOf)
      : cloneOf(mesh.material);
  });
  return { scene, materials: [...clones.values()], textures, unpaired: [...unpaired] };
}

/** Let go of a top parse once its level 0 data has moved into an assembly: dispose of what the
 *  loader made for it (the textures, never uploaded; the material; the degenerate mesh). The
 *  level objects an assembly took stay alive in its textures. */
export function disposeWocArmorTopParse(top: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  top.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    for (const material of materialsOf(mesh)) {
      for (const [, texture] of wocMaterialTextures(material)) textures.add(texture);
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}
