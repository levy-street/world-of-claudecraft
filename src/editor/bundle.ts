// Map bundle export/import: the map JSON plus every browser-stored dependency
// (imported models, ground textures, uploaded skybox) packaged so a map moves
// to another computer whole. Export prefers a real folder (File System Access
// API) and falls back to downloading a single .wocmap.zip; import reads that
// zip back and restores the dependencies into IndexedDB.
//
// The ZIP writer/reader here is deliberately minimal: STORED entries only (no
// compression - the payloads are already-compressed GLB/PNG/JPG), which keeps
// both sides ~80 lines and dependency-free.

import { loadGroundTextureBytes } from '../render/assets/ground_textures';
import { loadSkyboxBytes, storeSkybox } from '../render/assets/skyboxes';
import type { CustomMap } from './custom_map';
import { bundleDependencyRefs, prepareMapForEngine } from './export_contract';
import { loadStoredLocalAssets, storeLocalAssetBytes } from './local_assets_db';

export interface BundleFile {
  path: string;
  bytes: Uint8Array;
}

export class BundleDependencyError extends Error {
  constructor(readonly missing: number) {
    super(`Map bundle is missing ${missing} browser-owned dependencies`);
    this.name = 'BundleDependencyError';
  }
}

const enc = new TextEncoder();

// ---- CRC32 (standard polynomial), table-driven --------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- minimal ZIP (stored) ------------------------------------------------------

export function zipStore(files: readonly BundleFile[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.path);
    const crc = crc32(f.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.bytes.length, true);
    lv.setUint32(22, f.bytes.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, f.bytes);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.bytes.length, true);
    cv.setUint32(24, f.bytes.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length + f.bytes.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/**
 * Read ANY zip: the editor's own STORED bundles plus foreign zips (Finder,
 * `zip`, 7-Zip, ...). Parses the CENTRAL directory (so data-descriptor
 * entries with zeroed local sizes still read) and inflates DEFLATE entries
 * through the browser's native DecompressionStream, no zip dependency.
 * Directory entries and macOS junk (__MACOSX/, .DS_Store, AppleDouble ._*)
 * are skipped. Returns null when the bytes are not a readable zip.
 */
export async function zipReadAny(bytes: Uint8Array): Promise<BundleFile[] | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD: scan back from the tail (the record allows a trailing comment).
  let eocd = -1;
  const scanFloor = Math.max(0, bytes.length - 22 - 65535);
  for (let pos = bytes.length - 22; pos >= scanFloor; pos--) {
    if (view.getUint32(pos, true) === 0x06054b50) {
      eocd = pos;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let cd = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files: BundleFile[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (cd + 46 > bytes.length || view.getUint32(cd, true) !== 0x02014b50) return null;
    const method = view.getUint16(cd + 10, true);
    const expectedCrc = view.getUint32(cd + 16, true);
    const compSize = view.getUint32(cd + 20, true);
    const rawSize = view.getUint32(cd + 24, true);
    const nameLen = view.getUint16(cd + 28, true);
    const extraLen = view.getUint16(cd + 30, true);
    const commentLen = view.getUint16(cd + 32, true);
    const localOff = view.getUint32(cd + 42, true);
    const path = dec.decode(bytes.subarray(cd + 46, cd + 46 + nameLen));
    cd += 46 + nameLen + extraLen + commentLen;
    // Zip64 sentinel: out of scope (bundles are far below 4GB).
    if (compSize === 0xffffffff || rawSize === 0xffffffff || localOff === 0xffffffff) return null;
    // Skip directories and macOS packaging junk.
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (path.endsWith('/') || path.startsWith('__MACOSX/')) continue;
    if (base === '.DS_Store' || base.startsWith('._')) continue;
    if (seen.has(path)) continue;
    // The data offset comes from the entry's own LOCAL header (its name/extra
    // lengths can differ from the central copy).
    if (localOff + 30 > bytes.length || view.getUint32(localOff, true) !== 0x04034b50) return null;
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > bytes.length) return null;
    const raw = bytes.slice(dataStart, dataStart + compSize);
    let payload: Uint8Array;
    if (method === 0) {
      payload = raw;
    } else if (method === 8 && typeof DecompressionStream === 'function') {
      try {
        const stream = new Blob([raw as BlobPart]).stream().pipeThrough(
          // biome-ignore lint/suspicious/noExplicitAny: deflate-raw is in every supported browser but older lib.dom typings lag
          new DecompressionStream('deflate-raw' as any),
        );
        payload = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        return null;
      }
      if (payload.length !== rawSize) return null;
    } else {
      return null; // unsupported method (or no DecompressionStream)
    }
    if (crc32(payload) !== expectedCrc) return null;
    seen.add(path);
    files.push({ path, bytes: payload });
  }
  return files.length > 0 ? files : null;
}

/** Read a STORED-entries zip (the format zipStore writes). Compressed entries
 *  return null (foreign zips are out of scope). */
export function zipRead(bytes: Uint8Array): BundleFile[] | null {
  const files: BundleFile[] = [];
  const paths = new Set<string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  const dec = new TextDecoder();
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
    const method = view.getUint16(pos + 8, true);
    const expectedCrc = view.getUint32(pos + 14, true);
    const size = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    if (method !== 0) return null;
    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart + size > bytes.length) return null;
    const path = dec.decode(bytes.subarray(nameStart, nameStart + nameLen));
    if (paths.has(path)) return null;
    paths.add(path);
    const payload = bytes.slice(dataStart, dataStart + size);
    if (crc32(payload) !== expectedCrc) return null;
    files.push({ path, bytes: payload });
    pos = dataStart + size;
  }
  return files.length > 0 ? files : null;
}

// ---- bundle build --------------------------------------------------------------

/** Collect the map JSON plus every dependency stored in this browser. */
export async function buildMapBundle(map: CustomMap): Promise<BundleFile[]> {
  const prepared = prepareMapForEngine(map);
  const canonical = prepared.map;
  const files: BundleFile[] = [{ path: 'map.json', bytes: enc.encode(prepared.json) }];
  const refs = bundleDependencyRefs(canonical);
  let missing = 0;
  if (refs.models.length > 0) {
    const wanted = new Set(refs.models);
    const found = new Set<string>();
    for (const stored of await loadStoredLocalAssets()) {
      if (!wanted.has(stored.sha256)) continue;
      files.push({ path: `models/${stored.sha256}.glb`, bytes: new Uint8Array(stored.bytes) });
      found.add(stored.sha256);
    }
    missing += refs.models.filter((sha) => !found.has(sha)).length;
  }
  // Ground textures behind custom paint swatches.
  for (const sha of refs.textures) {
    const stored = await loadGroundTextureBytes(sha);
    if (stored) {
      files.push({ path: `textures/${stored.sha256}`, bytes: new Uint8Array(stored.bytes) });
    } else missing++;
  }
  // The uploaded skybox, when the map uses one.
  for (const sha of refs.skyboxes) {
    const stored = await loadSkyboxBytes(sha);
    if (stored) {
      files.push({ path: `skybox/${stored.sha256}`, bytes: new Uint8Array(stored.bytes) });
    } else missing++;
  }
  if (missing > 0) throw new BundleDependencyError(missing);
  return files;
}

/** Restore a bundle's dependencies into this browser's stores (import side). */
export async function restoreBundleDeps(files: readonly BundleFile[]): Promise<void> {
  const expectedModels = new Set<string>();
  const expectedTextures = new Set<string>();
  const expectedSkyboxes = new Set<string>();
  for (const f of files) {
    if (f.path.startsWith('models/')) {
      const sha = f.path.slice('models/'.length).replace(/\.glb$/i, '');
      expectedModels.add(sha);
      await storeLocalAssetBytes({
        sha256: sha,
        name: sha.slice(0, 8),
        mime: 'model/gltf-binary',
        byteSize: f.bytes.length,
        bytes: f.bytes.slice().buffer,
      });
    } else if (f.path.startsWith('textures/')) {
      const sha = f.path.slice('textures/'.length);
      expectedTextures.add(sha);
      const { storeGroundTexture } = await import('../render/assets/ground_textures');
      await storeGroundTexture({
        sha256: sha,
        name: sha.slice(0, 8),
        mime: 'image/png',
        bytes: f.bytes.slice().buffer,
      });
    } else if (f.path.startsWith('skybox/')) {
      const sha = f.path.slice('skybox/'.length);
      expectedSkyboxes.add(sha);
      await storeSkybox({
        sha256: sha,
        name: sha.slice(0, 8),
        mime: 'image/png',
        bytes: f.bytes.slice().buffer,
      });
    }
  }

  // IndexedDB helpers intentionally never throw, so explicitly read every
  // payload back. Otherwise a browser with blocked/quota-exhausted storage
  // would report a successful import and then render holes after reload.
  let missing = 0;
  const restoredModels = new Set((await loadStoredLocalAssets()).map((entry) => entry.sha256));
  for (const sha of expectedModels) if (!restoredModels.has(sha)) missing++;
  for (const sha of expectedTextures) if (!(await loadGroundTextureBytes(sha))) missing++;
  for (const sha of expectedSkyboxes) if (!(await loadSkyboxBytes(sha))) missing++;
  if (missing > 0) throw new BundleDependencyError(missing);
}
