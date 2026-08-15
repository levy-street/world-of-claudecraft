import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES,
  ADMIN_GUILD_LIST_CACHE_TTL_MS,
  ADMIN_GUILD_LIST_MAX_CONCURRENT_AGGREGATE_READS,
  ADMIN_GUILD_LIST_MAX_CONCURRENT_PAGE_READS,
  AdminGuildListBusyError,
  adminGuildListCacheSizeForTests,
  adminGuildListReadClass,
  bustAdminGuildListReads,
  readAdminGuildList,
  resetAdminGuildListReadsForTests,
} from '../server/admin_guilds_read';

const baseRequest = {
  search: '',
  page: 1,
  limit: 25,
  sort: 'member_count' as const,
  dir: 'desc' as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('admin guild list read admission', () => {
  afterEach(() => {
    resetAdminGuildListReadsForTests();
    vi.restoreAllMocks();
  });

  it('shares one database read between concurrent identical requests', async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);

    const reads = Array.from({ length: 10 }, (_, index) =>
      readAdminGuildList({ ...baseRequest, search: index % 2 ? ' Keep ' : 'keep' }, load),
    );
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    pending.resolve('result');

    await expect(Promise.all(reads)).resolves.toEqual(Array(10).fill('result'));
  });

  it('normalizes the 64-character search bound before coalescing', async () => {
    const pending = deferred<string>();
    const load = vi.fn(() => pending.promise);
    const prefix = 'x'.repeat(64);

    const first = readAdminGuildList({ ...baseRequest, search: `${prefix}first` }, load);
    const second = readAdminGuildList({ ...baseRequest, search: `${prefix}second` }, load);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    pending.resolve('result');

    await expect(Promise.all([first, second])).resolves.toEqual(['result', 'result']);
  });

  it('rejects excess distinct aggregating reads instead of saturating the shared pool', async () => {
    const pending = Array.from({ length: ADMIN_GUILD_LIST_MAX_CONCURRENT_AGGREGATE_READS }, () =>
      deferred<string>(),
    );
    const admitted = pending.map(({ promise }, index) =>
      readAdminGuildList({ ...baseRequest, page: index + 1 }, () => promise),
    );

    await expect(
      readAdminGuildList(
        { ...baseRequest, page: ADMIN_GUILD_LIST_MAX_CONCURRENT_AGGREGATE_READS + 1 },
        async () => 'not reached',
      ),
    ).rejects.toBeInstanceOf(AdminGuildListBusyError);

    pending.forEach(({ resolve }, index) => {
      resolve(`result-${index}`);
    });
    await expect(Promise.all(admitted)).resolves.toEqual(['result-0', 'result-1']);
  });

  it('classifies only the member_count branch as the aggregating read', () => {
    expect(adminGuildListReadClass(baseRequest)).toBe('aggregate');
    expect(adminGuildListReadClass({ ...baseRequest, sort: 'name' })).toBe('page');
    expect(adminGuildListReadClass({ ...baseRequest, sort: 'created_at' })).toBe('page');
  });

  it('still admits a cheap paged read while the aggregating class is saturated', async () => {
    const aggregating = Array.from(
      { length: ADMIN_GUILD_LIST_MAX_CONCURRENT_AGGREGATE_READS },
      () => deferred<string>(),
    );
    const admitted = aggregating.map(({ promise }, index) =>
      readAdminGuildList({ ...baseRequest, page: index + 1 }, () => promise),
    );

    // The directory's default view: several operators loading it at once must not
    // collide with a saturated member_count sort.
    await expect(
      readAdminGuildList({ ...baseRequest, sort: 'name', dir: 'asc' }, async () => 'directory'),
    ).resolves.toBe('directory');

    aggregating.forEach(({ resolve }, index) => {
      resolve(`aggregate-${index}`);
    });
    await expect(Promise.all(admitted)).resolves.toEqual(['aggregate-0', 'aggregate-1']);
  });

  it('gives the paged class its own, wider cap', async () => {
    expect(ADMIN_GUILD_LIST_MAX_CONCURRENT_PAGE_READS).toBeGreaterThan(
      ADMIN_GUILD_LIST_MAX_CONCURRENT_AGGREGATE_READS,
    );
    const pending = Array.from({ length: ADMIN_GUILD_LIST_MAX_CONCURRENT_PAGE_READS }, () =>
      deferred<string>(),
    );
    const admitted = pending.map(({ promise }, index) =>
      readAdminGuildList({ ...baseRequest, sort: 'name', page: index + 1 }, () => promise),
    );

    await expect(
      readAdminGuildList(
        { ...baseRequest, sort: 'name', page: ADMIN_GUILD_LIST_MAX_CONCURRENT_PAGE_READS + 1 },
        async () => 'not reached',
      ),
    ).rejects.toBeInstanceOf(AdminGuildListBusyError);

    pending.forEach(({ resolve }, index) => {
      resolve(`page-${index}`);
    });
    await expect(Promise.all(admitted)).resolves.toHaveLength(
      ADMIN_GUILD_LIST_MAX_CONCURRENT_PAGE_READS,
    );
  });

  it('releases its admission slot after the read settles', async () => {
    await expect(readAdminGuildList(baseRequest, async () => 'first')).resolves.toBe('first');
    await expect(
      readAdminGuildList({ ...baseRequest, page: 2 }, async () => 'second'),
    ).resolves.toBe('second');
  });

  it('releases its admission slot after a database rejection', async () => {
    await expect(
      readAdminGuildList(baseRequest, async () => {
        throw new Error('database unavailable');
      }),
    ).rejects.toThrow('database unavailable');

    const pending = [deferred<string>(), deferred<string>()];
    const admitted = pending.map(({ promise }, index) =>
      readAdminGuildList({ ...baseRequest, page: index + 2 }, () => promise),
    );
    pending.forEach(({ resolve }, index) => {
      resolve(`recovered-${index}`);
    });
    await expect(Promise.all(admitted)).resolves.toEqual(['recovered-0', 'recovered-1']);
  });

  it('keeps every request dimension in the cache key', async () => {
    const load = vi.fn(async () => 'result');
    const requests = [
      { ...baseRequest, search: 'different' },
      { ...baseRequest, page: 2 },
      { ...baseRequest, limit: 50 },
      { ...baseRequest, sort: 'created_at' as const },
      { ...baseRequest, dir: 'asc' as const },
    ];

    await readAdminGuildList(baseRequest, load);
    for (const request of requests) await readAdminGuildList(request, load);

    expect(load).toHaveBeenCalledTimes(requests.length + 1);
  });

  it('serves a short-lived hit and bounds cache cardinality', async () => {
    expect(ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES).toBe(64);
    const load = vi.fn(async () => 'result');
    for (let page = 1; page <= ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES + 1; page += 1) {
      await readAdminGuildList({ ...baseRequest, page }, load);
    }
    expect(adminGuildListCacheSizeForTests()).toBe(ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES);

    await readAdminGuildList(
      { ...baseRequest, page: ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES + 1 },
      load,
    );
    expect(load).toHaveBeenCalledTimes(ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES + 1);

    await readAdminGuildList(baseRequest, load);
    expect(load).toHaveBeenCalledTimes(ADMIN_GUILD_LIST_CACHE_MAX_ENTRIES + 2);
  });

  it('refreshes a cached result after its short TTL expires', async () => {
    expect(ADMIN_GUILD_LIST_CACHE_TTL_MS).toBe(2_000);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const load = vi.fn(async () => 'result');
    await readAdminGuildList(baseRequest, load);
    await readAdminGuildList(baseRequest, load);
    expect(load).toHaveBeenCalledOnce();

    now.mockReturnValue(1_000 + ADMIN_GUILD_LIST_CACHE_TTL_MS);
    await readAdminGuildList(baseRequest, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('removes an already cached result when guild data changes', async () => {
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('fresh');
    await expect(readAdminGuildList(baseRequest, load)).resolves.toBe('old');
    await expect(readAdminGuildList(baseRequest, load)).resolves.toBe('old');

    bustAdminGuildListReads();

    await expect(readAdminGuildList(baseRequest, load)).resolves.toBe('fresh');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let a pre-bust flight overwrite the fresh cache', async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const oldLoad = vi.fn(() => old.promise);
    const freshLoad = vi.fn(() => fresh.promise);

    const oldRead = readAdminGuildList(baseRequest, oldLoad);
    await vi.waitFor(() => expect(oldLoad).toHaveBeenCalledOnce());
    bustAdminGuildListReads();
    const freshRead = readAdminGuildList(baseRequest, freshLoad);
    await vi.waitFor(() => expect(freshLoad).toHaveBeenCalledOnce());

    fresh.resolve('fresh');
    await expect(freshRead).resolves.toBe('fresh');
    old.resolve('old');
    await expect(oldRead).resolves.toBe('old');
    await expect(
      readAdminGuildList(baseRequest, async () => {
        throw new Error('fresh cache was not retained');
      }),
    ).resolves.toBe('fresh');
  });
});
