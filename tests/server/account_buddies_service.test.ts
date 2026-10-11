import { afterEach, describe, expect, it, vi } from 'vitest';

const admission = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../src/sim/vendor_buddy_purchase', () => ({ canBuyBuddyOffer: admission }));
vi.mock('../../server/db', () => ({ pool: {}, saveCharacterStateOnClient: vi.fn() }));

import type { BuddyPurchaseSnapshot } from '../../server/account_buddies_db';
import { AccountBuddiesService } from '../../server/account_buddies_service';
import type { ClientSession } from '../../server/game';
import { createKeyedSerialWriter } from '../../server/serial_writer';
import type { BuddyKey } from '../../src/sim/content/buddies';
import type { Sim } from '../../src/sim/sim';

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
afterEach(() => vi.restoreAllMocks());

function setup() {
  const owned = new Map<number, BuddyKey[]>();
  const balances = new Map<number, number>();
  const calls: string[] = [];
  let service: AccountBuddiesService;
  const sim = {
    ownedBuddiesFor: (pid: number) => owned.get(pid) ?? [],
    syncBuddyOwnershipFor: vi.fn((pid: number, keys: readonly BuddyKey[]) => {
      owned.set(pid, [...new Set([...(owned.get(pid) ?? []), ...keys])]);
    }),
    buyItem: vi.fn((_npc: number, _item: string, _options: unknown, pid: number) => {
      calls.push('buy');
      owned.set(pid, [...(owned.get(pid) ?? []), 'horse']);
      service.granted(pid);
      balances.set(pid, (balances.get(pid) ?? 100000) - 100000);
    }),
  };
  const host = {
    sim: () => sim as unknown as Sim,
    save: vi.fn(async () => {
      calls.push('save');
      return true;
    }),
    serialize: (pid: number) =>
      ({
        level: 20,
        honor: balances.get(pid),
        buddies: { owned: owned.get(pid) ?? [] },
      }) as unknown as NonNullable<ReturnType<Sim['serializeCharacter']>>,
    queue: createKeyedSerialWriter<number>(),
    quarantine: vi.fn((s: ClientSession) => {
      s.escrowQuarantined = true;
    }),
    observe: vi.fn(),
  };
  const db = {
    grantAccountBuddies: vi.fn(async (_id: number, keys: readonly string[]) => {
      calls.push('grant');
      return keys as BuddyKey[];
    }),
    purchaseAccountBuddy: vi.fn(
      async (
        _id: number,
        _key: BuddyKey,
        prepare: (keys: readonly BuddyKey[]) => BuddyPurchaseSnapshot | null,
      ) => {
        calls.push('lock');
        const snapshot = prepare([]);
        calls.push('commit');
        return (snapshot?.state.buddies?.owned as BuddyKey[]) ?? [];
      },
    ),
    readAccountBuddyBatch: vi.fn(async (_ids: readonly number[]) => new Map<number, BuddyKey[]>()),
  };
  service = new AccountBuddiesService(host, db);
  function attach(pid: number, accountId = 7, keys: BuddyKey[] = []) {
    const session = {
      pid,
      characterId: pid,
      accountId,
      name: `C${pid}`,
      dirtyGuildBanks: new Map(),
      pendingStorageAppliedEffects: [],
      bankLedgerJournal: { outbox: { snapshot: () => ({ rowCount: 0 }) } },
    } as unknown as ClientSession;
    balances.set(pid, 100000);
    service.attach(session, keys);
    return session;
  }
  return { service, attach, sim, host, db, owned, balances, calls };
}

describe('account buddy ownership coordinator', () => {
  it('publishes a grant to same-account alts only after source save and account durability', async () => {
    const x = setup();
    x.attach(1);
    x.attach(2);
    x.attach(3, 8);
    let commit!: (keys: BuddyKey[]) => void;
    x.db.grantAccountBuddies.mockImplementation(
      () =>
        new Promise((resolve) => {
          commit = resolve;
        }),
    );
    x.owned.set(1, ['crystal_lich']);
    x.service.granted(1);
    x.service.granted(1);
    await flush();
    expect(x.host.save).toHaveBeenCalledTimes(1);
    expect(x.owned.get(2)).toEqual([]);
    commit(['crystal_lich']);
    await flush();
    expect(x.owned.get(2)).toEqual(['crystal_lich']);
    expect(x.owned.get(3)).toEqual([]);
  });

  it('never publishes a failed source save', async () => {
    const x = setup();
    x.attach(1);
    x.attach(2);
    x.host.save.mockResolvedValue(false);
    x.owned.set(1, ['forgemaw']);
    x.service.granted(1);
    await flush();
    expect(x.db.grantAccountBuddies).not.toHaveBeenCalled();
    expect(x.owned.get(2)).toEqual([]);
  });

  it('retries an undurable grant at the next bounded refresh', async () => {
    const x = setup();
    x.attach(1);
    x.attach(2);
    x.host.save.mockResolvedValueOnce(false);
    x.owned.set(1, ['forgemaw']);
    x.service.granted(1);
    await flush();
    expect(x.owned.get(2)).toEqual([]);
    await x.service.refresh();
    await flush();
    expect(x.owned.get(2)).toEqual(['forgemaw']);
    expect(x.db.grantAccountBuddies).toHaveBeenCalledTimes(1);
  });

  it('rejects failed sim admission without any character save or purchase query', async () => {
    const x = setup();
    const s = x.attach(1);
    admission.mockReturnValueOnce(false);
    x.service.buy(s, 10, 'whistle_horse', { bulk: false });
    await flush();
    expect(x.host.save).not.toHaveBeenCalled();
    expect(x.db.purchaseAccountBuddy).not.toHaveBeenCalled();
    expect(x.service.commandBlocked(1)).toBe(false);
  });

  it('serializes a paid unlock, suppresses its nested grant hook, and blocks a concurrent account purchase', async () => {
    const x = setup();
    const a = x.attach(1);
    const b = x.attach(2);
    expect(x.service.buy(a, 10, 'whistle_horse', { bulk: false })).toBe(true);
    expect(x.service.commandBlocked(1)).toBe(true);
    x.service.buy(b, 10, 'whistle_horse', { bulk: false });
    await flush();
    expect(x.calls).toEqual(['save', 'lock', 'buy', 'commit']);
    expect(x.balances.get(1)).toBe(0);
    expect(x.balances.get(2)).toBe(100000);
    expect(x.db.grantAccountBuddies).not.toHaveBeenCalled();
    expect(x.owned.get(2)).toEqual(['horse']);
    expect(x.service.commandBlocked(1)).toBe(false);
  });

  it('refreshes a concurrently acquired durable buddy under the lock without charging', async () => {
    const x = setup();
    const s = x.attach(1);
    x.db.purchaseAccountBuddy.mockImplementation(async (_id, _key, prepare) => {
      expect(prepare(['horse'])).toBeNull();
      return ['horse'];
    });
    x.service.buy(s, 10, 'whistle_horse', { bulk: false });
    await flush();
    expect(x.sim.buyItem).not.toHaveBeenCalled();
    expect(x.balances.get(1)).toBe(100000);
    expect(x.owned.get(1)).toEqual(['horse']);
  });

  it('quarantines an ambiguous paid write without publishing or a speculative refund', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const x = setup();
    const s = x.attach(1);
    x.attach(2);
    x.db.purchaseAccountBuddy.mockImplementation(async (_id, _key, prepare) => {
      prepare([]);
      throw new Error('connection lost');
    });
    x.service.buy(s, 10, 'whistle_horse', { bulk: false });
    await flush();
    expect(x.host.quarantine).toHaveBeenCalledWith(s);
    expect(x.balances.get(1)).toBe(0);
    expect(x.owned.get(2)).toEqual([]);
    expect(x.db.grantAccountBuddies).not.toHaveBeenCalled();
  });

  it('quarantines inside the FIFO before a queued logout save can start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const x = setup();
    const s = x.attach(1);
    let reject!: (error: Error) => void;
    x.db.purchaseAccountBuddy.mockImplementation(async (_id, _key, prepare) => {
      prepare([]);
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    });
    x.service.buy(s, 10, 'whistle_horse', { bulk: false });
    await flush();
    const queuedSave = x.host.queue.enqueue(s.characterId, async () => s.escrowQuarantined);
    reject(new Error('commit unknown'));
    expect(await queuedSave).toBe(true);
    await flush();
  });

  it('refreshes active accounts in bounded coalesced pages with no quiet writes and evicts departed accounts', async () => {
    const x = setup();
    const keys: BuddyKey[] = ['horse', 'crystal_lich', 'forgemaw'];
    const sessions = Array.from({ length: 1001 }, (_, i) => x.attach(i + 1, i + 1, keys));
    x.db.readAccountBuddyBatch.mockImplementation(
      async (ids) => new Map(ids.map((id) => [id, keys])),
    );
    const first = x.service.refresh();
    expect(x.service.refresh()).toBe(first);
    await first;
    expect(x.db.readAccountBuddyBatch.mock.calls.map(([ids]) => ids.length)).toEqual([
      256, 256, 256, 233,
    ]);
    expect(x.host.save).not.toHaveBeenCalled();
    expect(x.db.grantAccountBuddies).not.toHaveBeenCalled();
    const measured = x.host.observe.mock.calls.map(([ms]) => ms);
    process.stdout.write(
      `${JSON.stringify({
        accountBuddyRefreshBenchmark: {
          accounts: 1001,
          keysPerAccount: 3,
          pages: 4,
          synchronousTotalMs: measured.reduce((a, b) => a + b, 0),
          synchronousMeanMs: measured.reduce((a, b) => a + b, 0) / measured.length,
          synchronousMaxMs: Math.max(...measured),
          quietWrites: 0,
        },
      })}\n`,
    );
    for (const session of sessions) x.service.detach(session);
    x.db.readAccountBuddyBatch.mockClear();
    await x.service.refresh();
    expect(x.db.readAccountBuddyBatch).not.toHaveBeenCalled();
  });
});
