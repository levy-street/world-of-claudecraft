import type * as THREE from 'three';

const RGBA_COMPONENTS = 4;

interface TexturePixelData extends ArrayBufferView {
  readonly BYTES_PER_ELEMENT: number;
  readonly length: number;
}

interface TextureUpdateRange {
  start: number;
  count: number;
}

interface RangeUpdatableDataTexture extends THREE.DataTexture {
  readonly updateRanges: TextureUpdateRange[];
  clearUpdateRanges(): void;
  addUpdateRange(start: number, count: number): void;
}

function supportsUpdateRanges(texture: THREE.DataTexture): texture is RangeUpdatableDataTexture {
  return (
    'updateRanges' in texture &&
    Array.isArray(texture.updateRanges) &&
    'clearUpdateRanges' in texture &&
    typeof texture.clearUpdateRanges === 'function' &&
    'addUpdateRange' in texture &&
    typeof texture.addUpdateRange === 'function'
  );
}

export const DEFAULT_TEXTURE_UPLOAD_CHUNK_BYTES = 512 * 1024;

export interface TextureUploadTarget {
  initTexture(texture: THREE.Texture): void;
}

export interface ChunkedTextureUploadOptions {
  maxChunkBytes?: number;
  beforeChunk?: () => Promise<void>;
  uploadChunk?: (texture: THREE.Texture) => void | Promise<void>;
}

/**
 * Upload a DataTexture one bounded set of rows at a time when update ranges are
 * available. Three's updateRanges allocate the texture once, then issue
 * texSubImage2D only for selected rows. The installed three (0.185) ships the
 * range API natively, so plain DataTextures take the bounded path; the
 * single-upload arm remains for hosts or stubs without it, where beforeChunk
 * still paces the start and uploadChunk lets the renderer serialize that
 * indivisible call with other WebGL work.
 *
 * A CompressedTexture (the biome sky domes) takes that same single-upload arm:
 * there is no row-addressable pixel buffer to range over. It needs one far
 * less, since the block payload it uploads is an eighth of the half-float RGBA
 * the same image cost as a DataTexture.
 */
export async function uploadDataTextureInChunks(
  target: TextureUploadTarget,
  texture: THREE.Texture,
  options: ChunkedTextureUploadOptions = {},
): Promise<number> {
  const uploadChunk = options.uploadChunk ?? ((nextTexture) => target.initTexture(nextTexture));
  const dataTexture = texture as THREE.DataTexture;
  const image = dataTexture.image as
    | { data?: TexturePixelData; width?: number; height?: number }
    | undefined;
  const data = image?.data;
  const width = Math.floor(image?.width ?? 0);
  const height = Math.floor(image?.height ?? 0);
  const expectedComponents = width * height * RGBA_COMPONENTS;
  if (
    !dataTexture.isDataTexture ||
    !data ||
    width <= 0 ||
    height <= 0 ||
    Number(data.length) !== expectedComponents
  ) {
    await options.beforeChunk?.();
    await uploadChunk(texture);
    return 1;
  }

  const bytesPerComponent = Math.max(1, data.BYTES_PER_ELEMENT);
  const rowComponents = width * RGBA_COMPONENTS;
  const rowBytes = rowComponents * bytesPerComponent;
  const maxChunkBytes = Math.max(
    rowBytes,
    Math.floor(options.maxChunkBytes ?? DEFAULT_TEXTURE_UPLOAD_CHUNK_BYTES),
  );
  const rowsPerChunk = Math.max(1, Math.floor(maxChunkBytes / rowBytes));

  // Every three from the 0.185 train onward exposes texture update ranges
  // natively (r165, pinned through v0.35, predated them); keep the one valid
  // full upload for any texture or host without the range API.
  if (!supportsUpdateRanges(dataTexture)) {
    await options.beforeChunk?.();
    await uploadChunk(dataTexture);
    return 1;
  }

  let chunks = 0;

  dataTexture.clearUpdateRanges();
  for (let firstRow = 0; firstRow < height; firstRow += rowsPerChunk) {
    await options.beforeChunk?.();
    const lastRow = Math.min(height, firstRow + rowsPerChunk);
    // WebGLTextures currently emits one texSubImage2D per update range and
    // assumes every range remains inside one row, so add rows individually.
    for (let row = firstRow; row < lastRow; row++) {
      dataTexture.addUpdateRange(row * rowComponents, rowComponents);
    }
    dataTexture.needsUpdate = true;
    await uploadChunk(dataTexture);
    chunks++;
  }
  return chunks;
}
