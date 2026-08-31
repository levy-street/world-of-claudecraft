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
// Keying:
// - The default key is `data` itself, for a handler whose response IS the
//   cached object (the market metrics read).
// - A handler that COMPOSES a fresh response object per request from several
//   cache-stable fields (the activity route's four arrays off one frozen
//   bundle) passes those fields as `parts`; the memo keys on the tuple, so
//   the fresh wrapper still costs one stringify per cache turnover, and a
//   torn multi-read (fields from two different snapshots) can never serve
//   stale bytes because the key IS the served content.
// - A response that embeds genuinely per-request data (the overview route's
//   live adminStats() merge) must NOT ride this memo: its bytes would freeze
//   for the cache window and diverge from what ok() would produce.
//
// Stability requirement: callers hand cache-installed, effectively-immutable
// values (the owning caches freeze their snapshots). A caller mutating a
// served value after the first send would be the same shared-snapshot
// poisoning hazard those freezes exist to stop, with stale bytes as the
// symptom here.

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
   * on `parts` (default: the identity of `data` itself).
   */
  send(res: http.ServerResponse, data: object, parts?: readonly object[]): void;
  stats(): OkResponseMemoStats;
}

// One node per key-tuple prefix: children fan out by the next part's identity,
// and the node reached by the LAST part holds the memoized body. WeakMaps at
// every level, so dropping a snapshot drops its whole subtree.
interface MemoNode {
  children: WeakMap<object, MemoNode>;
  body?: string;
}

export function createOkResponseMemo(): OkResponseMemo {
  const root: MemoNode = { children: new WeakMap() };
  let serves = 0;
  let stringifies = 0;

  return {
    send(res: http.ServerResponse, data: object, parts?: readonly object[]): void {
      serves += 1;
      const keys = parts !== undefined && parts.length > 0 ? parts : [data];
      let node = root;
      for (const key of keys) {
        let next = node.children.get(key);
        if (next === undefined) {
          next = { children: new WeakMap() };
          node.children.set(key, next);
        }
        node = next;
      }
      let body = node.body;
      if (body === undefined) {
        stringifies += 1;
        body = JSON.stringify({ success: true, data, error: null });
        node.body = body;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    },
    stats(): OkResponseMemoStats {
      return { serves, stringifies };
    },
  };
}
