// Which textures under a gated root are still COLD, decided with no GL call.
//
// A compile gate links programs; it never touches WebGLTextures. three's
// compileAsync reaches getProgram/prepareMaterial and stops there, so a settled
// gate means "programs linked, uniform tables warmed" and every texture the
// root draws is still uploaded inside its reveal frame, unbudgeted, after the
// gate machinery already spent effort to make that frame cheap. This core is
// the enumeration half of the fix (texture_prep_lane.ts is the pacing half).
//
// Residency is read exactly the way WebGLTextures.setTexture2D reads it: the
// per-texture property record holds `__webglTexture` once the object exists and
// `__version` is stamped to `texture.version` at the end of uploadTexture, so a
// record with both, matching, is what three itself treats as "nothing to do".
// `__webglInit` alone is NOT enough: it only says a dispose listener was
// attached. The check must also never re-arm `needsUpdate`, because
// assets/ktx2_mip_release.ts stubs a compressed texture's CPU data after upload
// and a forced re-upload would come back black.
//
// Enumerate at the GATE, i.e. after the producer finished authoring the
// material: three re-applies texture parameters only when `__version` goes
// stale, so anything that sets anisotropy or wrapS after our upload silently
// keeps the pre-upload state.
//
// Pure core contract: no three import (the structural texture shape below is
// all it reads), no DOM, no clocks, no randomness. Registered in
// RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/texture_prep_core.test.ts.
import { collectPrewarmTextures } from './texture_prewarm';

/** The slice of a three Texture this decision reads. */
export interface TexturePrepTexture {
  readonly version?: number;
  readonly isRenderTargetTexture?: boolean;
  readonly isExternalTexture?: boolean;
  readonly isVideoTexture?: boolean;
  /** The source three uploads from: null while a loader has not delivered
   *  it, `complete === false` while an HTMLImageElement is still decoding. */
  readonly image?: { readonly complete?: boolean } | null;
}

/** The slice of `WebGLRenderer.properties` this decision reads (three types the
 *  per-object record as `unknown`). */
export interface TexturePropertiesLike {
  get(texture: object): unknown;
}

/** Anything the shared walk can traverse: a scene, a group, a gated root. */
export interface TexturePrepRoot {
  traverse(callback: (object: unknown) => void): void;
}

interface TextureGpuRecord {
  __webglTexture?: unknown;
  __version?: number;
}

// The shared enumeration is written against three's types; adapting it once
// here is what lets this core stay three-free while still walking exactly the
// same slots (ShaderMaterial uniforms and uniform ARRAYS included).
const collectInto = collectPrewarmTextures as unknown as (
  root: TexturePrepRoot,
  out: Set<TexturePrepTexture>,
) => void;

/**
 * Whether three already holds an up-to-date GPU object for `texture`, so
 * uploading it again would be a no-op.
 */
export function isTextureResident(
  properties: TexturePropertiesLike,
  texture: TexturePrepTexture,
): boolean {
  const record = properties.get(texture as object) as TextureGpuRecord | undefined;
  if (!record) return false;
  return record.__webglTexture !== undefined && record.__version === texture.version;
}

/**
 * Whether this lane may upload `texture` at all. A render-target texture lives
 * GPU-side already, an external and a video texture have no image source three
 * would upload from here, three uploads nothing for version 0, and a texture
 * whose image has not arrived (null) or not finished decoding (an
 * HTMLImageElement with `complete === false`) is refused by three's
 * setTexture2D with a warning and a stale __version: it would never read
 * resident and be re-queued, and re-warned, at every gate.
 */
export function isTexturePrepCandidate(texture: TexturePrepTexture): boolean {
  if (texture.isRenderTargetTexture === true) return false;
  if (texture.isExternalTexture === true) return false;
  if (texture.isVideoTexture === true) return false;
  if (texture.image === null || texture.image === undefined) return false;
  if (texture.image.complete === false) return false;
  return (texture.version ?? 0) > 0;
}

/**
 * Every texture under `root` that the gate's upload step should pay for, in
 * traversal order and deduplicated. `isInFlight` is the renderer's own chunked
 * upload path (Renderer.textureUploadTasks): a texture already being uploaded
 * there is skipped, or the two paths race on the same object.
 */
export function collectNonResidentTextures(
  properties: TexturePropertiesLike,
  root: TexturePrepRoot,
  isInFlight?: (texture: TexturePrepTexture) => boolean,
): TexturePrepTexture[] {
  const found = new Set<TexturePrepTexture>();
  collectInto(root, found);
  const cold: TexturePrepTexture[] = [];
  for (const texture of found) {
    if (!isTexturePrepCandidate(texture)) continue;
    if (isTextureResident(properties, texture)) continue;
    if (isInFlight?.(texture) === true) continue;
    cold.push(texture);
  }
  return cold;
}
