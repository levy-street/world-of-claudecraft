import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ runWithStatementTimeout: vi.fn() }));

import { invalidateAccountMountItemsHydration } from '../server/account_mount_items_hydration';
import { AccountMountItemsService } from '../server/account_mount_items_service';
import { createBackgroundDbGate } from '../server/background_db_gate';

const meta = () => ({ wireRev: 0, bankWireRev: 0, inventory: [], bank: { inventory: [] } });
const session = (accountId = 1) => ({ accountId, characterId: accountId, pid: accountId });
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
afterEach(() => vi.restoreAllMocks());

describe('incremental account mount refresh', () => {
  it('rejects stale deltas without advancing the next version manifest', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    let finish!: (rows: { characterId: number; version: string; mountSkinIds: string[] }[]) => void;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue([]);
    const publish = vi.fn();
    const service = new AccountMountItemsService(
      { meta, setCollectible: publish },
      vi.fn(async () => []),
      refresh,
    );
    const live = session(401);
    service.join(live, [{ characterId: 402, version: 'accepted', mountSkinIds: ['grag_bear'] }]);
    service.probe(live, 30_000);
    invalidateAccountMountItemsHydration(401);
    publish.mockClear();
    finish([{ characterId: 402, version: 'rejected', mountSkinIds: [] }]);
    await settle();
    expect(publish).not.toHaveBeenCalled();
    service.probe(live, 30_001);
    expect(refresh).toHaveBeenLastCalledWith(401, { 402: 'accepted' });
    await settle();
  });

  it('keeps quiet grown-account refreshes off containers and publication while billing deferred launches', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const inventoryRead = vi.fn(() => []);
    const liveMeta = {
      ...meta(),
      get inventory() {
        return inventoryRead();
      },
    };
    const publish = vi.fn();
    const onWorkMs = vi.fn();
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      characterId: 5000 + i,
      version: `v${i}`,
      mountSkinIds: ['grag_bear'],
    }));
    const refresh = vi.fn(async () =>
      rows.map(({ characterId, version }) => ({ characterId, version })),
    );
    const service = new AccountMountItemsService(
      { meta: () => liveMeta, setCollectible: publish, onWorkMs },
      vi.fn(async () => []),
      refresh,
    );
    const a = session(501),
      b = session(502);
    service.join(a, rows);
    service.join(b, rows);
    inventoryRead.mockClear();
    publish.mockClear();
    const start = performance.now();
    service.probe(a, 30_000);
    service.probe(b, 30_000);
    await settle();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(inventoryRead).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(onWorkMs.mock.calls.length).toBeGreaterThanOrEqual(3);
    console.log(
      'two quiet 1000-character refreshes:',
      performance.now() - start,
      'ms elapsed; billed CPU:',
      onWorkMs.mock.calls.reduce((sum, call) => sum + call[0], 0),
      'ms; container scans: 0; publications: 0',
    );
  });
  it('preserves unchanged projections, revokes changed-empty and deleted characters, and discovers new characters', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const publish = vi.fn();
    const full = vi.fn(async () => []);
    const refresh = vi
      .fn()
      .mockResolvedValueOnce([{ characterId: 2, version: 'v1' }])
      .mockResolvedValueOnce([{ characterId: 2, version: 'v2', mountSkinIds: [] }])
      .mockResolvedValueOnce([{ characterId: 3, version: 'v3', mountSkinIds: ['valorsteed'] }])
      .mockResolvedValueOnce([]);
    const service = new AccountMountItemsService({ meta, setCollectible: publish }, full, refresh);
    const live = session();
    service.join(live, [{ characterId: 2, version: 'v1', mountSkinIds: ['grag_bear'] }]);
    publish.mockClear();
    service.probe(live, 30_000);
    await settle();
    expect(refresh).toHaveBeenLastCalledWith(1, { 2: 'v1' });
    expect(full).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    service.probe(live, 60_000);
    await settle();
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
    service.probe(live, 90_000);
    await settle();
    expect(publish.mock.calls.at(-1)?.[1]).toEqual(['valorsteed']);
    service.probe(live, 120_000);
    await settle();
    expect(refresh).toHaveBeenLastCalledWith(1, { 3: 'v3' });
    expect(publish.mock.calls.at(-1)?.[1]).toEqual([]);
  });

  it('skips a busy shared gate without SQL or waiters, then retries on the next cadence', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const gate = createBackgroundDbGate(4);
    const held = gate.tryAcquire();
    const refresh = vi.fn(async () => []);
    const service = new AccountMountItemsService(
      { meta, setCollectible: vi.fn(), tryAcquireRefreshPermit: () => gate.tryAcquire() },
      vi.fn(async () => []),
      refresh,
    );
    const live = session();
    service.join(live, []);
    service.probe(live, 30_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(gate.stats()).toMatchObject({ waiting: 0, inFlight: 1, refused: 1 });
    held?.release();
    service.probe(live, 40_000);
    expect(refresh).not.toHaveBeenCalled();
    service.probe(live, 60_000);
    await settle();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(gate.stats()).toMatchObject({ waiting: 0, inFlight: 0 });
  });

  it('runs only one periodic query at a time and releases the gate on rejection or synchronous throw', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const gate = createBackgroundDbGate(8);
    let reject!: (err: Error) => void;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockImplementationOnce(() => {
        throw new Error('offline');
      })
      .mockResolvedValue([]);
    const onError = vi.fn();
    const service = new AccountMountItemsService(
      { meta, setCollectible: vi.fn(), onError, tryAcquireRefreshPermit: () => gate.tryAcquire() },
      vi.fn(async () => []),
      refresh,
    );
    const lives = [session(1), session(2), session(3)];
    for (const live of lives) service.join(live, []);
    for (const live of lives) service.probe(live, 30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(gate.stats().inFlight).toBe(1);
    reject(new Error('offline'));
    await settle();
    await settle();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(gate.stats()).toMatchObject({ waiting: 0, inFlight: 0 });
  });

  it('marks local ownership provisional until a successful complete projection arrives', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const publish = vi.fn();
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    const service = new AccountMountItemsService(
      { meta, setCollectible: publish },
      vi.fn(async () => []),
      refresh,
    );
    const live = session();
    service.join(live);
    await settle();
    expect(publish.mock.calls.at(-1)?.[3]).toBe(false);
    service.probe(live, 30_000);
    await settle();
    expect(publish.mock.calls.at(-1)?.[3]).toBe(true);
  });
});
