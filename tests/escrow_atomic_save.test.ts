// The 30s autosave persists character state (server/game.ts saveAll) and the
// market/mail world_state blobs (saveMarket/saveMail) as two INDEPENDENT
// fire-and-forget writes (flushPeriodicSaves). A crash between them tears an
// escrow-mutating command in half: market_buy's buyer character save (item
// granted, copper deducted) can commit before the market blob write that
// removes the listing, so a restart resurrects the listing (item duplicated,
// seller's proceeds lost); mail_take has the mirror coin/item-dupe window.
//
// The fix schedules the ALREADY atomic saveCharacterAndMarketState (the same
// writer the leave path uses, see saveCharacterOnLeave) for the acting
// character right after any escrow-mutating market/mail command, debounced
// per character so a burst of commands coalesces into one write, instead of
// relying only on the unsynchronized 30s pair.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { saveCharacterAndMarketState } from '../server/db';
import { type ClientSession, GameServer } from '../server/game';

interface Joined {
  session: ClientSession;
  sent: unknown[];
}

// biome-ignore lint/suspicious/noExplicitAny: private sim/server internals are reached via a cast in tests.
type AnyServer = any;

function join(server: AnyServer, id: number, name: string): Joined {
  const sent: unknown[] = [];
  const ws = { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) };
  const session = server.join(ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return { session, sent };
}

function send(server: AnyServer, session: ClientSession, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

function bringMerchantToPlayer(sim: AnyServer, pid: number): void {
  const merchant = sim.entities.get(sim.market.merchantIds[0]);
  const p = sim.entities.get(pid);
  merchant.pos = { ...p.pos };
  merchant.prevPos = { ...merchant.pos };
}

function moveToMailbox(sim: AnyServer, pid: number): void {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const p = sim.entities.get(pid);
  p.pos = { ...box.pos };
  p.prevPos = { ...p.pos };
}

function bookLetter(sim: AnyServer, recipientName: string, id: number, copper: number): void {
  sim.postOffice.mail.push({
    id,
    recipientKey: recipientName,
    recipientName,
    senderName: 'Postmaster',
    kind: 'system',
    subject: 'Coin',
    body: '',
    copper,
    items: [],
    deliverAt: 0,
    expiresAt: Infinity,
    read: false,
    announced: false,
  });
}

// The Merchant seeds house stock at world creation, so a fresh listing is
// never index 0: find it by seller instead (never house stock).
function listingBySeller(sim: AnyServer, characterId: number): { id: number } | undefined {
  return sim.market.marketListings.find(
    (l: { house: boolean; sellerKey: string }) => !l.house && l.sellerKey === String(characterId),
  );
}

function savesFor(characterId: number): unknown[][] {
  return vi.mocked(saveCharacterAndMarketState).mock.calls.filter((c) => c[0] === characterId);
}

// Fires every currently-pending timer (the escrow debounce, nothing else: these
// tests never call server.start(), so no interval loop is running) and lets the
// resulting save promise chain settle.
async function runEscrowTimers(): Promise<void> {
  await vi.runOnlyPendingTimersAsync();
  await vi.waitFor(() => {
    expect(vi.mocked(saveCharacterAndMarketState).mock.calls.length).toBeGreaterThan(0);
  });
}

beforeEach(() => {
  vi.mocked(saveCharacterAndMarketState).mockClear();
});

describe('escrow-mutating commands schedule a prompt atomic character+market/mail save', () => {
  it('market_list schedules an atomic save for the lister', async () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const seller = join(server, 1, 'Lister');
      const sim = server.sim as AnyServer;
      bringMerchantToPlayer(sim, seller.session.pid);
      sim.addItem('wolf_fang', 1, seller.session.pid);

      send(server, seller.session, { cmd: 'market_list', item: 'wolf_fang', count: 1, price: 100 });
      expect(listingBySeller(sim, seller.session.characterId)).toBeDefined();
      expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

      await runEscrowTimers();
      expect(savesFor(seller.session.characterId).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('market_buy schedules an atomic save for the buyer, off the hot dispatch path', async () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const seller = join(server, 1, 'Seller');
      const buyer = join(server, 2, 'Buyer');
      const sim = server.sim as AnyServer;
      bringMerchantToPlayer(sim, seller.session.pid);
      bringMerchantToPlayer(sim, buyer.session.pid);
      sim.addItem('wolf_fang', 1, seller.session.pid);
      sim.players.get(buyer.session.pid).copper = 1000;

      send(server, seller.session, { cmd: 'market_list', item: 'wolf_fang', count: 1, price: 100 });
      const listing = listingBySeller(sim, seller.session.characterId);
      if (!listing) throw new Error('listing not found');

      send(server, buyer.session, { cmd: 'market_buy', id: listing.id });

      // The buy itself resolves synchronously inside the authoritative Sim...
      const buyerMeta = sim.players.get(buyer.session.pid);
      expect(buyerMeta.copper).toBe(900);
      expect(buyerMeta.inventory.some((s: { itemId: string }) => s.itemId === 'wolf_fang')).toBe(
        true,
      );
      // ...but the atomic escrow save must not run inline on the hot dispatch
      // path: it is scheduled (fire-and-forget), matching every other save
      // call in this file.
      expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

      await runEscrowTimers();
      expect(savesFor(buyer.session.characterId).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('market_cancel schedules an atomic save for the canceller', async () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const seller = join(server, 1, 'Canceller');
      const sim = server.sim as AnyServer;
      bringMerchantToPlayer(sim, seller.session.pid);
      sim.addItem('wolf_fang', 1, seller.session.pid);
      send(server, seller.session, { cmd: 'market_list', item: 'wolf_fang', count: 1, price: 100 });
      await runEscrowTimers(); // drain the market_list save first
      vi.mocked(saveCharacterAndMarketState).mockClear();

      const listing = listingBySeller(sim, seller.session.characterId);
      if (!listing) throw new Error('listing not found');
      send(server, seller.session, { cmd: 'market_cancel', id: listing.id });
      expect(listingBySeller(sim, seller.session.characterId)).toBeUndefined();
      expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

      await runEscrowTimers();
      expect(savesFor(seller.session.characterId).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mail_send schedules an atomic save for the sender', async () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const alice = join(server, 1, 'Alice');
      const bob = join(server, 2, 'Bob');
      const sim = server.sim as AnyServer;
      const aliceMeta = sim.players.get(alice.session.pid);
      aliceMeta.copper = 10_000;
      moveToMailbox(sim, alice.session.pid);

      send(server, alice.session, {
        cmd: 'mail_send',
        to: 'Bob',
        subject: 'Hi',
        body: 'there',
        copper: 0,
        items: [],
      });
      expect(aliceMeta.copper).toBe(10_000 - 30); // MAIL_POSTAGE taken: the send resolved
      expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

      await runEscrowTimers();
      expect(savesFor(alice.session.characterId).length).toBe(1);
      // Bob (the recipient) took no action of his own: no save scheduled for him.
      expect(savesFor(bob.session.characterId).length).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mail_take schedules an atomic save for the taker (mirrors market_buy)', async () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const taker = join(server, 1, 'Taker');
      const sim = server.sim as AnyServer;
      const meta = sim.players.get(taker.session.pid);
      bookLetter(sim, meta.name, 9001, 50);
      moveToMailbox(sim, taker.session.pid);

      send(server, taker.session, { cmd: 'mail_take', id: 9001 });
      expect(meta.copper).toBe(50);
      expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

      await runEscrowTimers();
      expect(savesFor(taker.session.characterId).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces a burst of escrow commands from one character into a single debounced save', async () => {
    vi.useFakeTimers();
    try {
      const server = new GameServer();
      const taker = join(server, 1, 'Burst');
      const sim = server.sim as AnyServer;
      const meta = sim.players.get(taker.session.pid);
      bookLetter(sim, meta.name, 9101, 10);
      bookLetter(sim, meta.name, 9102, 10);
      bookLetter(sim, meta.name, 9103, 10);
      moveToMailbox(sim, taker.session.pid);

      // Three takes back to back, all inside one debounce window: each
      // re-arms the same per-character timer instead of scheduling a new one.
      send(server, taker.session, { cmd: 'mail_take', id: 9101 });
      send(server, taker.session, { cmd: 'mail_take', id: 9102 });
      send(server, taker.session, { cmd: 'mail_take', id: 9103 });
      expect(meta.copper).toBe(30);

      await runEscrowTimers();
      // A separate (non-debounced) implementation would have queued three
      // pending timers here and this would read 3.
      expect(savesFor(taker.session.characterId).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
