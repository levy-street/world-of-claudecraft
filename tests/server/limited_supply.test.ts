// buildLimitedMintsResponse pulls server/db transitively, which constructs a pg
// Pool at module load and throws without DATABASE_URL. The pool never connects:
// the seam test below drives the in-memory fake only. Same guard as
// tests/server/limited_routes.test.ts.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_limited_seam';

import { describe, expect, it } from 'vitest';
import { buildLimitedMintsResponse } from '../../server/limited_routes';
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
// Field names mirror the real COLUMNS (character_id / character_name), not the
// TS field names they map to. That keeps readMints below an honest translation
// step rather than an identity pass-through, which is the exact dimension the
// mintedBy rename is about, and it lets the rename/forget writes be modeled.
interface SerialRow {
  itemId: string;
  serial: number;
  state: 'leased' | 'minted' | 'released';
  realm: string;
  characterId: number | null;
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
      released.characterId = null;
      released.characterName = null;
      released.mintedAt = null;
      return released.serial;
    }
    const cap = this.supply.get(itemId);
    if (!cap || cap.nextSerial > cap.supply) return null;
    const serial = cap.nextSerial;
    cap.nextSerial += 1;
    this.rows.push({
      itemId,
      serial,
      state: 'leased',
      realm,
      characterId: null,
      characterName: null,
      mintedAt: null,
    });
    return serial;
  }

  async markMinted(itemId: string, serial: number, attr: LimitedMintAttribution): Promise<void> {
    const row = this.rows.find(
      (r) => r.itemId === itemId && r.serial === serial && r.state === 'leased',
    );
    if (!row) return;
    row.state = 'minted';
    row.characterId = attr.mintedById;
    row.characterName = attr.mintedByName;
    row.mintedAt = '2026-07-19T00:00:00.000Z';
  }

  async renameMintedBy(characterId: number, newName: string): Promise<void> {
    for (const r of this.rows) if (r.characterId === characterId) r.characterName = newName;
  }

  async forgetMintedBy(characterId: number): Promise<void> {
    for (const r of this.rows) {
      if (r.characterId !== characterId) continue;
      r.characterId = null;
      r.characterName = null;
    }
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
        mintedByName: r.characterName,
        mintedInRealm: r.realm,
        mintedAt: r.mintedAt ?? '',
      }));
    return { supplies, mints };
  }

  // Test helpers.
  attributionOf(itemId: string, serial: number): { id: number | null; name: string | null } {
    const r = this.rows.find((x) => x.itemId === itemId && x.serial === serial);
    return { id: r?.characterId ?? null, name: r?.characterName ?? null };
  }

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
    svc.onMint(ITEM, serial, { mintedById: 7, mintedByName: 'Ada' });
    svc.onMint(ITEM, serial, { mintedById: 7, mintedByName: 'Ada' }); // retry
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

// The two deliberate exceptions to the mint row's immutability. Everything else
// about a minted serial is frozen forever, but the PUBLISHED NAME is not the
// platform's to keep: a moderator force-rename must reach the public ledger or
// the moderation action is defeated on its widest-reach surface, and a deleted
// character's name must stop being served. Both key off character_id, and both
// must leave the serial row itself intact, because re-issuing a serial is the
// one thing this feature can never do.
describe('LimitedSupplyService: the immutability exceptions (rename and delete)', () => {
  const mintOne = async (db: FakeLimitedSupplyDb, attr: LimitedMintAttribution) => {
    const svc = new LimitedSupplyService(db, 'r1');
    await svc.init(CAPS);
    const serial = svc.claim(ITEM) as number;
    svc.onMint(ITEM, serial, attr);
    await settle();
    return { svc, serial };
  };

  it('a force-rename rewrites the published name and nothing else about the row', async () => {
    const db = new FakeLimitedSupplyDb();
    const { svc, serial } = await mintOne(db, { mintedById: 42, mintedByName: 'Badname' });
    await svc.renameMintedBy(42, 'Renamed');

    expect(db.attributionOf(ITEM, serial)).toEqual({ id: 42, name: 'Renamed' });
    // The serial survives, still minted: a rename must never free or re-issue it.
    expect(db.stateOf(ITEM, serial)).toBe('minted');
    expect(db.countByState(ITEM, 'minted')).toBe(1);
    // It reaches the public read, which is the whole point of following the rename.
    const snap = await db.readMints();
    expect(snap.mints.map((m) => m.mintedByName)).toEqual(['Renamed']);
  });

  it('deleting a character clears its attribution but keeps the serial minted', async () => {
    const db = new FakeLimitedSupplyDb();
    const { svc, serial } = await mintOne(db, { mintedById: 42, mintedByName: 'Ada' });
    await svc.forgetMintedBy(42);

    // BOTH columns cleared: leaving character_id behind would keep a pointer to a
    // deleted player on a row that disclaims being an owner index.
    expect(db.attributionOf(ITEM, serial)).toEqual({ id: null, name: null });
    // The row itself is untouched, so the serial can never be handed out again.
    expect(db.stateOf(ITEM, serial)).toBe('minted');
    expect(db.countByState(ITEM, 'minted')).toBe(1);
    expect(db.countByState(ITEM, 'released')).toBe(0);
    // The public read still shows the serial as minted, with a null winner.
    const snap = await db.readMints();
    expect(snap.mints).toHaveLength(1);
    expect(snap.mints[0].serial).toBe(serial);
    expect(snap.mints[0].mintedByName).toBeNull();
  });

  it('touches only the named character, never another player holding a serial', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'r1');
    await svc.init(CAPS);
    const mine = svc.claim(ITEM) as number;
    svc.onMint(ITEM, mine, { mintedById: 1, mintedByName: 'Mine' });
    await settle();
    const theirs = svc.claim(ITEM) as number;
    svc.onMint(ITEM, theirs, { mintedById: 2, mintedByName: 'Theirs' });
    await settle();

    await svc.renameMintedBy(1, 'MineRenamed');
    await svc.forgetMintedBy(1);

    expect(db.attributionOf(ITEM, mine)).toEqual({ id: null, name: null });
    expect(db.attributionOf(ITEM, theirs)).toEqual({ id: 2, name: 'Theirs' });
  });

  it('a serial minted without a resolvable character id is unreachable by either write', async () => {
    const db = new FakeLimitedSupplyDb();
    // The world-boss / linkdead case: game.ts passes `winner?.characterId ?? null`.
    const { svc, serial } = await mintOne(db, { mintedById: null, mintedByName: 'Ghost' });
    await svc.renameMintedBy(0, 'X');
    await svc.forgetMintedBy(0);
    // Documented limitation, pinned so it is a known gap and not a surprise: with
    // no id there is no key to find the row by, so the name stays frozen.
    expect(db.attributionOf(ITEM, serial)).toEqual({ id: null, name: 'Ghost' });
  });
});

// The seam, end to end in one test. Every link was already pinned in isolation
// (the service confirms a serial, the builder renames the field), but nothing
// ran a real attribution all the way through, so a field-name mismatch between
// readMints and the response builder had no runtime guard. This is the test that
// would catch "the winner's name silently stops arriving on the public API".
describe('limited relics: attribution survives service -> readMints -> public response', () => {
  it('carries the winner through to mintedBy, and a cleared winner through to null', async () => {
    const db = new FakeLimitedSupplyDb();
    const svc = new LimitedSupplyService(db, 'realm-one');
    await svc.init(CAPS);
    const serial = svc.claim(ITEM) as number;
    svc.onMint(ITEM, serial, { mintedById: 7, mintedByName: 'Ada' });
    await settle();

    const view = buildLimitedMintsResponse(await db.readMints());
    const row = view.items.find((i) => i.itemId === ITEM);
    expect(row?.mints).toEqual([
      { serial, mintedBy: 'Ada', mintedInRealm: 'realm-one', mintedAt: expect.any(String) },
    ]);

    // And the deletion path all the way to the public payload: the serial stays
    // on the ledger, the name stops being served.
    await svc.forgetMintedBy(7);
    const after = buildLimitedMintsResponse(await db.readMints());
    const afterRow = after.items.find((i) => i.itemId === ITEM);
    expect(afterRow?.mints).toEqual([
      { serial, mintedBy: null, mintedInRealm: 'realm-one', mintedAt: expect.any(String) },
    ]);
    expect(afterRow?.minted).toBe(1); // still counted: the relic still exists
  });
});
