// Limited-supply relic service: the bridge between the sim's SYNCHRONOUS mint
// seam (SimContext.claimLimitedSerial, called inside a tick) and the ASYNC
// cross-realm Postgres ledger (limited_supply_db.ts). The sim cannot wait on a
// database mid-tick, so this holds a small in-memory buffer of pre-leased serials
// per item and pops one synchronously on claim; a background FIFO refills the
// buffer and records confirmed mints, never blocking the game loop.
//
// This is environmental input to the deterministic sim, exactly like the injected
// lockoutNowMs / raidResetMs / utcDay: the sim stays pure and the host owns the
// non-deterministic ledger. Claim draws no rng.
//
// Supply integrity (see limited_supply_db.ts): a serial is never treated as minted
// until the winner takes possession, and a claimed serial is NEVER re-issued, so
// the cap is never exceeded and a serial is never duplicated (the load-bearing
// promise). A graceful shutdown releases the unclaimed buffer via releaseAll() so
// clean restarts waste nothing. The only residual is that an ungraceful crash, or
// a relic that drops and is never looted, orphans its serial as 'leased' forever
// (the effective supply erodes slightly DOWNWARD, always the safe direction). We
// deliberately do NOT auto-reclaim orphaned leases: at boot a 'leased' row is
// indistinguishable from one a player actually holds whose mint-record write
// failed, so reclaiming it could re-issue a live serial. Recovering orphans is a
// manual ops decision (see the runbook note in limited_supply_db.ts).

import type { LimitedMintAttribution, LimitedSupplyDb } from './limited_supply_db';

// Buffer target per item: how many pre-leased serials to keep ready for the
// synchronous claim. Deliberately 1. A larger buffer would let one realm (or the
// whole cluster, at boot) pre-lease a big slice of a small-cap relic's supply
// into idle buffers, starving other realms of a relic that still has stock, and
// would widen the crash window (an unclaimed buffer serial is only recovered by a
// graceful releaseAll). The shared-corpse bosses roll each relic at most once per
// kill, so 1 always suffices there; only the world boss rolls per contributor,
// where 1 paces minting at one-per-kill (the supply still fully mints over time,
// and a beyond-buffer multi-win falls back to a plain drop with the serial
// preserved in the pool for a later winner).
const DEFAULT_BUFFER_TARGET = 1;

export interface LimitedSupplyServiceOptions {
  bufferTarget?: number;
  // Diagnostic sink for background write failures (defaults to console.error).
  // English dev-channel text, never player-facing.
  onError?: (message: string, err: unknown) => void;
}

export class LimitedSupplyService {
  private readonly bufferTarget: number;
  private readonly onError: (message: string, err: unknown) => void;
  // itemId -> supply cap (from content, via init). Empty until init resolves.
  private readonly supplyByItem = new Map<string, number>();
  // itemId -> ready-to-hand-out leased serials.
  private readonly pools = new Map<string, number[]>();
  // Items with a refill already queued on the FIFO (see scheduleRefill).
  private readonly refillPending = new Set<string>();
  // Serializes every background DB write (refill, mint, release) into one
  // per-process FIFO, like server/bank_ledger.ts: the loop never awaits it, a
  // rejected write logs and never blocks or reorders, and it can never throw into
  // a caller. A realm process owns its own ledger writes, so one tail suffices.
  private tail: Promise<void> = Promise.resolve();
  private ready = false;

  constructor(
    private readonly db: LimitedSupplyDb,
    private readonly realm: string,
    options: LimitedSupplyServiceOptions = {},
  ) {
    this.bufferTarget = Math.max(1, options.bufferTarget ?? DEFAULT_BUFFER_TARGET);
    this.onError =
      options.onError ?? ((message, err) => console.error(`[limited-supply] ${message}`, err));
  }

  // Seed the supply caps and warm every item's buffer. Awaited at boot BEFORE the
  // game loop starts, so the first relic kill finds a warm pool.
  async init(items: { itemId: string; supply: number }[]): Promise<void> {
    await this.db.seedSupply(items);
    for (const { itemId, supply } of items) {
      this.supplyByItem.set(itemId, supply);
      this.pools.set(itemId, []);
    }
    this.ready = true;
    // Warm the buffers directly (not via the FIFO): init must complete before any
    // claim, and awaiting here is what guarantees the pool is ready.
    for (const itemId of this.supplyByItem.keys()) await this.fillBuffer(itemId);
  }

  // The synchronous mint seam. Pops the next ready serial for `itemId`, or returns
  // null when the buffer is momentarily empty or the supply is exhausted (the sim
  // then awards the registered fallback). Schedules a background refill.
  claim(itemId: string): number | null {
    if (!this.ready) return null;
    const pool = this.pools.get(itemId);
    if (!pool) return null;
    if (pool.length === 0) {
      // An empty pool is either a genuinely exhausted supply or a refill that
      // failed earlier, and from here the two are indistinguishable. Retry
      // either way. Without this the only refill triggers are init() and a
      // SUCCESSFUL claim, so one rejected fillBuffer (enqueue logs and swallows
      // it) would leave the pool empty for the rest of the process lifetime:
      // the relic stops minting on this realm and every winner silently gets the
      // fallback instead. Retrying also lets a realm that emptied against a
      // genuinely spent supply pick up serials another realm later released.
      this.scheduleRefill(itemId);
      return null;
    }
    const serial = pool.shift() as number;
    this.scheduleRefill(itemId);
    return serial;
  }

  // Record a confirmed mint (the winner took possession). Fire-and-forget: the
  // loop never awaits it. A retried/duplicate call is a DB no-op (markMinted only
  // touches a still-'leased' row).
  onMint(itemId: string, serial: number, attr: LimitedMintAttribution): void {
    this.enqueue(() => this.db.markMinted(itemId, serial, attr));
  }

  // Graceful shutdown: return every unclaimed buffered serial to the pool for
  // dense reuse on the next boot. Awaited by saveAll so it completes before exit.
  async releaseAll(): Promise<void> {
    // Let any queued refill/mint writes settle first, so we release the true
    // remaining buffer and never race a lease we just requested.
    await this.tail.catch(() => {});
    for (const [itemId, pool] of this.pools) {
      if (pool.length === 0) continue;
      const serials = pool.splice(0, pool.length);
      await this.db.releaseSerials(itemId, serials, this.realm).catch((err) => {
        this.onError(`releaseSerials failed for ${itemId}`, err);
      });
    }
  }

  // The number of ready serials currently buffered for an item (diagnostics/tests).
  bufferedCount(itemId: string): number {
    return this.pools.get(itemId)?.length ?? 0;
  }

  // Lease serials until the item's buffer reaches its target (or the supply is
  // spent). Bounded by the target so a burst of refill requests cannot over-lease.
  private async fillBuffer(itemId: string): Promise<void> {
    const supply = this.supplyByItem.get(itemId);
    if (supply === undefined) return;
    const target = Math.min(this.bufferTarget, supply);
    const pool = this.pools.get(itemId);
    if (!pool) return;
    while (pool.length < target) {
      const serial = await this.db.leaseSerial(itemId, this.realm);
      if (serial === null) return; // supply exhausted: leave the buffer short
      pool.push(serial);
    }
  }

  // Queue one refill for an item, unless one is already pending. Past the cap the
  // boss keeps rolling and claim() runs on every kill, so without this throttle a
  // hot empty pool would pile up one doomed lease attempt per kill on the FIFO.
  // Bounded to a single in-flight refill per item, which is enough: fillBuffer
  // always tops up to the target, so one pending refill subsumes any number of
  // claims that arrive before it runs.
  private scheduleRefill(itemId: string): void {
    if (this.refillPending.has(itemId)) return;
    this.refillPending.add(itemId);
    this.enqueue(async () => {
      try {
        await this.fillBuffer(itemId);
      } finally {
        // Clear on failure too, or a single rejection would re-create exactly
        // the permanent stall this scheduling exists to prevent.
        this.refillPending.delete(itemId);
      }
    });
  }

  // Chain a background DB task onto the FIFO tail. Failures are logged and swallowed
  // so the loop and later tasks are never affected.
  private enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task).catch((err) => {
      this.onError('background ledger write failed', err);
    });
  }
}
