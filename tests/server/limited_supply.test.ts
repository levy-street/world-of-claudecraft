import { describe, expect, it } from 'vitest';
import { LimitedSupplyService } from '../../server/limited_supply';
import type {
  LimitedMintAttribution,
  LimitedMintsSnapshot,
  LimitedSupplyDb,
} from '../../server/limited_supply_db';

// An in-memory LimitedSupplyDb that models the PgLimitedSupplyDb SQL semantics
// exactly: leaseSerial reclaims the lowest 'released' serial first, else allocates
// the next fresh serial only while next_serial <= supply, else returns null;
// markMinted only confirms a still-'leased' row; releaseSerials returns this
// realm's leased serials to 'released'. One instance shared across two services
// stands in for two realm processes on one Postgres, so the cap tests are real.
interface SerialRow {
  itemId: string;
  serial: number;
  state: 'leased' | 'minted' | 'released';
  realm: string;
  characterName: string | null;
  mintedAt: string | null;
}

class FakeLimitedSupplyDb implements LimitedSupplyDb {
  private readonly supply = new Map<string, { supply: number; nextSerial: number }>();
  private readonly rows: SerialRow[] = [];
  // Count DB round-trips so a test can assert the synchronous claim path never
  // waits on the ledger mid-tick.
  leaseCalls = 0;

  async seedSupply(items: { itemId: string; supply: number }[]): Promise<void> {
    for (const { itemId, supply } of items) {
      if (!this.supply.has(itemId)) this.supply.set(itemId, { supply, nextSerial: 1 });
    }
  }

  async leaseSerial(itemId: string, realm: string): Promise<number | null> {
    this.leaseCalls++;
    const released = this.rows
      .filter((r) => r.itemId === itemId && r.state === 'released')
      .sort((a, b) => a.serial - b.serial)[0];
    if (released) {
      released.state = 'leased';
      released.realm = realm;
      released.characterName = null;
      released.mintedAt = null;
      return released.serial;
    }
    const cap = this.supply.get(itemId);
    if (!cap || cap.nextSerial > cap.supply) return null;
    const serial = cap.nextSerial;
    cap.nextSerial += 1;
    this.rows.push({ itemId, serial, state: 'leased', realm, characterName: null, mintedAt: null });
    return serial;
  }

  async markMinted(itemId: string, serial: number, attr: LimitedMintAttribution): Promise<void> {
    const row = this.rows.find(
      (r) => r.itemId === itemId && r.serial === serial && r.state === 'leased',
    );
    if (!row) return;
    row.state = 'minted';
    row.characterName = attr.characterName;
    row.mintedAt = '2026-07-19T00:00:00.000Z';
  }

  async releaseSerials(itemId: string, serials: number[], realm: string): Promise<void> {
    for (const r of this.rows) {
      if (
        r.itemId === itemId &&
        r.state === 'leased' &&
        r.realm === realm &&
        serials.includes(r.serial)
      )
        r.state = 'released';
    }
  }

  async readMints(): Promise<LimitedMintsSnapshot> {
    const supplies = [...this.supply.entries()].map(([itemId, s]) => ({
      itemId,
      supply: s.supply,
      minted: this.rows.filter((r) => r.itemId === itemId && r.state === 'minted').length,
      leased: this.rows.filter((r) => r.itemId === itemId && r.state === 'leased').length,
    }));
    const mints = this.rows
      .filter((r) => r.state === 'minted')
      .map((r) => ({
        itemId: r.itemId,
        serial: r.serial,
        characterName: r.characterName,
        realm: r.realm,
        mintedAt: r.mintedAt ?? '',
      }));
    return { supplies, mints };
  }

  // Test helpers.
  stateOf(itemId: string, serial: number): string | undefined {
    return this.rows.find((r) => r.itemId === itemId && r.serial === serial)?.state;
  }

  countByState(itemId: string, state: string): number {
    return this.rows.filter((r) => r.itemId === itemId && r.state === state).length;
  }
}

const ITEM = 'relic';
const CAPS = [{ itemId: ITEM, supply: 5 }];
// Let the background FIFO (refill / mint / release) drain.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('LimitedSupplyService: buffer + claim', () => {
  it('warms the buffer to the target on init and claims synchronously without a DB wait', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1', { bufferTarget: 3 });
    await svc.init(CAPS);
    expect(db.leaseCalls).toBe(3); // buffer warmed to target
    expect(svc.bufferedCount(ITEM)).toBe(3);
    // The claim itself issues no lease call (it pops from the warm buffer); the
    // refill happens on the background FIFO afterward.
    const before = db.leaseCalls;
    const serial = svc.claim(ITEM);
    expect(serial).toBe(1);
    expect(db.leaseCalls).toBe(before); // synchronous claim drew no DB call
    await settle();
    expect(db.leaseCalls).toBe(before + 1); // buffer refilled back to target
    expect(svc.bufferedCount(ITEM)).toBe(3);
  });

  it('mints monotonic 1..supply then returns null (the hard cap holds)', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1', { bufferTarget: 2 });
    await svc.init(CAPS);
    const got: (number | null)[] = [];
    for (let i = 0; i < 8; i++) {
      got.push(svc.claim(ITEM));
      await settle(); // allow the refill so the next claim sees a warm buffer
    }
    expect(got).toEqual([1, 2, 3, 4, 5, null, null, null]);
  });

  it('a single-tick burst is bounded by the buffer, never exceeding the cap', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1', { bufferTarget: 3 });
    await svc.init(CAPS);
    // Drain the buffer synchronously (no settle between): the pool has 3 ready, so
    // exactly 3 mint and the 4th falls back, all in one tick.
    const burst = [svc.claim(ITEM), svc.claim(ITEM), svc.claim(ITEM), svc.claim(ITEM)];
    expect(burst).toEqual([1, 2, 3, null]);
    await settle();
    // Refill tops the buffer back up (supply has 5, three issued, so two more).
    expect(svc.bufferedCount(ITEM)).toBe(2);
  });

  it('caps the buffer at the item supply for a small-supply relic', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1', { bufferTarget: 100 });
    await svc.init([{ itemId: ITEM, supply: 2 }]);
    expect(svc.bufferedCount(ITEM)).toBe(2); // never more than the supply
    expect(db.leaseCalls).toBe(2);
  });
});

describe('LimitedSupplyService: mint attribution + release', () => {
  it('onMint confirms a leased serial and is a no-op on retry', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1', { bufferTarget: 2 });
    await svc.init(CAPS);
    const serial = svc.claim(ITEM) as number;
    svc.onMint(ITEM, serial, { characterId: 7, characterName: 'Ada' });
    svc.onMint(ITEM, serial, { characterId: 7, characterName: 'Ada' }); // retry
    await settle();
    expect(db.stateOf(ITEM, serial)).toBe('minted');
    expect(db.countByState(ITEM, 'minted')).toBe(1); // retry did not double-count
  });

  it('releaseAll returns the unclaimed buffer for reuse on the next boot', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1', { bufferTarget: 3 });
    await svc.init(CAPS);
    expect(svc.bufferedCount(ITEM)).toBe(3);
    await svc.releaseAll();
    expect(svc.bufferedCount(ITEM)).toBe(0);
    expect(db.countByState(ITEM, 'released')).toBe(3);
    // A fresh service reclaims the released serials densely (1..3 again) rather
    // than burning them and allocating 4,5.
    const svc2 = new LimitedSupplyService(db, 'r1', { bufferTarget: 3 });
    await svc2.init(CAPS);
    expect([svc2.claim(ITEM), svc2.claim(ITEM), svc2.claim(ITEM)].sort()).toEqual([1, 2, 3]);
  });

  it('never re-issues a claimed serial across a crash+reboot (uniqueness holds over erosion)', async () => {
    const db = new FakeLimitedSupplyDb();
    // A realm claims serial 1 (dropped, granted to a player), then the process
    // dies ungracefully (no releaseAll). Serial 1 is orphaned 'leased' in the DB.
    const r1 = new LimitedSupplyService(db, 'realm-one', { bufferTarget: 1 });
    await r1.init(CAPS);
    const claimed = r1.claim(ITEM);
    expect(claimed).toBe(1);
    await settle(); // the refill re-leases serial 2 into the buffer
    // A fresh boot must NOT re-issue serial 1 (a player holds it): the next mints
    // continue past it, so the same serial never appears twice in the world. This
    // is the deliberate tradeoff: the orphaned serial 1 erodes the effective
    // supply, but uniqueness (the load-bearing promise) is never violated.
    const r1b = new LimitedSupplyService(db, 'realm-one', { bufferTarget: 1 });
    await r1b.init(CAPS);
    const minted: number[] = [];
    for (let i = 0; i < 12; i++) {
      const s = r1b.claim(ITEM);
      if (s !== null) minted.push(s);
      await settle();
    }
    expect(minted).not.toContain(1); // never duplicated
    expect(new Set(minted).size).toBe(minted.length); // all distinct
    expect(Math.max(...minted)).toBeLessThanOrEqual(5); // never past the cap
  });
});

describe('LimitedSupplyService: cross-realm cap (one ledger, two realms)', () => {
  it('two realms sharing the ledger never mint past the global supply', async () => {
    const db = new FakeLimitedSupplyDb(); // one Postgres for both processes
    const r1 = new LimitedSupplyService(db, 'realm-one', { bufferTarget: 2 });
    const r2 = new LimitedSupplyService(db, 'realm-two', { bufferTarget: 2 });
    await r1.init(CAPS);
    await r2.init(CAPS);
    // With supply 5 and each realm buffering 2, the two buffers hold 4 distinct
    // serials; the 5th is still allocatable. Drain both realms to exhaustion.
    const minted = new Set<number>();
    for (let i = 0; i < 10; i++) {
      const a = r1.claim(ITEM);
      const b = r2.claim(ITEM);
      if (a !== null) minted.add(a);
      if (b !== null) minted.add(b);
      await settle();
    }
    // Exactly the 5 distinct serials 1..5 ever issued, no duplicates, no overflow.
    expect([...minted].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });
});

// A transient lease failure must not permanently stop this realm minting.
// enqueue() logs and swallows a rejected background write, so before the fix the
// ONLY refill triggers were init() and a SUCCESSFUL claim: one failed refill left
// the pool empty, every later claim took the empty-pool early return without
// scheduling anything, and the relic silently degraded to its fallback forever.
describe('LimitedSupplyService: buffer recovery after a failed refill', () => {
  // Wraps the fake so a chosen number of leaseSerial calls reject before it heals.
  class FlakyDb extends FakeLimitedSupplyDb {
    failuresLeft = 0;
    override async leaseSerial(itemId: string, realm: string): Promise<number | null> {
      if (this.failuresLeft > 0) {
        this.failuresLeft -= 1;
        throw new Error('transient lease failure');
      }
      return super.leaseSerial(itemId, realm);
    }
  }

  it('re-warms the buffer after a transient lease failure instead of stalling forever', async () => {
    const db = new FlakyDb();
    const errors: string[] = [];
    const svc = new LimitedSupplyService(db, 'r1', {
      bufferTarget: 1,
      onError: (message) => errors.push(message),
    });
    await svc.init(CAPS);
    expect(svc.bufferedCount(ITEM)).toBe(1);

    // Drain the warm serial, then make its refill fail.
    expect(svc.claim(ITEM)).toBe(1);
    db.failuresLeft = 1;
    await settle();
    expect(errors.length).toBeGreaterThan(0); // the refill really did fail
    expect(svc.bufferedCount(ITEM)).toBe(0);

    // The database is healthy again. A claim on the empty pool still returns null
    // (the sim awards the fallback for THIS kill), but it must schedule a refill.
    expect(svc.claim(ITEM)).toBeNull();
    await settle();
    expect(svc.bufferedCount(ITEM)).toBe(1);

    // The next kill mints again, and supply continues from where it left off.
    expect(svc.claim(ITEM)).toBe(2);
  });

  it('keeps retrying so a realm can pick up serials another realm released back', async () => {
    // One shared ledger, two realm processes. r2 drains the whole supply, so r1's
    // pool empties on a genuinely exhausted cap. When r2 gracefully releases its
    // unclaimed buffer, r1 must be able to pick those serials up.
    const db = new FakeLimitedSupplyDb();
    const small = [{ itemId: ITEM, supply: 2 }];
    const r1 = new LimitedSupplyService(db, 'r1', { bufferTarget: 1 });
    const r2 = new LimitedSupplyService(db, 'r2', { bufferTarget: 1 });
    await r1.init(small);
    await r2.init(small);

    // Both hold one buffered serial; drain r1's and let its refill find nothing.
    expect(r1.claim(ITEM)).not.toBeNull();
    await settle();
    expect(r1.bufferedCount(ITEM)).toBe(0);
    // Exhausted: a claim returns null and does not invent a serial.
    expect(r1.claim(ITEM)).toBeNull();
    await settle();
    expect(r1.bufferedCount(ITEM)).toBe(0);

    // r2 shuts down gracefully and returns its unclaimed serial to the pool.
    await r2.releaseAll();

    // r1 retries and picks it up rather than staying dark for the process life.
    expect(r1.claim(ITEM)).toBeNull(); // this claim schedules the retry
    await settle();
    expect(r1.bufferedCount(ITEM)).toBe(1);
    expect(r1.claim(ITEM)).not.toBeNull();
  });

  it('bounds the retry to one in-flight refill per item on a hot empty pool', async () => {
    // Past the cap the boss keeps rolling, so claim() is called on every kill.
    // Each claim must not pile up an unbounded queue of doomed lease attempts.
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1', { bufferTarget: 1 });
    await svc.init([{ itemId: ITEM, supply: 1 }]);
    expect(svc.claim(ITEM)).toBe(1);
    await settle();
    const before = db.leaseCalls;
    // Ten claims against an exhausted supply, all before the FIFO drains.
    for (let i = 0; i < 10; i++) expect(svc.claim(ITEM)).toBeNull();
    await settle();
    expect(db.leaseCalls - before).toBeLessThanOrEqual(2);
  });
});
