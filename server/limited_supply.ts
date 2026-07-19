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
// Supply integrity (see limited_supply_db.ts): a leased serial is never treated as
// minted until the winner takes possession, so the cap is never EXCEEDED. To keep
// it from eroding DOWNWARD, init() reclaims every serial this realm still holds
// 'leased' at boot (a crashed buffer or a relic that dropped and was never looted)
// back into the pool: the world is fresh then, so such a serial was never minted.
// A graceful shutdown additionally releases the live buffer via releaseAll().

import type { LimitedMintAttribution, LimitedSupplyDb } from './limited_supply_db';

// Buffer target per item: how many pre-leased serials to keep ready for the
// synchronous claim. Deliberately 1. A larger buffer would let one realm (or the
// whole cluster, at boot) pre-lease a big slice of a small-cap relic's supply
// into idle buffers, starving other realms of a relic that has stock left, and
// would widen the crash/abandon window (a leased-but-unminted serial only returns
// to the pool via the boot reclaim below). The shared-corpse bosses roll each
// relic at most once per kill, so 1 always suffices there; only the world boss
// rolls per contributor, where 1 paces minting at one-per-kill (the supply still
// fully mints over time, and a beyond-buffer multi-win falls back to a plain drop
// with the serial preserved for a later winner). See reclaimRealmLeases for why a
// tiny buffer keeps the effective supply honest.
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
    // Reclaim this realm's stale leases FIRST: the world is fresh at boot, so any
    // serial still 'leased' by this realm was never minted (a crashed buffer or an
    // abandoned drop), and returning it to the pool keeps the effective supply
    // from eroding below the cap. Runs before the warm below so a reclaimed serial
    // can immediately re-lease into the fresh buffer.
    const reclaimed = await this.db.reclaimRealmLeases(this.realm);
    if (reclaimed > 0)
      console.log(`[limited-supply] reclaimed ${reclaimed} stale relic lease(s) at boot`);
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
