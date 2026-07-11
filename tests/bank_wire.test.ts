import { describe, expect, it, vi } from 'vitest';

// Postgres is mocked (hoisted above the server/game import), same block as
// loot_roll_wire.test.ts, so GameServer runs with no live DB.
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  // A successful bank op now dereferences the fire-and-forget ledger writer.
  insertBankLedgerRow: vi.fn(async () => {}),
}));

import { GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { Sim } from '../src/sim/sim';

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
// A field-initialized-free ClientWorld (the snapshots.test.ts idiom): Object.create
// skips field initializers, so bankInfo starts undefined and is set only by
// applySnapshot's delta-guarded decode. That is exactly what the omission test needs.
function bareClient(pid: number): ClientWorld {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
  c.mouselookFacing = null;
  c.markers = {};
  return c;
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
});
