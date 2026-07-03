import type * as http from 'node:http';
import { inflateSync } from 'node:zlib';
import type { AccountModerationStatus } from './db';
import type { ErrorCode } from './http/error_codes';

export function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

/**
 * The legacy 403 moderation-lock body, PLUS the additive machine `code` the client
 * code-matcher keys on (and, for a timed suspension, the machine-readable `date`
 * the client formats).
 * The prose `status.message` stays byte-identical; the code is derived from the
 * same status fields, mirroring the problem+json requireAccount mapping EXACTLY
 * (server/http/middleware/require_account.ts: banned -> moderation.banned;
 * an active suspension -> moderation.suspended_until { date }; a self-deactivation
 * -> account.deactivated; the fallback -> moderation.suspended). Callers invoke
 * this only when status.locked is true. One source so the ~10 legacy emit sites
 * (both the migrated RouteDef guards and their legacy main.ts twins) cannot drift.
 */
export function moderationErrorBody(
  status: Pick<AccountModerationStatus, 'message' | 'banned' | 'suspendedUntil' | 'deactivated'>,
): { error: string; code: ErrorCode; date?: string } {
  if (status.banned) return { error: status.message, code: 'moderation.banned' };
  if (status.suspendedUntil) {
    return {
      error: status.message,
      code: 'moderation.suspended_until',
      date: status.suspendedUntil,
    };
  }
  if (status.deactivated) return { error: status.message, code: 'account.deactivated' };
  return { error: status.message, code: 'moderation.suspended' };
}

// A Postgres unique-constraint violation (SQLSTATE 23505). The REST layer maps
// this to 409 Conflict: the pre-insert existence check (e.g. findAccount) is
// inherently TOCTOU, so the UNIQUE index is the real guard. When a racing
// request wins the insert, this lets us return "already taken" instead of a
// generic 500. The message fallback covers driver/test errors without a code.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === '23505' || (typeof e?.message === 'string' && e.message.includes('unique'));
}

// The default JSON request-body cap (64 KiB). The single source of truth so
// readBody and the withBody middleware (server/http/middleware/body.ts) can
// never drift apart.
export const DEFAULT_JSON_BODY_MAX_BYTES = 64 * 1024;

export function readBody(
  req: http.IncomingMessage,
  maxBytes = DEFAULT_JSON_BODY_MAX_BYTES,
): Promise<any> {
  return new Promise((resolve, reject) => {
    // Collect raw bytes and decode ONCE at the end. Concatenating each chunk onto
    // a string (`data += c`) decodes every chunk independently, which mangles a
    // multi-byte UTF-8 character split across a chunk boundary into replacement
    // characters. Same buffer-then-decode-once strategy as readBinaryBody; the cap
    // ordering here matches the old readBody (push the chunk, then check the cap),
    // not readBinaryBody (which rejects before pushing an over-cap chunk).
    const chunks: Buffer[] = [];
    let bytes = 0;
    let aborted = false;
    req.on('data', (c: Buffer | string) => {
      if (aborted) return;
      const chunk = typeof c === 'string' ? Buffer.from(c) : c;
      bytes += chunk.byteLength;
      chunks.push(chunk);
      if (bytes > maxBytes) {
        // Rejecting the promise does not pause the socket, so without
        // destroying the request a client could keep streaming unbounded
        // data into memory. Stop reading and ignore any further chunks.
        aborted = true;
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      if (aborted) return;
      const data = Buffer.concat(chunks).toString('utf8');
      try {
        // Every route reads properties off the body, so only a JSON object is
        // a valid request body: a literal null, an array, or a primitive is
        // rejected here (400 at the route) instead of crashing a handler on
        // property access (a `null` body would otherwise 500).
        const parsed: unknown = data ? JSON.parse(data) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('bad json'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

// Read a raw binary request body into a Buffer, capped at `maxBytes`. JSON
// bodies go through readBody (64 KB); this exists for the player-card PNG
// upload, which is far larger than that cap but still bounded. As with
// readBody, exceeding the cap destroys the socket so a client can't stream
// unbounded data into memory.
export function readBinaryBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > maxBytes) {
        aborted = true;
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

// Cheap pre-body reject for oversized uploads: when the client declares a
// Content-Length above the cap, answer before reading (or authenticating)
// anything. Streams without the header still hit the readBody/readBinaryBody
// byte caps, so this is an optimization, never the guard.
export function contentLengthExceeds(req: http.IncomingMessage, maxBytes: number): boolean {
  const raw = req.headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  return Number(trimmed) > maxBytes;
}

// The 8-byte PNG signature. This helper is only a cheap signature sniff; upload
// paths that store public media must use parsePngInfo so fake PNG headers do not
// cross the trust boundary.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function isPng(buf: Buffer): boolean {
  return buf.length > PNG_MAGIC.length && buf.subarray(0, 8).equals(PNG_MAGIC);
}

export interface PngDimensions {
  width: number;
  height: number;
}

export interface PngInfo extends PngDimensions {
  bitDepth: number;
  colorType: number;
}

export interface PngValidationOptions {
  allowedDimensions?: readonly PngDimensions[];
  maxDecodedBytes?: number;
}

const DEFAULT_MAX_PNG_DECODED_BYTES = 64 * 1024 * 1024;
const PNG_CRITICAL_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isPngChunkType(buf: Buffer, offset: number): boolean {
  for (let i = 0; i < 4; i++) {
    const c = buf[offset + i];
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false;
  }
  return true;
}

function validPngBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return (
        bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16
      );
    case 2:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    default:
      return false;
  }
}

function samplesPerPngPixel(colorType: number): number | null {
  switch (colorType) {
    case 0:
    case 3:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return null;
  }
}

function expectedPngScanlineBytes(info: PngInfo): number | null {
  const samples = samplesPerPngPixel(info.colorType);
  if (samples === null) return null;
  const bits = info.width * samples * info.bitDepth;
  if (!Number.isSafeInteger(bits)) return null;
  return Math.ceil(bits / 8);
}

function dimensionsAllowed(info: PngInfo, allowed: readonly PngDimensions[] | undefined): boolean {
  return !allowed || allowed.some((d) => info.width === d.width && info.height === d.height);
}

function pngImageDataValid(info: PngInfo, idatChunks: Buffer[], maxDecodedBytes: number): boolean {
  const scanlineBytes = expectedPngScanlineBytes(info);
  if (scanlineBytes === null) return false;
  const expected = (scanlineBytes + 1) * info.height;
  if (!Number.isSafeInteger(expected) || expected > maxDecodedBytes) return false;
  try {
    const compressed = idatChunks.length === 1 ? idatChunks[0] : Buffer.concat(idatChunks);
    const inflated = inflateSync(compressed, { maxOutputLength: expected + 1 });
    if (inflated.length !== expected) return false;
    const stride = scanlineBytes + 1;
    for (let offset = 0; offset < inflated.length; offset += stride) {
      if (inflated[offset] > 4) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Parse enough of the PNG format to reject spoofed files before they are stored:
// signature, ordered critical chunks, IHDR fields, chunk CRCs, IDAT zlib data,
// expected decoded byte count, and scanline filter bytes. Interlaced PNGs are
// rejected because browser-created player cards are non-interlaced.
export function parsePngInfo(buf: Buffer, options: PngValidationOptions = {}): PngInfo | null {
  if (!isPng(buf)) return null;
  let offset = PNG_MAGIC.length;
  let chunkIndex = 0;
  let info: PngInfo | null = null;
  let sawPlte = false;
  let sawIdat = false;
  let idatClosed = false;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (dataEnd < dataStart || chunkEnd < dataEnd || chunkEnd > buf.length) return null;
    if (!isPngChunkType(buf, typeStart)) return null;
    const type = buf.toString('ascii', typeStart, dataStart);
    if (chunkIndex === 0 && type !== 'IHDR') return null;
    if ((buf[typeStart] & 0x20) === 0 && !PNG_CRITICAL_CHUNKS.has(type)) return null;
    if (crc32(buf, typeStart, dataEnd) !== buf.readUInt32BE(dataEnd)) return null;
    if (type !== 'IDAT' && sawIdat) idatClosed = true;

    switch (type) {
      case 'IHDR': {
        if (chunkIndex !== 0 || info || length !== 13) return null;
        const width = buf.readUInt32BE(dataStart);
        const height = buf.readUInt32BE(dataStart + 4);
        const bitDepth = buf[dataStart + 8];
        const colorType = buf[dataStart + 9];
        const compression = buf[dataStart + 10];
        const filter = buf[dataStart + 11];
        const interlace = buf[dataStart + 12];
        if (width <= 0 || height <= 0) return null;
        if (!validPngBitDepth(colorType, bitDepth)) return null;
        if (compression !== 0 || filter !== 0 || interlace !== 0) return null;
        info = { width, height, bitDepth, colorType };
        if (!dimensionsAllowed(info, options.allowedDimensions)) return null;
        break;
      }
      case 'PLTE':
        if (!info || sawPlte || sawIdat || length === 0 || length % 3 !== 0 || length / 3 > 256)
          return null;
        if (info.colorType === 0 || info.colorType === 4) return null;
        sawPlte = true;
        break;
      case 'IDAT':
        if (!info || idatClosed) return null;
        if (info.colorType === 3 && !sawPlte) return null;
        sawIdat = true;
        idatChunks.push(buf.subarray(dataStart, dataEnd));
        break;
      case 'IEND':
        if (!info || length !== 0 || !sawIdat || chunkEnd !== buf.length) return null;
        if (info.colorType === 3 && !sawPlte) return null;
        if (
          !pngImageDataValid(
            info,
            idatChunks,
            options.maxDecodedBytes ?? DEFAULT_MAX_PNG_DECODED_BYTES,
          )
        )
          return null;
        return info;
    }

    offset = chunkEnd;
    chunkIndex++;
  }

  return null;
}

// ---------------------------------------------------------------------------
// GLB (binary glTF 2.0) validation, modeled on parsePngInfo above: parse enough
// of the container to reject spoofed or hostile files before they are stored
// and re-served as public media. Hand-rolled over node primitives (no new
// dependency). Checks: the 12-byte header (magic/version/declared length), the
// chunk table (one JSON chunk first, one optional BIN chunk, nothing else,
// exact tiling of the declared length), a JSON size cap, no external URIs
// (buffers must use the BIN chunk; images may inline data: URIs only), content
// caps (meshes/nodes/accessors), and that every bufferView and accessor stays
// inside the BIN chunk. Anything else returns null and the route rejects.
// ---------------------------------------------------------------------------

export interface GlbInfo {
  byteLength: number;
  jsonByteLength: number;
  binByteLength: number;
  meshCount: number;
  nodeCount: number;
  accessorCount: number;
}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_JSON_CHUNK = 0x4e4f534a; // 'JSON'
const GLB_BIN_CHUNK = 0x004e4942; // 'BIN\0'
export const MAX_GLB_JSON_BYTES = 4 * 1024 * 1024;
export const GLB_MAX_MESHES = 64;
export const GLB_MAX_NODES = 512;
export const GLB_MAX_ACCESSORS = 512;

const GLB_COMPONENT_BYTES = new Map<unknown, number>([
  [5120, 1], // BYTE
  [5121, 1], // UNSIGNED_BYTE
  [5122, 2], // SHORT
  [5123, 2], // UNSIGNED_SHORT
  [5125, 4], // UNSIGNED_INT
  [5126, 4], // FLOAT
]);
const GLB_TYPE_COMPONENTS = new Map<unknown, number>([
  ['SCALAR', 1],
  ['VEC2', 2],
  ['VEC3', 3],
  ['VEC4', 4],
  ['MAT2', 4],
  ['MAT3', 9],
  ['MAT4', 16],
]);
// Sparse indices may only use unsigned integer component types.
const GLB_SPARSE_INDEX_TYPES = new Set([5121, 5123, 5125]);

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isPosInt(v: unknown): v is number {
  return isNonNegInt(v) && v > 0;
}

function isIndex(v: unknown, length: number): v is number {
  return isNonNegInt(v) && v < length;
}

// A top-level glTF table: absent means empty, anything but an array is invalid.
function glbTable(v: unknown): unknown[] | null {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : null;
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

interface GlbViewInfo {
  byteLength: number;
  byteStride: number | undefined;
}

// A tightly-packed run of `count` elements starting at `byteOffset` (with an
// optional vertex stride) must fit inside its bufferView.
function runFitsView(
  view: GlbViewInfo,
  byteOffset: unknown,
  count: number,
  elementBytes: number,
  stride?: number,
): boolean {
  const offset = byteOffset === undefined ? 0 : byteOffset;
  if (!isNonNegInt(offset)) return false;
  const step = stride ?? elementBytes;
  const needed = count === 0 ? 0 : step * (count - 1) + elementBytes;
  return Number.isSafeInteger(offset + needed) && offset + needed <= view.byteLength;
}

export function parseGlbInfo(buf: Buffer): GlbInfo | null {
  // 12-byte header + at least the JSON chunk header.
  if (buf.length < 20) return null;
  if (buf.readUInt32LE(0) !== GLB_MAGIC) return null;
  if (buf.readUInt32LE(4) !== 2) return null;
  if (buf.readUInt32LE(8) !== buf.length) return null;

  // Chunk 0 must be JSON, capped so JSON.parse never sees a multi-hundred-MB blob.
  const jsonByteLength = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== GLB_JSON_CHUNK) return null;
  if (jsonByteLength === 0 || jsonByteLength > MAX_GLB_JSON_BYTES) return null;
  const jsonEnd = 20 + jsonByteLength;
  if (jsonEnd > buf.length) return null;

  // Optional chunk 1 must be BIN and must end the file exactly (no unknown
  // trailing chunks, no stray bytes to smuggle data in).
  const hasBin = jsonEnd !== buf.length;
  let binByteLength = 0;
  if (hasBin) {
    if (jsonEnd + 8 > buf.length) return null;
    binByteLength = buf.readUInt32LE(jsonEnd);
    if (buf.readUInt32LE(jsonEnd + 4) !== GLB_BIN_CHUNK) return null;
    if (jsonEnd + 8 + binByteLength !== buf.length) return null;
  }

  let root: unknown;
  try {
    root = JSON.parse(buf.toString('utf8', 20, jsonEnd));
  } catch {
    return null;
  }
  const gltf = asObject(root);
  if (!gltf) return null;
  const asset = asObject(gltf.asset);
  if (!asset || asset.version !== '2.0') return null;

  const buffers = glbTable(gltf.buffers);
  const bufferViews = glbTable(gltf.bufferViews);
  const accessors = glbTable(gltf.accessors);
  const meshes = glbTable(gltf.meshes);
  const nodes = glbTable(gltf.nodes);
  const images = glbTable(gltf.images);
  if (!buffers || !bufferViews || !accessors || !meshes || !nodes || !images) return null;
  if (meshes.length > GLB_MAX_MESHES) return null;
  if (nodes.length > GLB_MAX_NODES) return null;
  if (accessors.length > GLB_MAX_ACCESSORS) return null;

  // Only the single GLB-stored buffer is allowed, and it must have NO uri:
  // every byte a placed asset loads must come from this validated upload, never
  // an external fetch. (Per spec the BIN chunk may pad the buffer by up to 3.)
  if (buffers.length > 1) return null;
  let storedBufferBytes = 0;
  if (buffers.length === 1) {
    const buffer = asObject(buffers[0]);
    if (!buffer || buffer.uri !== undefined) return null;
    if (!isPosInt(buffer.byteLength)) return null;
    if (!hasBin) return null;
    if (buffer.byteLength > binByteLength || binByteLength - buffer.byteLength > 3) return null;
    storedBufferBytes = buffer.byteLength;
  } else if (hasBin) {
    // A BIN chunk with no declared buffer is unreferenced smuggled bytes.
    return null;
  }

  // Images may inline data: URIs or reference a bufferView; external URLs are
  // rejected so serving an asset can never trigger third-party fetches.
  for (const entry of images) {
    const image = asObject(entry);
    if (!image) return null;
    if (image.uri !== undefined) {
      if (typeof image.uri !== 'string' || !image.uri.startsWith('data:')) return null;
    } else if (image.bufferView !== undefined && !isIndex(image.bufferView, bufferViews.length)) {
      return null;
    }
  }

  const viewInfos: GlbViewInfo[] = [];
  for (const entry of bufferViews) {
    const view = asObject(entry);
    if (!view) return null;
    if (!isIndex(view.buffer, buffers.length)) return null;
    const byteOffset = view.byteOffset === undefined ? 0 : view.byteOffset;
    if (!isNonNegInt(byteOffset) || !isPosInt(view.byteLength)) return null;
    if (byteOffset + view.byteLength > storedBufferBytes) return null;
    let byteStride: number | undefined;
    if (view.byteStride !== undefined) {
      if (!isPosInt(view.byteStride) || view.byteStride < 4 || view.byteStride > 252) return null;
      if (view.byteStride % 4 !== 0) return null;
      byteStride = view.byteStride;
    }
    viewInfos.push({ byteLength: view.byteLength, byteStride });
  }

  for (const entry of accessors) {
    const accessor = asObject(entry);
    if (!accessor) return null;
    const componentBytes = GLB_COMPONENT_BYTES.get(accessor.componentType);
    const components = GLB_TYPE_COMPONENTS.get(accessor.type);
    if (componentBytes === undefined || components === undefined) return null;
    if (!isPosInt(accessor.count)) return null;
    const elementBytes = componentBytes * components;
    if (accessor.bufferView !== undefined) {
      if (!isIndex(accessor.bufferView, viewInfos.length)) return null;
      const view = viewInfos[accessor.bufferView];
      if (view.byteStride !== undefined && view.byteStride < elementBytes) return null;
      if (!runFitsView(view, accessor.byteOffset, accessor.count, elementBytes, view.byteStride)) {
        return null;
      }
    } else if (accessor.byteOffset !== undefined && accessor.byteOffset !== 0) {
      return null;
    }
    if (accessor.sparse !== undefined) {
      const sparse = asObject(accessor.sparse);
      if (!sparse || !isPosInt(sparse.count) || sparse.count > accessor.count) return null;
      const indices = asObject(sparse.indices);
      const values = asObject(sparse.values);
      if (!indices || !values) return null;
      if (typeof indices.componentType !== 'number') return null;
      if (!GLB_SPARSE_INDEX_TYPES.has(indices.componentType)) return null;
      const indexBytes = GLB_COMPONENT_BYTES.get(indices.componentType);
      if (indexBytes === undefined) return null;
      if (!isIndex(indices.bufferView, viewInfos.length)) return null;
      if (!isIndex(values.bufferView, viewInfos.length)) return null;
      const indexView = viewInfos[indices.bufferView];
      const valueView = viewInfos[values.bufferView];
      if (!runFitsView(indexView, indices.byteOffset, sparse.count, indexBytes)) return null;
      if (!runFitsView(valueView, values.byteOffset, sparse.count, elementBytes)) return null;
    }
  }

  return {
    byteLength: buf.length,
    jsonByteLength,
    binByteLength,
    meshCount: meshes.length,
    nodeCount: nodes.length,
    accessorCount: accessors.length,
  };
}
