import { loadGroundTextureBytes, storeGroundTexture } from '../render/assets/ground_textures';

export const WALL_TEXTURE_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const WALL_TEXTURE_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const WALL_TEXTURE_MAX_INPUT_SIDE = 8192;
export const WALL_TEXTURE_MAX_INPUT_PIXELS = 32 * 1024 * 1024;
export const WALL_TEXTURE_OUTPUT_SIDE = 1024;

export type WallTextureImportErrorCode =
  | 'type'
  | 'size'
  | 'dimensions'
  | 'decode'
  | 'encode'
  | 'storage';

/** The caller maps this stable code to its own localized message. */
export class WallTextureImportError extends Error {
  constructor(readonly code: WallTextureImportErrorCode) {
    super(code);
    this.name = 'WallTextureImportError';
  }
}

export interface WallTextureImageHeader {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

/** Inspect dimensions before asking the browser to allocate a decoded surface. */
export function wallTextureImageHeader(bytes: ArrayBuffer): WallTextureImageHeader | null {
  const b = new Uint8Array(bytes);
  const v = new DataView(bytes);
  if (
    b.length >= 24 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => b[i] === byte) &&
    v.getUint32(8) === 13 &&
    v.getUint32(12) === 0x49484452
  ) {
    return { mime: 'image/png', width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 3 < b.length) {
      if (b[at++] !== 0xff) return null;
      while (b[at] === 0xff) at++;
      const marker = b[at++];
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > b.length) return null;
      const length = v.getUint16(at);
      if (length < 2 || at + length > b.length) return null;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8) return null;
        return { mime: 'image/jpeg', height: v.getUint16(at + 3), width: v.getUint16(at + 5) };
      }
      at += length;
    }
    return null;
  }
  if (
    b.length >= 20 &&
    v.getUint32(0) === 0x52494646 &&
    v.getUint32(8) === 0x57454250 &&
    v.getUint32(4, true) + 8 === b.length
  ) {
    const chunk = v.getUint32(12);
    const length = v.getUint32(16, true);
    if (20 + length > b.length) return null;
    if (chunk === 0x56503858 && length >= 10) {
      const uint24 = (i: number): number => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16);
      return { mime: 'image/webp', width: uint24(24) + 1, height: uint24(27) + 1 };
    }
    if (chunk === 0x5650384c && length >= 5 && b[20] === 0x2f) {
      const bits = v.getUint32(21, true);
      return {
        mime: 'image/webp',
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (chunk === 0x56503820 && length >= 10 && b[23] === 0x9d && b[24] === 1 && b[25] === 0x2a) {
      return {
        mime: 'image/webp',
        width: v.getUint16(26, true) & 0x3fff,
        height: v.getUint16(28, true) & 0x3fff,
      };
    }
  }
  return null;
}

function validDimensions(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= WALL_TEXTURE_MAX_INPUT_SIDE &&
    height <= WALL_TEXTURE_MAX_INPUT_SIDE &&
    width * height <= WALL_TEXTURE_MAX_INPUT_PIXELS
  );
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ImportedWallTexture {
  name: string;
  sha256: string;
  width: number;
  height: number;
  mimeType: string;
}

/** Normalize and durably store a texture in the existing shared image store. */
export async function importWallTexture(file: File): Promise<ImportedWallTexture> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new WallTextureImportError('type');
  }
  if (file.size <= 0 || file.size > WALL_TEXTURE_MAX_INPUT_BYTES) {
    throw new WallTextureImportError('size');
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > WALL_TEXTURE_MAX_INPUT_BYTES) throw new WallTextureImportError('size');
  const header = wallTextureImageHeader(bytes);
  if (!header || header.mime !== file.type) throw new WallTextureImportError('type');
  if (!validDimensions(header.width, header.height)) throw new WallTextureImportError('dimensions');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: header.mime }));
  } catch {
    throw new WallTextureImportError('decode');
  }
  let encoded: Blob | null;
  let width: number;
  let height: number;
  try {
    if (!validDimensions(bitmap.width, bitmap.height))
      throw new WallTextureImportError('dimensions');
    const scale = Math.min(1, WALL_TEXTURE_OUTPUT_SIDE / Math.max(bitmap.width, bitmap.height));
    width = Math.max(1, Math.round(bitmap.width * scale));
    height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new WallTextureImportError('encode');
    context.drawImage(bitmap, 0, 0, width, height);
    encoded = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.9),
    );
  } finally {
    bitmap.close();
  }
  if (!encoded || !['image/webp', 'image/png'].includes(encoded.type)) {
    throw new WallTextureImportError('encode');
  }
  if (encoded.size > WALL_TEXTURE_MAX_OUTPUT_BYTES) throw new WallTextureImportError('size');
  const normalized = await encoded.arrayBuffer();
  const outputHeader = wallTextureImageHeader(normalized);
  if (
    !outputHeader ||
    outputHeader.mime !== encoded.type ||
    outputHeader.width !== width ||
    outputHeader.height !== height
  ) {
    throw new WallTextureImportError('encode');
  }
  const sha256 = await digest(normalized);
  const name =
    Array.from(file.name)
      .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
      .join('')
      .replace(/\.[a-z0-9]+$/i, '')
      .trim()
      .slice(0, 80) || sha256.slice(0, 12);
  await storeGroundTexture({ sha256, name, mime: encoded.type, bytes: normalized });
  const stored = await loadGroundTextureBytes(sha256);
  if (!stored || stored.mime !== encoded.type || (await digest(stored.bytes)) !== sha256) {
    throw new WallTextureImportError('storage');
  }
  return { name, sha256, width, height, mimeType: encoded.type };
}
