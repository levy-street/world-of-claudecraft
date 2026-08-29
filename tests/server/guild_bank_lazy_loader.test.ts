import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createGuildBankLazyLoader,
  GUILD_BANK_LAZY_LOAD_AUTOMATIC_START_WINDOW_MS,
  GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS,
  GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX,
  GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS,
  GUILD_BANK_LAZY_LOAD_MAX_ACTIVE,
  GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS,
  GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS,
  GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES,
  GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES,
  GUILD_BANK_LAZY_LOAD_RETRY_SPREAD_STEP_MS,
  GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES,
  type GuildBankLazyLoadApplyResult,
  type GuildBankLazyLoadRow,
  type GuildBankLazyLoadScheduleRetry,
} from '../../server/guild_bank_lazy_loader';
import { GUILD_BANK_ROW_MAX_BYTES } from '../../server/guild_bank_receipt_db';
import { stripComments } from '../helpers/strip_comments';

interface TestRow extends GuildBankLazyLoadRow {
  readonly data: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function row(guildId: number, overrides: Partial<TestRow> = {}): TestRow {
  return {
    guildId,
    data: `guild-${guildId}`,
    oversized: false,
    dataBytes: 64,
    ...overrides,
  };
}

function loadedResult(...guildIds: number[]): GuildBankLazyLoadApplyResult {
  return { loaded: guildIds, oversized: [], malformed: [] };
}

const NO_RETRY_SCHEDULER: GuildBankLazyLoadScheduleRetry = () => () => undefined;

interface RetryJob {
  readonly delayMs: number;
  readonly retry: () => void | Promise<void>;
  cancelled: boolean;
  ran: boolean;
}

function fakeRetryScheduler(advanceNow: (delayMs: number) => void = () => undefined) {
  const jobs: RetryJob[] = [];
  const scheduleRetry = vi.fn((delayMs: number, retry: () => void | Promise<void>) => {
    const job: RetryJob = { delayMs, retry, cancelled: false, ran: false };
    jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  });
  const pending = () => jobs.filter((job) => !job.cancelled && !job.ran);
  return {
    jobs,
    scheduleRetry,
    pending,
    advance: advanceNow,
    async runNext(): Promise<void> {
      const job = pending()[0];
      if (!job) throw new Error('no pending guild-bank retry');
      job.ran = true;
      advanceNow(job.delayMs);
      await job.retry();
    },
  };
}

describe('guild bank lazy loader', () => {
  it('wires unref retry timers and shutdown cancellation into GameServer', () => {
    // Strip comments so commented-out code cannot satisfy the positive pins below.
    const game = stripComments(
      readFileSync(new URL('../../server/game.ts', import.meta.url), 'utf8'),
    );

    expect(game).toContain('const timer = setTimeout(retry, delayMs).unref();');
    expect(game).toContain('return () => clearTimeout(timer);');
    expect(game).toMatch(/stop\(\): void \{\s+this\.guildBankLazyLoader\.stop\(\);/);
    expect(game).toContain('await this.guildBankLazyLoader.ensureLoaded(snap.guild.id);');
    expect(game).toContain(
      "recordBookUnloadedIncident: () => gameMetricsCounters().guildBankIncident('book_unloaded')",
    );
  });

  it('pins the admission, retry, cache, and soft-size bounds', () => {
    expect(GUILD_BANK_LAZY_LOAD_MAX_ACTIVE).toBe(4);
    expect(GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS).toBe(30_000);
    expect(GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS).toBe(5_000);
    expect(GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES).toBe(64);
    expect(GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES).toBe(2);
    expect(GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS).toBe(6);
    expect(GUILD_BANK_LAZY_LOAD_RETRY_SPREAD_STEP_MS).toBe(100);
    expect(GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS).toBe(10);
    expect(GUILD_BANK_LAZY_LOAD_AUTOMATIC_START_WINDOW_MS).toBe(1_000);
    expect(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX).toBe(1_024);
    expect(GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES).toBe(65_536);
    expect(GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES).toBe(GUILD_BANK_ROW_MAX_BYTES / 4);
  });

  it('short-circuits an already-loaded book without taking admission or reading storage', async () => {
    const loadRow = vi.fn<(guildId: number) => Promise<TestRow | null>>();
    const tryAcquireImmediatePermit = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: (guildId) => guildId === 7,
      loadRow,
      applyRows: vi.fn(),
      tryAcquireImmediatePermit,
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => 100,
    });

    await expect(loader.ensureLoaded(7)).resolves.toBeUndefined();

    expect(loadRow).not.toHaveBeenCalled();
    expect(tryAcquireImmediatePermit).not.toHaveBeenCalled();
  });

  it('coalesces concurrent requests for one guild into one load and one permit lifetime', async () => {
    const pending = deferred<TestRow | null>();
    const release = vi.fn();
    const loadRow = vi.fn(() => pending.promise);
    const applyRows = vi.fn(() => loadedResult(12));
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows,
      tryAcquireImmediatePermit: () => ({ release }),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => 100,
    });

    const first = loader.ensureLoaded(12);
    const second = loader.ensureLoaded(12);
    expect(loadRow).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    pending.resolve(row(12));
    await Promise.all([first, second]);

    expect(applyRows).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('admits four distinct reads, gives the fifth a five-second busy memo, then retries it', async () => {
    let now = 10_000;
    const pending = deferred<TestRow | null>();
    const loadRow = vi.fn((guildId: number) =>
      guildId <= GUILD_BANK_LAZY_LOAD_MAX_ACTIVE ? pending.promise : Promise.resolve(row(guildId)),
    );
    const incident = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: (rows) => loadedResult(rows[0].guildId),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    const active = Array.from({ length: GUILD_BANK_LAZY_LOAD_MAX_ACTIVE }, (_, index) =>
      loader.ensureLoaded(index + 1),
    );
    await loader.ensureLoaded(5);
    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_ACTIVE);
    expect(incident).not.toHaveBeenCalled();

    now += GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS - 1;
    await loader.ensureLoaded(5);
    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_ACTIVE);

    pending.resolve(row(1));
    await Promise.all(active);
    now += 1;
    await loader.ensureLoaded(5);
    expect(loadRow).toHaveBeenLastCalledWith(5);
  });

  it('uses the same short busy memo when the optional shared permit refuses admission', async () => {
    let now = 50;
    let admitted = false;
    const release = vi.fn();
    const loadRow = vi.fn(async (guildId: number) => row(guildId));
    const incident = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: (rows) => loadedResult(rows[0].guildId),
      tryAcquireImmediatePermit: () => (admitted ? { release } : null),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(21);
    admitted = true;
    now += GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS - 1;
    await loader.ensureLoaded(21);
    expect(loadRow).not.toHaveBeenCalled();
    expect(incident).not.toHaveBeenCalled();

    now += 1;
    await loader.ensureLoaded(21);
    expect(loadRow).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('self-heals after a busy shared permit without another social snapshot', async () => {
    let now = 50;
    let admitted = false;
    let loaded = false;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const loadRow = vi.fn(async (guildId: number) => row(guildId));
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => loaded,
      loadRow,
      applyRows: (rows) => {
        loaded = true;
        return loadedResult(rows[0].guildId);
      },
      tryAcquireImmediatePermit: () => (admitted ? { release: vi.fn() } : null),
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(22);
    expect(loadRow).not.toHaveBeenCalled();
    expect(scheduler.pending()).toHaveLength(1);
    expect(scheduler.scheduleRetry).toHaveBeenCalledWith(
      GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS,
      expect.any(Function),
    );

    admitted = true;
    await scheduler.runNext();

    expect(loadRow).toHaveBeenCalledOnce();
    expect(scheduler.pending()).toHaveLength(0);
  });

  it('self-heals a transient read failure after the ordinary failure TTL', async () => {
    let now = 100;
    let loaded = false;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const loadRow = vi
      .fn<(guildId: number) => Promise<TestRow | null>>()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValue(row(32));
    const incident = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => loaded,
      loadRow,
      applyRows: () => {
        loaded = true;
        return loadedResult(32);
      },
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(32);
    expect(loadRow).toHaveBeenCalledOnce();
    expect(scheduler.scheduleRetry).toHaveBeenCalledWith(
      GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS,
      expect.any(Function),
    );

    await scheduler.runNext();

    expect(loadRow).toHaveBeenCalledTimes(2);
    expect(scheduler.pending()).toHaveLength(0);
    expect(incident).not.toHaveBeenCalled();
  });

  it('deduplicates one retry timer per guild and cancels it when another path loads the book', async () => {
    let now = 0;
    let loaded = false;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const loadRow = vi.fn(async (guildId: number) => row(guildId));
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => loaded,
      loadRow,
      applyRows: (rows) => loadedResult(rows[0].guildId),
      tryAcquireImmediatePermit: () => null,
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await Promise.all([loader.ensureLoaded(23), loader.ensureLoaded(23), loader.ensureLoaded(23)]);

    expect(scheduler.scheduleRetry).toHaveBeenCalledOnce();
    expect(scheduler.pending()).toHaveLength(1);

    loaded = true;
    await loader.ensureLoaded(23);

    expect(scheduler.pending()).toHaveLength(0);
    expect(loadRow).not.toHaveBeenCalled();
  });

  it('ignores a cancelled timer ghost after a later failure replaces its token', async () => {
    let now = 0;
    const scheduler = fakeRetryScheduler();
    const tryAcquireImmediatePermit = vi.fn(() => null);
    const loadRow = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: vi.fn(),
      tryAcquireImmediatePermit,
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(29);
    const retired = scheduler.jobs[0];
    expect(retired).toBeDefined();

    now = GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS;
    await loader.ensureLoaded(29);
    expect(retired.cancelled).toBe(true);
    expect(scheduler.pending()).toHaveLength(1);

    await retired.retry();

    expect(tryAcquireImmediatePermit).toHaveBeenCalledTimes(2);
    expect(loadRow).not.toHaveBeenCalled();
    expect(scheduler.pending()).toHaveLength(1);
  });

  it('bounds automatic busy rearms but lets a later manual call start a fresh cycle', async () => {
    let now = 0;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const tryAcquireImmediatePermit = vi.fn(() => null);
    const incident = vi.fn();
    const error = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow: vi.fn(),
      applyRows: vi.fn(),
      tryAcquireImmediatePermit,
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error,
      nowMs: () => now,
    });

    await loader.ensureLoaded(24);
    for (let attempt = 0; attempt < GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS; attempt++) {
      await scheduler.runNext();
    }

    expect(tryAcquireImmediatePermit).toHaveBeenCalledTimes(
      GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS + 1,
    );
    expect(scheduler.scheduleRetry).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS);
    expect(scheduler.pending()).toHaveLength(0);
    expect(incident).toHaveBeenCalledOnce();
    expect(error).toHaveBeenLastCalledWith(
      'guild bank 24 lazy load busy retries exhausted; bank remains inert',
    );

    scheduler.advance(GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS);
    await loader.ensureLoaded(24);

    expect(tryAcquireImmediatePermit).toHaveBeenCalledTimes(
      GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS + 2,
    );
    expect(scheduler.pending()).toHaveLength(1);
    expect(incident).toHaveBeenCalledOnce();
  });

  it('bounds actual automatic load retries separately from busy rearms', async () => {
    let now = 0;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const incident = vi.fn();
    const loadRow = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: vi.fn(),
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(25);
    for (let attempt = 0; attempt < GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES; attempt++) {
      await scheduler.runNext();
    }

    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES + 1);
    expect(scheduler.scheduleRetry).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES);
    expect(scheduler.pending()).toHaveLength(0);
    expect(incident).toHaveBeenCalledOnce();

    scheduler.advance(GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS);
    await loader.ensureLoaded(25);

    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES + 2);
    expect(scheduler.pending()).toHaveLength(1);
  });

  it('caps pending retry state without evicting live timers', async () => {
    const scheduler = fakeRetryScheduler();
    const incident = vi.fn();
    const error = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow: vi.fn(),
      applyRows: vi.fn(),
      tryAcquireImmediatePermit: () => null,
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error,
      nowMs: () => 0,
    });

    for (let guildId = 1; guildId <= GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES + 1; guildId++) {
      await loader.ensureLoaded(guildId);
    }

    expect(scheduler.scheduleRetry).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES);
    expect(scheduler.pending()).toHaveLength(GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES);
    expect(scheduler.jobs.filter((job) => job.cancelled)).toHaveLength(0);
    expect(incident).toHaveBeenCalledOnce();
    expect(error).toHaveBeenLastCalledWith(
      `guild bank ${GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES + 1} lazy load retry capacity exhausted; bank remains inert`,
    );
    expect(scheduler.jobs.map((job) => job.delayMs)).toEqual(
      Array.from(
        { length: GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES },
        (_, slot) =>
          GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS + slot * GUILD_BANK_LAZY_LOAD_RETRY_SPREAD_STEP_MS,
      ),
    );
    const startsPerSecond = new Map<number, number>();
    for (const job of scheduler.jobs) {
      const second = Math.floor(job.delayMs / 1_000);
      startsPerSecond.set(second, (startsPerSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...startsPerSecond.values())).toBeLessThanOrEqual(10);
    expect(new Set(scheduler.jobs.map((job) => job.delayMs))).toHaveLength(
      GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES,
    );
  });

  it('reuses only free pacing slots when pending guilds churn', async () => {
    const loaded = new Set<number>();
    const scheduler = fakeRetryScheduler();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: (guildId) => loaded.has(guildId),
      loadRow: vi.fn(),
      applyRows: vi.fn(),
      tryAcquireImmediatePermit: () => null,
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => 0,
    });

    for (let guildId = 1; guildId <= GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES; guildId++) {
      await loader.ensureLoaded(guildId);
    }
    for (let guildId = 2; guildId <= GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES; guildId++) {
      loaded.add(guildId);
      await loader.ensureLoaded(guildId);
    }
    for (
      let guildId = GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES + 1;
      guildId < GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES * 2;
      guildId++
    ) {
      await loader.ensureLoaded(guildId);
    }

    const pending = scheduler.pending();
    expect(pending).toHaveLength(GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES);
    expect(new Set(pending.map((job) => job.delayMs))).toHaveLength(
      GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES,
    );
    const startsPerSecond = new Map<number, number>();
    for (const job of pending) {
      const second = Math.floor(job.delayMs / 1_000);
      startsPerSecond.set(second, (startsPerSecond.get(second) ?? 0) + 1);
    }
    expect(Math.max(...startsPerSecond.values())).toBeLessThanOrEqual(10);
  });

  it('enforces the rolling automatic-start gate without throttling a manual recovery', async () => {
    let now = 0;
    let admitted = false;
    const loaded = new Set<number>();
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const incident = vi.fn();
    const loadRow = vi.fn(async (guildId: number) => row(guildId));
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: (guildId) => loaded.has(guildId),
      loadRow,
      applyRows: (rows) => {
        loaded.add(rows[0].guildId);
        return loadedResult(rows[0].guildId);
      },
      tryAcquireImmediatePermit: () => (admitted ? { release: vi.fn() } : null),
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    for (let guildId = 1; guildId <= GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS + 2; guildId++) {
      await loader.ensureLoaded(guildId);
    }
    const firstWave = [...scheduler.jobs];
    admitted = true;
    now = 20_000;
    for (const job of firstWave) {
      job.ran = true;
      await job.retry();
    }

    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS);
    expect(scheduler.pending()).toHaveLength(2);
    expect(scheduler.pending().map((job) => job.delayMs)).toEqual([
      GUILD_BANK_LAZY_LOAD_AUTOMATIC_START_WINDOW_MS +
        GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS * GUILD_BANK_LAZY_LOAD_RETRY_SPREAD_STEP_MS,
      GUILD_BANK_LAZY_LOAD_AUTOMATIC_START_WINDOW_MS +
        (GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS + 1) * GUILD_BANK_LAZY_LOAD_RETRY_SPREAD_STEP_MS,
    ]);
    expect(incident).not.toHaveBeenCalled();

    await loader.ensureLoaded(GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS + 1);
    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS + 1);
    expect(scheduler.pending()).toHaveLength(1);

    await scheduler.runNext();
    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS + 2);
    expect(scheduler.pending()).toHaveLength(0);
    expect(incident).not.toHaveBeenCalled();
  });

  it('retains starts from the trailing edge when the wall-clock second changes', async () => {
    let now = 0;
    let admitted = false;
    const loaded = new Set<number>();
    const scheduler = fakeRetryScheduler();
    const loadRow = vi.fn(async (guildId: number) => row(guildId));
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: (guildId) => loaded.has(guildId),
      loadRow,
      applyRows: (rows) => {
        loaded.add(rows[0].guildId);
        return loadedResult(rows[0].guildId);
      },
      tryAcquireImmediatePermit: () => (admitted ? { release: vi.fn() } : null),
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    const guildCount = GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS + 6;
    for (let guildId = 1; guildId <= guildCount; guildId++) await loader.ensureLoaded(guildId);
    const firstWave = [...scheduler.jobs];
    admitted = true;

    now = 10_000;
    for (const job of firstWave.slice(0, 5)) {
      job.ran = true;
      await job.retry();
    }
    now = 10_900;
    for (const job of firstWave.slice(5, 10)) {
      job.ran = true;
      await job.retry();
    }
    now = 11_000;
    for (const job of firstWave.slice(10)) {
      job.ran = true;
      await job.retry();
    }

    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS + 5);
    expect(scheduler.pending()).toHaveLength(1);
  });

  it('coalesces a due timer with a manual load already in flight', async () => {
    let now = 0;
    let loaded = false;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const pending = deferred<TestRow | null>();
    const loadRow = vi
      .fn<(guildId: number) => Promise<TestRow | null>>()
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockImplementation(() => pending.promise);
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => loaded,
      loadRow,
      applyRows: () => {
        loaded = true;
        return loadedResult(26);
      },
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(26);
    now += GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS;
    const manual = loader.ensureLoaded(26);
    const automatic = scheduler.runNext();
    expect(loadRow).toHaveBeenCalledTimes(2);

    pending.resolve(row(26));
    await Promise.all([manual, automatic]);

    expect(loadRow).toHaveBeenCalledTimes(2);
    expect(scheduler.pending()).toHaveLength(0);
  });

  it('cancels every timer at stop and ignores a ghost callback after cancellation', async () => {
    let now = 0;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const loadRow = vi.fn(async (guildId: number) => row(guildId));
    const tryAcquireImmediatePermit = vi.fn(() => null);
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: (rows) => loadedResult(rows[0].guildId),
      tryAcquireImmediatePermit,
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(27);
    await loader.ensureLoaded(28);
    const ghosts = [...scheduler.jobs];
    expect(ghosts).toHaveLength(2);

    loader.stop();
    loader.stop();
    expect(scheduler.pending()).toHaveLength(0);
    expect(ghosts.every((job) => job.cancelled)).toBe(true);
    for (const ghost of ghosts) await ghost.retry();
    await loader.ensureLoaded(27);
    await loader.ensureLoaded(28);

    expect(tryAcquireImmediatePermit).toHaveBeenCalledTimes(2);
    expect(loadRow).not.toHaveBeenCalled();
  });

  it('starts the ordinary failure TTL when the failed read completes', async () => {
    let now = 100;
    const pending = deferred<TestRow | null>();
    const loadRow = vi.fn(() => pending.promise);
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: vi.fn(),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    const first = loader.ensureLoaded(31);
    now = 1_000;
    pending.resolve(null);
    await first;

    now += GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS - 1;
    await loader.ensureLoaded(31);
    expect(loadRow).toHaveBeenCalledOnce();
  });

  it('reports a missing row once and retries only after the ordinary failure TTL', async () => {
    let now = 2_000;
    const loadRow = vi.fn(async () => null);
    const incident = vi.fn();
    const error = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: vi.fn(),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error,
      nowMs: () => now,
    });

    await loader.ensureLoaded(41);
    await loader.ensureLoaded(41);
    expect(loadRow).toHaveBeenCalledOnce();
    expect(incident).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'guild bank lazy load found no guild 41; bank remains inert',
    );

    now += GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS;
    await loader.ensureLoaded(41);
    expect(loadRow).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      label: 'oversized',
      result: { loaded: [], oversized: [52], malformed: [] },
      reason: 'oversized',
    },
    {
      label: 'malformed',
      result: { loaded: [], oversized: [], malformed: [52] },
      reason: 'malformed',
    },
    {
      label: 'unclassified',
      result: { loaded: [], oversized: [], malformed: [] },
      reason: 'missing after load',
    },
  ])(
    'reports an applied row that remains $label and releases its permit',
    async ({ result, reason }) => {
      const release = vi.fn();
      const incident = vi.fn();
      const error = vi.fn();
      const scheduler = fakeRetryScheduler();
      const loader = createGuildBankLazyLoader<TestRow>({
        hasLoaded: () => false,
        loadRow: async () => row(52),
        applyRows: () => result,
        tryAcquireImmediatePermit: () => ({ release }),
        scheduleRetry: scheduler.scheduleRetry,
        recordBookUnloadedIncident: incident,
        warn: vi.fn(),
        error,
        nowMs: () => 1,
      });

      await loader.ensureLoaded(52);

      expect(incident).toHaveBeenCalledTimes(reason === 'missing after load' ? 0 : 1);
      expect(scheduler.scheduleRetry).toHaveBeenCalledTimes(
        reason === 'missing after load' ? 1 : 0,
      );
      expect(error).toHaveBeenCalledWith(
        `guild bank 52 lazy load failed (${reason}); bank remains inert`,
      );
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it('self-heals an unclassified transient apply failure', async () => {
    let now = 0;
    let loaded = false;
    const scheduler = fakeRetryScheduler((delayMs) => {
      now += delayMs;
    });
    const incident = vi.fn();
    const loadRow = vi.fn(async () => row(53));
    const applyRows = vi
      .fn<() => GuildBankLazyLoadApplyResult>()
      .mockReturnValueOnce({ loaded: [], oversized: [], malformed: [] })
      .mockImplementation(() => {
        loaded = true;
        return loadedResult(53);
      });
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => loaded,
      loadRow,
      applyRows,
      scheduleRetry: scheduler.scheduleRetry,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(53);
    await scheduler.runNext();

    expect(loadRow).toHaveBeenCalledTimes(2);
    expect(applyRows).toHaveBeenCalledTimes(2);
    expect(scheduler.pending()).toHaveLength(0);
    expect(incident).not.toHaveBeenCalled();
  });

  it.each(['oversized', 'malformed'] as const)(
    'allows manual recovery after a repaired %s row without auto-looping',
    async (classification) => {
      let now = 0;
      let loaded = false;
      let repaired = false;
      const scheduler = fakeRetryScheduler();
      const incident = vi.fn();
      const loadRow = vi.fn(async () => row(54));
      const applyRows = vi.fn(() => {
        if (repaired) {
          loaded = true;
          return loadedResult(54);
        }
        return classification === 'oversized'
          ? { loaded: [], oversized: [54], malformed: [] }
          : { loaded: [], oversized: [], malformed: [54] };
      });
      const loader = createGuildBankLazyLoader<TestRow>({
        hasLoaded: () => loaded,
        loadRow,
        applyRows,
        scheduleRetry: scheduler.scheduleRetry,
        recordBookUnloadedIncident: incident,
        warn: vi.fn(),
        error: vi.fn(),
        nowMs: () => now,
      });

      await loader.ensureLoaded(54);
      expect(scheduler.scheduleRetry).not.toHaveBeenCalled();

      repaired = true;
      now = GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS;
      await loader.ensureLoaded(54);

      expect(loadRow).toHaveBeenCalledTimes(2);
      expect(applyRows).toHaveBeenCalledTimes(2);
      expect(scheduler.scheduleRetry).not.toHaveBeenCalled();
      expect(incident).toHaveBeenCalledOnce();
      expect(loaded).toBe(true);
    },
  );

  it('reports a thrown read, resolves fail-closed, and releases its permit', async () => {
    const failure = new Error('db down');
    const release = vi.fn();
    const incident = vi.fn();
    const error = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow: async () => {
        throw failure;
      },
      applyRows: vi.fn(),
      tryAcquireImmediatePermit: () => ({ release }),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: incident,
      warn: vi.fn(),
      error,
      nowMs: () => 1,
    });

    await expect(loader.ensureLoaded(61)).resolves.toBeUndefined();

    expect(incident).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'guild bank 61 lazy load failed; bank remains inert:',
      failure,
    );
    expect(release).toHaveBeenCalledOnce();
  });

  it('warns only for a non-oversized row above the soft byte threshold', async () => {
    const warn = vi.fn();
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow: async (guildId) =>
        row(guildId, {
          oversized: guildId === 73,
          dataBytes:
            guildId === 71
              ? GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES
              : GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES + 1,
        }),
      applyRows: (rows) => loadedResult(rows[0].guildId),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: vi.fn(),
      warn,
      error: vi.fn(),
      nowMs: () => 1,
    });

    await loader.ensureLoaded(71);
    await loader.ensureLoaded(72);
    await loader.ensureLoaded(73);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      `guild bank row for guild 72 is ${GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES + 1} bytes during lazy load (soft watch threshold ${GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES})`,
    );
  });

  it('clears an expired failure after a successful retry', async () => {
    let now = 0;
    const loadRow = vi
      .fn<(guildId: number) => Promise<TestRow | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(row(81));
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: () => loadedResult(81),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    await loader.ensureLoaded(81);
    now = GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS;
    await loader.ensureLoaded(81);
    await loader.ensureLoaded(81);

    expect(loadRow).toHaveBeenCalledTimes(3);
  });

  it('bounds failure memory without letting distinct guilds churn an unexpired memo', async () => {
    let now = 10;
    const loadRow = vi.fn(async () => null);
    const loader = createGuildBankLazyLoader<TestRow>({
      hasLoaded: () => false,
      loadRow,
      applyRows: vi.fn(),
      scheduleRetry: NO_RETRY_SCHEDULER,
      recordBookUnloadedIncident: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      nowMs: () => now,
    });

    for (let guildId = 1; guildId <= GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 1; guildId++) {
      await loader.ensureLoaded(guildId);
    }
    await loader.ensureLoaded(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 1);
    await loader.ensureLoaded(1);
    await loader.ensureLoaded(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 2);

    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 1);

    now += GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS;
    await loader.ensureLoaded(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 1);
    await loader.ensureLoaded(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 1);

    expect(loadRow).toHaveBeenCalledTimes(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 2);
    expect(loadRow).toHaveBeenLastCalledWith(GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX + 1);
  });
});
