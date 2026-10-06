import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ runWithStatementTimeout: vi.fn() }));

import {
  EMPTY_LIVE_ACCOUNT_COSMETICS,
  mergeAccountCosmetics,
} from '../server/account_cosmetics_live';
import { accountMountSkinIds, characterMountSkinIds } from '../server/account_mount_items_core';
import { captureAccountMountItemsHydration } from '../server/account_mount_items_hydration';
import {
  ACCOUNT_MOUNT_ITEMS_REFRESH_MS,
  AccountMountItemsService,
} from '../server/account_mount_items_service';

const slots = (id: string) => [{ itemId: id, count: 1 }];
const makeMeta = (id = 'reins_valorsteed') => ({
  wireRev: 0,
  bankWireRev: 0,
  inventory: slots(id),
  bank: { inventory: [] as ReturnType<typeof slots> },
});
const session = (accountId = 1, characterId = 1) => ({ accountId, characterId, pid: characterId });
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('revocable account mount items', () => {
  it('observes bank-only ownership changes with an unchanged inventory revision', () => {
    const meta = makeMeta('not_a_mount');
    const publish = vi.fn();
    const load = vi.fn(async () => []);
    const service = new AccountMountItemsService(
      { meta: () => meta, setCollectible: publish },
      load,
    );
    const live = session();
    service.join(live, []);
    meta.bank.inventory = slots('reins_valorsteed');
    meta.bankWireRev++;
    service.probe(live, 1);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['valorsteed']);
    meta.bank.inventory = [];
    meta.bankWireRev++;
    service.probe(live, 1);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
    expect(meta.wireRev).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('retains a look while another character or container owns a duplicate and revokes only the final copy', () => {
    const firstMeta = makeMeta();
    firstMeta.bank.inventory = slots('reins_valorsteed');
    const secondMeta = makeMeta();
    const metas = new Map([
      [1, firstMeta],
      [2, secondMeta],
    ]);
    const publish = vi.fn();
    const service = new AccountMountItemsService(
      { meta: (pid) => metas.get(pid), setCollectible: publish },
      vi.fn(async () => []),
    );
    const first = session();
    const second = session(1, 2);
    service.join(first, []);
    service.join(second, []);
    const beforeRemoval = publish.mock.calls.length;
    firstMeta.inventory = [];
    firstMeta.wireRev++;
    service.syncAccount(second);
    expect(publish).toHaveBeenCalledTimes(beforeRemoval);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['valorsteed']);
    firstMeta.bank.inventory = [];
    firstMeta.bankWireRev++;
    service.syncAccount(second);
    expect(publish).toHaveBeenCalledTimes(beforeRemoval);
    secondMeta.inventory = [];
    secondMeta.wireRev++;
    service.syncAccount(first);
    expect(publish).toHaveBeenCalledTimes(beforeRemoval + 1);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
  });
  it.each([false, true])(
    'refuses pre-save hydration arriving after final settlement (other session retained: %s)',
    async (keepSibling) => {
      const firstMeta = makeMeta();
      const emptyMeta = makeMeta('not_a_mount');
      const metas = new Map([
        [1, firstMeta],
        [2, emptyMeta],
        [3, emptyMeta],
      ]);
      const publish = vi.fn();
      const load = vi.fn(async () => []);
      const service = new AccountMountItemsService(
        { meta: (pid) => metas.get(pid), setCollectible: publish },
        load,
      );
      const first = session();
      const second = session(1, 2);
      const oldRows = [{ characterId: 1, mountSkinIds: ['valorsteed'] }];
      service.join(first, oldRows);
      if (keepSibling) service.join(session(1, 3), oldRows);
      // B's handshake SQL started, but its remaining lease/auth work outlives
      // A's departure and final save. Stamp on completion must keep its old fence.
      const completeHandshakeRead = captureAccountMountItemsHydration(1);
      firstMeta.inventory = [];
      firstMeta.wireRev++;
      service.leave(first);
      service.settledLeave(1, 1);
      service.join(second, completeHandshakeRead(oldRows));
      expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
      expect(load).toHaveBeenCalledTimes(1);
      await settle();
      expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
    },
  );
  it('preserves the departed last character override during a switch with stale hydration and evicts after final save', async () => {
    const firstMeta = makeMeta();
    const secondMeta = makeMeta('not_a_mount');
    const metas = new Map([
      [1, firstMeta],
      [2, secondMeta],
    ]);
    const publish = vi.fn();
    let resolve!: (rows: { characterId: number; mountSkinIds: string[] }[]) => void;
    const load = vi.fn(
      () =>
        new Promise<{ characterId: number; mountSkinIds: string[] }[]>((done) => {
          resolve = done;
        }),
    );
    const service = new AccountMountItemsService(
      { meta: (pid) => metas.get(pid), setCollectible: publish },
      load,
    );
    const first = session();
    const second = session(1, 2);
    const staleRows = [{ characterId: 1, mountSkinIds: ['valorsteed'] }];
    service.join(first, staleRows);
    service.probe(first, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 2);
    firstMeta.inventory = [];
    firstMeta.wireRev++;
    service.leave(first);
    service.join(second, staleRows);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
    resolve(staleRows);
    await settle();
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
    service.settledLeave(1, 1);
    service.syncAccount(second);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
    service.leave(second);
    const accounts = (service as unknown as { accounts: Map<number, unknown> }).accounts;
    expect(accounts.size).toBe(1);
    service.settledLeave(1, 2);
    expect(accounts.size).toBe(0);
  });
  it('projects only positive bag and personal bank reins and supersedes stale saves with empty live state', () => {
    const meta = makeMeta();
    meta.bank.inventory = slots('reins_grag_bear');
    meta.inventory.push({ itemId: 'reins_stalkglider_snail', count: 0 });
    expect(characterMountSkinIds(meta)).toEqual(['valorsteed', 'grag_bear']);
    expect(
      accountMountSkinIds(
        new Map([
          [1, ['valorsteed']],
          [2, ['grag_bear']],
        ]),
        new Map([[1, []]]),
      ),
    ).toEqual(['grag_bear']);
  });

  it('replaces collectible state and preserves it across paid-only persistence snapshots', () => {
    const current = {
      ...EMPTY_LIVE_ACCOUNT_COSMETICS,
      mountSkinIds: ['mech_bird'],
      collectibleMountSkinIds: ['valorsteed'],
    };
    expect(
      mergeAccountCosmetics(current, { ...current, collectibleMountSkinIds: [] })
        .collectibleMountSkinIds,
    ).toEqual([]);
    expect(
      mergeAccountCosmetics(current, EMPTY_LIVE_ACCOUNT_COSMETICS).collectibleMountSkinIds,
    ).toEqual(['valorsteed']);
  });

  it('uses revision probes without touching unchanged containers and revokes immediately on mutation', () => {
    const meta = makeMeta();
    const publish = vi.fn();
    const load = vi.fn(async () => []);
    const service = new AccountMountItemsService(
      { meta: () => meta, setCollectible: publish },
      load,
    );
    const live = session();
    service.join(live, []);
    const inventory = vi.spyOn(meta, 'inventory', 'get');
    for (let i = 0; i < 1_000; i++) service.probe(live, 1);
    expect(inventory).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    inventory.mockRestore();
    meta.inventory = [];
    meta.wireRev++;
    service.probe(live, 1);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
  });

  it('refreshes remote characters with single flight, retries failure, and drops results after last leave', async () => {
    const meta = makeMeta();
    const publish = vi.fn();
    const onWorkMs = vi.fn();
    let resolve!: (rows: { characterId: number; mountSkinIds: string[] }[]) => void;
    const load = vi.fn(
      () =>
        new Promise<{ characterId: number; mountSkinIds: string[] }[]>((done) => {
          resolve = done;
        }),
    );
    const service = new AccountMountItemsService(
      { meta: () => meta, setCollectible: publish, onWorkMs },
      load,
    );
    const live = session();
    service.join(live);
    service.probe(live, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 2);
    expect(load).toHaveBeenCalledTimes(1);
    resolve([{ characterId: 2, mountSkinIds: ['grag_bear'] }]);
    await settle();
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['valorsteed', 'grag_bear']);
    expect(onWorkMs).toHaveBeenCalledTimes(1);
    expect(onWorkMs.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(0);
    service.probe(live, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 3);
    resolve([]);
    await settle();
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['valorsteed']);
    service.probe(live, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 5);
    service.leave(live);
    const count = publish.mock.calls.length;
    resolve([{ characterId: 2, mountSkinIds: ['grag_bear'] }]);
    await settle();
    expect(publish).toHaveBeenCalledTimes(count);
    const fail = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    const retry = new AccountMountItemsService({ meta: () => meta, setCollectible: vi.fn() }, fail);
    retry.join(live);
    await settle();
    retry.probe(live, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 2);
    await settle();
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it('bounds concurrent projection reads even when many accounts join at once', async () => {
    const resolvers: (() => void)[] = [];
    const load = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolvers.push(() => resolve([]));
        }),
    );
    const service = new AccountMountItemsService(
      { meta: () => makeMeta(), setCollectible: vi.fn() },
      load,
    );
    for (let id = 1; id <= 100; id++) service.join(session(id, id));
    expect(load).toHaveBeenCalledTimes(4);
    resolvers[0]();
    await settle();
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('authorizes from every live account character without a SQL read and permits remote changes after leave settles', async () => {
    const metas = new Map([
      [1, makeMeta()],
      [2, makeMeta('reins_grag_bear')],
    ]);
    const publish = vi.fn();
    const load = vi.fn(async () => [{ characterId: 1, mountSkinIds: ['valorsteed'] }]);
    const service = new AccountMountItemsService(
      { meta: (pid) => metas.get(pid), setCollectible: publish },
      load,
    );
    const first = session();
    const second = session(1, 2);
    service.join(first, []);
    service.join(second, []);
    const firstMeta = metas.get(1);
    if (!firstMeta) throw new Error('missing fixture');
    firstMeta.inventory = [];
    firstMeta.wireRev++;
    service.syncAccount(second);
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['grag_bear']);
    expect(load).not.toHaveBeenCalled();
    service.leave(first);
    service.settledLeave(1, 1);
    service.probe(second, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 2);
    await settle();
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['valorsteed', 'grag_bear']);
  });

  it('refuses a stale read launched before a departed character save settled', async () => {
    const firstMeta = makeMeta();
    const secondMeta = makeMeta('reins_grag_bear');
    const metas = new Map([
      [1, firstMeta],
      [2, secondMeta],
    ]);
    let resolve!: (rows: { characterId: number; mountSkinIds: string[] }[]) => void;
    const load = vi.fn(
      () =>
        new Promise<{ characterId: number; mountSkinIds: string[] }[]>((done) => {
          resolve = done;
        }),
    );
    const publish = vi.fn();
    const service = new AccountMountItemsService(
      { meta: (pid) => metas.get(pid), setCollectible: publish },
      load,
    );
    const first = session();
    const second = session(1, 2);
    service.join(first, []);
    service.join(second, []);
    service.probe(second, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 2);
    firstMeta.inventory = [];
    firstMeta.wireRev++;
    service.leave(first);
    service.settledLeave(1, 1);
    resolve([{ characterId: 1, mountSkinIds: ['valorsteed'] }]);
    await settle();
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['grag_bear']);
    service.probe(second, Date.now() + ACCOUNT_MOUNT_ITEMS_REFRESH_MS * 2);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
