import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  grantAccountMechChroma: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { generateProceduralItem } from '../src/sim/loot/procedural';
import { cloneItemInstancePayload, type ItemInstancePayload } from '../src/sim/types';

const BASE_ID = 'gravecaller_ring';
const UID = 'pi1:economy-wire:1401';

function exactInstance(): ItemInstancePayload {
  return {
    bindOnTrade: true,
    ...generateProceduralItem({
      seed: 1401,
      uid: UID,
      context: {
        source: 'dungeon',
        sourceEntityId: 41,
        sourceSpawnSequence: 1401,
        lootSlotIndex: 1,
      },
      basePoolId: 'initial_dungeon_boss',
      rarityTableId: 'initial_dungeon_boss',
      sourceItemLevel: 20,
      forcedBaseId: BASE_ID,
      forcedRarity: 'magic',
    }).instance,
  };
}

function fakeWs(): unknown {
  return { readyState: 1, send: vi.fn() };
}

function join(server: GameServer, id: number, name: string): ClientSession {
  const session = server.join(fakeWs() as never, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function moveToVendor(server: GameServer, pid: number): void {
  const vendor = [...server.sim.entities.values()].find(
    (entity) => entity.kind === 'npc' && entity.vendorItems.length > 0,
  );
  const player = server.sim.entities.get(pid);
  if (!vendor || !player) throw new Error('missing vendor or player');
  player.pos = { ...vendor.pos };
  player.prevPos = { ...player.pos };
  server.sim.rebucket(player);
}

function moveToMailbox(server: GameServer, pid: number): void {
  const mailbox = server.sim.entities.get(server.sim.postOffice.mailboxIds[0]);
  const player = server.sim.entities.get(pid);
  if (!mailbox || !player) throw new Error('missing mailbox or player');
  player.pos = { ...mailbox.pos };
  player.prevPos = { ...player.pos };
  server.sim.rebucket(player);
}

function placeTogether(server: GameServer, a: number, b: number): void {
  const first = server.sim.entities.get(a);
  const second = server.sim.entities.get(b);
  if (!first || !second) throw new Error('missing trade player');
  second.pos = { ...first.pos, x: first.pos.x + 1 };
  second.prevPos = { ...second.pos };
  server.sim.rebucket(second);
}

describe('procedural economy server wire authority', () => {
  it('never downgrades a present malformed UID into equip, discard, sell, or buyback', () => {
    const server = new GameServer();
    const session = join(server, 1401, 'WireOwner');
    const meta = server.sim.meta(session.pid);
    if (!meta) throw new Error('missing player meta');
    server.sim.setPlayerLevel(20, session.pid);
    meta.autoEquip = false;
    meta.inventory = [];
    meta.vendorBuyback = [];
    meta.copper = 500;
    moveToVendor(server, session.pid);
    const exact = exactInstance();

    meta.inventory = [{ itemId: BASE_ID, count: 1, instance: exact }];
    delete meta.equipment.ring1;
    delete meta.equipmentInstance.ring1;
    cmd(server, session, { cmd: 'equip', item: BASE_ID, uid: 'x'.repeat(97) });
    expect(meta.equipment.ring1).toBeUndefined();
    expect(meta.inventory[0]?.instance?.procedural?.uid).toBe(UID);

    cmd(server, session, { cmd: 'discard', item: BASE_ID, count: 1, uid: null });
    expect(meta.inventory[0]?.instance?.procedural?.uid).toBe(UID);

    cmd(server, session, { cmd: 'sell', item: BASE_ID, count: 1, uid: 123 });
    expect(meta.inventory[0]?.instance?.procedural?.uid).toBe(UID);
    expect(meta.vendorBuyback).toHaveLength(0);
    expect(meta.copper).toBe(500);

    meta.inventory = [];
    meta.vendorBuyback = [
      {
        itemId: BASE_ID,
        count: 1,
        instance: cloneItemInstancePayload(exact),
      },
    ];
    cmd(server, session, { cmd: 'buyback', item: BASE_ID, uid: { forged: true } });
    expect(meta.inventory).toHaveLength(0);
    expect(meta.vendorBuyback[0]?.instance?.procedural?.uid).toBe(UID);
    expect(meta.copper).toBe(500);
  });

  it('rejects a non-unit exact mail count instead of coercing it to one', () => {
    const server = new GameServer();
    const alice = join(server, 1411, 'WireAlice');
    join(server, 1412, 'WireBob');
    const meta = server.sim.meta(alice.pid);
    if (!meta) throw new Error('missing Alice meta');
    meta.autoEquip = false;
    meta.inventory = [];
    meta.copper = 1_000;
    server.sim.addItemInstance(BASE_ID, exactInstance(), alice.pid);
    moveToMailbox(server, alice.pid);

    cmd(server, alice, {
      cmd: 'mail_send',
      to: 'WireBob',
      subject: 'Malformed exact count',
      body: 'must not escrow',
      copper: 25,
      items: [{ itemId: BASE_ID, count: 2, instanceUid: UID }],
    });

    expect(meta.inventory[0]?.instance?.procedural?.uid).toBe(UID);
    expect(meta.copper).toBe(1_000);
    expect(
      server.sim.postOffice.mail.some((message) => message.subject === 'Malformed exact count'),
    ).toBe(false);
  });

  it('wires UID only to the owner while both parties can see bind-on-trade', () => {
    const server = new GameServer();
    const alice = join(server, 1421, 'ProjectionAlice');
    const bob = join(server, 1422, 'ProjectionBob');
    const exact = exactInstance();
    const aliceMeta = server.sim.meta(alice.pid);
    const bobMeta = server.sim.meta(bob.pid);
    if (!aliceMeta || !bobMeta) throw new Error('missing projection player meta');
    aliceMeta.inventory = [];
    bobMeta.inventory = [];
    server.sim.addItemInstance(BASE_ID, exact, alice.pid);
    placeTogether(server, alice.pid, bob.pid);

    cmd(server, alice, { cmd: 'trade_req', id: bob.pid });
    cmd(server, bob, { cmd: 'trade_accept' });
    cmd(server, alice, {
      cmd: 'trade_offer',
      items: [{ itemId: BASE_ID, count: 1, instanceUid: UID }],
      copper: 0,
    });

    type TradeWire = {
      myOffer: { items: Array<{ instance?: ItemInstancePayload }> };
      theirOffer: { items: Array<{ instance?: ItemInstancePayload }> };
    };
    const wire = server as unknown as { tradeWire(pid: number): TradeWire };
    const owner = wire.tradeWire(alice.pid).myOffer.items[0]?.instance;
    const counterparty = wire.tradeWire(bob.pid).theirOffer.items[0]?.instance;
    expect(owner?.bindOnTrade).toBe(true);
    expect(owner?.procedural?.uid).toBe(UID);
    expect(owner?.procedural).not.toHaveProperty('seed');
    expect(owner?.procedural).not.toHaveProperty('dropContext');
    expect(counterparty?.bindOnTrade).toBe(true);
    expect(counterparty?.procedural).not.toHaveProperty('uid');
    expect(counterparty?.procedural).not.toHaveProperty('seed');
    expect(counterparty?.procedural).not.toHaveProperty('dropContext');
  });
});
