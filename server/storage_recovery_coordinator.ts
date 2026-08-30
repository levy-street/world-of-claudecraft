import { performance } from 'node:perf_hooks';
import { AMBIGUITY_HOLD_MAX_MS } from './storage_ladder_hold';

// Bounded, keyed scheduling for Claudium storage-purchase recovery.
//
// The coordinator owns only concurrency, retry timing, cancellation, and
// lifecycle. Domain decisions remain in server/storage_purchases.ts. One
// tracked character has at most one scan, drive, or retry timer, so repeated
// login and settle kicks coalesce instead of multiplying database and economy
// service work during the outage/restart shape recovery exists for.

export const STORAGE_RECOVERY_MAX_TRACKED = 200;
export const STORAGE_RECOVERY_SCAN_CONCURRENCY = 2;
export const STORAGE_RECOVERY_DRIVE_CONCURRENCY = 2;
// Five seconds is an operational target for one healthy drive, not a live
// end-to-end upper bound: DB deadlines, queue waits, retries, and character-save
// deadlines can all exceed it. The derived drain budget is therefore scheduler
// capacity telemetry only. Money safety does not depend on meeting it; a scanned
// pending row's `recovery-drive` ladder hold cannot yield while it is queued.
export const STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS = 5_000;
export const STORAGE_RECOVERY_TARGET_DRIVE_DRAIN_MS =
  Math.ceil(STORAGE_RECOVERY_MAX_TRACKED / STORAGE_RECOVERY_DRIVE_CONCURRENCY) *
  STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS;
// Operational age alarm. This shares the duration of the ambiguity policy for
// operator familiarity only; crossing it does not change the queued-row hold.
export const STORAGE_RECOVERY_HORIZON_WARNING_MS = AMBIGUITY_HOLD_MAX_MS;
// One realm may begin at most ten recovery drives or failed-scan retries per
// second after a two-start burst. The rate ceiling limits downstream bursts;
// the two drive slots are the binding term in the conditional target above.
export const STORAGE_RECOVERY_START_RATE_PER_SECOND = 10;
export const STORAGE_RECOVERY_START_BURST = 2;
export const STORAGE_RECOVERY_WARNING_WINDOW_MS = 60_000;
export const STORAGE_RECOVERY_BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;

export type StorageRecoveryDriveResult = 'done' | 'retry' | 'stop';

export interface StorageRecoveryTimer {
  cancel(): void;
}

export interface StorageRecoveryScheduler {
  /** Schedule one timer. The returned handle must make cancellation idempotent. */
  schedule(delayMs: number, run: () => void): StorageRecoveryTimer;
  /** Monotonic-enough wall clock for the aggregate start token bucket. */
  now(): number;
  /** Uniform sample in [0, 1), injected so equal jitter is directly testable. */
  random(): number;
  /** Yield between rows. Recovery never drains a character in one event-loop turn. */
  yieldTurn(run: () => void): void;
}

export interface StorageRecoveryHooks<Row> {
  scan(characterId: number, signal: AbortSignal): Promise<Row | null>;
  /** Reserve the exact recovered purchase before its outbound spend can start. */
  reserve(characterId: number, row: Row): boolean;
  drive(
    characterId: number,
    row: Row,
    isCurrent: () => boolean,
    signal: AbortSignal,
  ): Promise<StorageRecoveryDriveResult>;
  /** Atomically move the domain hold from row back to scan (or release it). */
  prepareScan(characterId: number, previousRow: Row | null): void;
  release(characterId: number, row: Row | null): void;
  /** True only when a nonactive entry may safely wait for its next login. */
  canEvict?(characterId: number, row: Row | null): boolean;
  warn(message: string): void;
}

export interface StorageRecoveryMetrics {
  tracked: number;
  scanActive: number;
  scanQueued: number;
  driveActive: number;
  driveQueued: number;
  rateLimitedQueued: number;
  /** Strong references held by all FIFO queues (never exceeds tracked). */
  queuedStorage: number;
  retryTimers: number;
  startRateGateTimers: number;
  horizonWarningTimers: number;
  /** Age since admission for the oldest retained key. */
  oldestTrackedAgeMs: number;
  /** Oldest time spent in the current queued or retry phase. */
  oldestQueuedAgeMs: number;
  /** Oldest time spent inside a scan or drive hook. */
  oldestActiveAgeMs: number;
  activePastSlotTarget: number;
  horizonBreached: boolean;
  kicks: number;
  coalescedKicks: number;
  capacityRefusals: number;
  capacityEvictions: number;
  capacityEvictionProbes: number;
  warningsEmitted: number;
  warningsSuppressed: number;
  scansStarted: number;
  drivesStarted: number;
  rateLimitedStarts: number;
  startRateDeferrals: number;
  retriesScheduled: number;
  horizonBreaches: number;
}

type Phase = 'scan-queued' | 'scanning' | 'drive-queued' | 'driving' | 'retry';

interface Entry<Row> {
  readonly characterId: number;
  readonly generation: number;
  phase: Phase;
  row: Row | null;
  retryAttempt: number;
  timer: StorageRecoveryTimer | null;
  followup: boolean;
  /** Set only by the authoritative final-session teardown hook. */
  offline: boolean;
  readonly admittedAtMs: number;
  phaseStartedAtMs: number;
}

type RateLimitedKind = 'scan' | 'drive';
type WarningKind = 'capacity' | 'drive' | 'eviction' | 'horizon' | 'host' | 'scan';

function defaultScheduler(): StorageRecoveryScheduler {
  return {
    schedule(delayMs, run) {
      const timer = setTimeout(run, delayMs);
      timer.unref();
      return { cancel: () => clearTimeout(timer) };
    },
    now: () => performance.now(),
    random: Math.random,
    yieldTurn: (run) => setImmediate(run),
  };
}

/** Equal jitter: half the cap is guaranteed, and the other half is uniform. */
export function storageRecoveryRetryDelay(baseMs: number, random: number): number {
  const unit = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) : 0;
  return Math.floor(baseMs / 2 + (baseMs / 2) * unit);
}

export class StorageRecoveryCoordinator<Row> {
  private readonly entries = new Map<number, Entry<Row>>();
  // Keyed Maps are insertion-ordered FIFOs with O(1) deletion. A plain array
  // plus a head index bounds dequeue cost, but not retained tombstones when IO
  // is wedged and capacity eviction repeatedly replaces queued keys.
  private readonly scanQueue = new Map<number, Entry<Row>>();
  private readonly pacedScanQueue = new Map<number, Entry<Row>>();
  private readonly driveQueue = new Map<number, Entry<Row>>();
  private readonly evictable = new Map<number, Entry<Row>>();
  private nextRateKind: RateLimitedKind = 'scan';
  private readonly activeScans = new Set<AbortController>();
  private readonly activeDrives = new Set<AbortController>();
  private startTokens = STORAGE_RECOVERY_START_BURST;
  private lastStartRefillMs: number;
  private startRateGateTimer: StorageRecoveryTimer | null = null;
  private horizonWarningTimer: StorageRecoveryTimer | null = null;
  private horizonWarningDueAtMs: number | null = null;
  private horizonCurrentlyBreached = false;
  private generation = 0;
  private stopping = false;
  private stopWaiters: (() => void)[] = [];
  private readonly warningState: Record<
    WarningKind,
    { lastEmittedMs: number | null; suppressed: number }
  > = {
    capacity: { lastEmittedMs: null, suppressed: 0 },
    drive: { lastEmittedMs: null, suppressed: 0 },
    eviction: { lastEmittedMs: null, suppressed: 0 },
    horizon: { lastEmittedMs: null, suppressed: 0 },
    host: { lastEmittedMs: null, suppressed: 0 },
    scan: { lastEmittedMs: null, suppressed: 0 },
  };
  private counts = {
    kicks: 0,
    coalescedKicks: 0,
    capacityRefusals: 0,
    capacityEvictions: 0,
    capacityEvictionProbes: 0,
    warningsEmitted: 0,
    warningsSuppressed: 0,
    scansStarted: 0,
    drivesStarted: 0,
    rateLimitedStarts: 0,
    startRateDeferrals: 0,
    retriesScheduled: 0,
    horizonBreaches: 0,
  };

  constructor(
    private readonly hooks: StorageRecoveryHooks<Row>,
    private readonly scheduler: StorageRecoveryScheduler = defaultScheduler(),
  ) {
    this.lastStartRefillMs = scheduler.now();
  }

  /**
   * Queue a character scan. Returns false only when shutdown or the hard
   * tracked-key cap refuses admission. An existing key is coalesced. A kick
   * that overlaps an active scan demands one newer scan because its caller may
   * have inserted an open row after the active query took its snapshot.
   */
  kick(characterId: number): boolean {
    this.counts.kicks++;
    if (this.stopping) return false;
    const existing = this.entries.get(characterId);
    if (existing) {
      // A login/request kick is authoritative evidence that the character is
      // live again. Remove it from the exact offline eviction index in O(1).
      existing.offline = false;
      this.evictable.delete(characterId);
      // Other phases already provide the required newer read: scan-queued has
      // not started, while every successful drive yields to a follow-up scan.
      // Only an active scan can finish from a snapshot older than this kick.
      if (existing.phase === 'scanning') existing.followup = true;
      this.counts.coalescedKicks++;
      return true;
    }
    if (!this.makeAdmissionRoom()) return false;
    const entry: Entry<Row> = {
      characterId,
      generation: ++this.generation,
      phase: 'scan-queued',
      row: null,
      retryAttempt: 0,
      timer: null,
      followup: false,
      offline: false,
      admittedAtMs: this.scheduler.now(),
      phaseStartedAtMs: this.scheduler.now(),
    };
    this.entries.set(characterId, entry);
    this.refreshHorizonWatch();
    this.markEvictable(entry);
    this.scanQueue.set(characterId, entry);
    this.pumpScans();
    return true;
  }

  /**
   * Hand an already-known pending row to the coordinator after an ambiguous
   * request-path spend. A newly admitted row observes the same backoff as later
   * retries. An existing scan gets an explicit follow-up; false tells the caller
   * it still owns the handed-off row and must release that domain reservation.
   */
  defer(characterId: number, row: Row): boolean {
    this.counts.kicks++;
    if (this.stopping) return false;
    const existing = this.entries.get(characterId);
    if (existing) {
      existing.offline = false;
      this.evictable.delete(characterId);
      // Its scan may have taken a database snapshot before the request path
      // inserted this known row. Demand a follow-up, but do not claim adoption:
      // the caller must release its real purchase hold before re-kicking.
      existing.followup = true;
      this.counts.coalescedKicks++;
      return false;
    }
    if (!this.makeAdmissionRoom()) return false;
    const entry: Entry<Row> = {
      characterId,
      generation: ++this.generation,
      phase: 'retry',
      row,
      retryAttempt: 0,
      timer: null,
      followup: false,
      offline: false,
      admittedAtMs: this.scheduler.now(),
      phaseStartedAtMs: this.scheduler.now(),
    };
    this.entries.set(characterId, entry);
    this.refreshHorizonWatch();
    if (!this.hooks.reserve(characterId, row)) {
      this.finish(entry);
      return false;
    }
    this.scheduleRetry(entry);
    return true;
  }

  /**
   * Mark a character as safely evictable after its final local session has
   * been removed. Active IO is never cancelled; it becomes eligible only when
   * it next reaches a queued/retry phase.
   */
  characterOffline(characterId: number): void {
    const entry = this.entries.get(characterId);
    if (!entry) return;
    entry.offline = true;
    this.markEvictable(entry);
  }

  metrics(): StorageRecoveryMetrics {
    this.refreshHorizonWatch();
    let retryTimers = 0;
    for (const entry of this.entries.values()) {
      if (entry.timer) retryTimers++;
    }
    const ages = this.currentAges();
    return {
      tracked: this.entries.size,
      scanActive: this.scanActive,
      scanQueued:
        this.queuedCount(this.scanQueue, 'scan-queued') + this.rateLimitedQueuedCount('scan'),
      driveActive: this.driveActive,
      driveQueued: this.rateLimitedQueuedCount('drive'),
      rateLimitedQueued: this.rateLimitedQueuedCount(),
      queuedStorage: this.scanQueue.size + this.pacedScanQueue.size + this.driveQueue.size,
      retryTimers,
      startRateGateTimers: this.startRateGateTimer ? 1 : 0,
      horizonWarningTimers: this.horizonWarningTimer ? 1 : 0,
      ...ages,
      horizonBreached: ages.oldestTrackedAgeMs >= STORAGE_RECOVERY_HORIZON_WARNING_MS,
      ...this.counts,
    };
  }

  tracks(characterId: number): boolean {
    return this.entries.has(characterId);
  }

  /** Aggregate host-construction failures through the same fixed warning lane. */
  reportHostFailure(error: unknown): void {
    this.warn('host', `storage purchase recovery host unavailable: ${String(error)}`);
  }

  /** Stop admission, cancel work that has not started, and drain active IO. */
  async stop(): Promise<void> {
    if (!this.stopping) {
      this.stopping = true;
      this.abortActiveOperations();
      for (const entry of [...this.entries.values()]) {
        if (entry.phase === 'scanning' || entry.phase === 'driving') continue;
        this.finish(entry);
      }
      this.startRateGateTimer?.cancel();
      this.startRateGateTimer = null;
      this.cancelHorizonWarningTimer();
      this.scanQueue.clear();
      this.pacedScanQueue.clear();
      this.driveQueue.clear();
      this.evictable.clear();
    }
    if (this.scanActive === 0 && this.driveActive === 0) return;
    await new Promise<void>((resolve) => this.stopWaiters.push(resolve));
  }

  /** Test-only immediate teardown. Stale completions fail their generation check. */
  reset(): void {
    this.stopping = true;
    this.abortActiveOperations();
    for (const entry of [...this.entries.values()]) this.finish(entry);
    this.entries.clear();
    this.startRateGateTimer?.cancel();
    this.startRateGateTimer = null;
    this.cancelHorizonWarningTimer();
    this.scanQueue.clear();
    this.pacedScanQueue.clear();
    this.driveQueue.clear();
    this.evictable.clear();
    this.nextRateKind = 'scan';
    this.activeScans.clear();
    this.activeDrives.clear();
    this.startTokens = STORAGE_RECOVERY_START_BURST;
    this.lastStartRefillMs = this.scheduler.now();
    this.stopWaiters.splice(0).forEach((resolve) => {
      resolve();
    });
    this.counts = {
      kicks: 0,
      coalescedKicks: 0,
      capacityRefusals: 0,
      capacityEvictions: 0,
      capacityEvictionProbes: 0,
      warningsEmitted: 0,
      warningsSuppressed: 0,
      scansStarted: 0,
      drivesStarted: 0,
      rateLimitedStarts: 0,
      startRateDeferrals: 0,
      retriesScheduled: 0,
      horizonBreaches: 0,
    };
    for (const state of Object.values(this.warningState)) {
      state.lastEmittedMs = null;
      state.suppressed = 0;
    }
    this.horizonCurrentlyBreached = false;
    this.stopping = false;
  }

  private get scanActive(): number {
    return this.activeScans.size;
  }

  private get driveActive(): number {
    return this.activeDrives.size;
  }

  private isCurrent(entry: Entry<Row>): boolean {
    return this.entries.get(entry.characterId)?.generation === entry.generation;
  }

  private makeAdmissionRoom(): boolean {
    if (this.entries.size < STORAGE_RECOVERY_MAX_TRACKED) return true;
    const candidate = this.evictable.entries().next().value as [number, Entry<Row>] | undefined;
    if (candidate && this.hooks.canEvict) {
      const [characterId, entry] = candidate;
      this.evictable.delete(characterId);
      if (
        this.isCurrent(entry) &&
        entry.phase !== 'scanning' &&
        entry.phase !== 'driving' &&
        entry.offline
      ) {
        this.counts.capacityEvictionProbes++;
        let safe = false;
        try {
          safe = this.hooks.canEvict(entry.characterId, entry.row);
        } catch (err) {
          this.warn('eviction', `storage purchase recovery eviction check failed: ${String(err)}`);
        }
        if (safe) {
          this.counts.capacityEvictions++;
          this.finish(entry);
          return true;
        }
        // The host saw a newer live session than the teardown notification.
        // Treat that as authoritative and wait for its eventual final leave.
        entry.offline = false;
      }
    }
    this.counts.capacityRefusals++;
    this.warn(
      'capacity',
      'storage purchase recovery capacity exhausted; live overflow remains held for bounded session retry',
    );
    return false;
  }

  private markEvictable(entry: Entry<Row>): void {
    if (!this.isCurrent(entry)) return;
    if (!entry.offline || entry.phase === 'scanning' || entry.phase === 'driving') {
      this.evictable.delete(entry.characterId);
      return;
    }
    this.evictable.set(entry.characterId, entry);
  }

  private pumpScans(): void {
    while (
      !this.stopping &&
      this.scanActive < STORAGE_RECOVERY_SCAN_CONCURRENCY &&
      this.scanQueue.size > 0
    ) {
      const entry = this.dequeueScan();
      if (!entry || !this.isCurrent(entry) || entry.phase !== 'scan-queued') continue;
      this.startScan(entry);
    }
  }

  private startScan(entry: Entry<Row>): void {
    this.evictable.delete(entry.characterId);
    this.setPhase(entry, 'scanning');
    const controller = new AbortController();
    this.activeScans.add(controller);
    this.counts.scansStarted++;
    void this.hooks
      .scan(entry.characterId, controller.signal)
      .then((row) => this.scanFinished(entry, row))
      .catch((err) => {
        if (!this.isCurrent(entry)) return;
        if (this.stopping || controller.signal.aborted) {
          this.finish(entry);
          return;
        }
        this.warn('scan', `storage purchase recovery scan failed: ${String(err)}`);
        this.scheduleRetry(entry);
      })
      .finally(() => {
        this.activeScans.delete(controller);
        this.pumpScans();
        this.pumpRateLimited();
        this.maybeResolveStop();
      });
  }

  private scanFinished(entry: Entry<Row>, row: Row | null): void {
    if (!this.isCurrent(entry)) return;
    if (this.stopping) {
      this.finish(entry);
      return;
    }
    if (!row) {
      if (entry.followup) {
        entry.followup = false;
        this.setPhase(entry, 'scan-queued');
        this.markEvictable(entry);
        this.scheduler.yieldTurn(() => {
          if (!this.isCurrent(entry) || this.stopping) {
            if (this.isCurrent(entry)) this.finish(entry);
            return;
          }
          this.scanQueue.set(entry.characterId, entry);
          this.pumpScans();
        });
        return;
      }
      this.finish(entry);
      return;
    }
    entry.row = row;
    entry.retryAttempt = 0;
    if (!this.hooks.reserve(entry.characterId, row)) {
      this.scheduleRetry(entry);
      return;
    }
    this.setPhase(entry, 'drive-queued');
    this.markEvictable(entry);
    this.enqueueRateLimited(entry, 'drive');
  }

  private startDrive(entry: Entry<Row>): void {
    const row = entry.row;
    if (!row) return;
    this.evictable.delete(entry.characterId);
    this.setPhase(entry, 'driving');
    const controller = new AbortController();
    this.activeDrives.add(controller);
    this.counts.drivesStarted++;
    void this.hooks
      .drive(
        entry.characterId,
        row,
        () => this.isCurrent(entry) && !this.stopping && !controller.signal.aborted,
        controller.signal,
      )
      .then((result) => this.driveFinished(entry, result))
      .catch((err) => {
        if (!this.isCurrent(entry)) return;
        if (this.stopping || controller.signal.aborted) {
          this.finish(entry);
          return;
        }
        this.warn('drive', `storage purchase recovery drive failed: ${String(err)}`);
        this.scheduleRetry(entry);
      })
      .finally(() => {
        this.activeDrives.delete(controller);
        this.pumpRateLimited();
        this.maybeResolveStop();
      });
  }

  /**
   * Drives and failed-scan retries share one fair token bucket over separate
   * indexed queues. Round-robin arbitration prevents a slow saturated lane
   * from blocking the other lane. Initial login scans and successful-drive
   * follow-up scans stay outside the bucket so a healthy indexed empty read
   * clears its provisional hold quickly.
   */
  private pumpRateLimited(): void {
    while (!this.stopping) {
      const kind = this.nextRunnableRateKind();
      if (!kind) return;
      if (!this.takeStartToken()) {
        this.armStartRateGate();
        return;
      }
      const entry = this.dequeueRateLimited(kind);
      if (!entry) continue;
      this.nextRateKind = kind === 'scan' ? 'drive' : 'scan';
      this.counts.rateLimitedStarts++;
      if (kind === 'scan') this.startScan(entry);
      else this.startDrive(entry);
    }
  }

  private enqueueRateLimited(entry: Entry<Row>, kind: RateLimitedKind): void {
    if (kind === 'scan') this.pacedScanQueue.set(entry.characterId, entry);
    else this.driveQueue.set(entry.characterId, entry);
    this.pumpRateLimited();
  }

  private nextRunnableRateKind(): RateLimitedKind | null {
    const scan =
      this.scanActive < STORAGE_RECOVERY_SCAN_CONCURRENCY
        ? this.peekRateLimited('scan')
        : undefined;
    const drive =
      this.driveActive < STORAGE_RECOVERY_DRIVE_CONCURRENCY
        ? this.peekRateLimited('drive')
        : undefined;
    if (scan && drive) return this.nextRateKind;
    if (scan) return 'scan';
    if (drive) return 'drive';
    return null;
  }

  private peekRateLimited(kind: RateLimitedKind): Entry<Row> | undefined {
    for (;;) {
      const queue = kind === 'scan' ? this.pacedScanQueue : this.driveQueue;
      const entry = queue.values().next().value as Entry<Row> | undefined;
      if (!entry) return undefined;
      const expected: Phase = kind === 'scan' ? 'scan-queued' : 'drive-queued';
      if (this.isCurrent(entry) && entry.phase === expected && (kind !== 'drive' || entry.row)) {
        return entry;
      }
      this.dequeueRateLimited(kind);
    }
  }

  private takeStartToken(): boolean {
    this.refillStartTokens();
    if (this.startTokens < 1) return false;
    this.startTokens -= 1;
    return true;
  }

  private refillStartTokens(): void {
    const now = this.scheduler.now();
    if (now < this.lastStartRefillMs) {
      // An injected wall clock may regress. Reset the baseline instead of
      // freezing refill until it catches up; production uses performance.now().
      this.lastStartRefillMs = now;
      return;
    }
    const elapsed = now - this.lastStartRefillMs;
    if (elapsed === 0) return;
    this.startTokens = Math.min(
      STORAGE_RECOVERY_START_BURST,
      this.startTokens + (elapsed * STORAGE_RECOVERY_START_RATE_PER_SECOND) / 1_000,
    );
    this.lastStartRefillMs = now;
  }

  private armStartRateGate(): void {
    if (
      this.startRateGateTimer ||
      this.stopping ||
      (!this.peekRateLimited('scan') && !this.peekRateLimited('drive'))
    ) {
      return;
    }
    const missing = Math.max(0, 1 - this.startTokens);
    const delay = Math.max(
      1,
      Math.ceil((missing * 1_000) / STORAGE_RECOVERY_START_RATE_PER_SECOND),
    );
    this.counts.startRateDeferrals++;
    this.startRateGateTimer = this.scheduler.schedule(delay, () => {
      this.startRateGateTimer = null;
      if (this.stopping) return;
      this.pumpRateLimited();
    });
  }

  private driveFinished(entry: Entry<Row>, result: StorageRecoveryDriveResult): void {
    if (!this.isCurrent(entry)) return;
    if (this.stopping || result === 'stop') {
      this.finish(entry);
      return;
    }
    if (result === 'retry') {
      this.scheduleRetry(entry);
      return;
    }
    const previous = entry.row;
    entry.row = null;
    entry.retryAttempt = 0;
    entry.followup = false;
    this.setPhase(entry, 'scan-queued');
    this.markEvictable(entry);
    this.hooks.prepareScan(entry.characterId, previous);
    // One operational row per event-loop turn, including an all-immediate fake.
    this.scheduler.yieldTurn(() => {
      if (!this.isCurrent(entry) || this.stopping) {
        if (this.isCurrent(entry)) this.finish(entry);
        return;
      }
      this.scanQueue.set(entry.characterId, entry);
      this.pumpScans();
    });
  }

  private scheduleRetry(entry: Entry<Row>): void {
    if (!this.isCurrent(entry)) return;
    if (this.stopping) {
      this.finish(entry);
      return;
    }
    entry.timer?.cancel();
    const index = Math.min(entry.retryAttempt, STORAGE_RECOVERY_BACKOFF_MS.length - 1);
    const base = STORAGE_RECOVERY_BACKOFF_MS[index];
    entry.retryAttempt++;
    this.setPhase(entry, 'retry');
    this.markEvictable(entry);
    this.counts.retriesScheduled++;
    const delay = storageRecoveryRetryDelay(base, this.scheduler.random());
    entry.timer = this.scheduler.schedule(delay, () => {
      if (!this.isCurrent(entry) || this.stopping) return;
      entry.timer = null;
      if (entry.row) {
        if (!this.hooks.reserve(entry.characterId, entry.row)) {
          this.scheduleRetry(entry);
          return;
        }
        this.setPhase(entry, 'drive-queued');
        this.markEvictable(entry);
        this.enqueueRateLimited(entry, 'drive');
        return;
      }
      this.setPhase(entry, 'scan-queued');
      this.markEvictable(entry);
      this.enqueueRateLimited(entry, 'scan');
    });
  }

  private finish(entry: Entry<Row>): void {
    if (!this.isCurrent(entry)) return;
    entry.timer?.cancel();
    entry.timer = null;
    this.scanQueue.delete(entry.characterId);
    this.pacedScanQueue.delete(entry.characterId);
    this.driveQueue.delete(entry.characterId);
    this.evictable.delete(entry.characterId);
    this.entries.delete(entry.characterId);
    this.hooks.release(entry.characterId, entry.row);
    this.refreshHorizonWatch();
    this.maybeResolveStop();
  }

  private setPhase(entry: Entry<Row>, phase: Phase): void {
    entry.phase = phase;
    entry.phaseStartedAtMs = this.scheduler.now();
  }

  private abortActiveOperations(): void {
    for (const controller of this.activeScans) controller.abort();
    for (const controller of this.activeDrives) controller.abort();
  }

  private currentAges(): Pick<
    StorageRecoveryMetrics,
    'activePastSlotTarget' | 'oldestActiveAgeMs' | 'oldestQueuedAgeMs' | 'oldestTrackedAgeMs'
  > {
    const now = this.scheduler.now();
    let oldestTrackedAgeMs = 0;
    let oldestQueuedAgeMs = 0;
    let oldestActiveAgeMs = 0;
    let activePastSlotTarget = 0;
    for (const entry of this.entries.values()) {
      oldestTrackedAgeMs = Math.max(oldestTrackedAgeMs, Math.max(0, now - entry.admittedAtMs));
      const phaseAgeMs = Math.max(0, now - entry.phaseStartedAtMs);
      if (entry.phase === 'scanning' || entry.phase === 'driving') {
        oldestActiveAgeMs = Math.max(oldestActiveAgeMs, phaseAgeMs);
        if (phaseAgeMs > STORAGE_RECOVERY_SLOT_OCCUPANCY_TARGET_MS) activePastSlotTarget++;
      } else {
        oldestQueuedAgeMs = Math.max(oldestQueuedAgeMs, phaseAgeMs);
      }
    }
    return {
      activePastSlotTarget,
      oldestActiveAgeMs,
      oldestQueuedAgeMs,
      oldestTrackedAgeMs,
    };
  }

  private refreshHorizonWatch(): void {
    const oldestTrackedAgeMs = this.currentAges().oldestTrackedAgeMs;
    const breached = oldestTrackedAgeMs >= STORAGE_RECOVERY_HORIZON_WARNING_MS;
    if (breached && !this.horizonCurrentlyBreached) {
      this.counts.horizonBreaches++;
      this.warn(
        'horizon',
        `storage purchase recovery horizon breached: oldest tracked work is ${Math.floor(oldestTrackedAgeMs)}ms old`,
      );
    }
    this.horizonCurrentlyBreached = breached;
    if (this.stopping || breached || this.entries.size === 0) {
      this.cancelHorizonWarningTimer();
      return;
    }
    const oldest = this.entries.values().next().value as Entry<Row> | undefined;
    if (!oldest) return;
    const dueAt = oldest.admittedAtMs + STORAGE_RECOVERY_HORIZON_WARNING_MS;
    if (this.horizonWarningTimer && this.horizonWarningDueAtMs === dueAt) return;
    this.cancelHorizonWarningTimer();
    const delay = Math.max(0, dueAt - this.scheduler.now());
    this.horizonWarningDueAtMs = dueAt;
    this.horizonWarningTimer = this.scheduler.schedule(delay, () => {
      this.horizonWarningTimer = null;
      this.horizonWarningDueAtMs = null;
      this.refreshHorizonWatch();
    });
  }

  private cancelHorizonWarningTimer(): void {
    this.horizonWarningTimer?.cancel();
    this.horizonWarningTimer = null;
    this.horizonWarningDueAtMs = null;
  }

  private warn(kind: WarningKind, message: string): void {
    const state = this.warningState[kind];
    const now = this.scheduler.now();
    if (state.lastEmittedMs !== null && now >= state.lastEmittedMs) {
      if (now - state.lastEmittedMs < STORAGE_RECOVERY_WARNING_WINDOW_MS) {
        state.suppressed++;
        this.counts.warningsSuppressed++;
        return;
      }
    }
    const suffix = state.suppressed > 0 ? ` (${state.suppressed} similar failures suppressed)` : '';
    state.lastEmittedMs = now;
    state.suppressed = 0;
    this.counts.warningsEmitted++;
    this.hooks.warn(`${message}${suffix}`);
  }

  private maybeResolveStop(): void {
    if (!this.stopping || this.scanActive !== 0 || this.driveActive !== 0) return;
    this.stopWaiters.splice(0).forEach((resolve) => {
      resolve();
    });
  }

  private queuedCount(queue: Map<number, Entry<Row>>, phase: Phase): number {
    let count = 0;
    for (const entry of queue.values()) {
      if (entry && this.isCurrent(entry) && entry.phase === phase) count++;
    }
    return count;
  }

  private rateLimitedQueuedCount(kind?: RateLimitedKind): number {
    const scans = kind === 'drive' ? 0 : this.queuedCount(this.pacedScanQueue, 'scan-queued');
    const drives = kind === 'scan' ? 0 : this.queuedCount(this.driveQueue, 'drive-queued');
    return scans + drives;
  }

  private dequeueScan(): Entry<Row> | undefined {
    const entry = this.scanQueue.values().next().value as Entry<Row> | undefined;
    if (entry) this.scanQueue.delete(entry.characterId);
    return entry;
  }

  private dequeueRateLimited(kind: RateLimitedKind): Entry<Row> | undefined {
    const queue = kind === 'scan' ? this.pacedScanQueue : this.driveQueue;
    const entry = queue.values().next().value as Entry<Row> | undefined;
    if (entry) queue.delete(entry.characterId);
    return entry;
  }
}
