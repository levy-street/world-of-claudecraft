// Single-pending transport for `inspectCorpseHarvest` (Intentional Gathering
// PR3 transport contract): one specialized pending read, not an unbounded
// per-corpse cache or a generic RPC framework. A new subject supersedes and
// settles the old read null; the same subject shares one pending promise.

import type { CorpseHarvestInfo } from '../world_api';
import { decodeCorpseHarvestInfoReply } from './corpse_harvest_info_wire';

const REQUEST_TIMEOUT_MS = 5000;

export type SendInspectCorpseHarvest = (id: number, rid: number) => void;

interface PendingRequest {
  readonly id: number;
  readonly rid: number;
  readonly promise: Promise<CorpseHarvestInfo | null>;
  readonly resolve: (info: CorpseHarvestInfo | null) => void;
  readonly reject: (err: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class CorpseHarvestInfoRequest {
  private pending: PendingRequest | null = null;
  private nextRid = 1;

  constructor(private readonly send: SendInspectCorpseHarvest) {}

  /** Ask for `id`'s current status. Same subject while one is already
   *  pending shares that ONE promise (no second send, and a reentrant
   *  same-subject `issue()` from inside the send callback returns the exact
   *  same promise object rather than a new one); a different subject
   *  supersedes and settles the prior one null before sending its own. */
  issue(id: number): Promise<CorpseHarvestInfo | null> {
    if (this.pending && this.pending.id === id) return this.pending.promise;
    this.settlePending(null);

    const rid = this.nextRid;
    // Wrap before Number.MAX_SAFE_INTEGER rather than overflowing (the
    // CommandOutcomeTracker rollover, src/net/command_outcomes.ts), and never
    // reset on `reset()`: a stale rid from before a reset must never appear
    // to match a freshly issued read that happens to land on the same value.
    this.nextRid = rid >= Number.MAX_SAFE_INTEGER ? 1 : rid + 1;

    let resolve!: (info: CorpseHarvestInfo | null) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<CorpseHarvestInfo | null>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timer = setTimeout(() => {
      if (this.pending?.rid === rid) this.settlePending(null);
    }, REQUEST_TIMEOUT_MS);
    // Installed BEFORE sending: a send callback that synchronously delivers
    // the reply (a test harness, a loopback), or reentrantly issues for the
    // SAME subject, must find this pending record already in place.
    const installed: PendingRequest = { id, rid, promise, resolve, reject, timer };
    this.pending = installed;

    try {
      this.send(id, rid);
    } catch (err) {
      // Only tear down and reject THIS pending record if it is still the
      // live one: a reentrant same-subject `issue()` inside `send` shares it
      // (nothing to unwind), a reentrant DIFFERENT-subject `issue()` already
      // superseded it (already settled null; leave the newer pending alone),
      // and a synchronous reply already resolved it for real. In every one
      // of those cases `installed` is already finalized, so the throw is
      // moot and the caller still gets that settled promise back.
      if (this.pending === installed) {
        this.pending = null;
        clearTimeout(installed.timer);
        installed.reject(err);
      }
    }
    // Always the SAME promise object every caller (the original issuer and
    // any reentrant same-subject sharer) was handed: resolved, rejected, or
    // still pending.
    return promise;
  }

  /** Feed one inbound wire message. Ignored (no state change) unless it
   *  decodes AND matches the currently pending subject and request id: a
   *  malformed frame, an unrelated frame, or a late answer for a superseded
   *  or already-settled subject all no-op rather than corrupting the live
   *  pending read. */
  onReply(raw: unknown): void {
    const decoded = decodeCorpseHarvestInfoReply(raw);
    if (!decoded) return;
    if (!this.pending || this.pending.id !== decoded.id || this.pending.rid !== decoded.rid) {
      return;
    }
    this.settlePending(decoded.info);
  }

  /** Socket close / reconnect / session end: settle any pending read null and
   *  clear state. Idempotent (a repeated call with nothing pending is a
   *  no-op). */
  reset(): void {
    this.settlePending(null);
  }

  private settlePending(info: CorpseHarvestInfo | null): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(info);
  }
}
