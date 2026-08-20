// The compile gate's UPLOAD step, spread over the GPU work queue instead of
// landing in the reveal frame.
//
// Why it exists: a settled gate means programs linked and uniform tables
// warmed, never a single byte uploaded (see texture_prep_core.ts). The gated
// body, the streamed cell, the zone feature therefore paid every cold texture
// inside the very frame the gate exists to make cheap, and an uncompressed
// per-look layer with mipmaps (the 512 makeup and the 1024 stubble decals build
// their whole chain inside the upload) is a real unit, not a rounding error.
//
// Why one unit per texture. Same argument as the touch tail: as one batch the
// step is unbudgetable, while one texture per queue unit lets the per-frame
// admission take two in a frame with headroom and none in a frame without. A
// unit can still be big (the production worst single texSubImage2D was 368 ms),
// which is tolerable only because the budget may refuse a candidate and the
// starvation rule guarantees it is admitted eventually.
//
// Sequential and never releaseTail: an upload is main-thread driver-blocking
// work with no off-thread arm to release to, so overlapping units would only
// make one frame carry several of them.
//
// Order inside a gate is LINK, then these UPLOADS, then the touch tail, then
// settle. Uploads first because the touch's round trip flushes behind
// everything already queued on the GPU process, so paying them after the touch
// would simply be measured by it.
//
// Deliberately NOT wrapped in the colour-target dance compilePrewarmColorPrograms
// does: initTexture dispatches on the texture's own flags and ends with
// state.unbindTexture(), so unlike compileAsync it never reads the bound render
// target and there is nothing to restore.
import type * as THREE from 'three';
import { GPU_WORK_PRIORITY } from './background_gpu_queue';
import { collectNonResidentTextures, type TexturePropertiesLike } from './texture_prep_core';
import { type TextureUploadTarget, uploadDataTextureInChunks } from './texture_upload';

/** The slice of the background GPU queue this lane needs. */
export interface TexturePrepQueue {
  run<T>(work: () => T | Promise<T>, priority?: number, label?: string): Promise<T>;
}

/** The base label of every world upload piece. Its KIND (the part before the
 *  colon, with the size class of texturePieceSizeClass appended) is what the
 *  budget learns a cost for, priced apart from `touch:program` and
 *  `texture-chunk-upload`. */
export const TEXTURE_PREP_LABEL = 'upload:texture';

/** The second contexts' own kind (paperdoll, portrait) for when they move onto
 *  this lane (today they still run their sliced upload): a preview upload runs
 *  on its own GL context against a catalog rig, so sharing the world estimate
 *  would let the budget admit a whole open's worth of pieces into one frame.
 *  Mirrors PREVIEW_LINKED_PROGRAM_TOUCH_LABEL. */
export const PREVIEW_TEXTURE_PREP_LABEL = 'upload-preview:texture';

/** The queue priority a gate's upload pieces ride at: an actionable gate keeps
 *  its own (the actionable floor); every other gate's pieces drop to
 *  TAIL_PIECE, below every link submission. Mirrors
 *  linkedProgramTouchPriority. */
export function texturePrepPriority(gatePriority: number): number {
  return gatePriority >= GPU_WORK_PRIORITY.ACTIONABLE_VIEW
    ? gatePriority
    : GPU_WORK_PRIORITY.TAIL_PIECE;
}

export interface TexturePrepOptions {
  /** A caller on a SECOND context passes its own label so the budget prices it
   *  apart from the world uploads. */
  label?: string;
  /** The renderer's in-flight chunked uploads (Renderer.textureUploadTasks):
   *  a texture already being uploaded there is skipped, or the two paths race
   *  on the same object. */
  inFlight?: { has(texture: THREE.Texture): boolean };
}

/**
 * The size class a piece is priced under. Upload cost is bimodal by size, not
 * a single distribution: a resident-adjacent 128x128 costs a millisecond and a
 * 1024x1024 with its mip chain (or a compressed 1024x1024 whose transcode lands
 * here) costs hundreds, so one learned EMA under-prices the large pieces and
 * the admission lets them into frames with no headroom for them. Three classes
 * keep the ledger honest per class: `upload` under 512x512, `upload-mid` from
 * 512x512 up to 1024x1024, `upload-big` from 1024x1024 up, each its own KIND.
 */
export function texturePieceSizeClass(texture: THREE.Texture): '' | '-mid' | '-big' {
  const image = texture.image as { width?: number; height?: number } | null | undefined;
  const texels = (image?.width ?? 0) * (image?.height ?? 0);
  if (texels >= 1024 * 1024) return '-big';
  if (texels >= 512 * 512) return '-mid';
  return '';
}

/**
 * What one piece is called in the queue: the base label's kind with the size
 * class appended (`upload-big:texture`), then the texture's name (or its
 * short uuid when unnamed), its dimensions and a `c` for a compressed (KTX2)
 * source. The kind is all the budget reads; the rest is what lets a 900 ms
 * piece be named from a blob.
 */
export function texturePieceLabel(baseLabel: string, texture: THREE.Texture): string {
  const colon = baseLabel.indexOf(':');
  const head = colon >= 0 ? baseLabel.slice(0, colon) : baseLabel;
  const rest = colon >= 0 ? baseLabel.slice(colon) : '';
  const image = texture.image as { width?: number; height?: number } | null | undefined;
  const size = image?.width && image?.height ? `${image.width}x${image.height}` : 'unsized';
  const name = texture.name || texture.uuid.slice(0, 8);
  const compressed = (texture as THREE.CompressedTexture).isCompressedTexture ? 'c' : 'u';
  return `${head}${texturePieceSizeClass(texture)}${rest}:${name}:${size}${compressed}`;
}

/**
 * Upload every non-resident texture under `root`, one queue unit at a time, in
 * order, and resolve with how many textures were handed to the host. The
 * textures are collected ONCE up front: re-walking between pieces would
 * re-enumerate what earlier pieces already made resident. `gatePriority` is the
 * GATE's priority; the pieces ride at `texturePrepPriority(gatePriority)`.
 *
 * A DataTexture is the one sub-chunkable shape three exposes (update ranges),
 * so it goes through uploadDataTextureInChunks with each chunk as its own
 * queue unit; every other texture is one indivisible unit.
 */
export async function runTexturePrepLane(
  queue: TexturePrepQueue,
  properties: TexturePropertiesLike,
  host: TextureUploadTarget,
  root: THREE.Object3D,
  gatePriority: number,
  options: TexturePrepOptions = {},
): Promise<number> {
  const inFlight = options.inFlight;
  const textures = collectNonResidentTextures(
    properties,
    root,
    inFlight ? (texture): boolean => inFlight.has(texture as THREE.Texture) : undefined,
  ) as THREE.Texture[];
  const kind = options.label ?? TEXTURE_PREP_LABEL;
  const priority = texturePrepPriority(gatePriority);
  for (const texture of textures) {
    const label = texturePieceLabel(kind, texture);
    if ((texture as THREE.DataTexture).isDataTexture) {
      await uploadDataTextureInChunks(host, texture, {
        uploadChunk: (chunk) => queue.run(() => host.initTexture(chunk), priority, label),
      });
      continue;
    }
    await queue.run(() => host.initTexture(texture), priority, label);
  }
  return textures.length;
}
