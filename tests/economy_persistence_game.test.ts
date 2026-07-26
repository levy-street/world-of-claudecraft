import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => true),
  saveCharacterAndMarketState: vi.fn(async () => true),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
}));

vi.mock('../server/deeds_records', () => ({
  deedRecordsIdle: vi.fn(async () => {}),
  isHiddenDeedId: vi.fn(() => false),
  isMarqueeDeed: vi.fn(() => false),
  reconcileCharacterDeeds: vi.fn(async () => {}),
  recordDeedUnlocks: vi.fn(),
}));

import {
  loadMailState,
  loadMarketState,
  releaseCharacterLease,
  saveCharacterAndMarketState,
  saveCharacterState,
  saveMailState,
  saveMarketState,
} from '../server/db';
import { recordDeedUnlocks } from '../server/deeds_records';
import { type ClientSession, GameServer } from '../server/game';

import { generateProceduralItem } from '../src/sim/loot/procedural';
import type { CharacterState, MailSave } from '../src/sim/sim';
import type { ItemInstancePayload } from '../src/sim/types';

const BASE_ID = 'gravecaller_ring';
const UID = 'pi1:atomic-economy:1';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function exactInstance(): ItemInstancePayload {
  return generateProceduralItem({
    seed: 1776,
    uid: UID,
    context: {
      source: 'dungeon',
      sourceEntityId: 41,
      sourceSpawnSequence: 1776,
      lootSlotIndex: 1,
    },
    basePoolId: 'initial_dungeon_boss',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: 20,
    forcedBaseId: BASE_ID,
    forcedRarity: 'magic',
  }).instance;
}

function fakeWs() {
  const sent: unknown[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(JSON.parse(payload)),
      close: vi.fn(),
    },
  };
}

function join(server: GameServer, id: number, name: string): ClientSession {
  const socket = fakeWs();
  const session = server.join(socket.ws as never, id, id, name, 'warrior', null, false, {
    leaseNonce: `nonce-${id}`,
  });
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function cmd(server: GameServer, session: ClientSession, body: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...body }));
}

function placeTogether(server: GameServer, a: number, b: number): void {
  const first = server.sim.entities.get(a);
  const second = server.sim.entities.get(b);
  if (!first || !second) throw new Error('missing trade player');
  second.pos = { ...first.pos, x: first.pos.x + 1 };
  second.prevPos = { ...second.pos };
  server.sim.rebucket(second);
}

function moveToMailbox(server: GameServer, pid: number): void {
  const mailbox = server.sim.entities.get(server.sim.postOffice.mailboxIds[0]);
  const player = server.sim.entities.get(pid);
  if (!mailbox || !player) throw new Error('missing mailbox or player');
  player.pos = { ...mailbox.pos };
  player.prevPos = { ...player.pos };
  server.sim.rebucket(player);
}

function moveToMerchant(server: GameServer, pid: number): void {
  const merchant = server.sim.entities.get(server.sim.market.merchantIds[0]);
  const player = server.sim.entities.get(pid);
  if (!merchant || !player) throw new Error('missing merchant or player');
  player.pos = { ...merchant.pos };
  player.prevPos = { ...player.pos };
  server.sim.rebucket(player);
}

function openProceduralTrade(server: GameServer, alice: ClientSession, bob: ClientSession): void {
  const aliceMeta = server.sim.meta(alice.pid);
  const bobMeta = server.sim.meta(bob.pid);
  if (!aliceMeta || !bobMeta) throw new Error('missing trade meta');
  aliceMeta.inventory = [];
  bobMeta.inventory = [];
  server.sim.addItemInstance(BASE_ID, exactInstance(), alice.pid);
  placeTogether(server, alice.pid, bob.pid);
  cmd(server, alice, { cmd: 'trade_req', id: bob.pid });
  cmd(server, bob, { cmd: 'trade_accept' });
  cmd(server, alice, {
    cmd: 'trade_offer',
    items: [{ itemId: BASE_ID, count: 1, instanceUid: UID }],
    copper: 0,
  });
  cmd(server, alice, { cmd: 'trade_confirm' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveCharacterState).mockResolvedValue(true);
  vi.mocked(saveCharacterAndMarketState).mockResolvedValue(true);
  vi.mocked(saveMailState).mockResolvedValue(undefined);
  vi.mocked(saveMarketState).mockResolvedValue(undefined);
});

describe('atomic direct-transfer persistence', () => {
  it('persists both post-trade character snapshots and realm blobs in one call', async () => {
    const server = new GameServer();
    const alice = join(server, 501, 'AtomicAlice');
    const bob = join(server, 502, 'AtomicBob');
    openProceduralTrade(server, alice, bob);

    cmd(server, bob, { cmd: 'trade_confirm' });

    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));
    const call = vi.mocked(saveCharacterAndMarketState).mock.calls[0];
    const aliceState = call?.[2] as CharacterState;
    const peer = call?.[6] as
      | { characterId: number; leaseNonce?: string; state: CharacterState }
      | undefined;
    expect(call?.[0]).toBe(alice.characterId);
    expect(call?.[3]).toBeNull();
    expect(call?.[4]).toBeNull();
    expect(call?.[5]).toBe(alice.leaseNonce);
    expect(peer?.characterId).toBe(bob.characterId);
    expect(peer?.leaseNonce).toBe(bob.leaseNonce);
    expect(aliceState.inventory.some((slot) => slot.instance?.procedural?.uid === UID)).toBe(false);
    expect(peer?.state.inventory.some((slot) => slot.instance?.procedural?.uid === UID)).toBe(true);
  });

  it('orders pre-save, atomic trade, and later saves without late snapshot bleed', async () => {
    const server = new GameServer();
    const alice = join(server, 511, 'OrderAlice');
    const bob = join(server, 512, 'OrderBob');
    openProceduralTrade(server, alice, bob);
    const preSave = deferred<boolean>();
    const order: string[] = [];
    vi.mocked(saveCharacterState).mockImplementation(async (characterId) => {
      order.push(`character:${characterId}`);
      if (characterId === alice.characterId && order.length === 1) return preSave.promise;
      return true;
    });
    vi.mocked(saveCharacterAndMarketState).mockImplementation(async () => {
      order.push('atomic');
      return true;
    });

    const beforeTradeSave = server.saveCharacter(alice);
    cmd(server, bob, { cmd: 'trade_confirm' });
    const afterTradeSave = server.saveCharacter(bob);

    await vi.waitFor(() => expect(order).toEqual([`character:${alice.characterId}`]));
    const preState = vi.mocked(saveCharacterState).mock.calls[0]?.[2] as CharacterState;
    expect(preState.inventory.some((slot) => slot.instance?.procedural?.uid === UID)).toBe(true);
    expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

    preSave.resolve(true);
    await beforeTradeSave;
    await afterTradeSave;
    await vi.waitFor(() => expect(order).toContain(`character:${bob.characterId}`));
    expect(order).toEqual([
      `character:${alice.characterId}`,
      'atomic',
      `character:${bob.characterId}`,
    ]);
  });

  it('publishes only deed ids captured by the save that actually lands', async () => {
    const server = new GameServer();
    const alice = join(server, 513, 'DeedOrderAlice');
    const bob = join(server, 514, 'DeedOrderBob');
    openProceduralTrade(server, alice, bob);
    const preSave = deferred<boolean>();
    vi.mocked(saveCharacterState).mockImplementationOnce(() => preSave.promise);
    alice.pendingDeedRecords.push('deed-before-snapshot');

    const beforeTradeSave = server.saveCharacter(alice);
    cmd(server, bob, { cmd: 'trade_confirm' });
    alice.pendingDeedRecords.push('deed-after-snapshot');
    await vi.waitFor(() => expect(saveCharacterState).toHaveBeenCalledTimes(1));
    expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

    preSave.resolve(true);
    await beforeTradeSave;
    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));

    expect(recordDeedUnlocks).toHaveBeenCalledTimes(1);
    expect(recordDeedUnlocks).toHaveBeenCalledWith(
      { characterId: alice.characterId, accountId: alice.accountId },
      ['deed-before-snapshot'],
    );
    expect(alice.pendingDeedRecords).toEqual(['deed-after-snapshot']);

    await server.saveCharacter(alice);
    expect(recordDeedUnlocks).toHaveBeenLastCalledWith(
      { characterId: alice.characterId, accountId: alice.accountId },
      ['deed-after-snapshot'],
    );
  });

  it('blocks non-atomic market mutations until the direct-transfer commit settles', async () => {
    const server = new GameServer();
    const alice = join(server, 516, 'PendingAlice');
    const bob = join(server, 517, 'PendingBob');
    openProceduralTrade(server, alice, bob);
    const atomic = deferred<boolean>();
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => atomic.promise);

    cmd(server, bob, { cmd: 'trade_confirm' });
    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));
    server.sim.addItem('roasted_boar', 1, bob.pid);
    moveToMerchant(server, bob.pid);
    cmd(server, bob, { cmd: 'market_list', item: 'roasted_boar', count: 1, price: 10 });
    expect(server.sim.countItem('roasted_boar', bob.pid)).toBe(1);
    expect(server.sim.serializeMarket().listings).toHaveLength(0);

    atomic.resolve(true);
    const persistence = server as unknown as { atomicEconomyTransactionsPending: number };
    await vi.waitFor(() => expect(persistence.atomicEconomyTransactionsPending).toBe(0));
    cmd(server, bob, { cmd: 'market_list', item: 'roasted_boar', count: 1, price: 10 });
    expect(server.sim.countItem('roasted_boar', bob.pid)).toBe(0);
    expect(server.sim.serializeMarket().listings).toHaveLength(1);
  });

  it('rejects additional trade and mail mutations before sim state changes while a write is pending', async () => {
    const server = new GameServer();
    const alice = join(server, 5181, 'BackpressureAlice');
    const bob = join(server, 5182, 'BackpressureBob');
    const carol = join(server, 5183, 'BackpressureCarol');
    const dave = join(server, 5184, 'BackpressureDave');
    openProceduralTrade(server, alice, bob);

    const carolMeta = server.sim.meta(carol.pid);
    const daveMeta = server.sim.meta(dave.pid);
    if (!carolMeta || !daveMeta) throw new Error('missing backpressure trade players');
    carolMeta.copper = 100;
    daveMeta.copper = 100;
    placeTogether(server, carol.pid, dave.pid);
    cmd(server, carol, { cmd: 'trade_req', id: dave.pid });
    cmd(server, dave, { cmd: 'trade_accept' });
    cmd(server, carol, { cmd: 'trade_offer', items: [], copper: 1 });
    cmd(server, carol, { cmd: 'trade_confirm' });

    moveToMailbox(server, carol.pid);
    server.sim.postOffice.sendLetter(
      carol.name,
      carol.name,
      {
        letterId: 'test_atomic_backpressure',
        senderName: 'Test Courier',
        subject: 'Backpressure',
        body: 'Test message.',
        delaySeconds: 0,
      },
      'system',
    );
    const letter = server.sim.postOffice.mail.find((mail) => mail.recipientName === carol.name);
    if (!letter) throw new Error('missing backpressure mail');

    const atomic = deferred<boolean>();
    vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => atomic.promise);
    cmd(server, bob, { cmd: 'trade_confirm' });
    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));

    cmd(server, dave, { cmd: 'trade_confirm' });
    cmd(server, carol, { cmd: 'mail_read', id: letter.id });
    expect(carolMeta.copper).toBe(100);
    expect(daveMeta.copper).toBe(100);
    expect(letter.read).toBe(false);
    expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1);

    atomic.resolve(true);
    const internals = server as unknown as { atomicEconomyTransactionsPending: number };
    await vi.waitFor(() => expect(internals.atomicEconomyTransactionsPending).toBe(0));
    cmd(server, dave, { cmd: 'trade_confirm' });
    await vi.waitFor(() => expect(internals.atomicEconomyTransactionsPending).toBe(0));
    expect(carolMeta.copper).toBe(99);
    expect(daveMeta.copper).toBe(101);

    cmd(server, carol, { cmd: 'mail_read', id: letter.id });
    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(3));
    expect(letter.read).toBe(true);
    expect(vi.mocked(saveCharacterAndMarketState).mock.calls[2]?.[3]).toBeNull();
  });

  it('persists each successful market mutation with only its character and Market blob', async () => {
    const server = new GameServer();
    const seller = join(server, 519, 'AtomicMarketSeller');
    const meta = server.sim.meta(seller.pid);
    if (!meta) throw new Error('missing market seller');
    meta.inventory = [];
    server.sim.addItem('roasted_boar', 1, seller.pid);
    moveToMerchant(server, seller.pid);

    cmd(server, seller, { cmd: 'market_list', item: 'roasted_boar', count: 1, price: 10 });

    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));
    const call = vi.mocked(saveCharacterAndMarketState).mock.calls[0];
    if (!call) throw new Error('expected atomic market persistence');
    expect(call[0]).toBe(seller.characterId);
    expect((call[2] as CharacterState).inventory).not.toContainEqual(
      expect.objectContaining({ itemId: 'roasted_boar' }),
    );
    expect((call[3] as { listings: unknown[] }).listings).toHaveLength(1);
    expect(call[4]).toBeNull();
  });

  it.each(['db error', 'lease fence'] as const)(
    'quarantines and disconnects both trade participants on %s without leave saves',
    async (failure) => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const server = new GameServer();
        const alice = join(server, 521, 'FaultAlice');
        const bob = join(server, 522, 'FaultBob');
        openProceduralTrade(server, alice, bob);
        if (failure === 'db error') {
          vi.mocked(saveCharacterAndMarketState).mockRejectedValueOnce(new Error('database lost'));
        } else {
          vi.mocked(saveCharacterAndMarketState).mockResolvedValueOnce(false);
        }

        cmd(server, bob, { cmd: 'trade_confirm' });

        await vi.waitFor(() => {
          expect(alice.left).toBe(true);
          expect(bob.left).toBe(true);
          expect(server.hasSessionForCharacter(alice.characterId)).toBe(false);
          expect(server.hasSessionForCharacter(bob.characterId)).toBe(false);
        });
        expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
        expect(saveCharacterState).not.toHaveBeenCalled();
        expect(releaseCharacterLease).toHaveBeenCalledWith(alice.characterId, alice.leaseNonce);
        expect(releaseCharacterLease).toHaveBeenCalledWith(bob.characterId, bob.leaseNonce);

        // Even an explicitly requested later save from the doomed session is a
        // no-op: only a reconnect/reload may advance this character again.
        await server.saveCharacter(alice);
        await server.saveCharacter(bob);
        await server.saveMarket();
        expect(saveCharacterState).not.toHaveBeenCalled();
        expect(saveMarketState).toHaveBeenCalledTimes(1);
      } finally {
        log.mockRestore();
      }
    },
  );

  it('keeps unrelated market persistence independent from a failed direct trade', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const server = new GameServer();
      const alice = join(server, 526, 'MarketRaceAlice');
      const bob = join(server, 527, 'MarketRaceBob');
      openProceduralTrade(server, alice, bob);
      const atomic = deferred<boolean>();
      vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => atomic.promise);

      cmd(server, bob, { cmd: 'trade_confirm' });
      await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));

      // A characters-only trade owns no realm FIFO and cannot quarantine a clean
      // Market domain when it later fails.
      await server.saveMarket();
      expect(saveMarketState).toHaveBeenCalledTimes(1);

      atomic.reject(new Error('rolled back'));
      await vi.waitFor(() => expect(alice.left && bob.left).toBe(true));
      await server.saveMarket();
      expect(saveMarketState).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
  it('orders pre-mail save, atomic procedural send, and later realm save', async () => {
    const server = new GameServer();
    const alice = join(server, 531, 'MailOrderAlice');
    const bob = join(server, 532, 'MailOrderBob');
    const aliceMeta = server.sim.meta(alice.pid);
    if (!aliceMeta) throw new Error('missing mail sender');
    aliceMeta.inventory = [];
    aliceMeta.copper = 1_000;
    server.sim.addItemInstance(BASE_ID, exactInstance(), alice.pid);
    moveToMailbox(server, alice.pid);

    const preMail = deferred<void>();
    const order: string[] = [];
    vi.mocked(saveMailState).mockImplementation(async () => {
      order.push('mail');
      if (order.length === 1) return preMail.promise;
    });
    vi.mocked(saveCharacterAndMarketState).mockImplementation(async () => {
      order.push('atomic');
      return true;
    });

    const beforeSendSave = server.saveMail();
    cmd(server, alice, {
      cmd: 'mail_send',
      to: bob.name,
      subject: 'Atomic parcel',
      body: 'One exact copy.',
      copper: 0,
      items: [{ itemId: BASE_ID, count: 1, instanceUid: UID }],
    });
    const afterSendSave = server.saveMail();

    await vi.waitFor(() => expect(order).toEqual(['mail']));
    const preSnapshot = vi.mocked(saveMailState).mock.calls[0]?.[0] as MailSave;
    expect(preSnapshot.mail.some((letter) => letter.subject === 'Atomic parcel')).toBe(false);
    expect(saveCharacterAndMarketState).not.toHaveBeenCalled();

    preMail.resolve();
    await beforeSendSave;
    await afterSendSave;
    await vi.waitFor(() => expect(order).toEqual(['mail', 'atomic', 'mail']));
    const atomicMail = vi.mocked(saveCharacterAndMarketState).mock.calls[0]?.[4] as MailSave;
    expect(atomicMail.mail.some((letter) => letter.subject === 'Atomic parcel')).toBe(true);
    const laterSnapshot = vi.mocked(saveMailState).mock.calls[1]?.[0] as MailSave;
    expect(laterSnapshot.mail.some((letter) => letter.subject === 'Atomic parcel')).toBe(true);
  });

  it('suppresses a mail save already queued behind a send that later rolls back', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const server = new GameServer();
      const alice = join(server, 536, 'MailQueueAlice');
      const bob = join(server, 537, 'MailQueueBob');
      const aliceMeta = server.sim.meta(alice.pid);
      if (!aliceMeta) throw new Error('missing queued mail sender');
      aliceMeta.inventory = [];
      aliceMeta.copper = 1_000;
      server.sim.addItemInstance(BASE_ID, exactInstance(), alice.pid);
      moveToMailbox(server, alice.pid);
      const atomic = deferred<boolean>();
      vi.mocked(saveCharacterAndMarketState).mockImplementationOnce(() => atomic.promise);

      cmd(server, alice, {
        cmd: 'mail_send',
        to: bob.name,
        subject: 'Queued rollback parcel',
        body: '',
        copper: 0,
        items: [{ itemId: BASE_ID, count: 1, instanceUid: UID }],
      });
      const laterMailSave = server.saveMail();
      await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));
      expect(saveMailState).not.toHaveBeenCalled();

      atomic.reject(new Error('mail transaction rolled back'));
      await laterMailSave;
      await vi.waitFor(() => expect(alice.left).toBe(true));
      expect(saveMailState).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('drains old realm callbacks before reload clears market or mail quarantine', async () => {
    const server = new GameServer();
    const internals = server as unknown as {
      realmPersistenceQueue: Promise<void>;
      marketPersistenceQuarantined: boolean;
      mailPersistenceQuarantined: boolean;
    };

    const marketTail = deferred<void>();
    internals.realmPersistenceQueue = marketTail.promise;
    internals.marketPersistenceQuarantined = true;
    const marketReload = server.loadMarket();
    await Promise.resolve();
    expect(loadMarketState).not.toHaveBeenCalled();
    expect(internals.marketPersistenceQuarantined).toBe(true);
    marketTail.resolve();
    await marketReload;
    expect(loadMarketState).toHaveBeenCalledTimes(1);
    expect(internals.marketPersistenceQuarantined).toBe(false);

    const mailTail = deferred<void>();
    internals.realmPersistenceQueue = mailTail.promise;
    internals.mailPersistenceQuarantined = true;
    const mailReload = server.loadMail();
    await Promise.resolve();
    expect(loadMailState).not.toHaveBeenCalled();
    expect(internals.mailPersistenceQuarantined).toBe(true);
    mailTail.resolve();
    await mailReload;
    expect(loadMailState).toHaveBeenCalledTimes(1);
    expect(internals.mailPersistenceQuarantined).toBe(false);
  });

  it('queues an immediate transaction for read, take, and delete mutations', async () => {
    const server = new GameServer();
    const recipient = join(server, 541, 'MailLifecycle');
    const recipientMeta = server.sim.meta(recipient.pid);
    if (!recipientMeta) throw new Error('missing mail lifecycle recipient');
    recipientMeta.inventory = [];
    moveToMailbox(server, recipient.pid);
    server.sim.postOffice.sendLetter(
      recipient.name,
      recipient.name,
      {
        letterId: 'test_mail_lifecycle',
        senderName: 'Test Courier',
        subject: 'Lifecycle',
        body: 'Test attachment.',
        items: [{ itemId: 'roasted_boar', count: 2 }],
        delaySeconds: 0,
      },
      'system',
    );
    const letter = server.sim.postOffice.mail.find(
      (message) => message.recipientName === recipient.name,
    );
    if (!letter) throw new Error('missing reward letter');

    cmd(server, recipient, { cmd: 'mail_read', id: letter.id });
    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1));
    cmd(server, recipient, { cmd: 'mail_take', id: letter.id });
    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(2));
    cmd(server, recipient, { cmd: 'mail_delete', id: letter.id });
    await vi.waitFor(() => expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(3));

    expect(server.sim.postOffice.mail.some((message) => message.id === letter.id)).toBe(false);
  });

  it('quarantines the sender and realm mail after a failed procedural send transaction', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const server = new GameServer();
      const alice = join(server, 551, 'MailFaultAlice');
      const bob = join(server, 552, 'MailFaultBob');
      const aliceMeta = server.sim.meta(alice.pid);
      const bobMeta = server.sim.meta(bob.pid);
      if (!aliceMeta || !bobMeta) throw new Error('missing mail fault meta');
      aliceMeta.inventory = [];
      aliceMeta.copper = 1_000;
      bobMeta.copper = 1_000;
      server.sim.addItemInstance(BASE_ID, exactInstance(), alice.pid);
      moveToMailbox(server, alice.pid);
      vi.mocked(saveCharacterAndMarketState).mockRejectedValueOnce(new Error('mail db lost'));

      cmd(server, alice, {
        cmd: 'mail_send',
        to: bob.name,
        subject: 'Rolled back parcel',
        body: 'Must never leak through autosave.',
        copper: 0,
        items: [{ itemId: BASE_ID, count: 1, instanceUid: UID }],
      });

      await vi.waitFor(() => {
        expect(alice.left).toBe(true);
        expect(server.hasSessionForCharacter(alice.characterId)).toBe(false);
      });
      expect(bob.left).toBe(false);
      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
      expect(saveCharacterState).not.toHaveBeenCalled();

      // The failed transaction left the live book ahead of durable Ravenpost.
      // Global quarantine makes both autosave and new commands no-ops until a
      // restart reloads the durable pre-send book.
      await server.saveMail();
      expect(saveMailState).not.toHaveBeenCalled();
      moveToMailbox(server, bob.pid);
      const before = server.sim.postOffice.mail.length;
      cmd(server, bob, {
        cmd: 'mail_send',
        to: bob.name,
        subject: 'Blocked after quarantine',
        body: '',
        copper: 0,
        items: [],
      });
      expect(server.sim.postOffice.mail).toHaveLength(before);
      expect(saveCharacterAndMarketState).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });
});
