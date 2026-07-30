// Runtime observer for accepted /unstuck attempts. The sim remains the sole
// authority; this module snapshots terminal events and mirrors them to the
// append-only report table without ever blocking or faulting gameplay.

import { randomUUID } from 'node:crypto';
import type { SimEvent, UnstuckEvent } from '../src/sim/types';
import { pool } from './db';
import { type InsertUnstuckReportInput, insertUnstuckReport } from './unstuck_db';

export interface UnstuckRecordIdentity {
  realm: string;
  accountId: number | null;
  characterId: number | null;
}

export type TerminalUnstuckEvent = Extract<
  UnstuckEvent,
  { phase: 'completed' | 'cancelled' | 'failed' }
> & { pid?: number };

export interface UnstuckRecordsDeps {
  attemptId(): string;
  insert(input: InsertUnstuckReportInput): Promise<void>;
  delay(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  scheduleDeadline(callback: () => void, ms: number): () => void;
}

export const UNSTUCK_RECORD_MAX_ATTEMPTS = 3;
export const UNSTUCK_RECORD_RETRY_DELAYS_MS = [100, 500] as const;
export const UNSTUCK_RECORD_MAX_PENDING = 256;
export const UNSTUCK_RECORD_OVERFLOW_WARN_INTERVAL_MS = 60_000;
export const UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS = 5_000;

const TRANSIENT_NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
const TRANSIENT_OPERATOR_CODES = new Set(['57P01', '57P02', '57P03']);

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

// Call-time arrows keep the production bindings lazy and give focused tests a
// narrow writer/clock seam without exposing or replacing the shared Pool.
const REAL_DEPS: UnstuckRecordsDeps = {
  attemptId: () => randomUUID(),
  insert: (input) => insertUnstuckReport(pool, input),
  delay: abortableDelay,
  now: () => Date.now(),
  scheduleDeadline: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

let deps: UnstuckRecordsDeps = REAL_DEPS;
let tail: Promise<void> = Promise.resolve();
let accepting = true;
let workController = new AbortController();
let stopPromise: Promise<boolean> | null = null;
let queueState = { pending: 0 };
let lastOverflowWarningAt: number | null = null;

function isTerminalUnstuckEvent(event: SimEvent): event is TerminalUnstuckEvent {
  return (
    event.type === 'unstuck' &&
    (event.phase === 'completed' || event.phase === 'cancelled' || event.phase === 'failed')
  );
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code.toUpperCase() : null;
}

function isTransientInsertError(error: unknown): boolean {
  if (error instanceof Error && error.message === 'Query read timeout') return true;
  const code = errorCode(error);
  if (code === null) return false;
  return (
    code.startsWith('08') ||
    code.startsWith('40') ||
    code.startsWith('53') ||
    TRANSIENT_OPERATOR_CODES.has(code) ||
    TRANSIENT_NETWORK_CODES.has(code)
  );
}

async function insertWithRetry(
  input: InsertUnstuckReportInput,
  insert: UnstuckRecordsDeps['insert'],
  delay: UnstuckRecordsDeps['delay'],
  signal: AbortSignal,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    if (signal.aborted) return;
    try {
      await insert(input);
      return;
    } catch (err) {
      if (signal.aborted) return;
      if (attempt >= UNSTUCK_RECORD_MAX_ATTEMPTS || !isTransientInsertError(err)) throw err;
      await delay(UNSTUCK_RECORD_RETRY_DELAYS_MS[attempt - 1], signal);
    }
  }
}

function snapshotInput(
  identity: UnstuckRecordIdentity,
  event: TerminalUnstuckEvent,
  attemptId: string,
  resolvedAtMs: number,
): InsertUnstuckReportInput {
  const resolvedAt = new Date(resolvedAtMs);
  const invokedAt = new Date(resolvedAtMs - event.duration * 1000);
  const destination = event.phase === 'completed' ? event.destination : null;
  return {
    attemptId,
    realm: identity.realm,
    accountId: identity.accountId,
    characterId: identity.characterId,
    areaKind: event.area.kind,
    areaId: event.area.id,
    instanceId: event.area.instanceId ?? null,
    instanceSlot: event.area.slot ?? null,
    originRawX: event.origin.x,
    originRawY: event.origin.y,
    originRawZ: event.origin.z,
    originLocalX: event.origin.localX,
    // Instance origins translate only X/Z, so world Y is already area-local Y.
    originLocalY: event.origin.y,
    originLocalZ: event.origin.localZ,
    destinationRawX: destination?.x ?? null,
    destinationRawY: destination?.y ?? null,
    destinationRawZ: destination?.z ?? null,
    destinationLocalX: destination?.localX ?? null,
    destinationLocalY: destination?.y ?? null,
    destinationLocalZ: destination?.localZ ?? null,
    outcome: event.phase,
    reason: event.reason,
    invokedAt,
    resolvedAt,
  };
}

/**
 * Snapshot and enqueue one terminal accepted attempt. Non-unstuck and
 * non-terminal events are deliberate no-ops. Returns void immediately.
 */
export function recordUnstuckEvent(identity: UnstuckRecordIdentity, event: SimEvent): void {
  if (!accepting || !isTerminalUnstuckEvent(event)) return;
  try {
    const nowMs = deps.now();
    if (queueState.pending >= UNSTUCK_RECORD_MAX_PENDING) {
      if (
        lastOverflowWarningAt === null ||
        nowMs - lastOverflowWarningAt >= UNSTUCK_RECORD_OVERFLOW_WARN_INTERVAL_MS
      ) {
        lastOverflowWarningAt = nowMs;
        console.warn('unstuck report queue full; dropping telemetry');
      }
      return;
    }
    // Snapshot both the clock and every event/identity scalar before yielding
    // to the FIFO, since the sim reuses mutable objects after event delivery.
    const input = snapshotInput(identity, event, deps.attemptId(), nowMs);
    const insert = deps.insert;
    const delay = deps.delay;
    const signal = workController.signal;
    const state = queueState;
    state.pending += 1;
    tail = tail
      .then(() => insertWithRetry(input, insert, delay, signal))
      .catch((err) => {
        if (!signal.aborted) console.error('unstuck_reports write failed:', err);
      })
      .finally(() => {
        state.pending -= 1;
      });
  } catch (err) {
    // Telemetry must never fault the event-routing path.
    console.error('unstuck recordUnstuckEvent failed:', err);
  }
}

/** The current FIFO tail, for deterministic test and shutdown drains. */
export function unstuckRecordsIdle(): Promise<void> {
  return tail;
}

/** Stop intake and drain queued writes, aborting retries when the finite deadline expires. */
export function stopUnstuckRecords(
  deadlineMs = UNSTUCK_RECORD_SHUTDOWN_DRAIN_MS,
): Promise<boolean> {
  if (stopPromise !== null) return stopPromise;
  accepting = false;
  const boundedDeadline = Math.max(1, Math.floor(deadlineMs));
  const tailAtStop = tail;
  const controller = workController;
  const scheduleDeadline = deps.scheduleDeadline;
  stopPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    let cancelDeadline = () => {};
    const finish = (drained: boolean) => {
      if (settled) return;
      settled = true;
      cancelDeadline();
      if (!drained) controller.abort();
      resolve(drained);
    };
    cancelDeadline = scheduleDeadline(() => finish(false), boundedDeadline);
    void tailAtStop.then(() => finish(true));
  });
  return stopPromise;
}

/** Override recorder IO with fakes (test-only; merges over production deps). */
export function setUnstuckRecordsDepsForTests(overrides: Partial<UnstuckRecordsDeps>): void {
  deps = { ...REAL_DEPS, ...overrides };
}

/** Restore production deps and an empty FIFO after tests have awaited the idle hook. */
export function resetUnstuckRecordsForTests(): void {
  workController.abort();
  deps = REAL_DEPS;
  tail = Promise.resolve();
  accepting = true;
  workController = new AbortController();
  stopPromise = null;
  queueState = { pending: 0 };
  lastOverflowWarningAt = null;
}
