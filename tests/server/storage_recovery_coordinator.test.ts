import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AMBIGUITY_HOLD_MAX_MS } from '../../server/storage_ladder_hold';
import {
  STORAGE_RECOVERY_BACKOFF_MS,
  STORAGE_RECOVERY_DRIVE_CONCURRENCY,
  STORAGE_RECOVERY_HORIZON_WARNING_MS,
  STORAGE_RECOVERY_MAX_TRACKED,
  STORAGE_RECOVERY_SCAN_CONCURRENCY,
  STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS,
  STORAGE_RECOVERY_START_BURST,
  STORAGE_RECOVERY_START_RATE_PER_SECOND,
  STORAGE_RECOVERY_TARGET_DRIVE_DRAIN_MS,
  STORAGE_RECOVERY_WARNING_WINDOW_MS,
  StorageRecoveryCoordinator,
  type StorageRecoveryScheduler,
  storageRecoveryRetryDelay,
} from '../../server/storage_recovery_coordinator';

interface Row {
  idempotencyKey: string;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeScheduler(random = 0) {
  let nowMs = 0;
  const timers: { delay: number; dueAt: number; run: () => void; cancelled: boolean }[] = [];
  const turns: (() => void)[] = [];
  const scheduler: StorageRecoveryScheduler = {
    schedule: (delay, run) => {
      const timer = { delay, dueAt: nowMs + delay, run, cancelled: false };
      timers.push(timer);
      return { cancel: () => (timer.cancelled = true) };
    },
    now: () => nowMs,
    random: () => random,
    yieldTurn: (run) => turns.push(run),
  };
  const fireNext = (): void => {
    const timer = timers
      .filter((candidate) => !candidate.cancelled)
      .sort((a, b) => a.dueAt - b.dueAt)[0];
    if (!timer) throw new Error('no live timer');
    timer.cancelled = true;
    nowMs = Math.max(nowMs, timer.dueAt);
    timer.run();
  };
  const yieldNext = (): void => {
    const run = turns.shift();
    if (!run) throw new Error('no yielded turn');
    run();
  };
  return {
    scheduler,
    timers,
    turns,
    fireNext,
    yieldNext,
    now: () => nowMs,
    setNow: (value: number) => {
      nowMs = value;
    },
  };
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('StorageRecoveryCoordinator', () => {
  it('pins the hard population and concurrency bounds', () => {
    expect(STORAGE_RECOVERY_MAX_TRACKED).toBe(200);
    expect(STORAGE_RECOVERY_SCAN_CONCURRENCY).toBe(2);
    expect(STORAGE_RECOVERY_DRIVE_CONCURRENCY).toBe(2);
    expect(STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS).toBe(5_000);
    expect(STORAGE_RECOVERY_TARGET_DRIVE_DRAIN_MS).toBe(500_000);
    expect(STORAGE_RECOVERY_HORIZON_WARNING_MS).toBe(600_000);
    expect(STORAGE_RECOVERY_HORIZON_WARNING_MS).toBe(AMBIGUITY_HOLD_MAX_MS);
    expect(STORAGE_RECOVERY_START_RATE_PER_SECOND).toBe(10);
    expect(STORAGE_RECOVERY_START_BURST).toBe(2);
    expect(STORAGE_RECOVERY_WARNING_WINDOW_MS).toBe(60_000);
    expect(STORAGE_RECOVERY_BACKOFF_MS).toEqual([2_000, 5_000, 15_000, 30_000, 60_000]);
  });

  it('coalesces duplicate kicks and admits no more than the tracked-key cap', () => {
    const scheduler = fakeScheduler();
    const never = new Promise<Row | null>(() => {});
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => never,
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    expect(coordinator.kick(1)).toBe(true);
    for (let n = 1; n < 20; n++) expect(coordinator.kick(1)).toBe(true);
    for (let n = 2; n <= STORAGE_RECOVERY_MAX_TRACKED; n++) {
      expect(coordinator.kick(n)).toBe(true);
    }
    expect(coordinator.kick(STORAGE_RECOVERY_MAX_TRACKED + 1)).toBe(false);
    expect(coordinator.metrics()).toMatchObject({
      tracked: STORAGE_RECOVERY_MAX_TRACKED,
      scanActive: STORAGE_RECOVERY_SCAN_CONCURRENCY,
      scanQueued: STORAGE_RECOVERY_MAX_TRACKED - STORAGE_RECOVERY_SCAN_CONCURRENCY,
      coalescedKicks: 19,
      capacityRefusals: 1,
    });
    coordinator.reset();
  });

  it('evicts the exact offline key in O(1), even behind a saturated live set', () => {
    const scheduler = fakeScheduler();
    const never = new Promise<Row | null>(() => {});
    const released: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => never,
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: (characterId) => released.push(characterId),
        canEvict: (characterId) => characterId <= STORAGE_RECOVERY_MAX_TRACKED,
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) {
      expect(coordinator.kick(id)).toBe(true);
    }
    coordinator.characterOffline(33);

    expect(coordinator.kick(STORAGE_RECOVERY_MAX_TRACKED + 1)).toBe(true);
    expect(coordinator.kick(STORAGE_RECOVERY_MAX_TRACKED + 1)).toBe(true);
    expect(coordinator.metrics()).toMatchObject({
      tracked: STORAGE_RECOVERY_MAX_TRACKED,
      capacityEvictions: 1,
      capacityEvictionProbes: 1,
      capacityRefusals: 0,
      coalescedKicks: 1,
    });
    expect(released).toEqual([33]);
    coordinator.reset();
  });

  it('does no candidate scan when saturation has no teardown-confirmed offline key', () => {
    const scheduler = fakeScheduler();
    const never = new Promise<Row | null>(() => {});
    const canEvict = vi.fn(() => false);
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => never,
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: vi.fn(),
        canEvict,
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) coordinator.kick(id);

    expect(coordinator.kick(STORAGE_RECOVERY_MAX_TRACKED + 1)).toBe(false);
    expect(canEvict).not.toHaveBeenCalled();
    expect(coordinator.metrics()).toMatchObject({
      tracked: STORAGE_RECOVERY_MAX_TRACKED,
      capacityRefusals: 1,
      capacityEvictions: 0,
      capacityEvictionProbes: 0,
    });
    coordinator.reset();
  });

  it('removes an offline entry from eviction eligibility when a newer kick marks it live', () => {
    const scheduler = fakeScheduler();
    const never = new Promise<Row | null>(() => {});
    const released: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => never,
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: (characterId) => released.push(characterId),
        canEvict: () => true,
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) coordinator.kick(id);
    coordinator.characterOffline(33);
    expect(coordinator.kick(33)).toBe(true);

    expect(coordinator.kick(STORAGE_RECOVERY_MAX_TRACKED + 1)).toBe(false);
    expect(released).toEqual([]);
    coordinator.reset();
  });

  it('keeps FIFO strong-reference storage bounded through more than twice-cap eviction churn', () => {
    const scheduler = fakeScheduler();
    const never = new Promise<Row | null>(() => {});
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => never,
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: vi.fn(),
        canEvict: () => true,
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) coordinator.kick(id);
    for (let offset = 0; offset < STORAGE_RECOVERY_MAX_TRACKED * 2 + 1; offset++) {
      const victim = 3 + offset;
      const replacement = STORAGE_RECOVERY_MAX_TRACKED + 1 + offset;
      coordinator.characterOffline(victim);
      expect(coordinator.kick(replacement)).toBe(true);
    }
    expect(coordinator.metrics()).toMatchObject({
      tracked: STORAGE_RECOVERY_MAX_TRACKED,
      capacityEvictions: STORAGE_RECOVERY_MAX_TRACKED * 2 + 1,
      queuedStorage: STORAGE_RECOVERY_MAX_TRACKED - STORAGE_RECOVERY_SCAN_CONCURRENCY,
    });
    coordinator.reset();
  });

  it('aggregates repeated recovery warnings by fixed failure kind and reports suppression', () => {
    const scheduler = fakeScheduler();
    const warn = vi.fn();
    const never = new Promise<Row | null>(() => {});
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => never,
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn,
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) coordinator.kick(id);
    for (let id = 1; id <= 100; id++) {
      expect(coordinator.kick(STORAGE_RECOVERY_MAX_TRACKED + id)).toBe(false);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(coordinator.metrics()).toMatchObject({
      warningsEmitted: 1,
      warningsSuppressed: 99,
    });

    scheduler.setNow(STORAGE_RECOVERY_WARNING_WINDOW_MS);
    expect(coordinator.kick(STORAGE_RECOVERY_MAX_TRACKED + 101)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toContain('99 similar failures suppressed');
    coordinator.reset();
  });

  it('aggregates host-construction failures without allocating per-key state', () => {
    const scheduler = fakeScheduler();
    const warn = vi.fn();
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async () => null,
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn,
      },
      scheduler.scheduler,
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      coordinator.reportHostFailure(new Error('runtime unavailable'));
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(coordinator.metrics()).toMatchObject({
      tracked: 0,
      warningsEmitted: 1,
      warningsSuppressed: 99,
    });
  });

  it('rate-limits a capped fast-drive burst after two immediate starts', async () => {
    const scheduler = fakeScheduler();
    const startedAt: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async (characterId) => ({ idempotencyKey: `k${characterId}` }),
        reserve: () => true,
        drive: async () => {
          startedAt.push(scheduler.now());
          return 'stop';
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) coordinator.kick(id);
    await vi.waitFor(() => {
      expect(coordinator.metrics().scansStarted).toBe(STORAGE_RECOVERY_MAX_TRACKED);
    });

    expect(startedAt.filter((time) => time === 0)).toHaveLength(2);
    expect(coordinator.metrics()).toMatchObject({
      rateLimitedQueued: STORAGE_RECOVERY_MAX_TRACKED - 2,
      startRateGateTimers: 1,
    });
    for (let count = 0; count < 10; count++) {
      scheduler.fireNext();
      await tick();
    }
    expect(startedAt.filter((time) => time > 0 && time <= 1_000)).toHaveLength(10);
    expect(startedAt).toHaveLength(12);
    coordinator.reset();
  });

  it('models 200 target-duration drive stages within the scheduler capacity target', async () => {
    const scheduler = fakeScheduler();
    const startedAt: number[] = [];
    const finishedAt: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async (characterId) => ({ idempotencyKey: `k${characterId}` }),
        reserve: () => true,
        drive: (_characterId) => {
          startedAt.push(scheduler.now());
          return new Promise<'stop'>((resolve) => {
            scheduler.scheduler.schedule(STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS, () => {
              finishedAt.push(scheduler.now());
              resolve('stop');
            });
          });
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) coordinator.kick(id);
    await vi.waitFor(() => {
      expect(coordinator.metrics().scansStarted).toBe(STORAGE_RECOVERY_MAX_TRACKED);
      expect(startedAt).toHaveLength(STORAGE_RECOVERY_DRIVE_CONCURRENCY);
    });

    for (let completed = 0; completed < STORAGE_RECOVERY_MAX_TRACKED; completed++) {
      scheduler.fireNext();
      await tick();
    }

    expect(startedAt).toHaveLength(STORAGE_RECOVERY_MAX_TRACKED);
    expect(finishedAt).toHaveLength(STORAGE_RECOVERY_MAX_TRACKED);
    expect(Math.max(...startedAt)).toBeLessThanOrEqual(
      STORAGE_RECOVERY_TARGET_DRIVE_DRAIN_MS - STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS,
    );
    expect(Math.max(...finishedAt)).toBeLessThanOrEqual(STORAGE_RECOVERY_TARGET_DRIVE_DRAIN_MS);
    expect(coordinator.metrics()).toMatchObject({
      tracked: 0,
      horizonBreached: false,
      horizonBreaches: 0,
    });
  });

  it('models the healthy done-yield-rescan path inside its scheduler target', async () => {
    const scheduler = fakeScheduler();
    const warn = vi.fn();
    // The scan occupancy is DERIVED from the real constants, never invented:
    // each key costs two scans across SCAN_CONCURRENCY lanes against one
    // SLOT_OCCUPANCY_TARGET drive across DRIVE_CONCURRENCY lanes, so the scan
    // side breaks even with the drive drain at TARGET * SCAN/(2*DRIVE).
    // Half that share keeps drives the binding term, and retuning any of the
    // constants moves the fixture and the assertions together.
    const scanOccupancyMs =
      (STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS * STORAGE_RECOVERY_SCAN_CONCURRENCY) /
      (2 * STORAGE_RECOVERY_DRIVE_CONCURRENCY) /
      2;
    // Outside the drive drain, the only normal-path time is the pipeline's
    // two scan ends (the first adoption scan and the last confirming rescan).
    const normalPathBudgetMs = STORAGE_RECOVERY_TARGET_DRIVE_DRAIN_MS + scanOccupancyMs * 2;
    // The horizon relation itself, in constants: the derived normal-path
    // ceiling must clear the warning horizon, or a healthy walk would warn.
    expect(normalPathBudgetMs).toBeLessThan(STORAGE_RECOVERY_HORIZON_WARNING_MS);
    const scansByCharacter = new Map<number, number>();
    let drivesFinished = 0;
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: (characterId) =>
          new Promise<Row | null>((resolve) => {
            scheduler.scheduler.schedule(scanOccupancyMs, () => {
              const scanNumber = (scansByCharacter.get(characterId) ?? 0) + 1;
              scansByCharacter.set(characterId, scanNumber);
              resolve(scanNumber === 1 ? { idempotencyKey: `k${characterId}` } : null);
            });
          }),
        reserve: () => true,
        drive: () =>
          new Promise<'done'>((resolve) => {
            scheduler.scheduler.schedule(STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS, () => {
              drivesFinished++;
              resolve('done');
            });
          }),
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn,
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= STORAGE_RECOVERY_MAX_TRACKED; id++) coordinator.kick(id);

    for (
      let operations = 0;
      coordinator.metrics().tracked > 0 && operations < 1_000;
      operations++
    ) {
      scheduler.fireNext();
      await tick();
      while (scheduler.turns.length > 0) {
        scheduler.yieldNext();
        await tick();
      }
    }

    expect(drivesFinished).toBe(STORAGE_RECOVERY_MAX_TRACKED);
    expect([...scansByCharacter.values()]).toHaveLength(STORAGE_RECOVERY_MAX_TRACKED);
    expect([...scansByCharacter.values()].every((count) => count === 2)).toBe(true);
    expect(coordinator.metrics()).toMatchObject({ tracked: 0, horizonBreached: false });
    expect(scheduler.now()).toBeLessThanOrEqual(normalPathBudgetMs);
    // This proves the coordinator arithmetic under injected target-duration
    // hooks. It is intentionally not a production latency or money-safety
    // proof; live DB/save deadlines can exceed those fake occupancies.
    expect(scheduler.now()).toBeLessThan(STORAGE_RECOVERY_HORIZON_WARNING_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports 5001ms slot occupancy and warns at 600s without a metrics scrape', async () => {
    const scheduler = fakeScheduler();
    const warn = vi.fn();
    let driveSignal: AbortSignal | undefined;
    const never = new Promise<'stop'>(() => {});
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async () => ({ idempotencyKey: 'slow' }),
        reserve: () => true,
        drive: (_characterId, _row, _isCurrent, signal) => {
          driveSignal = signal;
          return never;
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn,
      },
      scheduler.scheduler,
    );
    coordinator.kick(1);
    await vi.waitFor(() => expect(coordinator.metrics().driveActive).toBe(1));

    scheduler.setNow(STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS + 1);
    expect(coordinator.metrics()).toMatchObject({
      activePastSlotTarget: 1,
      horizonBreached: false,
      oldestActiveAgeMs: STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS + 1,
      oldestTrackedAgeMs: STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS + 1,
    });

    scheduler.fireNext();
    expect(scheduler.now()).toBe(STORAGE_RECOVERY_HORIZON_WARNING_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('horizon breached');
    expect(coordinator.metrics()).toMatchObject({
      horizonBreached: true,
      horizonBreaches: 1,
      oldestTrackedAgeMs: STORAGE_RECOVERY_HORIZON_WARNING_MS,
    });
    coordinator.metrics();
    expect(warn).toHaveBeenCalledTimes(1);
    coordinator.reset();
    expect(driveSignal?.aborted).toBe(true);
  });

  it('starts a failed-scan retry while both drive slots are saturated', async () => {
    const scheduler = fakeScheduler();
    const driveGates = [deferred<'stop'>(), deferred<'stop'>()];
    let retryScans = 0;
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async (characterId) => {
          if (characterId === 3) {
            retryScans++;
            if (retryScans === 1) throw new Error('pool unavailable');
            return null;
          }
          return { idempotencyKey: `k${characterId}` };
        },
        reserve: () => true,
        drive: async (characterId) => driveGates[characterId - 1].promise,
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(1);
    coordinator.kick(2);
    await vi.waitFor(() => expect(coordinator.metrics().driveActive).toBe(2));
    coordinator.kick(3);
    await vi.waitFor(() => expect(coordinator.metrics().retryTimers).toBe(1));

    scheduler.fireNext();
    await tick();
    expect(retryScans).toBe(2);
    expect(coordinator.metrics().driveActive).toBe(2);
    coordinator.reset();
  });

  it('starts a queued drive while both scan slots are saturated', async () => {
    const scheduler = fakeScheduler();
    const scanGate = deferred<Row | null>();
    const drives: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => scanGate.promise,
        reserve: () => true,
        drive: async (characterId) => {
          drives.push(characterId);
          return 'stop';
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(1);
    coordinator.kick(2);
    expect(coordinator.metrics().scanActive).toBe(2);
    expect(coordinator.defer(3, { idempotencyKey: 'known-row' })).toBe(true);

    scheduler.fireNext();
    await tick();
    expect(drives).toEqual([3]);
    expect(coordinator.metrics().scanActive).toBe(2);
    coordinator.reset();
  });

  it('recovers token refill immediately after an injected clock regression', async () => {
    const scheduler = fakeScheduler();
    const startedAt: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async (characterId) => ({ idempotencyKey: `k${characterId}` }),
        reserve: () => true,
        drive: async () => {
          startedAt.push(scheduler.now());
          return 'stop';
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(1);
    coordinator.kick(2);
    coordinator.kick(3);
    await vi.waitFor(() => expect(startedAt).toHaveLength(2));

    scheduler.setNow(-1_000);
    coordinator.kick(4);
    await tick();
    expect(startedAt).toHaveLength(2);
    scheduler.setNow(-900);
    coordinator.kick(5);
    await vi.waitFor(() => expect(startedAt).toHaveLength(3));
    coordinator.reset();
  });

  it('uses an indexed queue rather than quadratic Array.shift under the cap burst', () => {
    const source = readFileSync(
      new URL('../../server/storage_recovery_coordinator.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('.shift()');
    expect(source).toContain('this.dequeueScan()');
    expect(source).toContain('this.dequeueRateLimited(kind)');
  });

  it('reports only the live suffix after indexed dequeue advances', async () => {
    const scheduler = fakeScheduler();
    const gates = new Map<number, ReturnType<typeof deferred<Row | null>>>();
    const started: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: (characterId) => {
          started.push(characterId);
          const gate = deferred<Row | null>();
          gates.set(characterId, gate);
          return gate.promise;
        },
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= 5; id++) coordinator.kick(id);
    expect(coordinator.metrics()).toMatchObject({ scanActive: 2, scanQueued: 3 });

    const first = gates.get(1);
    if (!first) throw new Error('first scan did not start');
    first.resolve(null);
    await tick();
    expect(started).toEqual([1, 2, 3]);
    // Entries 1, 2, and 3 remain in the backing array's consumed prefix, but
    // only characters 4 and 5 are queued work an operator should see.
    expect(coordinator.metrics()).toMatchObject({ scanActive: 2, scanQueued: 2 });
    coordinator.reset();
  });

  it('runs at most two scans and two drives while preserving every admitted key', async () => {
    const scheduler = fakeScheduler();
    const scanGates: ReturnType<typeof deferred<Row | null>>[] = [];
    const driveGates: ReturnType<typeof deferred<'done'>>[] = [];
    const startedScans: number[] = [];
    const startedDrives: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: (characterId) => {
          startedScans.push(characterId);
          const gate = deferred<Row | null>();
          scanGates.push(gate);
          return gate.promise;
        },
        reserve: () => true,
        drive: (characterId) => {
          startedDrives.push(characterId);
          const gate = deferred<'done'>();
          driveGates.push(gate);
          return gate.promise;
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= 7; id++) coordinator.kick(id);
    expect(startedScans).toEqual([1, 2]);
    scanGates[0].resolve({ idempotencyKey: 'k1' });
    scanGates[1].resolve({ idempotencyKey: 'k2' });
    await tick();
    expect(startedDrives).toEqual([1, 2]);
    expect(coordinator.metrics()).toMatchObject({ scanActive: 2, driveActive: 2 });

    driveGates[0].resolve('done');
    driveGates[1].resolve('done');
    await tick();
    expect(scheduler.turns).toHaveLength(2);
    scheduler.yieldNext();
    scheduler.yieldNext();
    await tick();
    expect(Math.max(coordinator.metrics().scanActive, 0)).toBeLessThanOrEqual(2);
    expect(Math.max(coordinator.metrics().driveActive, 0)).toBeLessThanOrEqual(2);
    coordinator.reset();
  });

  it('processes one row per turn and reserves it before drive starts', async () => {
    const scheduler = fakeScheduler();
    const events: string[] = [];
    const rows: (Row | null)[] = [{ idempotencyKey: 'a' }, { idempotencyKey: 'b' }, null];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async () => rows.shift() ?? null,
        reserve: (_characterId, row) => {
          events.push(`reserve:${row.idempotencyKey}`);
          return true;
        },
        drive: async (_characterId, row) => {
          events.push(`drive:${row.idempotencyKey}`);
          return 'done';
        },
        prepareScan: (_characterId, row) => events.push(`rescan:${row?.idempotencyKey}`),
        release: (_characterId, row) => events.push(`release:${row?.idempotencyKey ?? 'scan'}`),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(7);
    await tick();
    expect(events).toEqual(['reserve:a', 'drive:a', 'rescan:a']);
    expect(scheduler.turns).toHaveLength(1);
    scheduler.yieldNext();
    await tick();
    expect(events).toEqual([
      'reserve:a',
      'drive:a',
      'rescan:a',
      'reserve:b',
      'drive:b',
      'rescan:b',
    ]);
    scheduler.yieldNext();
    await tick();
    expect(events.at(-1)).toBe('release:scan');
    expect(coordinator.metrics().tracked).toBe(0);
  });

  it('the default scheduler crosses a macrotask boundary between rows', async () => {
    let scans = 0;
    const coordinator = new StorageRecoveryCoordinator<Row>({
      scan: async () => (++scans === 1 ? { idempotencyKey: 'first' } : null),
      reserve: () => true,
      drive: async () => 'done',
      prepareScan: vi.fn(),
      release: vi.fn(),
      warn: vi.fn(),
    });
    coordinator.kick(12);
    await tick();
    expect(scans).toBe(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await tick();
    expect(scans).toBe(2);
    coordinator.reset();
  });

  it('a known-row defer racing an older empty scan demands a follow-up and returns unadopted', async () => {
    const scheduler = fakeScheduler();
    const firstScan = deferred<Row | null>();
    let scans = 0;
    const driven: string[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => {
          scans++;
          return scans === 1
            ? firstScan.promise
            : Promise.resolve({ idempotencyKey: 'inserted-after-snapshot' });
        },
        reserve: () => true,
        drive: async (_characterId, row) => {
          driven.push(row.idempotencyKey);
          return 'stop';
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    expect(coordinator.kick(13)).toBe(true);
    expect(coordinator.defer(13, { idempotencyKey: 'inserted-after-snapshot' })).toBe(false);
    firstScan.resolve(null);
    await tick();
    expect(scheduler.turns).toHaveLength(1);
    scheduler.yieldNext();
    await tick();
    expect(scans).toBe(2);
    expect(driven).toEqual(['inserted-after-snapshot']);
    expect(coordinator.metrics().tracked).toBe(0);
  });

  it('a coalesced kick racing an older empty scan demands one follow-up scan', async () => {
    const scheduler = fakeScheduler();
    const firstScan = deferred<Row | null>();
    let scans = 0;
    const driven: string[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => {
          scans++;
          return scans === 1
            ? firstScan.promise
            : Promise.resolve({ idempotencyKey: 'inserted-after-snapshot' });
        },
        reserve: () => true,
        drive: async (_characterId, row) => {
          driven.push(row.idempotencyKey);
          return 'stop';
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    expect(coordinator.kick(14)).toBe(true);
    expect(coordinator.kick(14)).toBe(true);
    firstScan.resolve(null);
    await tick();
    expect(scheduler.turns).toHaveLength(1);
    scheduler.yieldNext();
    await tick();
    expect(scans).toBe(2);
    expect(driven).toEqual(['inserted-after-snapshot']);
    expect(coordinator.metrics().tracked).toBe(0);
  });

  it('uses one equal-jitter timer per key across the capped backoff ladder', async () => {
    const scheduler = fakeScheduler(0.5);
    const attempts: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async () => ({ idempotencyKey: 'retry-me' }),
        reserve: () => true,
        drive: async () => {
          attempts.push(attempts.length);
          return 'retry';
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(9);
    await tick();
    for (let attempt = 0; attempt < 7; attempt++) {
      const base = STORAGE_RECOVERY_BACKOFF_MS[Math.min(attempt, 4)];
      const maxBackoffMs = STORAGE_RECOVERY_BACKOFF_MS.at(-1) ?? 0;
      const live = scheduler.timers.filter(
        (timer) => !timer.cancelled && timer.delay <= maxBackoffMs,
      );
      expect(live).toHaveLength(1);
      expect(live[0].delay).toBe(storageRecoveryRetryDelay(base, 0.5));
      scheduler.fireNext();
      await tick();
    }
    expect(attempts).toHaveLength(8);
    coordinator.reset();
  });

  it('walks the drive-retry ladder through the pinned literals to its clamped cap', async () => {
    // random = 1 puts equal jitter at its ceiling, so each scheduled delay is
    // exactly its ladder base: the walk pins the LITERALS, not a derivation.
    const scheduler = fakeScheduler(1);
    const delays: number[] = [];
    let drives = 0;
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async () => ({ idempotencyKey: 'retry-me' }),
        reserve: () => true,
        drive: async () => {
          drives++;
          return 'retry';
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(9);
    await tick();
    const maxBackoffMs = STORAGE_RECOVERY_BACKOFF_MS.at(-1) ?? 0;
    for (let attempt = 0; attempt < 7; attempt++) {
      const live = scheduler.timers.filter(
        (timer) => !timer.cancelled && timer.delay <= maxBackoffMs,
      );
      expect(live).toHaveLength(1);
      delays.push(live[0].delay);
      scheduler.fireNext();
      await tick();
    }
    expect(delays).toEqual([2_000, 5_000, 15_000, 30_000, 60_000, 60_000, 60_000]);
    expect(drives).toBe(8);
    // Every one of the eight 'retry' results scheduled a rung; the walk above
    // fired the first seven, and the eighth is standing when metrics is read.
    expect(coordinator.metrics().retriesScheduled).toBe(8);
    coordinator.reset();
  });

  it('holds a reserve() refusal on the retry ladder without rescanning until admitted', async () => {
    const scheduler = fakeScheduler(1);
    const reserveAnswers = [false, false, true];
    let scans = 0;
    let rescanRow: Row | null | undefined;
    const driveStarts: number[] = [];
    const prepareScan = vi.fn((_characterId: number, previousRow: Row | null) => {
      rescanRow = previousRow;
    });
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async () => {
          scans++;
          return scans === 1 ? { idempotencyKey: 'held-row' } : null;
        },
        reserve: () => reserveAnswers.shift() ?? true,
        drive: async () => {
          driveStarts.push(scheduler.now());
          return 'done';
        },
        prepareScan,
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(5);
    await tick();

    // The refused reservation consumed no drive slot and no fresh scan: the
    // known row waits on the ladder's FIRST rung (2s base, jitter ceiling).
    expect(scans).toBe(1);
    expect(driveStarts).toEqual([]);
    expect(coordinator.metrics()).toMatchObject({ retriesScheduled: 1, driveActive: 0 });
    const maxBackoffMs = STORAGE_RECOVERY_BACKOFF_MS.at(-1) ?? 0;
    const rung = (): number => {
      const live = scheduler.timers.filter(
        (timer) => !timer.cancelled && timer.delay <= maxBackoffMs,
      );
      expect(live).toHaveLength(1);
      return live[0].delay;
    };
    expect(rung()).toBe(2_000);

    // A second refusal climbs the SAME ladder a drive retry uses, still
    // holding the row: no rescan may replace a refused-but-reserved key.
    scheduler.fireNext();
    await tick();
    expect(scans).toBe(1);
    expect(driveStarts).toEqual([]);
    expect(coordinator.metrics().retriesScheduled).toBe(2);
    expect(rung()).toBe(5_000);

    // Admission on the third answer starts the drive with the HELD row and
    // no third scan; the confirming rescan after 'done' releases the key.
    scheduler.fireNext();
    await tick();
    expect(driveStarts).toHaveLength(1);
    expect(scans).toBe(1);
    expect(prepareScan).toHaveBeenCalledWith(5, { idempotencyKey: 'held-row' });
    expect(rescanRow).toEqual({ idempotencyKey: 'held-row' });
    scheduler.yieldNext();
    await tick();
    expect(scans).toBe(2);
    expect(coordinator.metrics().tracked).toBe(0);
  });

  it('cancels queued and timed work on stop, then drains active work', async () => {
    const scheduler = fakeScheduler();
    const activeScan = deferred<Row | null>();
    const releases: string[] = [];
    let scans = 0;
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: () => {
          scans++;
          return activeScan.promise;
        },
        reserve: () => true,
        drive: async () => 'done',
        prepareScan: vi.fn(),
        release: (characterId) => releases.push(String(characterId)),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(1);
    coordinator.kick(2);
    coordinator.kick(3);
    expect(scans).toBe(2);
    let stopped = false;
    const stopping = coordinator.stop().then(() => {
      stopped = true;
    });
    await tick();
    expect(stopped).toBe(false);
    expect(releases).toContain('3');
    activeScan.resolve(null);
    // Both active calls share the same promise in this fixture.
    await stopping;
    expect(stopped).toBe(true);
    expect(coordinator.kick(4)).toBe(false);
    expect(coordinator.metrics().tracked).toBe(0);
  });

  it('aborts active scan and drive hooks before stop waits for their settlement', async () => {
    const scheduler = fakeScheduler();
    const signals: { drive?: AbortSignal; scan?: AbortSignal } = {};
    const abortable = <T>(signal: AbortSignal) =>
      new Promise<T>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: (characterId, signal) => {
          if (characterId === 1) return Promise.resolve({ idempotencyKey: 'drive' });
          signals.scan = signal;
          return abortable<Row | null>(signal);
        },
        reserve: () => true,
        drive: (_characterId, _row, _isCurrent, signal) => {
          signals.drive = signal;
          return abortable<'stop'>(signal);
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(1);
    coordinator.kick(2);
    await vi.waitFor(() => {
      expect(coordinator.metrics()).toMatchObject({ scanActive: 1, driveActive: 1 });
    });

    let settled = false;
    const stopping = coordinator.stop().then(() => {
      settled = true;
    });
    expect(signals.scan?.aborted).toBe(true);
    expect(signals.drive?.aborted).toBe(true);
    expect(settled).toBe(false);
    await stopping;
    expect(settled).toBe(true);
    expect(coordinator.metrics()).toMatchObject({ scanActive: 0, driveActive: 0, tracked: 0 });
  });

  it('aborts active hooks during test reset and ignores their stale completions', async () => {
    const scheduler = fakeScheduler();
    let scanSignal: AbortSignal | undefined;
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: (_characterId, signal) => {
          scanSignal = signal;
          return new Promise<Row | null>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        },
        reserve: () => true,
        drive: async () => 'stop',
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    coordinator.kick(1);
    expect(coordinator.metrics().scanActive).toBe(1);

    coordinator.reset();
    expect(scanSignal?.aborted).toBe(true);
    expect(coordinator.metrics()).toMatchObject({ scanActive: 0, tracked: 0 });
    await tick();
    expect(coordinator.metrics()).toMatchObject({ scanActive: 0, tracked: 0 });
  });

  it('a stopped queued drive never starts and its current guard turns false', async () => {
    const scheduler = fakeScheduler();
    const firstDrive = deferred<'stop'>();
    const guards: (() => boolean)[] = [];
    const started: number[] = [];
    const coordinator = new StorageRecoveryCoordinator<Row>(
      {
        scan: async (characterId) => ({ idempotencyKey: `k${characterId}` }),
        reserve: () => true,
        drive: (characterId, _row, isCurrent) => {
          started.push(characterId);
          guards.push(isCurrent);
          return firstDrive.promise;
        },
        prepareScan: vi.fn(),
        release: vi.fn(),
        warn: vi.fn(),
      },
      scheduler.scheduler,
    );
    for (let id = 1; id <= 4; id++) coordinator.kick(id);
    await tick();
    expect(started).toEqual([1, 2]);
    expect(guards.every((guard) => guard())).toBe(true);
    const stopping = coordinator.stop();
    expect(guards.every((guard) => !guard())).toBe(true);
    expect(started).toEqual([1, 2]);
    firstDrive.resolve('stop');
    await stopping;
    expect(started).toEqual([1, 2]);
  });
});
