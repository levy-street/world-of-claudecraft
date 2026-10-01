// Single-pending transport for `inspectMob` (the mob inspect window's live
// stat read): one pending read at a time, not a cache or a generic RPC
// framework. The same contract as CorpseHarvestInfoRequest: a new subject
// supersedes and settles the old read null; the same subject shares one
// pending promise; a read nobody answers settles null after a timeout.

import type { MobInspectInfo } from '../world_api';
import { decodeMobInspectInfoReply } from './mob_inspect_wire';

const REQUEST_TIMEOUT_MS = 5000;

export type SendInspectMob = (id: number, rid: number) => void;

interface PendingRequest {
  readonly id: number;
  readonly rid: number;
  readonly promise: Promise<MobInspectInfo | null>;
  readonly resolve: (info: MobInspectInfo | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class MobInspectRequest {
  private pending: PendingRequest | null = null;
  private nextRid = 1;

  constructor(private readonly send: SendInspectMob) {}

  /** Ask for `id`'s live stats. The same subject while one is pending shares
   *  that promise; a different subject settles the prior one null first. A
   *  send that throws settles this read null rather than rejecting, since the
   *  window treats "no answer" and "could not ask" identically. */
  issue(id: number): Promise<MobInspectInfo | null> {
    if (this.pending && this.pending.id === id) return this.pending.promise;
    this.settlePending(null);

    const rid = this.nextRid;
    // Wrap before Number.MAX_SAFE_INTEGER, and never reset on `reset()`, so a
    // stale rid can never match a fresh read.
    this.nextRid = rid >= Number.MAX_SAFE_INTEGER ? 1 : rid + 1;

    let resolve!: (info: MobInspectInfo | null) => void;
    const promise = new Promise<MobInspectInfo | null>((res) => {
      resolve = res;
    });
    const timer = setTimeout(() => {
      if (this.pending?.rid === rid) this.settlePending(null);
    }, REQUEST_TIMEOUT_MS);
    // Installed BEFORE sending, so a synchronous reply finds it in place.
    this.pending = { id, rid, promise, resolve, timer };
    try {
      this.send(id, rid);
    } catch {
      if (this.pending?.rid === rid) this.settlePending(null);
    }
    return promise;
  }

  /** Feed one inbound wire message: ignored unless it decodes AND matches the
   *  pending subject and request id. */
  onReply(raw: unknown): void {
    const decoded = decodeMobInspectInfoReply(raw);
    if (!decoded) return;
    if (!this.pending || this.pending.id !== decoded.id || this.pending.rid !== decoded.rid) {
      return;
    }
    this.settlePending(decoded.info);
  }

  /** Socket close / reconnect / session end: settle any pending read null. */
  reset(): void {
    this.settlePending(null);
  }

  private settlePending(info: MobInspectInfo | null): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(info);
  }
}
