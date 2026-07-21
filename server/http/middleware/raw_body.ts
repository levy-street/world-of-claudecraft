// Raw (binary) body middleware for the API request pipeline.
//
// withRawBody wraps readBinaryBody (server/http_util.ts) as an onion
// middleware for a binary route (e.g. the shareable player-card PNG upload):
// it reads ctx.req into a Buffer at ctx.body, with NO JSON parse. It mirrors
// the live card route's pre-auth short-circuit: a Content-Length that already
// exceeds the cap rejects before a byte is read, and either that check or a
// mid-stream overflow marks the connection non-keep-alive (Connection: close)
// so a client that ignored its own declared length cannot keep the socket.
// Importable but UNMOUNTED here; the route tables place it in front of the card route.

import type * as http from 'node:http';
import { readBinaryBody } from '../../http_util';
import { HttpError } from '../errors';
import type { Middleware } from '../types';

/**
 * Whether the DECLARED Content-Length already exceeds the cap. Mirrors the live
 * card route's cardUploadContentLengthTooLarge (server/player_card.ts) 1:1: only
 * a strictly-numeric length (/^\d+$/ on the trimmed value) that is over the cap
 * rejects before a byte is read. A missing, non-numeric, or in-cap length falls
 * through to readBinaryBody, whose own mid-stream cap still bounds the body, so
 * this pre-check is a cheap optimization, never the sole guard.
 */
function contentLengthOverCap(req: http.IncomingMessage, maxBytes: number): boolean {
  const raw = req.headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return false;
  return Number(trimmed) > maxBytes;
}

/**
 * Read the request body as a raw Buffer into ctx.body, capped at maxBytes,
 * then call next(). A Content-Length already over the cap rejects before
 * reading; a mid-stream overflow (no or understated Content-Length) rejects
 * once readBinaryBody's own cap trips. Both throw HttpError(413,
 * 'body.too_large', { maxBytes }, { Connection: 'close' }) and set
 * ctx.res.shouldKeepAlive = false.
 */
export function withRawBody(maxBytes: number): Middleware {
  return async (ctx, next) => {
    if (contentLengthOverCap(ctx.req, maxBytes)) {
      ctx.res.shouldKeepAlive = false;
      throw new HttpError(413, 'body.too_large', { maxBytes }, { Connection: 'close' });
    }
    try {
      ctx.body = await readBinaryBody(ctx.req, maxBytes);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'body too large') {
        ctx.res.shouldKeepAlive = false;
        throw new HttpError(413, 'body.too_large', { maxBytes }, { Connection: 'close' });
      }
      throw err;
    }
    await next();
  };
}
