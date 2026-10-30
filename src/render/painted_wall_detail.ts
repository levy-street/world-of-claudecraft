// The three.js half of the painted walls' stone relief (painted_wall_detail_core.ts owns
// the GLSL, the gate, the knobs and the reasoning): the one shared detail normal, and the
// layer placedBuildingMaterial (eastbrook_placed_building.ts) puts on the re-baked walls.
//
// WHICH: decided once per material, when the placed building converts its materials, from
// the material's name and the mesh wearing it (the re-baked walls carry uv1; a look's walls
// and every old file do not, so they are never touched): the mask guard on every re-baked
// walls material of every tier, the relief on top of it on the Standard tiers once the
// detail normal is resident. The program a material links never changes under it.
//
// GPU preparation (src/render/CLAUDE.md, "GPU work"): the layer adds no producer and no
// lane. A walls material links where it always did, behind its town's reveal gate (every
// building group is a reveal root of the town's static key), and its key is this layer's
// token chained onto the material's own, the same string for every re-baked walls
// material of a variant: one program per base program, never one per building. The camera
// fade's twin is a hook-preserving clone (material_clone_hooks.ts re-attaches the layer
// from the source, so the twin links the program the flip draws); the dithered ghost
// chains on top of it. The detail normal is a uniform, so the material also exposes it as
// `uniforms` (the wall_finishes.ts precedent): the gate's upload lane enumerates that
// surface and uploads the texture as a budgeted unit before the reveal draw, not inside it.
//
// The texture is a structure texture like detail_normals.ts's: loaded once through the
// KTX2 loader on the Standard profiles only (the Lambert tiers never sample it), held for
// the session as the town's own building textures are (a standalone KTX2 keeps its CPU
// mips, so a renderer rebuild re-uploads it), and never disposed under a drawn material.
import * as THREE from 'three';
import { loadKtx2Texture } from './assets/loader';
import { mediaAssetExists } from './assets/media';
import { registerDeferredPreload } from './assets/preload';
import { GFX, type GfxSettings } from './gfx';
import {
  PAINTED_WALL_DETAIL_FADE,
  PAINTED_WALL_DETAIL_STRENGTH,
  PAINTED_WALL_DETAIL_URL,
  PAINTED_WALL_DETAIL_UV_ATTRIBUTE,
  type PaintedWallDetailVariant,
  paintedWallDetailProgramKey,
  paintedWallDetailStrengthFromQuery,
  paintedWallDetailVariant,
  patchPaintedWallDetailShader,
} from './painted_wall_detail_core';
import { applyTextureAnisotropy } from './texture_anisotropy';

// Read once at module load: the variant is compiled into programs, so a change needs a
// reload. A host without a location (Node tests, tools) runs the shipped strength.
const sessionStrength =
  typeof location === 'undefined'
    ? PAINTED_WALL_DETAIL_STRENGTH
    : paintedWallDetailStrengthFromQuery(location.search);

/** The one uniform set every patched walls program reads, by reference. */
const detailUniforms = {
  uPaintedWallDetailMap: { value: null as THREE.Texture | null },
  uPaintedWallDetailStrength: { value: sessionStrength },
  uPaintedWallDetailFade: {
    value: new THREE.Vector2(PAINTED_WALL_DETAIL_FADE.start, PAINTED_WALL_DETAIL_FADE.end),
  },
};

let detailTask: Promise<void> | null = null;

/** Prepare the shared detail normal for an explicit target profile (the boot lane passes
 *  the live one, a graphics rebuild the profile about to be applied). */
export function preparePaintedWallDetailProfileAssets(
  target: Readonly<GfxSettings>,
): Promise<void> {
  if (!target.standardMaterials || sessionStrength <= 0) return Promise.resolve();
  if (detailUniforms.uPaintedWallDetailMap.value) return Promise.resolve();
  if (detailTask) return detailTask;
  // A checkout whose bake has not landed the texture asks for nothing (the walls keep the
  // mask guard): the media manifest is the list of files that exist.
  if (!mediaAssetExists(PAINTED_WALL_DETAIL_URL)) return Promise.resolve();
  detailTask = loadKtx2Texture(PAINTED_WALL_DETAIL_URL, { repeat: true })
    .then((texture) => {
      // A clone, so the anisotropy stamp never writes the loader's cached instance; it
      // shares the transcoded mips (one fetch, one transcode).
      const detail = texture.clone();
      applyTextureAnisotropy(detail, 'normal');
      detail.needsUpdate = true;
      detailUniforms.uPaintedWallDetailMap.value = detail;
    })
    .catch((err) => {
      detailTask = null;
      throw err;
    });
  return detailTask;
}

// Guarded like the town's own source loads (eastbrook_town.ts): a plain-Node host never
// opens the boot lane for it.
if (typeof window !== 'undefined') {
  registerDeferredPreload(() => preparePaintedWallDetailProfileAssets(GFX));
}

/** The shared detail normal once resident (null before, and on the Lambert profiles). */
export function paintedWallDetailTexture(): THREE.Texture | null {
  return detailUniforms.uPaintedWallDetailMap.value;
}

/** The materials that carry the layer and the variant each was built with. A clone takes
 *  the layer only when its source carried it, never a layer it did not have. */
const patched = new WeakMap<THREE.Material, PaintedWallDetailVariant>();

/** Which layer a material carries, or null (tests, the clone re-attach). */
export function paintedWallDetailVariantOf(
  material: THREE.Material,
): PaintedWallDetailVariant | null {
  return patched.get(material) ?? null;
}

function attachLayer(material: THREE.Material, variant: PaintedWallDetailVariant): void {
  if (patched.has(material)) return;
  patched.set(material, variant);
  const previousCompile = material.onBeforeCompile;
  const previousCompileSource = previousCompile.toString();
  const previousProgramKey = material.customProgramCacheKey.bind(material);
  const key = paintedWallDetailProgramKey(variant);
  // Idempotent and stateless, as the dry compile requires (src/render/CLAUDE.md, the shader
  // warm gate): a pure rewrite of the source it is handed plus the SHARED uniform objects,
  // nothing of the shader kept.
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    const out = patchPaintedWallDetailShader(shader, variant);
    shader.vertexShader = out.vertexShader;
    shader.fragmentShader = out.fragmentShader;
    if (variant === 'detail') Object.assign(shader.uniforms, detailUniforms);
  };
  material.customProgramCacheKey = () => `${key}|${previousCompileSource}|${previousProgramKey()}`;
  // The upload lane's enumeration surface (see the header); three ignores `uniforms` on a
  // built-in material.
  if (variant === 'detail') Object.assign(material, { uniforms: detailUniforms });
  material.needsUpdate = true;
}

/**
 * The layer on one freshly converted placed-building material (`geometry` is the mesh's):
 * the mask guard on a re-baked walls material, plus the relief on the Standard tiers once
 * the detail normal is resident. A no-op for every other material and every mesh without
 * uv1 (the looks, the old files, roofs, props, interiors). Returns the variant attached.
 */
export function applyPaintedWallDetail(
  material: THREE.Material,
  geometry: THREE.BufferGeometry | undefined,
): PaintedWallDetailVariant | null {
  const variant = paintedWallDetailVariant({
    materialName: material.name,
    hasUv1: geometry?.getAttribute(PAINTED_WALL_DETAIL_UV_ATTRIBUTE) !== undefined,
    standard: (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true,
    detailReady: detailUniforms.uPaintedWallDetailMap.value !== null,
    strength: sessionStrength,
  });
  if (variant) attachLayer(material, variant);
  return variant;
}

/** Re-attach the layer to a Material.clone() of a patched material (material_clone_hooks.ts):
 *  clone() drops the hook, so the clone would draw the bare walls (the mask as coverage
 *  included) and link a program of its own. No-op for any other source. */
export function reapplyPaintedWallDetailToClone(
  source: THREE.Material,
  clone: THREE.Material,
): void {
  const variant = patched.get(source);
  if (variant) attachLayer(clone, variant);
}

/** Test seam: the detail normal as if the boot lane had resolved it (null: not resident). */
export function setPaintedWallDetailTextureForTest(texture: THREE.Texture | null): void {
  detailUniforms.uPaintedWallDetailMap.value = texture;
  detailTask = null;
}

/** Test view of the shared uniform set. */
export const paintedWallDetailInternalsForTest = {
  uniforms: detailUniforms,
  sessionStrength: (): number => sessionStrength,
};
