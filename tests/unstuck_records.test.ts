import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({ pool: { query: vi.fn() } }));

import { GameServer } from '../server/game';
import { REALM } from '../server/realm';
import type { InsertUnstuckReportInput } from '../server/unstuck_db';
import {
  recordUnstuckEvent,
  resetUnstuckRecordsForTests,
  setUnstuckRecordsDepsForTests,
  stopUnstuckRecords,
  UNSTUCK_RECORD_MAX_ATTEMPTS,
  UNSTUCK_RECORD_MAX_PENDING,
  UNSTUCK_RECORD_OVERFLOW_WARN_INTERVAL_MS,
  UNSTUCK_RECORD_RETRY_DELAYS_MS,
  UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS,
  type UnstuckRecordIdentity,
  unstuckRecordsIdle,
} from '../server/unstuck_records';
import type { SimEvent, UnstuckEvent } from '../src/sim/types';

const identity: UnstuckRecordIdentity = {
  realm: 'alpha',
  accountId: 7,
  characterId: 42,
};
const nowMs = Date.parse('2026-07-14T10:00:00.000Z');
const attemptId = '018f7c30-6ea8-7c9f-8123-456789abcdef';
const insert = vi.fn(async (_input: InsertUnstuckReportInput) => {});

function codedError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function completedEvent(): Extract<UnstuckEvent, { phase: 'completed' }> & { pid?: number } {
  return {
    type: 'unstuck',
    phase: 'completed',
    reason: 'nearest_safe_position',
    area: { kind: 'dungeon', id: 'hollow_crypt', instanceId: 'run_17', slot: 3 },
    origin: { x: 101, y: 12, z: -55, localX: 21, localZ: 15 },
    destination: { x: 106, y: 13, z: -50, localX: 26, localZ: 20 },
    duration: 10,
    distance: Math.sqrt(50),
    pid: 99,
  };
}

beforeEach(async () => {
  await unstuckRecordsIdle();
  resetUnstuckRecordsForTests();
  insert.mockReset();
  insert.mockImplementation(async () => {});
  setUnstuckRecordsDepsForTests({ attemptId: () => attemptId, insert, now: () => nowMs });
});

afterEach(async () => {
  await unstuckRecordsIdle();
  resetUnstuckRecordsForTests();
  vi.restoreAllMocks();
});

describe('recordUnstuckEvent filtering and mapping', () => {
  it('ignores unrelated, started, countdown, and blocked events', async () => {
    const ignored: SimEvent[] = [
      { type: 'respawn', pid: 99 },
      { type: 'unstuck', phase: 'started', seconds: 10, pid: 99 },
      { type: 'unstuck', phase: 'countdown', seconds: 5, pid: 99 },
      { type: 'unstuck', phase: 'blocked', reason: 'cooldown', seconds: 60, pid: 99 },
    ];
    for (const event of ignored) recordUnstuckEvent(identity, event);
    await unstuckRecordsIdle();
    expect(insert).not.toHaveBeenCalled();
  });

  it('maps and snapshots a completed nested event into the flat DB input', async () => {
    const who = { ...identity };
    const event = completedEvent();
    expect(recordUnstuckEvent(who, event)).toBeUndefined();

    // Mutating caller-owned objects before the promise runs cannot alter the row.
    who.realm = 'mutated';
    who.accountId = 999;
    event.area.id = 'mutated';
    event.origin.x = 999;
    event.destination.localZ = 999;
    event.reason = 'nearest_safe_position';

    await unstuckRecordsIdle();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      attemptId,
      realm: 'alpha',
      accountId: 7,
      characterId: 42,
      areaKind: 'dungeon',
      areaId: 'hollow_crypt',
      instanceId: 'run_17',
      instanceSlot: 3,
      originRawX: 101,
      originRawY: 12,
      originRawZ: -55,
      originLocalX: 21,
      originLocalY: 12,
      originLocalZ: 15,
      destinationRawX: 106,
      destinationRawY: 13,
      destinationRawZ: -50,
      destinationLocalX: 26,
      destinationLocalY: 13,
      destinationLocalZ: 20,
      outcome: 'completed',
      reason: 'nearest_safe_position',
      invokedAt: new Date('2026-07-14T09:59:50.000Z'),
      resolvedAt: new Date('2026-07-14T10:00:00.000Z'),
    });
    const saved = insert.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(saved).not.toHaveProperty('pid');
    expect(saved).not.toHaveProperty('distance');
    expect(saved).not.toHaveProperty('name');
    expect(saved).not.toHaveProperty('ip');
    expect(saved).not.toHaveProperty('userAgent');
  });

  it('maps cancelled and failed attempts with complete null destinations and nullable identity', async () => {
    const cancelled: SimEvent = {
      type: 'unstuck',
      phase: 'cancelled',
      reason: 'damaged',
      area: { kind: 'overworld', id: 'eastbrook_vale' },
      origin: { x: 5, y: 1, z: 10, localX: 5, localZ: 10 },
      duration: 3,
      pid: 1,
    };
    const failed: SimEvent = {
      type: 'unstuck',
      phase: 'failed',
      reason: 'no_safe_position',
      area: { kind: 'delve', id: 'sunken_archive', instanceId: 'seed:8', slot: 2 },
      origin: { x: 20, y: 2, z: 30, localX: 4, localZ: 6 },
      duration: 10,
      pid: 2,
    };
    recordUnstuckEvent({ realm: 'beta', accountId: null, characterId: null }, cancelled);
    recordUnstuckEvent(identity, failed);
    await unstuckRecordsIdle();

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toMatchObject({
      realm: 'beta',
      accountId: null,
      characterId: null,
      areaKind: 'overworld',
      instanceId: null,
      instanceSlot: null,
      outcome: 'cancelled',
      reason: 'damaged',
      invokedAt: new Date('2026-07-14T09:59:57.000Z'),
      destinationRawX: null,
      destinationRawY: null,
      destinationRawZ: null,
      destinationLocalX: null,
      destinationLocalY: null,
      destinationLocalZ: null,
    });
    expect(insert.mock.calls[1][0]).toMatchObject({
      outcome: 'failed',
      reason: 'no_safe_position',
      areaKind: 'delve',
      areaId: 'sunken_archive',
      instanceId: 'seed:8',
      instanceSlot: 2,
      invokedAt: new Date('2026-07-14T09:59:50.000Z'),
    });
  });
});

describe('GameServer unstuck observer wiring', () => {
  it('attaches trusted live-session identity to terminal sim events only', async () => {
    const server = Object.create(GameServer.prototype) as GameServer;
    Object.assign(server, {
      clients: new Map([[99, { accountId: 7, characterId: 42 }]]),
    });
    const detectActivity = (
      server as unknown as { detectActivity(events: SimEvent[]): void }
    ).detectActivity.bind(server);

    detectActivity([completedEvent()]);
    detectActivity([
      {
        type: 'unstuck',
        phase: 'cancelled',
        reason: 'moved',
        area: { kind: 'overworld', id: 'eastbrook_vale' },
        origin: { x: 1, y: 2, z: 3, localX: 1, localZ: 3 },
        duration: 1,
        pid: 404,
      },
    ]);
    await unstuckRecordsIdle();

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      realm: REALM,
      accountId: 7,
      characterId: 42,
      outcome: 'completed',
    });
  });
});

describe('recordUnstuckEvent queue isolation', () => {
  it('preserves FIFO order and keeps the idle hook pending until the first write resolves', async () => {
    const order: string[] = [];
    let releaseFirst: () => void = () => {};
    insert
      .mockImplementationOnce(async (input) => {
        order.push(`start:${input.reason}`);
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push(`end:${input.reason}`);
      })
      .mockImplementationOnce(async (input) => {
        order.push(`start:${input.reason}`);
        order.push(`end:${input.reason}`);
      });
    const first = completedEvent();
    const second: SimEvent = {
      type: 'unstuck',
      phase: 'cancelled',
      reason: 'moved',
      area: { kind: 'overworld', id: 'eastbrook_vale' },
      origin: { x: 1, y: 2, z: 3, localX: 1, localZ: 3 },
      duration: 1,
    };
    recordUnstuckEvent(identity, first);
    recordUnstuckEvent(identity, second);
    let idle = false;
    const drain = unstuckRecordsIdle().then(() => {
      idle = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['start:nearest_safe_position']);
    expect(idle).toBe(false);
    releaseFirst();
    await drain;
    expect(order).toEqual([
      'start:nearest_safe_position',
      'end:nearest_safe_position',
      'start:moved',
      'end:moved',
    ]);
  });

  it('retries clearly transient failures twice, then succeeds within the same FIFO item', async () => {
    const delay = vi.fn(async (_ms: number) => {});
    const nextAttemptId = vi.fn(() => attemptId);
    setUnstuckRecordsDepsForTests({ attemptId: nextAttemptId, insert, delay, now: () => nowMs });
    insert
      .mockRejectedValueOnce(new Error('Query read timeout'))
      .mockRejectedValueOnce(codedError('40001', 'serialization failure'))
      .mockResolvedValueOnce(undefined);

    recordUnstuckEvent(identity, completedEvent());
    await unstuckRecordsIdle();

    expect(UNSTUCK_RECORD_MAX_ATTEMPTS).toBe(3);
    expect(insert).toHaveBeenCalledTimes(3);
    expect(nextAttemptId).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].attemptId).toBe(attemptId);
    expect(insert.mock.calls[1][0]).toBe(insert.mock.calls[0][0]);
    expect(insert.mock.calls[2][0]).toBe(insert.mock.calls[0][0]);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([...UNSTUCK_RECORD_RETRY_DELAYS_MS]);
  });

  it.each(['08006', '40001', '53300', '57P01', '57P02', '57P03', 'ECONNRESET', 'ETIMEDOUT'])(
    'retries the transient database or network code %s',
    async (code) => {
      const delay = vi.fn(async (_ms: number) => {});
      setUnstuckRecordsDepsForTests({ insert, delay, now: () => nowMs });
      insert.mockRejectedValueOnce(codedError(code)).mockResolvedValueOnce(undefined);

      recordUnstuckEvent(identity, completedEvent());
      await unstuckRecordsIdle();

      expect(insert).toHaveBeenCalledTimes(2);
      expect(delay).toHaveBeenCalledTimes(1);
      expect(delay.mock.calls[0][0]).toBe(UNSTUCK_RECORD_RETRY_DELAYS_MS[0]);
    },
  );

  it('keeps later FIFO items and the idle drain blocked during a retry delay', async () => {
    let releaseRetry: () => void = () => {};
    const delay = vi.fn(
      async (_ms: number, _signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          releaseRetry = resolve;
        }),
    );
    setUnstuckRecordsDepsForTests({ insert, delay, now: () => nowMs });
    insert.mockRejectedValueOnce(codedError('ECONNRESET')).mockResolvedValue(undefined);
    recordUnstuckEvent(identity, completedEvent());
    recordUnstuckEvent(identity, {
      type: 'unstuck',
      phase: 'failed',
      reason: 'no_safe_position',
      area: { kind: 'overworld', id: 'eastbrook_vale' },
      origin: { x: 1, y: 0, z: 1, localX: 1, localZ: 1 },
      duration: 10,
    });
    let idle = false;
    const drain = unstuckRecordsIdle().then(() => {
      idle = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].reason).toBe('nearest_safe_position');
    expect(delay.mock.calls[0][0]).toBe(UNSTUCK_RECORD_RETRY_DELAYS_MS[0]);
    expect(idle).toBe(false);

    releaseRetry();
    await drain;
    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert.mock.calls.map(([input]) => input.reason)).toEqual([
      'nearest_safe_position',
      'nearest_safe_position',
      'no_safe_position',
    ]);
  });

  it('bounds an exhausted transient retry ladder at three total attempts', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const delay = vi.fn(async (_ms: number) => {});
    setUnstuckRecordsDepsForTests({ insert, delay, now: () => nowMs });
    const failure = codedError('57P03', 'cannot connect now');
    insert.mockRejectedValue(failure);

    recordUnstuckEvent(identity, completedEvent());
    await unstuckRecordsIdle();

    expect(insert).toHaveBeenCalledTimes(UNSTUCK_RECORD_MAX_ATTEMPTS);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([...UNSTUCK_RECORD_RETRY_DELAYS_MS]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('unstuck_reports write failed:', failure);
  });

  it('does not retry a constraint failure, never throws, and continues the FIFO', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const delay = vi.fn(async (_ms: number) => {});
    setUnstuckRecordsDepsForTests({ insert, delay, now: () => nowMs });
    insert.mockRejectedValueOnce(codedError('23514', 'check violation'));
    expect(() => recordUnstuckEvent(identity, completedEvent())).not.toThrow();
    recordUnstuckEvent(identity, {
      type: 'unstuck',
      phase: 'failed',
      reason: 'no_safe_position',
      area: { kind: 'overworld', id: 'eastbrook_vale' },
      origin: { x: 1, y: 0, z: 1, localX: 1, localZ: 1 },
      duration: 10,
    });
    await unstuckRecordsIdle();
    expect(errorSpy).toHaveBeenCalledWith('unstuck_reports write failed:', expect.any(Error));
    expect(insert).toHaveBeenCalledTimes(2);
    expect(delay).not.toHaveBeenCalled();
    expect(insert.mock.calls[1][0].outcome).toBe('failed');
  });

  it('isolates a synchronous clock failure and permits a later event', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setUnstuckRecordsDepsForTests({
      insert,
      now: () => {
        throw new Error('clock failed');
      },
    });
    expect(() => recordUnstuckEvent(identity, completedEvent())).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('unstuck recordUnstuckEvent failed:', expect.any(Error));
    setUnstuckRecordsDepsForTests({ insert, now: () => nowMs });
    recordUnstuckEvent(identity, completedEvent());
    await unstuckRecordsIdle();
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('recordUnstuckEvent pending bound', () => {
  it('caps accepted telemetry at the named pending-record limit', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nextAttemptId = vi.fn(() => attemptId);
    let releaseHead: () => void = () => {};
    insert
      .mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            releaseHead = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    setUnstuckRecordsDepsForTests({
      attemptId: nextAttemptId,
      insert,
      now: () => nowMs,
    });

    for (let i = 0; i < UNSTUCK_RECORD_MAX_PENDING; i += 1) {
      recordUnstuckEvent(identity, completedEvent());
    }
    for (let i = 0; i < 5; i += 1) recordUnstuckEvent(identity, completedEvent());
    await new Promise((resolve) => setImmediate(resolve));

    expect(nextAttemptId).toHaveBeenCalledTimes(UNSTUCK_RECORD_MAX_PENDING);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    releaseHead();
    await unstuckRecordsIdle();
    expect(insert).toHaveBeenCalledTimes(UNSTUCK_RECORD_MAX_PENDING);
  });

  it('accepts new telemetry after the bounded queue drains', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let releaseHead: () => void = () => {};
    insert
      .mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            releaseHead = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    setUnstuckRecordsDepsForTests({
      attemptId: () => attemptId,
      insert,
      now: () => nowMs,
    });

    for (let i = 0; i < UNSTUCK_RECORD_MAX_PENDING; i += 1) {
      recordUnstuckEvent(identity, completedEvent());
    }
    recordUnstuckEvent(identity, completedEvent());
    await new Promise((resolve) => setImmediate(resolve));
    releaseHead();
    await unstuckRecordsIdle();

    recordUnstuckEvent(identity, completedEvent());
    await unstuckRecordsIdle();
    expect(insert).toHaveBeenCalledTimes(UNSTUCK_RECORD_MAX_PENDING + 1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('rate-limits overflow warnings while the queue remains full', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let clock = nowMs;
    let releaseHead: () => void = () => {};
    insert
      .mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            releaseHead = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    setUnstuckRecordsDepsForTests({
      attemptId: () => attemptId,
      insert,
      now: () => clock,
    });

    for (let i = 0; i < UNSTUCK_RECORD_MAX_PENDING; i += 1) {
      recordUnstuckEvent(identity, completedEvent());
    }
    recordUnstuckEvent(identity, completedEvent());
    recordUnstuckEvent(identity, completedEvent());
    clock += UNSTUCK_RECORD_OVERFLOW_WARN_INTERVAL_MS - 1;
    recordUnstuckEvent(identity, completedEvent());
    clock += 1;
    recordUnstuckEvent(identity, completedEvent());

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(1, 'unstuck report queue full; dropping telemetry');
    expect(warnSpy).toHaveBeenNthCalledWith(2, 'unstuck report queue full; dropping telemetry');

    await new Promise((resolve) => setImmediate(resolve));
    releaseHead();
    await unstuckRecordsIdle();
  });
});

describe('stopUnstuckRecords', () => {
  it('stops intake and resolves true when the captured FIFO drains before the deadline', async () => {
    let releaseInsert: () => void = () => {};
    insert.mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          releaseInsert = resolve;
        }),
    );
    const cancelDeadline = vi.fn();
    const scheduleDeadline = vi.fn((_callback: () => void, _ms: number) => cancelDeadline);
    setUnstuckRecordsDepsForTests({
      attemptId: () => attemptId,
      insert,
      now: () => nowMs,
      scheduleDeadline,
    });
    recordUnstuckEvent(identity, completedEvent());
    await new Promise((resolve) => setImmediate(resolve));

    const stopping = stopUnstuckRecords(UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS);
    recordUnstuckEvent(identity, completedEvent());
    releaseInsert();

    await expect(stopping).resolves.toBe(true);
    expect(scheduleDeadline).toHaveBeenCalledWith(
      expect.any(Function),
      UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS,
    );
    expect(cancelDeadline).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('returns at the deadline and drops queued work after the active write settles', async () => {
    let releaseInsert: () => void = () => {};
    insert.mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          releaseInsert = resolve;
        }),
    );
    let fireDeadline: () => void = () => {};
    const scheduleDeadline = vi.fn((callback: () => void, _ms: number) => {
      fireDeadline = callback;
      return vi.fn();
    });
    setUnstuckRecordsDepsForTests({
      attemptId: () => attemptId,
      insert,
      now: () => nowMs,
      scheduleDeadline,
    });
    recordUnstuckEvent(identity, completedEvent());
    recordUnstuckEvent(identity, {
      type: 'unstuck',
      phase: 'failed',
      reason: 'no_safe_position',
      area: { kind: 'overworld', id: 'eastbrook_vale' },
      origin: { x: 1, y: 0, z: 1, localX: 1, localZ: 1 },
      duration: 10,
    });
    await new Promise((resolve) => setImmediate(resolve));

    const stopping = stopUnstuckRecords(250);
    fireDeadline();
    await expect(stopping).resolves.toBe(false);
    recordUnstuckEvent(identity, completedEvent());
    expect(insert).toHaveBeenCalledTimes(1);

    releaseInsert();
    await unstuckRecordsIdle();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight retry delay so no retry timer or later insert continues', async () => {
    let delayAborted = false;
    const delay = vi.fn(
      async (_ms: number, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              delayAborted = true;
              resolve();
            },
            { once: true },
          );
        }),
    );
    insert.mockRejectedValueOnce(codedError('08006')).mockResolvedValue(undefined);
    let fireDeadline: () => void = () => {};
    const scheduleDeadline = vi.fn((callback: () => void, _ms: number) => {
      fireDeadline = callback;
      return vi.fn();
    });
    setUnstuckRecordsDepsForTests({
      attemptId: () => attemptId,
      delay,
      insert,
      now: () => nowMs,
      scheduleDeadline,
    });
    recordUnstuckEvent(identity, completedEvent());
    await new Promise((resolve) => setImmediate(resolve));
    expect(delay).toHaveBeenCalledTimes(1);

    const stopping = stopUnstuckRecords(250);
    fireDeadline();
    await expect(stopping).resolves.toBe(false);
    await unstuckRecordsIdle();

    expect(delayAborted).toBe(true);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
