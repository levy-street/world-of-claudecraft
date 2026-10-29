import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/guild_weapon_purchase_db', () => ({ purchaseGuildWeaponAtomic: vi.fn() }));

import { EMPTY_LIVE_ACCOUNT_COSMETICS } from '../server/account_cosmetics_live';
import type { ClientSession } from '../server/game';
import {
  type GuildWeaponPurchaseHost,
  GuildWeaponPurchases,
} from '../server/guild_weapon_purchase';
import { createKeyedSerialWriter } from '../server/serial_writer';
import {
  LANTERN_HALL_SWORD_SKIN_ID,
  LANTERN_SEAL_ITEM_ID,
} from '../src/sim/content/guild_contracts';
import {
  GUILD_QUARTERMASTER_NPC_ID,
  HIGHWATCH_GUILD_ENTITY_IDS,
} from '../src/sim/content/highwatch_guild';
import { Sim } from '../src/sim/sim';

const OFFER = 'weapon_skin_lantern_hall_sword';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const sim = new Sim({ seed: 7, playerClass: 'warrior' });
  const npc = sim.entities.get(HIGHWATCH_GUILD_ENTITY_IDS[GUILD_QUARTERMASTER_NPC_ID])!;
  sim.player.pos = { ...npc.pos };
  sim.ctx.addItem(LANTERN_SEAL_ITEM_ID, 40, sim.player.id);
  const session = {
    pid: sim.player.id,
    characterId: 41,
    accountId: 7,
    leaseNonce: 'lease',
    left: false,
    escrowQuarantined: false,
    accountCosmetics: structuredClone(EMPTY_LIVE_ACCOUNT_COSMETICS),
  } as ClientSession;
  const queue = createKeyedSerialWriter<number>();
  const persist = vi.fn<NonNullable<GuildWeaponPurchaseHost['persist']>>();
  const host: GuildWeaponPurchaseHost = {
    sim: () => sim,
    session: () => session,
    queue,
    capture: () => ({
      level: 1,
      state: sim.serializeCharacter(session.pid)!,
      storageEffects: [],
      bankLedgerSnapshot: {} as never,
    }),
    conflict: () => false,
    acknowledge: vi.fn(() => true),
    quarantine: vi.fn(),
    cosmetics: {
      updateLive: vi.fn((_id, value) => {
        session.accountCosmetics = value;
      }),
    },
    persist,
  };
  const purchases = new GuildWeaponPurchases(host);
  const seals = () => sim.ctx.players.get(session.pid)?.lanternSeals ?? 0;
  const bought = () => sim.tick().filter((e) => e.type === 'guildCosmeticBought');
  return { sim, session, queue, persist, host, purchases, seals, bought };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('durable guild weapon purchase coordinator', () => {
  it('admits only two accounts at once and reuses the released admission slot', async () => {
    const f = setup(),
      db = deferred<string[]>(),
      entered = deferred<void>();
    f.sim.ctx.addItem(LANTERN_SEAL_ITEM_ID, 80, f.session.pid);
    const sessions = [0, 1, 2].map((i) => ({
      ...f.session,
      accountId: 7 + i,
      characterId: 41 + i,
    }));
    f.host.session = (id) => sessions.find((s) => s.characterId === id);
    f.host.cosmetics.updateLive = vi.fn();
    f.persist.mockImplementation(() => {
      if (f.persist.mock.calls.length === 2) entered.resolve();
      return db.promise;
    });
    const first = f.purchases.start(sessions[0], OFFER);
    const second = f.purchases.start(sessions[1], OFFER);
    await entered.promise;
    await f.purchases.start(sessions[2], OFFER);
    expect(f.persist).toHaveBeenCalledTimes(2);
    db.resolve([LANTERN_HALL_SWORD_SKIN_ID]);
    await Promise.all([first, second]);
    await f.purchases.start(sessions[2], OFFER);
    expect(f.persist).toHaveBeenCalledTimes(3);
  });

  it('forwards and acknowledges the exact captured storage and bank effect prefixes', async () => {
    const f = setup(),
      db = deferred<string[]>(),
      entered = deferred<void>();
    const captured = f.host.capture(41)!;
    const storageEffects = Object.freeze([Object.freeze({ idempotencyKey: 'storage-prefix' })]);
    const bankLedgerSnapshot = Object.freeze({
      batches: [Object.freeze({ batchKey: 'bank-prefix' })],
    });
    f.host.capture = () => ({ ...captured, storageEffects, bankLedgerSnapshot }) as never;
    f.persist.mockImplementation(() => {
      entered.resolve();
      return db.promise;
    });
    const work = f.purchases.start(f.session, OFFER);
    await entered.promise;
    const save = f.persist.mock.calls[0][0];
    expect(save.storageEffects).toBe(storageEffects);
    expect(save.bankLedgerSnapshot).toBe(bankLedgerSnapshot);
    // A newer capture cannot replace the committed prefix during acknowledgement.
    f.host.capture = () => captured;
    db.resolve([LANTERN_HALL_SWORD_SKIN_ID]);
    await work;
    expect(f.host.acknowledge).toHaveBeenCalledWith(save);
    expect(f.host.acknowledge).toHaveBeenCalledOnce();
  });

  it('reserves seals in the FIFO but publishes ownership and success only after commit', async () => {
    const f = setup(),
      db = deferred<string[]>(),
      entered = deferred<void>();
    f.persist.mockImplementation(() => {
      entered.resolve();
      return db.promise;
    });
    const work = f.purchases.start(f.session, OFFER);
    await entered.promise;
    expect(f.seals()).toBe(20);
    expect(f.bought()).toEqual([]);
    expect(f.session.accountCosmetics.weaponSkinIds).toEqual([]);
    await f.purchases.start(f.session, OFFER);
    expect(f.persist).toHaveBeenCalledTimes(1);
    db.resolve([LANTERN_HALL_SWORD_SKIN_ID]);
    await work;
    expect(f.session.accountCosmetics.weaponSkinIds).toEqual([LANTERN_HALL_SWORD_SKIN_ID]);
    expect(f.bought()).toEqual([expect.objectContaining({ offerId: OFFER, pid: f.session.pid })]);
    expect(f.host.acknowledge).toHaveBeenCalledWith(f.persist.mock.calls[0][0]);
  });
  it('quarantines failure before a following autosave can persist the reserved cost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = setup(),
      db = deferred<string[]>(),
      entered = deferred<void>();
    f.persist.mockImplementation(() => {
      entered.resolve();
      return db.promise;
    });
    const work = f.purchases.start(f.session, OFFER);
    await entered.promise;
    let saved = false;
    const autosave = f.queue.enqueue(41, async () => {
      if (!f.session.escrowQuarantined) saved = true;
    });
    db.reject(new Error('connection lost during COMMIT'));
    await work;
    await autosave;
    expect(saved).toBe(false);
    expect(f.host.quarantine).toHaveBeenCalledOnce();
    expect(f.bought()).toEqual([]);
    expect(f.host.cosmetics.updateLive).not.toHaveBeenCalled();
    expect(f.persist).toHaveBeenCalledTimes(1);
  });
  it('does not refund or retry when acknowledgement fails after a successful commit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = setup();
    f.persist.mockResolvedValue([LANTERN_HALL_SWORD_SKIN_ID]);
    f.host.acknowledge = () => false;
    await f.purchases.start(f.session, OFFER);
    expect(f.seals()).toBe(20);
    expect(f.session.escrowQuarantined).toBe(true);
    expect(f.persist).toHaveBeenCalledOnce();
    expect(f.bought()).toEqual([]);
  });
  it('quarantines a snapshot failure after reservation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = setup();
    f.host.capture = () => null;
    await f.purchases.start(f.session, OFFER);
    expect(f.seals()).toBe(20);
    expect(f.session.escrowQuarantined).toBe(true);
    expect(f.persist).not.toHaveBeenCalled();
  });
  it('cancels a queued purchase without mutation when its deadline expires', async () => {
    vi.useFakeTimers();
    const f = setup(),
      blocker = deferred<void>();
    const first = f.queue.enqueue(41, () => blocker.promise);
    const work = f.purchases.start(f.session, OFFER);
    await vi.advanceTimersByTimeAsync(15_001);
    await work;
    blocker.resolve();
    await first;
    expect(f.seals()).toBe(40);
    expect(f.persist).not.toHaveBeenCalled();
  });
  it.each(['conflict', 'left', 'nonce', 'range'] as const)(
    'revalidates %s inside the queue',
    async (kind) => {
      const f = setup(),
        blocker = deferred<void>();
      const first = f.queue.enqueue(41, () => blocker.promise);
      const work = f.purchases.start(f.session, OFFER);
      if (kind === 'conflict') f.host.conflict = () => true;
      if (kind === 'left') f.session.left = true;
      if (kind === 'nonce') f.session.leaseNonce = 'taken-over';
      if (kind === 'range') f.sim.player.pos.x += 100;
      blocker.resolve();
      await first;
      await work;
      expect(f.seals()).toBe(40);
      expect(f.persist).not.toHaveBeenCalled();
    },
  );
});
