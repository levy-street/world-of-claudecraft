// Serialize-once memo over the admin ok() envelope, the REST sibling of the
// broadcast loop's realm_readout_memo: a viewer-identical response that comes
// off a TTL cache (server/cached_read.ts) used to be re-JSON.stringify'd per
// request even though the cached object is the SAME object until the cache
// turns over. This memo keys the serialized envelope on the cached value's
// object identity (a WeakMap, so a turned-over snapshot and its bytes are
// GC'd together) and replays the memoized bytes for every request inside the
// window.
//
// Byte parity is the contract: send() writes EXACTLY what the admin surface's
// ok() helper (json(res, 200, { success: true, data, error: null }) in
// server/http_util.ts) would have written, body, status, Content-Type, and
// Content-Length, because admin clients parse that envelope. Any change to
// json()'s shape must land here in the same change; the parity pin is
// tests/server/ok_response_memo.test.ts.
//
// THE KEY CONTRACT (what a caller must guarantee, since the memo cannot see
// inside `data`): the memoized bytes are looked up by the identities in
// `parts`, so EVERY field of `data` that can vary across requests must appear
// in `parts`. Fields that are module constants (the activity route's `days`,
// pinned to ACTIVITY_WINDOW_DAYS by admin_activity_cache's own assertWindow)
// may be omitted from the key because they cannot vary; the day such a scalar
// becomes request-derived it must join `parts` or the route must stop riding
// the memo. The activity route's non-part fields are pinned to exactly that
// constant set in tests/server/admin_analytics_reads.test.ts.
// - The default key is `data` itself, for a handler whose response IS the
//   cached object (the market metrics read).
// - A handler that COMPOSES a fresh response object per request from several
//   cache-stable fields (the activity route's four arrays off one frozen
//   bundle) passes those fields as `parts`; the fresh wrapper still costs one
//   stringify per cache turnover, and a torn multi-read (fields from two
//   different snapshots) keys to its own tuple, so it can never serve another
//   tuple's bytes.
// - An EMPTY `parts` array is a caller bug (it would key on the fresh wrapper
//   and never hit) and throws at the call.
// - ONE INSTANCE PER ROUTE (never one memo shared across response shapes): the
//   key space has no notion of shape, so two routes sharing an instance would
//   rely on their key tuples never colliding by accident. A route's instance
//   is still shared by BOTH dispatch arms of that route.
// - A response that embeds genuinely per-request data (the overview route's
//   live adminStats() merge) must NOT ride this memo: its bytes would freeze
//   for the cache window and diverge from what ok() would produce.
//
// Stability requirement: callers hand cache-installed, deep-frozen values
// (the owning caches freeze their snapshots whole, rows included). A caller
// mutating a served value after the first send would be the same
// shared-snapshot poisoning hazard those freezes exist to stop, with stale
// bytes as the symptom here.

import type * as http from 'node:http';

export interface OkResponseMemoStats {
  /** send() calls since construction. */
  serves: number;
  /** Envelope stringifies actually performed (cache-turnover count). */
  stringifies: number;
}

export interface OkResponseMemo {
  /**
   * Serve `data` as the ok() envelope, memoizing the serialized bytes keyed
   * on `parts` (default: the identity of `data` itself). Throws on an empty
   * `parts` array (see the key contract in the header).
   */
  send(res: http.ServerResponse, data: object, parts?: readonly object[]): void;
  stats(): OkResponseMemoStats;
}

// One node per key-tuple prefix: children fan out by the next part's identity,
// and the node reached by the LAST part holds the memoized body plus its byte
// length (computed once with the body; Content-Length is written per serve).
// WeakMaps at every level, so dropping a snapshot drops its whole subtree.
interface MemoNode {
  children: WeakMap<object, MemoNode>;
  memo?: { body: string; bytes: number };
}

export function createOkResponseMemo(): OkResponseMemo {
  const root: MemoNode = { children: new WeakMap() };
  let serves = 0;
  let stringifies = 0;

  return {
    send(res: http.ServerResponse, data: object, parts?: readonly object[]): void {
      if (parts !== undefined && parts.length === 0) {
        throw new Error(
          'ok_response_memo: an empty parts array would key on the fresh wrapper and never hit; pass the cache-stable fields or omit parts',
        );
      }
      serves += 1;
      const keys = parts ?? [data];
      let node = root;
      for (const key of keys) {
        let next = node.children.get(key);
        if (next === undefined) {
          next = { children: new WeakMap() };
          node.children.set(key, next);
        }
        node = next;
      }
      let memo = node.memo;
      if (memo === undefined) {
        stringifies += 1;
        const body = JSON.stringify({ success: true, data, error: null });
        memo = { body, bytes: Buffer.byteLength(body) };
        node.memo = memo;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': memo.bytes,
      });
      res.end(memo.body);
    },
    stats(): OkResponseMemoStats {
      return { serves, stringifies };
    },
  };
}
