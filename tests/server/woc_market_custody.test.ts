// The $WOC Exchange custody bridge (server/woc_market_custody.ts): the ONE
// place marketplace code touches the live Sim. Driven against a REAL Sim with a
// fake GameServer host, because the thing worth pinning here is precisely what a
// fake PostOffice would paper over.
//
// Why this file exists: persistMailParcel used to DISCARD the boolean
// mailSystemParcel returns. The escrowed copy is already gone from the seller's
// bags by the time a parcel is booked, so a refused parcel that reports success
// let bookCustodyOnce mark the custody ref booked and advance the settlement to
// 'delivered' against a letter carrying nothing: a silently destroyed item, with
// every test green. The refusal now throws, which lands in the caller's existing
// failure path (release the claim, retry on a later sweep pass).

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_woc_market_custody';

import { describe, expect, it } from 'vitest';
import { createWocMarketCustody, type WocCustodyGameHost } from '../../server/woc_market_custody';
import { isCataloguedRelicItem } from '../../src/sim/content/reliquary';
import { Sim } from '../../src/sim/sim';
import type { InvSlot } from '../../src/sim/types';

const RECIPIENT = { key: '4242', name: 'Buyer' };
const REF = 'settlement:9';

/** A host over a real Sim: no live session (deliveries never need one) and a
 *  persist hook whose calls are counted so "did it try to persist" is decidable. */
function makeHost(over: Partial<WocCustodyGameHost> = {}): {
  host: WocCustodyGameHost;
  persists: () => number;
} {
  let persists = 0;
  const sim = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
  const host: WocCustodyGameHost = {
    sim,
    wocCustodySession: () => null,
    persistMailBlob: async () => {
      persists++;
    },
    // Pass-through FIFO and a fixup-free persist snapshot: these tests have
    // no GameServer, so the session fixups and queue ordering are exercised
    // by tests/server/woc_market_escrow_queue.test.ts instead.
    enqueueCharacterWrite: (_characterId, job) => job(),
    serializeCharacterForPersist: (characterId) => {
      const session = host.wocCustodySession(characterId);
      if (!session) return null;
      const state = host.sim.serializeCharacter(session.pid);
      return state ? { level: state.level, state } : null;
    },
    hasDirtyGuildBooks: () => false,
    flushDirtyGuildBooks: async () => {},
    escrowSessionLost: () => {},
    ...over,
  };
  return { host, persists: () => persists };
}

const GOOD: InvSlot = { itemId: 'rusty_hatchet', count: 1 };
const UNKNOWN: InvSlot = { itemId: 'no_such_item_id', count: 1 };

describe('persistMailParcel propagates a refused parcel', () => {
  it('throws, and does NOT persist, when no offered slot survives validation', async () => {
    const { host, persists } = makeHost();
    const custody = createWocMarketCustody(host);
    await expect(custody.persistMailParcel(RECIPIENT, 'delivery', [UNKNOWN], REF)).rejects.toThrow(
      /refused/,
    );
    // Persisting a blob that holds no parcel is the step that would make the
    // loss durable, so the throw has to come first.
    expect(persists()).toBe(0);
    expect(host.sim.postOffice.mail).toHaveLength(0);
  });

  it('names the custody ref in the error so the stuck row is findable in a log', async () => {
    const { host } = makeHost();
    const custody = createWocMarketCustody(host);
    await expect(
      custody.persistMailParcel(RECIPIENT, 'delivery', [UNKNOWN], 'settlement:777'),
    ).rejects.toThrow(/settlement:777/);
  });

  it('books and persists exactly once on the happy path', async () => {
    const { host, persists } = makeHost();
    const custody = createWocMarketCustody(host);
    await custody.persistMailParcel(RECIPIENT, 'delivery', [GOOD], REF);
    expect(persists()).toBe(1);
    expect(host.sim.postOffice.mail).toHaveLength(1);
    expect(host.sim.postOffice.mail[0].items.map((s) => s.itemId)).toEqual(['rusty_hatchet']);
    expect(host.sim.postOffice.mail[0].custodyRef).toBe(REF);
  });

  it('resolves on the SECOND call for the same ref without booking twice', async () => {
    // The book-once dedupe answers "already booked" as success, which must not
    // be confused with the refusal above: a retry after a crash has to be able
    // to complete rather than throwing forever.
    const { host, persists } = makeHost();
    const custody = createWocMarketCustody(host);
    await custody.persistMailParcel(RECIPIENT, 'delivery', [GOOD], REF);
    await custody.persistMailParcel(RECIPIENT, 'delivery', [GOOD], REF);
    expect(host.sim.postOffice.mail).toHaveLength(1);
    expect(persists()).toBe(2);
  });

  it('propagates a persist failure too, so nothing advances on a dead blob write', async () => {
    const { host } = makeHost({
      persistMailBlob: async () => {
        throw new Error('db down');
      },
    });
    const custody = createWocMarketCustody(host);
    await expect(custody.persistMailParcel(RECIPIENT, 'delivery', [GOOD], REF)).rejects.toThrow(
      'db down',
    );
  });

  it('carries a goods-free notice through, which legitimately attaches nothing', async () => {
    // The sold_notice arm passes no items on purpose. "Nothing booked" must not
    // read as a refusal when nothing was offered, or every sale notice throws.
    const { host, persists } = makeHost();
    const custody = createWocMarketCustody(host);
    await custody.persistMailParcel(RECIPIENT, 'sold_notice', [], 'sold:9');
    expect(persists()).toBe(1);
    expect(host.sim.postOffice.mail).toHaveLength(1);
    expect(host.sim.postOffice.mail[0].items).toEqual([]);
  });
});

describe('extractCopy requires the seller live in this realm process', () => {
  it('refuses offline rather than touching a saved blob', () => {
    const { host } = makeHost();
    const custody = createWocMarketCustody(host);
    expect(custody.extractCopy(1, 2, { index: 0, itemId: 'rusty_hatchet' })).toEqual({
      ok: false,
      reason: 'offline',
    });
  });

  it('puts the copy BACK when the session races a teardown mid-extraction', () => {
    // The one arm where the bags are already mutated before the refusal: the
    // extraction succeeded, then serializeCharacterForPersist answered null
    // (the session tore down, or quarantined, between the two calls). Without
    // the restore the copy is simply gone, and the seller is told 'offline'
    // about an item that no longer exists anywhere. The host's persist
    // snapshot is decoupled from the session lookup here on purpose: the two
    // agree in the shared fake, and this case is exactly where they must not.
    const { host } = makeHost({ serializeCharacterForPersist: () => null });
    const pid = liveSession(host);
    host.sim.addItem('rusty_hatchet', 1, pid, { silent: true });
    const meta = host.sim.players.get(pid);
    if (!meta) throw new Error('no live player meta');
    const index = meta.inventory.findIndex((s) => s.itemId === 'rusty_hatchet');
    expect(index, 'the fixture item must be in the bags to extract').toBeGreaterThanOrEqual(0);
    const before = meta.inventory
      .filter((s) => s.itemId === 'rusty_hatchet')
      .reduce((n, s) => n + s.count, 0);
    const custody = createWocMarketCustody(host);
    expect(custody.extractCopy(7, 2, { index, itemId: 'rusty_hatchet' })).toEqual({
      ok: false,
      reason: 'offline',
    });
    const after = meta.inventory
      .filter((s) => s.itemId === 'rusty_hatchet')
      .reduce((n, s) => n + s.count, 0);
    expect(after, 'the extracted unit is restored, not lost').toBe(before);
  });

  it('restores as a RELOCATION: the Reliquary obtain tally does not move across the round trip', () => {
    // The undo arm hands back a copy the seller already held. Every sibling
    // relocation grant (grantCopies in item_instance_transfer.ts, the mail
    // return rail) passes movement: true so noteRelicObtain stays silent.
    // The REACHABLE door is createListing's refusal arms in woc_market.ts,
    // which call restoreCopy on a LIVE seller after a successful extract: a
    // restore that counted would let a seller inflate a catalogued relic's
    // obtain tally by listing into a refusal and retrying. This harness
    // drives the same shared restoreInto through the extractCopy undo arm
    // (fake-only on a real server, where extract and persist share one
    // synchronous frame, but the cheapest way to reach the helper). The
    // fixture is a catalogued relic (a Reliquary page item) that clears the
    // exchange lock predicate, so the counter is decisive: it moves on any
    // grant that forgets the flag.
    const RELIC = 'cryptbone_greaves';
    expect(isCataloguedRelicItem(RELIC), 'the fixture must be a catalogued relic').toBe(true);
    const { host } = makeHost({ serializeCharacterForPersist: () => null });
    const pid = liveSession(host);
    // The first grant is a real obtain: it seeds the tally at 1 (the carrier
    // entry the saved blob rides on), which is the baseline the restore must
    // leave alone.
    host.sim.addItem(RELIC, 1, pid, { silent: true });
    const meta = host.sim.players.get(pid);
    if (!meta) throw new Error('no live player meta');
    const tallyBefore = meta.reliquary.counts[RELIC] ?? 0;
    expect(tallyBefore, 'the seed grant counts once').toBe(1);
    const index = meta.inventory.findIndex((s) => s.itemId === RELIC);
    expect(index).toBeGreaterThanOrEqual(0);
    const custody = createWocMarketCustody(host);
    expect(custody.extractCopy(7, 2, { index, itemId: RELIC })).toEqual({
      ok: false,
      reason: 'offline',
    });
    expect(
      meta.inventory.filter((s) => s.itemId === RELIC).reduce((n, s) => n + s.count, 0),
      'the copy is back in the bags',
    ).toBe(1);
    expect(meta.reliquary.counts[RELIC] ?? 0, 'a restored copy is not a new obtain').toBe(
      tallyBefore,
    );
  });

  it('restores a DISTINCT payload object: the bag slot never aliases the extracted copy', () => {
    // restoreInto clones like grantCopies does: the caller may still hold the
    // extracted slot (createListing stringifies it into the listing row), and
    // a bag slot aliasing that object would let one side's mutation reach the
    // other. Reverting the clone makes the two references identical and reds
    // the not.toBe below.
    const { host } = makeHost({ serializeCharacterForPersist: () => null });
    const pid = liveSession(host);
    host.sim.addItemInstance('rusty_hatchet', { signer: 'Provenance' }, pid, 1, { silent: true });
    const meta = host.sim.players.get(pid);
    if (!meta) throw new Error('no live player meta');
    const index = meta.inventory.findIndex((s) => s.itemId === 'rusty_hatchet');
    expect(index).toBeGreaterThanOrEqual(0);
    // Capture the exact slot object the undo arm hands to restoreInto.
    const realExtract = host.sim.extractTradableCopy.bind(host.sim);
    let extracted: InvSlot | undefined;
    host.sim.extractTradableCopy = (p, ref) => {
      const out = realExtract(p, ref);
      if (out.ok) extracted = out.extracted;
      return out;
    };
    const custody = createWocMarketCustody(host);
    expect(custody.extractCopy(7, 2, { index, itemId: 'rusty_hatchet' })).toEqual({
      ok: false,
      reason: 'offline',
    });
    expect(extracted?.instance, 'the extraction carried the payload').toBeDefined();
    const slot = meta.inventory.find((s) => s.itemId === 'rusty_hatchet' && s.instance);
    expect(slot?.instance, 'the restored copy keeps its payload').toBeDefined();
    expect(slot?.instance).toEqual(extracted?.instance);
    expect(slot?.instance, 'the restored payload is a clone of the extracted one').not.toBe(
      extracted?.instance,
    );
  });

  it('refuses not_yours when the live character belongs to another account', () => {
    // The account check happens BEFORE any bag mutation: a mismatched pair must
    // never reach extractTradableCopy.
    const { host } = makeHost({
      wocCustodySession: () => ({
        pid: 1,
        accountId: 99,
        name: 'Someone',
        leaseNonce: 'nonce',
      }),
    });
    const custody = createWocMarketCustody(host);
    expect(custody.extractCopy(7, 2, { index: 0, itemId: 'rusty_hatchet' })).toEqual({
      ok: false,
      reason: 'not_yours',
    });
  });
});

/** Put a real live player behind the host's session lookup and return its pid,
 *  so the session-gated arms below run against genuine sim state. */
function liveSession(
  host: WocCustodyGameHost,
  over: { accountId?: number; leaseNonce?: string | undefined } = {},
): number {
  const pid = host.sim.addPlayer('warrior', 'Live');
  host.wocCustodySession = () => ({
    pid,
    accountId: over.accountId ?? 7,
    name: 'Live',
    leaseNonce: 'leaseNonce' in over ? over.leaseNonce : 'live-nonce',
  });
  return pid;
}

/** The two sim calls the grant arms make, reachable for stubbing without
 *  widening anything on Sim itself. */
type SimGrantSurface = {
  grantTradableCopy: (pid: number | undefined, slot: InvSlot) => boolean;
  serializeCharacter: (pid: number) => unknown;
};

describe('snapshotCopy re-serializes a live session without granting anything', () => {
  // The resume arm of a direct hand-off whose atomic save threw: it must apply
  // exactly the session checks grantCopy does, and mint nothing, or the retry
  // it authorizes becomes the second copy.
  it('refuses offline when nothing holds the character in this process', () => {
    const { host } = makeHost();
    const custody = createWocMarketCustody(host);
    expect(custody.snapshotCopy(1, 2)).toEqual({ ok: false, reason: 'offline' });
  });

  it('refuses not_yours when the live session belongs to another account', () => {
    const { host } = makeHost();
    liveSession(host, { accountId: 99 });
    const custody = createWocMarketCustody(host);
    expect(custody.snapshotCopy(7, 2)).toEqual({ ok: false, reason: 'not_yours' });
  });

  it('carries the session lease nonce, grants nothing, and leaves the bags alone', () => {
    const { host } = makeHost();
    const pid = liveSession(host);
    const sim = host.sim as unknown as SimGrantSurface;
    const realGrant = sim.grantTradableCopy.bind(host.sim);
    let grants = 0;
    sim.grantTradableCopy = (target, slot) => {
      grants++;
      return realGrant(target, slot);
    };
    const before = JSON.stringify(host.sim.serializeCharacter(pid)?.inventory);
    const custody = createWocMarketCustody(host);
    const out = custody.snapshotCopy(7, 2);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The fence nonce is what makes the retried save land on the same session,
    // so losing it here would turn every resume into a lease_lost park.
    expect(out.save.leaseNonce).toBe('live-nonce');
    expect(out.save.characterId, 'the caller names the row, not the pid').toBe(2);
    expect(grants, 'a snapshot mints nothing').toBe(0);
    expect(JSON.stringify(host.sim.serializeCharacter(pid)?.inventory)).toBe(before);
  });
});

describe('grantCopy separates a clean refusal from an AMBIGUOUS one', () => {
  it('reports ambiguous when the state will not serialize after the bags were touched', () => {
    // The one refusal the caller may not mail over: grantTradableCopy already
    // mutated the live bags, so an ordinary teardown flush may still persist
    // them. Mailing here is the second copy; ambiguity parks instead.
    const { host } = makeHost();
    liveSession(host);
    const sim = host.sim as unknown as SimGrantSurface;
    let granted = 0;
    sim.grantTradableCopy = () => {
      granted++;
      return true;
    };
    sim.serializeCharacter = () => null;
    const custody = createWocMarketCustody(host);
    expect(custody.grantCopy(7, 2, GOOD)).toEqual({ ok: false, reason: 'ambiguous' });
    // The ordering is the whole reason this is not 'offline': the grant landed
    // first, which is what makes the outcome unprovable rather than clean.
    expect(granted).toBe(1);
  });
});
