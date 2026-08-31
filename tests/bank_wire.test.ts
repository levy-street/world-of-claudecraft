import { afterEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), same block as
// loot_roll_wire.test.ts, so GameServer runs with no live DB.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  releaseCharacterLease: vi.fn(async () => true),
  loadAccountFlair: vi.fn(async () => ({ titleId: null, cosmetics: [] })),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // A successful bank op now dereferences the fire-and-forget ledger writer.
  insertBankLedgerRow: vi.fn(async () => {}),
  insertBankLedgerRows: vi.fn(async () => {}),
}));

// Controllable next-rung Claudium quote: the real cache needs a live service,
// and the gated `bank` key must re-emit on a SERVER-side price retune that
// moves no sim revision. Default undefined = absent, the rig's old behavior.
// Spread of the real module so STORAGE_PRICE_MAX_STALE_MS keeps its real
// value for the storage_ladder_hold importer inside the server graph.
const { bankWirePriceRef } = vi.hoisted(() => ({
  bankWirePriceRef: { value: undefined as number | undefined },
}));
vi.mock('../server/storage_store_cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  nextRungClaudiumPriceFor: () => bankWirePriceRef.value,
}));

import { emitBankSelfKeys } from '../server/bank_wire';
import { GameServer } from '../server/game';
import { gameMetricsCounters } from '../server/http/game_signals';
import { bankGrantStorageSlots } from '../src/sim/bank';
import { Sim } from '../src/sim/sim';
import { COMMAND_NAMES } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

// The personal-bank wire round-trip: bank_deposit / bank_withdraw / bank_buy_slots
// resolve inside the authoritative Sim, ride the proximity-gated `bank` self-delta,
// and mirror onto ClientWorld.bankInfo. This gate proves the IWorld bankInfo read-boundary
// criteria: end-to-end deposit/withdraw/buy over the wire, a first snapshot that
// carries the delta, an unchanged bank that omits the key WITHOUT wiping the client
// mirror, a null encoding away from every banker, server authority against malformed
// commands, and offline/online outcome parity for one action script.
//
// Every value asserted is a LITERAL (item counts, copper, slot budgets), never a
// value compared against itself. The bank base is 24 slots; the first two expansion
// prices are 500 and 1000 copper (src/sim/bank.ts BANK_EXPANSION_PRICES); an
// expansion adds 6 slots. These are pinned here as bare numbers on purpose.

function fakeWs() {
  const sent: any[] = [];
  return { sent, ws: { readyState: 1, send: (p: string) => sent.push(JSON.parse(p)) } };
}
function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
  return null;
}

function joinAt(server: GameServer, fw: ReturnType<typeof fakeWs>, acct: number, name: string) {
  const s = server.join(fw.ws as any, acct, acct, name, 'warrior', null) as any;
  if ('error' in s) throw new Error(s.error);
  s.blockListLoaded = true;
  return s;
}

function send(server: GameServer, session: any, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

// Relocate the first banker NPC onto the player (the snapshots.test.ts mailbox/merchant
// idiom): nearBanker is a dist2d check, and moving the NPC (which has no wander AI)
// avoids pushing the PLAYER into a collider. Returns the banker entity.
function bringBankerToPlayer(sim: any, pid: number): any {
  const banker = sim.entities.get(sim.bankerIds[0]);
  const p = sim.entities.get(pid);
  banker.pos = { ...p.pos };
  banker.prevPos = { ...banker.pos };
  return banker;
}

function wolfFangIndex(sim: any, pid: number): number {
  return sim.players.get(pid).inventory.findIndex((s: any) => s.itemId === 'wolf_fang');
}

// Drive the identical deposit/withdraw/buy action script and return the resulting bank
// state, so the offline-Sim and over-the-wire runs can be compared for equality.
interface BankOutcome {
  inventory: any[];
  purchasedSlots: number;
  copper: number;
}
function readBank(sim: any, pid: number): BankOutcome {
  const meta = sim.players.get(pid);
  return {
    inventory: meta.bank.inventory,
    purchasedSlots: meta.bank.purchasedSlots,
    copper: meta.copper,
  };
}

describe('bank wire round-trip', () => {
  it('pins the bank_* wire tokens as an exact ordered list', () => {
    // The vault trio's review-forcing pin, on the bank family: a SEVENTH token
    // is a protocol addition that must be reviewed here, and the order is the
    // append order the table promises never to change (the socket trio landed
    // at the END of COMMAND_NAMES in phase 07, after the vault tokens).
    expect(COMMAND_NAMES.filter((t) => t.startsWith('bank_'))).toEqual([
      'bank_deposit',
      'bank_withdraw',
      'bank_buy_slots',
      'bank_unlock_socket',
      'bank_socket_bag',
      'bank_unsocket_bag',
    ]);
  });

  it('near a banker, the first snapshot carries the bank delta with the correct fields', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaulta');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 5, pid);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    expect(snap.self.bank).not.toBeNull();
    expect(snap.self.bank.slots).toEqual([]); // nothing deposited yet
    expect(snap.self.bank.capacity).toBe(24); // BANK_BASE_SLOTS
    expect(snap.self.bank.purchasedSlots).toBe(0);
    expect(snap.self.bank.bonusSlots).toBe(0);
    expect(snap.self.bank.nextExpansionCost).toBe(500); // first expansion price
    expect(snap.self.bank.bonusSources).toEqual([]); // no bankBonus stamped on this join
  });

  it('deposit, withdraw, and buy-slots resolve over the wire and the snapshot mirrors each step', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaultb');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 5, pid);
    sim.players.get(pid).copper = 1000;
    const meta = sim.players.get(pid);
    const bagCount = () => meta.inventory.find((x: any) => x.itemId === 'wolf_fang')?.count ?? 0;

    // 1) deposit a partial count (2 of 5): the rest stays in the bags.
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 2 });
    expect(meta.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    expect(bagCount()).toBe(3);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    expect(lastSnap(fw.sent).self.bank.slots).toEqual([{ itemId: 'wolf_fang', count: 2 }]);

    // 2) deposit the whole remaining stack (3): merges into the bank slot -> 5, and
    // the MERGED stack rides the wire (a mis-encode of a merged slot would slip past
    // the op-1 and op-4 snapshots, which only ever see counts 2 and 3).
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid) });
    expect(meta.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 5 }]);
    expect(meta.inventory.some((x: any) => x.itemId === 'wolf_fang')).toBe(false);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    expect(lastSnap(fw.sent).self.bank.slots).toEqual([{ itemId: 'wolf_fang', count: 5 }]);

    // 3) withdraw a partial count (2): bank -> bags.
    send(server, s, { cmd: 'bank_withdraw', slot: 0, count: 2 });
    expect(meta.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    expect(bagCount()).toBe(2);

    // 4) buy the first expansion: exact copper spent, +6 purchased slots.
    expect(meta.copper).toBe(1000);
    send(server, s, { cmd: 'bank_buy_slots' });
    expect(meta.copper).toBe(500);
    expect(meta.bank.purchasedSlots).toBe(6);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    expect(snap.self.bank.slots).toEqual([{ itemId: 'wolf_fang', count: 3 }]);
    expect(snap.self.bank.capacity).toBe(30); // 24 base + 6 purchased
    expect(snap.self.bank.purchasedSlots).toBe(6);
    expect(snap.self.bank.nextExpansionCost).toBe(1000); // second expansion price
    expect(snap.self.copper).toBe(500);
  });

  it('an unchanged bank omits the delta key and the client mirror survives the omission', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaultc');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.addItem('wolf_fang', 5, pid);

    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 4 });
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap1 = lastSnap(fw.sent);
    expect(snap1.self.bank.slots).toEqual([{ itemId: 'wolf_fang', count: 4 }]);

    const client = bareClient(pid);
    (client as any).applySnapshot(snap1);
    expect(client.bankInfo?.slots).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
    const bankRef = client.bankInfo;

    // A second broadcast with no bank change: the maybe() closure sees byte-identical
    // JSON and omits the key entirely.
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap2 = lastSnap(fw.sent);
    expect(snap2.self).not.toHaveProperty('bank');

    // Applying the delta-less snapshot keeps the prior mirror, by reference (the
    // `if (s.bank !== undefined)` guard is never entered).
    (client as any).applySnapshot(snap2);
    expect(client.bankInfo).toBe(bankRef);
    expect(client.bankInfo?.slots).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
  });

  it('leaving a banker encodes an explicit null and the client mirror clears', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaultd');
    const pid = s.pid;
    const sim = server.sim as any;
    const banker = bringBankerToPlayer(sim, pid);
    const p = sim.entities.get(pid);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snapNear = lastSnap(fw.sent);
    expect(snapNear.self.bank).not.toBeNull();

    // Mirror a client onto the near-banker snapshot so the clear below is observable.
    const client = bareClient(pid);
    (client as any).applySnapshot(snapNear);
    expect(client.bankInfo).not.toBeNull();

    // Move the only nearby banker 1000 yd away: the player is now far from every
    // banker, so the encoder ships an explicit null (the client clears its window).
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snapFar = lastSnap(fw.sent);
    expect(snapFar.self.bank).toBeNull();

    // The explicit null must CLEAR the mirror: a truthy decode guard (`if (s.bank)`)
    // would skip it and leave a stale open bank window after the player walks away,
    // while still passing the omission test above (undefined is falsy too).
    (client as any).applySnapshot(snapFar);
    expect(client.bankInfo).toBeNull();
  });

  it('server authority: malformed or out-of-range bank commands move nothing', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaulte');
    const pid = s.pid;
    const sim = server.sim as any;
    const banker = bringBankerToPlayer(sim, pid);
    const p = sim.entities.get(pid);
    sim.addItem('wolf_fang', 5, pid);
    sim.players.get(pid).copper = 1000;
    const meta = sim.players.get(pid);
    const bagCount = () => meta.inventory.find((x: any) => x.itemId === 'wolf_fang')?.count ?? 0;

    // Wrong-type slot: dispatch validation (typeof msg.slot === 'number') rejects it.
    send(server, s, { cmd: 'bank_deposit', slot: 'zero', count: 2 });
    expect(meta.bank.inventory).toEqual([]);
    expect(bagCount()).toBe(5);

    // Missing slot field entirely: same rejection, nothing moves.
    send(server, s, { cmd: 'bank_deposit', count: 2 });
    expect(meta.bank.inventory).toEqual([]);
    expect(bagCount()).toBe(5);

    // A present-but-non-number count is coerced to undefined by the dispatch typeof
    // gate, which means "deposit the whole stack": the command still succeeds. Pinned
    // as the documented coercion contract (a dispatch that instead rejected bad
    // counts would red this); it also stocks the bank for the withdraw refusals below.
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, pid), count: 'two' });
    expect(meta.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 5 }]);
    expect(bagCount()).toBe(0);

    // Wrong-type + missing slot on withdraw: rejected, the bank is untouched.
    send(server, s, { cmd: 'bank_withdraw', slot: 'zero' });
    expect(meta.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 5 }]);
    send(server, s, { cmd: 'bank_withdraw' });
    expect(meta.bank.inventory).toEqual([{ itemId: 'wolf_fang', count: 5 }]);

    // bank_buy_slots carries no client fields to validate, so its authority lives in
    // the Sim: far from every banker the proximity gate refuses, spending nothing.
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };
    send(server, s, { cmd: 'bank_buy_slots' });
    expect(meta.copper).toBe(1000);
    expect(meta.bank.purchasedSlots).toBe(0);
  });

  it('refuses the eleventh retained-ledger command before mutation and counts the drop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00Z'));
    const dropped = vi.spyOn(gameMetricsCounters(), 'wsMessageDropped');
    try {
      const server = new GameServer();
      const fw = fakeWs();
      const session = joinAt(server, fw, 1, 'Ledgerguard');
      const sim = server.sim as any;
      bringBankerToPlayer(sim, session.pid);
      sim.addItem('wolf_fang', 5, session.pid);
      const meta = sim.players.get(session.pid);

      // Shape-valid no-ops still spend the command budget, but their unused
      // row reservations are refunded. The next real move is refused before
      // it can change either side of the character-owned transfer.
      for (let index = 0; index < 10; index++) {
        send(server, session, { cmd: 'bank_deposit', slot: 999 });
      }
      const carriedSlot = wolfFangIndex(sim, session.pid);
      send(server, session, { cmd: 'bank_deposit', slot: carriedSlot, count: 2 });

      expect(meta.bank.inventory).toEqual([]);
      expect(meta.inventory[carriedSlot]).toMatchObject({ itemId: 'wolf_fang', count: 5 });
      expect(sim.events).toContainEqual({
        type: 'error',
        text: 'You are busy.',
        pid: session.pid,
      });
      expect(dropped).toHaveBeenCalledWith('bank_vault');
    } finally {
      dropped.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not reset the account retained-ledger budget on leave and reconnect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00Z'));
    try {
      const server = new GameServer();
      const firstWire = fakeWs();
      const first = joinAt(server, firstWire, 1, 'Ledgerfirst');
      const sim = server.sim as any;
      bringBankerToPlayer(sim, first.pid);

      for (let index = 0; index < 10; index++) {
        send(server, first, { cmd: 'bank_deposit', slot: 999 });
      }
      await server.leave(first, 'test reconnect');

      const secondWire = fakeWs();
      const second = server.join(
        secondWire.ws as any,
        1,
        2,
        'Ledgersecond',
        'warrior',
        null,
      ) as any;
      if ('error' in second) throw new Error(second.error);
      second.blockListLoaded = true;
      bringBankerToPlayer(sim, second.pid);
      sim.addItem('wolf_fang', 5, second.pid);
      const meta = sim.players.get(second.pid);
      const carriedSlot = wolfFangIndex(sim, second.pid);

      send(server, second, { cmd: 'bank_deposit', slot: carriedSlot, count: 2 });

      expect(meta.bank.inventory).toEqual([]);
      expect(meta.inventory[carriedSlot]).toMatchObject({ itemId: 'wolf_fang', count: 5 });
      expect(sim.events).toContainEqual({
        type: 'error',
        text: 'You are busy.',
        pid: second.pid,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('vault dispatch plumbs slot/itemId/count into the right Sim delegates', () => {
    // The three vault cases are shape-only plumbing (the Sim owns every gameplay
    // rule), so this pins exactly the plumbing: each wire field reaches the right
    // delegate parameter, wrong-typed fields are rejected, and a non-number count
    // coerces to undefined (whole stack), the bank cases' documented contract.
    // The vault unlock itself rides the wire (20000 copper is the rung 0 price,
    // pinned in src/sim/materials_vault.ts VAULT_UPGRADE_PRICES).
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaultwire');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    sim.addItem('copper_ore', 5, pid);
    meta.copper = 20000;
    const oreIndex = () => meta.inventory.findIndex((x: any) => x.itemId === 'copper_ore');
    const bagOre = () => meta.inventory.find((x: any) => x.itemId === 'copper_ore')?.count ?? 0;

    // The unlock over the wire: no client fields, the Sim charges the table price.
    send(server, s, { cmd: 'vault_buy_upgrade' });
    expect(meta.vault.upgrades).toBe(1);
    expect(meta.copper).toBe(0);

    // Wrong-type and missing slot: nothing moves. Two layers refuse this (the
    // dispatch typeof gate and the Sim's own Number.isInteger check), so this
    // arm pins the OUTCOME, not which layer fired; the count arms below are the
    // ones only the dispatch coercion contract can satisfy.
    send(server, s, { cmd: 'vault_deposit', slot: 'zero', count: 2 });
    send(server, s, { cmd: 'vault_deposit' });
    expect(meta.vault.stock).toEqual({});
    expect(bagOre()).toBe(5);

    // A non-number count coerces to undefined = the whole stack: proves BOTH that
    // msg.slot lands in the slotIndex parameter and that the count gate coerces
    // rather than rejects (a dispatch that refused bad counts would red this).
    send(server, s, { cmd: 'vault_deposit', slot: oreIndex(), count: 'two' });
    expect(meta.vault.stock).toEqual({ copper_ore: 5 });
    expect(bagOre()).toBe(0);

    // Wrong-type and missing itemId on withdraw: the stock is untouched (again
    // refused by either layer; the outcome is the pin).
    send(server, s, { cmd: 'vault_withdraw', itemId: 3 });
    send(server, s, { cmd: 'vault_withdraw' });
    expect(meta.vault.stock).toEqual({ copper_ore: 5 });

    // A well-formed partial withdraw: itemId AND count both plumb through (a
    // dropped count forward would move the whole stock and red the literal 3).
    send(server, s, { cmd: 'vault_withdraw', itemId: 'copper_ore', count: 2 });
    expect(meta.vault.stock).toEqual({ copper_ore: 3 });
    expect(bagOre()).toBe(2);
  });

  it('offline Sim and the wire path reach identical bank state for one action script', () => {
    // The shared script: stock 5 wolf_fang + 1000 copper, deposit 2 then the rest,
    // withdraw 1, buy the first expansion. End state: 4 in the bank, 6 purchased
    // slots, 500 copper.
    const offline = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as any;
    const offPid = offline.playerId;
    bringBankerToPlayer(offline, offPid);
    offline.addItem('wolf_fang', 5, offPid);
    offline.players.get(offPid).copper = 1000;
    offline.bankDeposit(wolfFangIndex(offline, offPid), 2, offPid);
    offline.bankDeposit(wolfFangIndex(offline, offPid), undefined, offPid);
    offline.bankWithdraw(0, 1, offPid);
    offline.bankBuySlots(offPid);
    const offBank = readBank(offline, offPid);

    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaultf');
    const onPid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, onPid);
    sim.addItem('wolf_fang', 5, onPid);
    sim.players.get(onPid).copper = 1000;
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, onPid), count: 2 });
    send(server, s, { cmd: 'bank_deposit', slot: wolfFangIndex(sim, onPid) });
    send(server, s, { cmd: 'bank_withdraw', slot: 0, count: 1 });
    send(server, s, { cmd: 'bank_buy_slots' });
    const onBank = readBank(sim, onPid);

    // Both paths land the same literal outcome...
    expect(offBank.inventory).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
    expect(offBank.purchasedSlots).toBe(6);
    expect(offBank.copper).toBe(500);
    // ...and they equal each other (offline Sim == authoritative server Sim).
    expect(onBank.inventory).toEqual(offBank.inventory);
    expect(onBank.purchasedSlots).toBe(offBank.purchasedSlots);
    expect(onBank.copper).toBe(offBank.copper);
  });

  it('the socket round trip resolves over the wire with exact owner-only fields at every step', () => {
    // Literals throughout: socket prices 1000000 then 2000000 copper
    // (src/sim/bank.ts BANK_SOCKET_PRICES), linen_pouch 6 general slots,
    // burlap_reagent_pouch 8 materials-only slots (src/sim/content/items.ts).
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Socketa');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    meta.copper = 3000000;
    sim.addItem('linen_pouch', 1, pid);
    sim.addItem('burlap_reagent_pouch', 1, pid);
    const carried = (id: string) => meta.inventory.filter((x: any) => x.itemId === id).length;

    // 0) the pre-unlock readout: all seven phase 06 fields ride the payload.
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    let bank = lastSnap(fw.sent).self.bank;
    expect(bank.socketsUnlocked).toBe(0);
    expect(bank.socketBags).toEqual([null, null, null, null]);
    expect(bank.nextSocketCost).toBe(1000000);
    expect(bank.capacity).toBe(24);
    expect(bank.generalCapacity).toBe(24);
    expect(bank.materialsCapacity).toBe(0);
    expect(bank.generalUsed).toBe(0);
    expect(bank.materialsUsed).toBe(0);

    // 1) unlock: exact copper spent, ONLY socketsUnlocked and nextSocketCost
    // move (an empty socket adds zero capacity).
    send(server, s, { cmd: 'bank_unlock_socket' });
    expect(meta.copper).toBe(2000000);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    bank = lastSnap(fw.sent).self.bank;
    expect(bank.socketsUnlocked).toBe(1);
    expect(bank.nextSocketCost).toBe(2000000);
    expect(bank.capacity).toBe(24);

    // 2) socket the carried general pouch (no socket named: first empty).
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch' });
    expect(carried('linen_pouch')).toBe(0);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    bank = lastSnap(fw.sent).self.bank;
    expect(bank.socketBags).toEqual(['linen_pouch', null, null, null]);
    expect(bank.capacity).toBe(30); // 24 base + 6 general bag slots
    expect(bank.generalCapacity).toBe(30);
    expect(bank.materialsCapacity).toBe(0);

    // 3) swap the satchel into the occupied socket 0: the pouch returns to the
    // bags and the pools flip to the materials split.
    send(server, s, { cmd: 'bank_socket_bag', item: 'burlap_reagent_pouch', socket: 0 });
    expect(carried('linen_pouch')).toBe(1);
    expect(carried('burlap_reagent_pouch')).toBe(0);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    bank = lastSnap(fw.sent).self.bank;
    expect(bank.socketBags).toEqual(['burlap_reagent_pouch', null, null, null]);
    expect(bank.capacity).toBe(32); // 24 base + 8 materials slots
    expect(bank.generalCapacity).toBe(24);
    expect(bank.materialsCapacity).toBe(8);

    // 4) unsocket: the satchel returns to the bags and the budget shrinks.
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 0 });
    expect(carried('burlap_reagent_pouch')).toBe(1);
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    bank = lastSnap(fw.sent).self.bank;
    expect(bank.socketBags).toEqual([null, null, null, null]);
    expect(bank.capacity).toBe(24);

    // The DECODE side: the wholesale mirror carries every socket field,
    // the pool four included (structurally guaranteed today by the wholesale
    // adopt; these lock the invariant against a future per-field encode).
    const client = bareClient(pid);
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.bankInfo?.socketsUnlocked).toBe(1);
    expect(client.bankInfo?.socketBags).toEqual([null, null, null, null]);
    expect(client.bankInfo?.nextSocketCost).toBe(2000000);
    expect(client.bankInfo?.generalCapacity).toBe(24);
    expect(client.bankInfo?.materialsCapacity).toBe(0);
    expect(client.bankInfo?.generalUsed).toBe(0);
    expect(client.bankInfo?.materialsUsed).toBe(0);
  });

  it('the named-slot arm reaches the sim: `slot` consumes the EXACT carried copy over the wire', () => {
    // The only arm real players hit (the bags click always names the clicked
    // copy), crossing the positional pid-or-target fold in the Sim delegate: a
    // positional swap in dispatch (slot passed third, pid fourth) would keep
    // every id-only test green while breaking both the pid resolution and the
    // copy addressing. The fixture discriminates by PAYLOAD: the marked copy
    // sits newest, so the id-only walk would peek IT and refuse (#2837),
    // while slot 0 names the clean copy and sockets.
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Socketslot');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    meta.copper = 1000000;
    send(server, s, { cmd: 'bank_unlock_socket' });
    meta.inventory.length = 0;
    meta.inventory.push(
      { itemId: 'linen_pouch', count: 1 }, // slot 0: the clean copy the click names
      { itemId: 'linen_pouch', count: 1, craftedRecipeId: 'tailoring_linen_pouch' }, // newest
    );

    // The id-only send peeks the NEWEST copy, which carries provenance: the
    // sim refuses before consuming anything (the control arm).
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch' });
    expect(meta.bank.socketBags).toEqual([null, null, null, null]);
    expect(meta.inventory).toHaveLength(2);

    // The named-slot send sockets exactly the clean copy at index 0: the
    // marked copy is the one that remains.
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch', slot: 0 });
    expect(meta.bank.socketBags).toEqual(['linen_pouch', null, null, null]);
    expect(meta.inventory).toHaveLength(1);
    expect(meta.inventory[0].craftedRecipeId).toBe('tailoring_linen_pouch');
  });

  it('the seven socket fields are OWNER-ONLY: a nearby viewer receives none of them', () => {
    // The executed pin the phase 06 rides-for-free claim was missing: player A
    // holds live socket state at a banker while player B stands 50 yd away,
    // inside interest range of A but outside banker range. B's whole snapshot
    // (self block AND entity broadcast) must carry none of the seven field
    // names and never A's socketed bag id. This is strictly stronger than a
    // source grep of the broadcast path: it observes the actual bytes.
    //
    // KNOWN, INTENDED exception this pin does not reach: under MODERATOR
    // spectate the self-block anchor is re-pointed at the spectated
    // character, so a spectating moderator sees the target's whole bank
    // (sockets included) in their own self block. That is the documented
    // posture every owner-only key shares (server/vault_wire.ts header:
    // bank, vault, guildBank, mail), moderator-gated at enterSpectate, and
    // deliberately NOT a player-reachable widening.
    const server = new GameServer();
    const fwA = fakeWs();
    const a = joinAt(server, fwA, 1, 'Socketowner');
    const sim = server.sim as any;
    bringBankerToPlayer(sim, a.pid);
    const metaA = sim.players.get(a.pid);
    metaA.copper = 1000000;
    sim.addItem('linen_pouch', 1, a.pid);
    send(server, a, { cmd: 'bank_unlock_socket' });
    send(server, a, { cmd: 'bank_socket_bag', item: 'linen_pouch' });
    expect(metaA.bank.socketBags[0]).toBe('linen_pouch'); // the state is live

    const fwB = fakeWs();
    const b = joinAt(server, fwB, 2, 'Socketpeer');
    const pA = sim.entities.get(a.pid);
    const pB = sim.entities.get(b.pid);
    pB.pos = { x: pA.pos.x + 50, y: pA.pos.y, z: pA.pos.z };
    pB.prevPos = { ...pB.pos };

    fwA.sent.length = 0;
    fwB.sent.length = 0;
    (server as any).broadcastSnapshots();

    // A's own wire carries all seven (the owner side of the same pass).
    const bankA = lastSnap(fwA.sent).self.bank;
    for (const field of [
      'socketsUnlocked',
      'socketBags',
      'nextSocketCost',
      'generalCapacity',
      'materialsCapacity',
      'generalUsed',
      'materialsUsed',
    ]) {
      expect(field in bankA, `owner self.bank should carry ${field}`).toBe(true);
    }

    // B sees A in its interest-scoped entity list, has no banker in range, and
    // its whole frame carries no socket field and no socketed bag id.
    const snapB = lastSnap(fwB.sent);
    expect(snapB.ents.some((e: any) => e.id === a.pid)).toBe(true);
    expect(snapB.self.bank ?? null).toBeNull();
    const rawB = JSON.stringify(snapB);
    for (const field of [
      'socketsUnlocked',
      'socketBags',
      'nextSocketCost',
      'generalCapacity',
      'materialsCapacity',
      'generalUsed',
      'materialsUsed',
      'linen_pouch',
    ]) {
      expect(rawB.includes(field), `viewer snapshot leaked ${field}`).toBe(false);
    }
  });

  it('with socket state in play, an unchanged bank omits the key and walking away nulls it', () => {
    // The two delta arms re-proven WITH sockets live, so the socket fields can
    // never regress into a per-field encode that breaks omission or clearing.
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Socketc');
    const pid = s.pid;
    const sim = server.sim as any;
    const banker = bringBankerToPlayer(sim, pid);
    const p = sim.entities.get(pid);
    sim.players.get(pid).copper = 1000000;
    sim.addItem('linen_pouch', 1, pid);
    send(server, s, { cmd: 'bank_unlock_socket' });
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch' });

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap1 = lastSnap(fw.sent);
    expect(snap1.self.bank.socketBags).toEqual(['linen_pouch', null, null, null]);
    const client = bareClient(pid);
    (client as any).applySnapshot(snap1);
    const bankRef = client.bankInfo;
    expect(bankRef?.socketsUnlocked).toBe(1);

    // Unchanged: the key is omitted and the mirror survives BY REFERENCE.
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap2 = lastSnap(fw.sent);
    expect(snap2.self).not.toHaveProperty('bank');
    (client as any).applySnapshot(snap2);
    expect(client.bankInfo).toBe(bankRef);
    expect(client.bankInfo?.socketBags).toEqual(['linen_pouch', null, null, null]);

    // Walking away: an explicit null clears the whole mirror, sockets included.
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap3 = lastSnap(fw.sent);
    expect(snap3.self.bank).toBeNull();
    (client as any).applySnapshot(snap3);
    expect(client.bankInfo).toBeNull();
  });

  it('server authority: malformed or out-of-range socket commands move nothing', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Sockete');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    meta.copper = 999999; // one short of the first socket price
    sim.addItem('linen_pouch', 1, pid);
    const untouched = () => {
      expect(meta.bank.unlockedSockets).toBe(0);
      expect(meta.bank.socketBags).toEqual([null, null, null, null]);
      expect(meta.copper).toBe(999999);
      expect(meta.inventory.some((x: any) => x.itemId === 'linen_pouch')).toBe(true);
    };

    // Unaffordable unlock: the sim refuses, nothing spent.
    send(server, s, { cmd: 'bank_unlock_socket' });
    untouched();
    // Non-string / missing item id: dispatch shape gate rejects.
    send(server, s, { cmd: 'bank_socket_bag', item: 5 });
    send(server, s, { cmd: 'bank_socket_bag' });
    untouched();
    // A well-formed item into a LOCKED socket index: the sim's range gate
    // silently refuses (no socket is unlocked yet), consuming nothing.
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch', socket: 3 });
    // ...and a malformed socket value coerces to undefined (the equip_bag
    // contract), where the first-empty scan finds no unlocked socket and the
    // sim refuses without consuming.
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch', socket: 'zero' });
    untouched();
    // Unsocket: wrong-type, missing, non-integer, and out-of-range sockets.
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 'zero' });
    send(server, s, { cmd: 'bank_unsocket_bag' });
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 1.5 });
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 9 });
    untouched();
  });

  it('malformed socket values with work REMAINING: coercion lands first-empty, gates displace nothing', () => {
    // The refusal-state test above runs every malformed arm where the sim
    // refuses REGARDLESS (nothing unlocked, nothing affordable), so it cannot
    // tell the dispatch gates from the sim's own always-refuse: a dispatch
    // mutant coercing a malformed `socket` to index 0, or an unsocket gate
    // coercing 'zero' to 0, would survive it (the early-exit trap). This
    // block re-runs the malformed shapes in a state where the gates are the
    // ONLY thing standing between the frame and a visible move: two sockets
    // unlocked, the satchel in socket 0, socket 1 OPEN, the pouch carried.
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Socketf');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    meta.copper = 3000000;
    sim.addItem('burlap_reagent_pouch', 1, pid);
    sim.addItem('linen_pouch', 1, pid);
    send(server, s, { cmd: 'bank_unlock_socket' });
    send(server, s, { cmd: 'bank_unlock_socket' });
    send(server, s, { cmd: 'bank_socket_bag', item: 'burlap_reagent_pouch' });
    expect(meta.bank.socketBags).toEqual(['burlap_reagent_pouch', null, null, null]);

    // A present-but-malformed `socket` coerces to undefined (the equip_bag
    // wire contract, bank_wire.ts) and the first-empty scan fills socket 1.
    // NEVER index 0: socket 0's satchel stays put, undisplaced.
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch', socket: 'zero' });
    expect(meta.bank.socketBags).toEqual(['burlap_reagent_pouch', 'linen_pouch', null, null]);

    // Unsocket with malformed socket values: the dispatch integer gate drops
    // each frame outright, so BOTH filled sockets stay filled (a gate that
    // coerced 'zero' to 0 would empty the satchel's socket here).
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 'zero' });
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 0.5 });
    send(server, s, { cmd: 'bank_unsocket_bag' });
    expect(meta.bank.socketBags).toEqual(['burlap_reagent_pouch', 'linen_pouch', null, null]);
    // The work-happened anchor: the exact move the mutants would have forged
    // is really available in this state when asked for correctly.
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 0 });
    expect(meta.bank.socketBags).toEqual([null, 'linen_pouch', null, null]);

    // The deliberate ONLINE-vs-OFFLINE divergence, pinned as behavior: the
    // offline Sim given the same non-integer socket argument hits its range
    // gate and refuses outright (no coercion layer exists offline), while
    // the wire's dispatch coerced and socketed first-empty above. Inherited
    // verbatim from the equip_bag family idiom; the UI only ever passes
    // integers, so no player-reachable caller sees the difference.
    const offline = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as any;
    const offPid = offline.playerId;
    bringBankerToPlayer(offline, offPid);
    offline.players.get(offPid).copper = 3000000;
    offline.addItem('linen_pouch', 1, offPid);
    offline.bankUnlockSocket(offPid);
    offline.bankSocketBag('linen_pouch', 'zero' as any, offPid);
    expect(offline.players.get(offPid).bank.socketBags).toEqual([null, null, null, null]);
  });

  it('offline Sim and the wire path reach identical socket state for one action script', () => {
    // The shared script: 3500000 copper, both bags carried, unlock twice
    // (1000000 + 2000000), socket the pouch first-empty, socket the satchel
    // into socket 1, unsocket socket 0. End state: 2 sockets unlocked,
    // the satchel alone socketed, the pouch back in the bags, 500000 copper.
    const drive = (world: any, pid: number) => {
      world.players.get(pid).copper = 3500000;
      world.addItem('linen_pouch', 1, pid);
      world.addItem('burlap_reagent_pouch', 1, pid);
    };
    const readSockets = (world: any, pid: number) => {
      const m = world.players.get(pid);
      return {
        unlocked: m.bank.unlockedSockets,
        socketBags: [...m.bank.socketBags],
        copper: m.copper,
        carriedBags: m.inventory
          .filter((x: any) => x.itemId === 'linen_pouch' || x.itemId === 'burlap_reagent_pouch')
          .map((x: any) => x.itemId)
          .sort(),
      };
    };

    const offline = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true }) as any;
    const offPid = offline.playerId;
    bringBankerToPlayer(offline, offPid);
    drive(offline, offPid);
    offline.bankUnlockSocket(offPid);
    offline.bankUnlockSocket(offPid);
    offline.bankSocketBag('linen_pouch', undefined, offPid);
    offline.bankSocketBag('burlap_reagent_pouch', 1, offPid);
    offline.bankUnsocketBag(0, offPid);
    const offOut = readSockets(offline, offPid);

    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Socketf');
    const onPid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, onPid);
    drive(sim, onPid);
    send(server, s, { cmd: 'bank_unlock_socket' });
    send(server, s, { cmd: 'bank_unlock_socket' });
    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch' });
    send(server, s, { cmd: 'bank_socket_bag', item: 'burlap_reagent_pouch', socket: 1 });
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 0 });
    const onOut = readSockets(sim, onPid);

    // Both paths land the same literal outcome...
    expect(offOut).toEqual({
      unlocked: 2,
      socketBags: [null, 'burlap_reagent_pouch', null, null],
      copper: 500000,
      carriedBags: ['linen_pouch'],
    });
    // ...and they equal each other (offline Sim == authoritative server Sim).
    expect(onOut).toEqual(offOut);
  });

  it('the two socket item movers dirty the heavy self mirror; the unlock does not', () => {
    // HEAVY_SELF_CMDS membership, observed behaviorally at the dispatch flag
    // (the inv_sort precedent). Both movers rewrite the carried inventory
    // (socketing consumes the bag copy, unsocketing returns it), so without
    // membership the owner's bag mirror lags a socket move by up to the
    // 40-tick staggered refresh. The unlock moves only copper (always-sent)
    // and the ungated bank key, so it stays OUT (the vault_buy_upgrade rule):
    // its arm proves the flag stays false while the unlock demonstrably
    // happened (the work-happened anchor).
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Socketh');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    meta.copper = 1000000;
    sim.addItem('linen_pouch', 1, pid);
    // Settle the join's own heavy pass, then drain a tick so nothing from the
    // SETUP can be what dirties the flag below (the dirty-test-vacuity rule).
    (server as any).broadcastSnapshots();
    sim.tick();

    s.selfHeavyDirty = false;
    send(server, s, { cmd: 'bank_unlock_socket' });
    expect(meta.bank.unlockedSockets).toBe(1); // the unlock happened...
    expect(s.selfHeavyDirty).toBe(false); // ...and did NOT dirty the mirror

    send(server, s, { cmd: 'bank_socket_bag', item: 'linen_pouch' });
    expect(meta.bank.socketBags[0]).toBe('linen_pouch');
    expect(s.selfHeavyDirty).toBe(true);

    s.selfHeavyDirty = false;
    send(server, s, { cmd: 'bank_unsocket_bag', socket: 0 });
    expect(meta.bank.socketBags[0]).toBeNull();
    expect(s.selfHeavyDirty).toBe(true);
  });

  it('a bank-bonus stamped join rides the wire: bonusSlots, capacity, and byte-equal breakdown rows', () => {
    // ws_auth stamps the recomputed grant into the join meta bag; addPlayer
    // writes bonusSlots + the breakdown into the character state; bankInfoFor exposes
    // them and the proximity-gated `bank` self-delta ships them. Here we stamp the meta
    // directly (the 8th join arg) to prove the whole state-to-wire path end to end.
    const server = new GameServer();
    const fw = fakeWs();
    const bankBonus = {
      bonusSlots: 6,
      sources: [
        { id: 'email', slots: 2, maxSlots: 2 },
        { id: 'referral', slots: 4, maxSlots: 10, count: 2, cap: 5 },
      ],
    };
    const s = server.join(fw.ws as any, 1, 1, 'Vaultg', 'warrior', null, false, {
      bankBonus,
    }) as any;
    if ('error' in s) throw new Error(s.error);
    s.blockListLoaded = true;
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    expect(snap.self.bank).not.toBeNull();
    expect(snap.self.bank.bonusSlots).toBe(6);
    expect(snap.self.bank.capacity).toBe(30); // 24 base + 0 purchased + 6 bonus
    expect(snap.self.bank.purchasedSlots).toBe(0);
    // The stamped breakdown rows ride byte-for-byte, count/cap included on the referral row.
    expect(snap.self.bank.bonusSources).toEqual([
      { id: 'email', slots: 2, maxSlots: 2 },
      { id: 'referral', slots: 4, maxSlots: 10, count: 2, cap: 5 },
    ]);

    // And the DECODE side: the ClientWorld mirror carries the populated breakdown
    // through applySnapshot (the whole-object bank decode; a per-field rewrite that
    // dropped bonusSources would red here while every encode pin stayed green).
    const client = bareClient(pid);
    (client as any).applySnapshot(snap);
    expect(client.bankInfo?.bonusSlots).toBe(6);
    expect(client.bankInfo?.bonusSources).toEqual([
      { id: 'email', slots: 2, maxSlots: 2 },
      { id: 'referral', slots: 4, maxSlots: 10, count: 2, cap: 5 },
    ]);
  });

  it('an overridden price table reaches ClientWorld unchanged (phase 09)', () => {
    // GameServer builds its own Sim (the boot env knob), so the override rides
    // a sim SWAPPED IN before any join or broadcast: every read in the
    // join -> bankInfoFor -> snapshot -> mirror flow resolves against the
    // overridden tables. Safe here because the one constructor-time capture of
    // the boot sim (the parse subsystem, inert without PARSE_CAPTURE=1) plays
    // no part in the bank flow; join(), handleMessage(), and
    // broadcastSnapshots() all read server.sim at call time.
    // Override lists must be EXACTLY the compiled lengths (12 expansions, 4
    // sockets) or the resolver drops the dimension; rung 0 carries the value
    // each assertion pins. 777 and 111111 appear in NO price table, so a
    // regression to any compiled constant (client- or server-side) fails on a
    // number that cannot occur by coincidence.
    const server = new GameServer();
    (server as any).sim = new Sim({
      seed: 7,
      playerClass: 'warrior',
      noPlayer: true,
      storagePrices: {
        bankExpansions: [777, 778, 779, 780, 781, 782, 783, 784, 785, 786, 787, 788],
        bankSockets: [111111, 222222, 333333, 444444],
      },
    });
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaultover');
    const pid = s.pid;
    bringBankerToPlayer(server.sim as any, pid);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    // The encode quotes the overridden rung-0 prices (fresh literals, never
    // the override object: comparing against the minted array would be a
    // self-comparison)...
    expect(snap.self.bank.nextExpansionCost).toBe(777);
    expect(snap.self.bank.nextSocketCost).toBe(111111);
    // ...and the decode mirrors them onto ClientWorld untouched.
    const client = bareClient(pid);
    (client as any).applySnapshot(snap);
    expect(client.bankInfo?.nextExpansionCost).toBe(777);
    expect(client.bankInfo?.nextSocketCost).toBe(111111);
  });

  it('the default rig still quotes the compiled prices through to the mirror', () => {
    // The control arm for the override above: an unmodified GameServer (no
    // storagePrices anywhere) quotes the compiled rung-0 prices, pinned as
    // fresh literals end to end so an override that leaked into the default
    // boot path fails here. Env note: a shell-exported STORAGE_PRICES WOULD
    // reach this boot sim (server/storage_prices.ts parses at module load)
    // and red this arm; CI and the gate run with it unset, which is the
    // environment this pin assumes.
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Vaultdef');
    const pid = s.pid;
    bringBankerToPlayer(server.sim as any, pid);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    expect(snap.self.bank.nextExpansionCost).toBe(500); // BANK_EXPANSION_PRICES[0]
    expect(snap.self.bank.nextSocketCost).toBe(1000000); // BANK_SOCKET_PRICES[0]
    const client = bareClient(pid);
    (client as any).applySnapshot(snap);
    expect(client.bankInfo?.nextExpansionCost).toBe(500);
    expect(client.bankInfo?.nextSocketCost).toBe(1000000);
  });
});

// ---------------------------------------------------------------------------
// The always-available ladder key `bpsl` (Bank Storage phase 15, ruling 17).
// Unlike `bank` it rides NO proximity gate, because the Strongbox store opens
// anywhere and gates its charter list on it. Still owner-only and self-block
// only, and keyed on the VIEWING session rather than the spectate anchor, which
// is what keeps the client-side count monotone for as long as one character is resident.
// ---------------------------------------------------------------------------
describe('the always-available ladder wire key', () => {
  it('rides the wire and reaches the client mirror where bankInfo is NULL', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Ladderfar');
    const pid = s.pid;
    const sim = server.sim as any;
    // Buy a rung at a banker, then walk away: the exact state ruling 17 records.
    bringBankerToPlayer(sim, pid);
    sim.players.get(pid).copper = 500;
    send(server, s, { cmd: 'bank_buy_slots' });
    const banker = sim.entities.get(sim.bankerIds[0]);
    const p = sim.entities.get(pid);
    banker.pos = { x: p.pos.x + 1000, y: p.pos.y, z: p.pos.z + 1000 };

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    expect(snap.self.bank).toBeNull(); // the blindness...
    expect(snap.self.bpsl).toBe(6); // ...and the key that closes it

    const client = bareClient(pid);
    (client as any).applySnapshot(snap);
    expect(client.bankInfo).toBeNull();
    expect(client.bankPurchasedSlots).toBe(6);
  });

  it('moves on a real gold rung and on a Claudium grant, both over the wire', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Laddermove');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.players.get(pid).copper = 5_000;
    const client = bareClient(pid);

    (server as any).broadcastSnapshots();
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.bankPurchasedSlots).toBe(0);

    send(server, s, { cmd: 'bank_buy_slots' });
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.bankPurchasedSlots).toBe(6);

    // The server-originated Claudium grant is the other writer, and it must move
    // the same key (it is not a ws command, so nothing else would carry it).
    expect(bankGrantStorageSlots(sim.ctx, pid, 'strongbox_charter_1', 'wire-grant-a').status).toBe(
      'applied',
    );
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    (client as any).applySnapshot(lastSnap(fw.sent));
    expect(client.bankPurchasedSlots).toBe(18);
  });

  it('an unchanged ladder omits the key, and the omission does not reset the mirror', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Ladderhold');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);
    sim.players.get(pid).copper = 500;
    send(server, s, { cmd: 'bank_buy_slots' });

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap1 = lastSnap(fw.sent);
    expect(snap1.self.bpsl).toBe(6);
    const client = bareClient(pid);
    (client as any).applySnapshot(snap1);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap2 = lastSnap(fw.sent);
    expect(snap2.self).not.toHaveProperty('bpsl');
    // A decode that defaulted on omission would reset a joined session to null
    // and re-open the very blindness this key closes.
    (client as any).applySnapshot(snap2);
    expect(client.bankPurchasedSlots).toBe(6);
  });

  it('is OWNER-ONLY: a nearby viewer receives their OWN count, never the observed one', () => {
    const server = new GameServer();
    const fwA = fakeWs();
    const a = joinAt(server, fwA, 1, 'Ladderowner');
    const sim = server.sim as any;
    bringBankerToPlayer(sim, a.pid);
    sim.players.get(a.pid).copper = 4_000;
    send(server, a, { cmd: 'bank_buy_slots' });
    send(server, a, { cmd: 'bank_buy_slots' });
    expect(sim.players.get(a.pid).bank.purchasedSlots).toBe(12); // A's state is live

    const fwB = fakeWs();
    const b = joinAt(server, fwB, 2, 'Ladderpeer');
    const pA = sim.entities.get(a.pid);
    const pB = sim.entities.get(b.pid);
    pB.pos = { x: pA.pos.x + 50, y: pA.pos.y, z: pA.pos.z };
    pB.prevPos = { ...pB.pos };

    fwA.sent.length = 0;
    fwB.sent.length = 0;
    (server as any).broadcastSnapshots();

    const snapA = lastSnap(fwA.sent);
    const snapB = lastSnap(fwB.sent);
    expect(snapA.self.bpsl).toBe(12);
    // B sees A in its interest-scoped entity list and still reads its OWN zero.
    // A raw-substring sweep cannot say this for a NUMBER, so the arm compares
    // the values and then walks the broadcast for the key itself.
    expect(snapB.ents.some((e: any) => e.id === a.pid)).toBe(true);
    expect(snapB.self.bpsl).toBe(0);
    expect(snapB.self.bank ?? null).toBeNull();
    for (const e of snapB.ents) {
      expect(Object.hasOwn(e, 'bpsl'), `entity ${e.id} carries the ladder key`).toBe(false);
    }
  });

  it('follows the VIEWER, not the spectate anchor, so the count can never go DOWN', () => {
    // Every other owner-only key (bank, vault, cvault, guildBank, mail) is
    // emitted for the spectate anchor, so a moderator sees the target's copy.
    // This one deliberately is not: it decides what the VIEWER may buy, and
    // anchoring it would move the number DOWN on a spectate enter, voiding the
    // monotonicity the store's fit gate rests on.
    const server = new GameServer();
    const fwMod = fakeWs();
    const mod = joinAt(server, fwMod, 1, 'Ladderwatcher');
    const fwTarget = fakeWs();
    const target = joinAt(server, fwTarget, 2, 'Ladderwatched');
    const sim = server.sim as any;

    // The moderator owns a ladder; the target owns none.
    bringBankerToPlayer(sim, mod.pid);
    sim.players.get(mod.pid).copper = 4_000;
    send(server, mod, { cmd: 'bank_buy_slots' });
    send(server, mod, { cmd: 'bank_buy_slots' });
    expect(sim.players.get(mod.pid).bank.purchasedSlots).toBe(12);
    expect(sim.players.get(target.pid).bank.purchasedSlots).toBe(0);

    (server as any).enterSpectate(mod, target);
    expect(mod.spectating).not.toBeNull(); // the rig really entered spectate

    fwMod.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fwMod.sent);
    // The two keys DISAGREE in the same frame, which is the decisive form: the
    // anchored `bank` followed the target (0 purchased, the documented posture)
    // while the ladder key stayed on the moderator's own 12. An implementation
    // that keyed both on the anchor would make these equal.
    expect(snap.self.bank.purchasedSlots).toBe(0);
    expect(snap.self.bpsl).toBe(12);
  });
});

// The revision + composed-price gate on the owner-only `bank` key (the vault
// gate's twin, server/bank_wire.ts emitBankSelfKeys). The mutator classes
// (deposit / withdraw / buy-slots / sockets / bonus stamp) are proven by the
// per-step snapshot mirrors in the round-trip suites above, which go stale if
// any bumpBankWireRev site is missed; this describe adds the gate's own
// build-elision arms plus the two writers those suites do not drive: the
// server-side price retune and the Claudium storage grant.
describe('the revision-gated bank self key', () => {
  afterEach(() => {
    bankWirePriceRef.value = undefined;
  });

  it('probes revision and price every pass but builds bank payloads only on first send, change, open/close, or price move', () => {
    let rev: number | null = 3;
    let builds = 0;
    const sim: any = {
      ctx: {
        resolve: () => ({ meta: { entityId: 9, bank: { purchasedSlots: 12 } } }),
        error: () => {},
      },
      bankInfoWireRevFor: () => rev,
      bankInfoFor: () => {
        builds++;
        return {
          slots: [],
          capacity: 36,
          purchasedSlots: 12,
          bonusSlots: 0,
          nextExpansionCost: 2500,
          bonusSources: [],
          socketsUnlocked: 0,
          socketBags: [null, null, null, null],
          nextSocketCost: 1000000,
          generalCapacity: 36,
          materialsCapacity: 0,
          generalUsed: 0,
          materialsUsed: 0,
        };
      },
    };
    const session = {
      pid: 9,
      lastSent: {} as Record<string, string>,
      lastBankWirePid: null as number | null,
      lastBankWireRev: null as number | null,
      lastBankWirePrice: null as number | null,
    };
    const emitted: [string, unknown][] = [];
    const emit = (key: string, value: unknown): void => {
      session.lastSent[key] = JSON.stringify(value ?? null);
      emitted.push([key, value]);
    };
    const bankEmits = () => emitted.filter(([k]) => k === 'bank');

    emitBankSelfKeys(emit, sim, session, { pid: 9, accountId: 22 });
    expect(bankEmits().length).toBe(1); // first send always ships
    expect(builds).toBe(1);

    emitBankSelfKeys(emit, sim, session, { pid: 9, accountId: 22 });
    expect(bankEmits().length).toBe(1); // unchanged: probed, never rebuilt
    expect(builds).toBe(1);

    rev = 4; // a sim-side mutation
    emitBankSelfKeys(emit, sim, session, { pid: 9, accountId: 22 });
    expect(bankEmits().length).toBe(2);
    expect(builds).toBe(2);

    // A spectate retarget is part of the signature even when both characters
    // happen to share a revision and lastSent stays populated.
    emitBankSelfKeys(emit, sim, session, { pid: 10, accountId: 22 });
    expect(bankEmits().length).toBe(3);
    expect(builds).toBe(3);

    rev = null; // walked away: an explicit null, never a build
    emitBankSelfKeys(emit, sim, session, { pid: 10, accountId: 22 });
    expect(bankEmits().at(-1)?.[1]).toBeNull();
    expect(builds).toBe(3);

    rev = 4; // back at the banker: immediate
    emitBankSelfKeys(emit, sim, session, { pid: 10, accountId: 22 });
    expect(builds).toBe(4);

    bankWirePriceRef.value = 90; // server-side retune, NO sim revision moved
    emitBankSelfKeys(emit, sim, session, { pid: 10, accountId: 22 });
    expect(builds).toBe(5);
    expect(
      (bankEmits().at(-1)?.[1] as { nextRungClaudiumPrice?: number } | undefined)
        ?.nextRungClaudiumPrice,
    ).toBe(90);

    emitBankSelfKeys(emit, sim, session, { pid: 10, accountId: 22 });
    expect(builds).toBe(5); // steady again behind the price tracker
  });

  it('a server-side price retune re-emits the gated key with the new quote over the wire', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Pricegate');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap1 = lastSnap(fw.sent);
    expect(snap1.self.bank).not.toBeNull();
    expect(snap1.self.bank).not.toHaveProperty('nextRungClaudiumPrice');

    // Unchanged: the key is omitted entirely (never rebuilt, never resent).
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    expect(lastSnap(fw.sent).self).not.toHaveProperty('bank');

    // The store cache moves while the sim does not: the gate must not strand
    // the retune behind the sim revision.
    bankWirePriceRef.value = 77;
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap3 = lastSnap(fw.sent);
    expect(snap3.self.bank.nextRungClaudiumPrice).toBe(77);

    // And the quote aging back out (service outage past MAX_STALE) re-emits
    // WITHOUT the field, so the client degrades to gold alone.
    bankWirePriceRef.value = undefined;
    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap4 = lastSnap(fw.sent);
    expect(snap4.self.bank).not.toBeNull();
    expect(snap4.self.bank).not.toHaveProperty('nextRungClaudiumPrice');
  });

  it('a Claudium storage grant beside a banker re-emits the gated key with the new ladder', () => {
    const server = new GameServer();
    const fw = fakeWs();
    const s = joinAt(server, fw, 1, 'Grantgate');
    const pid = s.pid;
    const sim = server.sim as any;
    bringBankerToPlayer(sim, pid);

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    expect(lastSnap(fw.sent).self.bank.purchasedSlots).toBe(0);

    // The server-originated grant rail (no ws command exists for it): the one
    // bank mutator the round-trip suites above never drive.
    const result = bankGrantStorageSlots(sim.ctx, pid, 'strongbox_rung_01', 'grant-key-1');
    expect(result.status).toBe('applied');

    fw.sent.length = 0;
    (server as any).broadcastSnapshots();
    const snap = lastSnap(fw.sent);
    expect(snap.self.bank.purchasedSlots).toBe(6);
    expect(snap.self.bank.capacity).toBe(30); // 24 base + the granted rung
    expect(snap.self.bpsl).toBe(6);
  });
});

// The pool-honest deposit refusal (src/sim/bank.ts bankDeposit): a no_fit on a
// non-material while the two-pool meter shows free materials-satchel room must
// say so, not claim the bank is "full". Driven on the offline Sim (the emit is
// sim-side; the S3 guard pins the literal's matcher registration).
describe('pool-honest bank deposit refusal', () => {
  function bankWithMaterialsRoomOnly() {
    const sim: any = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    bringBankerToPlayer(sim, pid);
    const meta = sim.players.get(pid);
    // A materials-only satchel in socket 0 (8 materials slots) and a general
    // pool packed to its 24-slot base with distinct non-material stacks.
    meta.bank.unlockedSockets = 1;
    meta.bank.socketBags[0] = 'burlap_reagent_pouch';
    meta.bank.inventory = Array.from({ length: 24 }, (_, i) => ({
      itemId: i % 2 === 0 ? 'worn_sword' : 'rusty_dagger',
      count: 1,
      instance: { rolled: { pad: i } }, // distinct payloads: nothing merges
    }));
    sim.drainEvents();
    return { sim, pid, meta };
  }

  it('a non-material refused with materials room left gets the distinct line', () => {
    const { sim, pid, meta } = bankWithMaterialsRoomOnly();
    sim.addItem('worn_sword', 1, pid);
    const slot = meta.inventory.findIndex((s: any) => s.itemId === 'worn_sword');
    sim.drainEvents();
    sim.bankDeposit(slot, undefined, pid);
    const errors = sim.drainEvents().filter((ev: any) => ev.type === 'error');
    expect(errors.map((ev: any) => ev.text)).toEqual([
      'Only materials fit in the space left in your bank.',
    ]);
    expect(meta.bank.inventory.length).toBe(24); // nothing moved
  });

  it('CONTROL: a material still deposits into the satchel room', () => {
    const { sim, pid, meta } = bankWithMaterialsRoomOnly();
    sim.addItem('wolf_fang', 3, pid);
    const slot = meta.inventory.findIndex((s: any) => s.itemId === 'wolf_fang');
    sim.drainEvents();
    sim.bankDeposit(slot, undefined, pid);
    expect(sim.drainEvents().filter((ev: any) => ev.type === 'error')).toEqual([]);
    expect(meta.bank.inventory.some((s: any) => s.itemId === 'wolf_fang')).toBe(true);
  });

  it('CONTROL: with BOTH pools packed the classic full line stands', () => {
    const { sim, pid, meta } = bankWithMaterialsRoomOnly();
    // Pack the 8 materials slots with distinct-payload material rows too.
    for (let i = 0; i < 8; i++) {
      meta.bank.inventory.push({
        itemId: 'wolf_fang',
        count: 1,
        instance: { rolled: { pad: 100 + i } },
      });
    }
    sim.addItem('worn_sword', 1, pid);
    const slot = meta.inventory.findIndex((s: any) => s.itemId === 'worn_sword');
    sim.drainEvents();
    sim.bankDeposit(slot, undefined, pid);
    const errors = sim.drainEvents().filter((ev: any) => ev.type === 'error');
    expect(errors.map((ev: any) => ev.text)).toEqual(['Your bank is full.']);
  });
});
