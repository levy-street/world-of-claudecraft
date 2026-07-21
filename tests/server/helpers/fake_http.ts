// Framework-free fakes of the slices of node:http the API pipeline touches.
//
// FakeRes models the bits of http.ServerResponse the compose runtime and the
// existing handlers use: a case-insensitive header store (lower-cased keys, like
// node), writeHead that MERGES already-set headers, an accumulating body, and the
// headersSent / writableEnded lifecycle with the same single-use guards node
// enforces (no second writeHead, no write or end after end). makeReq builds an
// http.IncomingMessage on a node stream Readable carrying method, url, headers
// (a default host) and socket.remoteAddress. Both are a strict SUPERSET of the
// ad-hoc makeRes()/makeReq() copies in woc_balance / wallet_server / discord_server
// tests, so a later phase can re-point those at this one helper. Full
// ServerResponse / IncomingMessage conformance is impractical, so a single
// `as unknown as` cast bridges each fake to its node type at the boundary.

import { Buffer } from 'node:buffer';
import type * as http from 'node:http';
import { Readable } from 'node:stream';

/** A header value, matching node's `string | number | string[]`. */
export type HeaderValue = string | number | string[];

/** Coerce a written chunk (string or binary) to its UTF-8 string form. */
function chunkToString(chunk: string | Buffer | Uint8Array): string {
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString('utf8');
  return Buffer.from(chunk).toString('utf8');
}

/**
 * A faithful, framework-free fake of the http.ServerResponse surface the pipeline
 * uses. Header keys are lower-cased (node-faithful) so reads are case-insensitive.
 */
export class FakeRes {
  /** The response status; defaults to 200 and is settable directly or via writeHead. */
  statusCode = 200;

  private readonly _headers = new Map<string, HeaderValue>();
  private readonly _bodyChunks: string[] = [];
  private _headersSent = false;
  private _writableEnded = false;
  private _capturedBody: string | null = null;
  private _capturedHeaders: Record<string, HeaderValue> | null = null;

  /** true once writeHead, write, or end has committed the headers. */
  get headersSent(): boolean {
    return this._headersSent;
  }

  /** true once end() has been called. */
  get writableEnded(): boolean {
    return this._writableEnded;
  }

  /** The captured final body string (the accumulated chunks; '' until written). */
  get body(): string {
    return this._capturedBody ?? this._bodyChunks.join('');
  }

  /** The captured headers snapshot (frozen at end(); otherwise the live store). */
  get headers(): Record<string, HeaderValue> {
    return this._capturedHeaders ?? this.snapshotHeaders();
  }

  setHeader(name: string, value: HeaderValue): this {
    this._headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name: string): HeaderValue | undefined {
    return this._headers.get(name.toLowerCase());
  }

  getHeaders(): Record<string, HeaderValue> {
    return this.snapshotHeaders();
  }

  removeHeader(name: string): void {
    this._headers.delete(name.toLowerCase());
  }

  /**
   * Set the status and MERGE the passed headers onto any already-set-via-setHeader
   * headers: already-set headers are kept, the explicit ones win on conflict.
   * Guarded: a second writeHead (or writeHead after end) throws.
   */
  writeHead(statusCode: number, headers?: Record<string, HeaderValue>): this {
    if (this._headersSent) {
      throw new Error('FakeRes.writeHead() called after headers were already sent');
    }
    this.statusCode = statusCode;
    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        this._headers.set(name.toLowerCase(), value);
      }
    }
    this._headersSent = true;
    return this;
  }

  /** Accumulate a body chunk; commits the headers. Throws if called after end(). */
  write(chunk: string | Buffer | Uint8Array): boolean {
    if (this._writableEnded) {
      throw new Error('FakeRes.write() called after end()');
    }
    this._headersSent = true;
    this._bodyChunks.push(chunkToString(chunk));
    return true;
  }

  /**
   * Accumulate the final chunk and capture the final body, headers snapshot, and
   * status. Guarded: a second end() (like a write after end) throws.
   */
  end(data?: string | Buffer | Uint8Array): this {
    if (this._writableEnded) {
      throw new Error('FakeRes.end() called more than once');
    }
    if (data !== undefined) this._bodyChunks.push(chunkToString(data));
    this._headersSent = true;
    this._writableEnded = true;
    this._capturedBody = this._bodyChunks.join('');
    this._capturedHeaders = this.snapshotHeaders();
    return this;
  }

  private snapshotHeaders(): Record<string, HeaderValue> {
    const out: Record<string, HeaderValue> = {};
    for (const [name, value] of this._headers) out[name] = value;
    return out;
  }
}

/** The shape of an extra-augmented Readable standing in for an IncomingMessage. */
interface FakeReqExtras {
  method: string;
  url: string;
  headers: Record<string, string>;
  socket: { remoteAddress: string };
}

/**
 * Build an http.IncomingMessage on a node stream Readable, a strict superset of
 * the three ad-hoc makeReq copies: it carries method, url, headers (defaulting a
 * host header) and socket.remoteAddress. When `body` is given the stream is
 * readable (a string body is sent verbatim, anything else is JSON-encoded);
 * otherwise the stream is empty.
 */
export function makeReq(
  opts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown } = {},
): http.IncomingMessage {
  const stream =
    opts.body !== undefined
      ? Readable.from([bodyToBuffer(opts.body)])
      : new Readable({
          read() {
            this.push(null);
          },
        });
  const req = stream as Readable & FakeReqExtras;
  req.method = opts.method ?? 'GET';
  req.url = opts.url ?? '/';
  // node lower-cases all incoming header names; mirror that so a caller passing a
  // mixed-case header (e.g. 'X-Forwarded-For') is still seen by requestIp et al.
  const headers: Record<string, string> = { host: 'localhost:8787' };
  for (const [name, value] of Object.entries(opts.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  req.headers = headers;
  req.socket = { remoteAddress: '127.0.0.1' };
  return req as unknown as http.IncomingMessage;
}

/** Encode a body for the request stream: Buffer as-is, string verbatim, else JSON. */
function bodyToBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  return Buffer.from(JSON.stringify(body));
}
