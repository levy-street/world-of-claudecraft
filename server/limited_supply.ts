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
// Crash safety (see limited_supply_db.ts): a leased serial is never re-adopted on
// boot, so an ungraceful crash can only LOSE the buffer (a few serials orphaned as
// 'leased'), never exceed the cap. A graceful shutdown returns the unclaimed
// buffer to the pool via releaseAll(), so clean restarts waste nothing.

import type { LimitedMintAttribution, LimitedSupplyDb } from './limited_supply_db';

// Buffer target per item: how many pre-leased serials to keep ready. Sized to
// cover a realistic single-tick burst (a world boss rolls the relic once per
// contributor in one tick, so a shared buffer of 1 would cap a lucky multi-win
// kill to a single mint) while bounding the crash-loss to at most this many
// serials per item. Capped at the item's supply so a small-cap relic never holds
// its whole supply as leased-in-flight.
const DEFAULT_BUFFER_TARGET = 8;

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
    if (!pool || pool.length === 0) return null;
    const serial = pool.shift() as number;
    this.enqueue(() => this.fillBuffer(itemId));
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

  // Chain a background DB task onto the FIFO tail. Failures are logged and swallowed
  // so the loop and later tasks are never affected.
  private enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task).catch((err) => {
      this.onError('background ledger write failed', err);
    });
  }
}
