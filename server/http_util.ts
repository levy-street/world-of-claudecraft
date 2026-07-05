import * as http from 'node:http';
import { inflateSync } from 'node:zlib';

export function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
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

export function readBody(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    let aborted = false;
    req.on('data', (c: Buffer | string) => {
      if (aborted) return;
      bytes += typeof c === 'string' ? Buffer.byteLength(c) : c.byteLength;
      data += c;
      if (bytes > maxBytes) {
        // Rejecting the promise does not pause the socket, so without
        // destroying the request a client could keep streaming unbounded
        // data into `data`. Stop reading and ignore any further chunks.
        aborted = true;
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        resolve(data ? JSON.parse(data) : {});
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
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
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
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16;
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
        if (!info || sawPlte || sawIdat || length === 0 || length % 3 !== 0 || length / 3 > 256) return null;
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
        if (!pngImageDataValid(info, idatChunks, options.maxDecodedBytes ?? DEFAULT_MAX_PNG_DECODED_BYTES)) return null;
        return info;
    }

    offset = chunkEnd;
    chunkIndex++;
  }

  return null;
}
