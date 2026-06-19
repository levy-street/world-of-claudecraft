import * as http from 'node:http';

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

export function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      data += c;
      if (data.length > 64 * 1024) {
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

// The 8-byte PNG signature. Card uploads must be real PNGs (the card page sets
// Content-Type: image/png), so reject anything else before it is stored.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export function isPng(buf: Buffer): boolean {
  return buf.length > PNG_MAGIC.length && buf.subarray(0, 8).equals(PNG_MAGIC);
}
