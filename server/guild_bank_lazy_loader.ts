// Bounded, fail-closed recovery for a guild bank that was not present in the
// boot snapshot. The coordinator owns only admission and retry state; storage,
// sim application, metrics, and logging stay behind narrow injected ports.

export const GUILD_BANK_LAZY_LOAD_MAX_ACTIVE = 4;
export const GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS = 30_000;
export const GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS = 5_000;
export const GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES = 64;
export const GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES = 2;
export const GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS = 6;
export const GUILD_BANK_LAZY_LOAD_RETRY_SPREAD_STEP_MS = 100;
export const GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS = 10;
export const GUILD_BANK_LAZY_LOAD_AUTOMATIC_START_WINDOW_MS = 1_000;
export const GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX = 1_024;
// One quarter of the durable hard row bound. The paired test pins the relation
// without pulling persistence modules into this coordinator's runtime graph.
export const GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES = 65_536;

export interface GuildBankLazyLoadRow {
  readonly guildId: number;
  readonly oversized: boolean;
  readonly dataBytes?: number | null;
}

export interface GuildBankLazyLoadApplyResult {
  readonly loaded: readonly number[];
  readonly oversized: readonly number[];
  readonly malformed: readonly number[];
}

export interface GuildBankLazyLoadPermit {
  release(): void;
}

export interface GuildBankLazyLoader {
  ensureLoaded(guildId: number): Promise<void>;
  stop(): void;
}

export type GuildBankLazyLoadRetryTask = () => void | Promise<void>;
export type GuildBankLazyLoadScheduleRetry = (
  delayMs: number,
  retry: GuildBankLazyLoadRetryTask,
) => () => void;

export interface GuildBankLazyLoaderDeps<Row extends GuildBankLazyLoadRow> {
  hasLoaded(guildId: number): boolean;
  loadRow(guildId: number): Promise<Row | null>;
  applyRows(rows: readonly Row[]): GuildBankLazyLoadApplyResult;
  /** Omit when the host has no shared background gate. Null means busy. */
  tryAcquireImmediatePermit?: () => GuildBankLazyLoadPermit | null;
  /** Must return an idempotent cancellation handle. The host owns unref(). */
  scheduleRetry: GuildBankLazyLoadScheduleRetry;
  recordBookUnloadedIncident(): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  nowMs(): number;
}

interface GuildBankLazyLoadRetryState {
  loadRetries: number;
  busyRearms: number;
  readonly slot: number;
  readonly spreadMs: number;
  retryAtMs: number;
  cancel: (() => void) | null;
  token: object | null;
}

export function createGuildBankLazyLoader<Row extends GuildBankLazyLoadRow>(
  deps: GuildBankLazyLoaderDeps<Row>,
): GuildBankLazyLoader {
  const inFlight = new Map<number, Promise<void>>();
  const failuresUntil = new Map<number, number>();
  const retries = new Map<number, GuildBankLazyLoadRetryState>();
  const retrySlots = new Set<number>();
  const automaticStarts: number[] = [];
  let active = 0;
  let failureOverflowUntil = 0;
  let nextRetrySlot = 0;
  let stopped = false;

  const cancelRetry = (guildId: number): void => {
    const state = retries.get(guildId);
    if (!state) return;
    retries.delete(guildId);
    retrySlots.delete(state.slot);
    const cancel = state.cancel;
    state.cancel = null;
    state.token = null;
    try {
      cancel?.();
    } catch (error) {
      deps.error(`guild bank ${guildId} lazy-load retry cancellation failed:`, error);
    }
  };

  const retryState = (guildId: number) => {
    const existing = retries.get(guildId);
    if (existing) return existing;
    if (stopped || retries.size >= GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES) return null;
    let slot: number | null = null;
    for (let offset = 0; offset < GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES; offset++) {
      const candidate = (nextRetrySlot + offset) % GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES;
      if (retrySlots.has(candidate)) continue;
      slot = candidate;
      break;
    }
    if (slot === null) return null;
    retrySlots.add(slot);
    const created: GuildBankLazyLoadRetryState = {
      loadRetries: 0,
      busyRearms: 0,
      slot,
      spreadMs: slot * GUILD_BANK_LAZY_LOAD_RETRY_SPREAD_STEP_MS,
      retryAtMs: 0,
      cancel: null,
      token: null,
    };
    nextRetrySlot = (slot + 1) % GUILD_BANK_LAZY_LOAD_MAX_RETRY_STATES;
    retries.set(guildId, created);
    return created;
  };

  const markBookUnloaded = (guildId: number): void => {
    cancelRetry(guildId);
    if (!stopped) deps.recordBookUnloadedIncident();
  };

  const automaticRetryAt = (nowMs: number): number | null => {
    while (
      automaticStarts.length > 0 &&
      (automaticStarts[0] ?? 0) <= nowMs - GUILD_BANK_LAZY_LOAD_AUTOMATIC_START_WINDOW_MS
    ) {
      automaticStarts.shift();
    }
    if (automaticStarts.length < GUILD_BANK_LAZY_LOAD_MAX_AUTOMATIC_STARTS) return null;
    return (automaticStarts[0] ?? nowMs) + GUILD_BANK_LAZY_LOAD_AUTOMATIC_START_WINDOW_MS;
  };

  const scheduleRetryAt = (guildId: number, retryAtMs: number): void => {
    const state = retryState(guildId);
    if (!state) return;
    if (state.cancel && state.retryAtMs >= retryAtMs) return;
    const priorCancel = state.cancel;
    state.cancel = null;
    state.token = null;
    try {
      priorCancel?.();
    } catch (error) {
      deps.error(`guild bank ${guildId} lazy-load retry cancellation failed:`, error);
    }

    const token = {};
    state.retryAtMs = retryAtMs;
    state.token = token;
    try {
      const cancel = deps.scheduleRetry(Math.max(0, retryAtMs - deps.nowMs()), async () => {
        try {
          const current = retries.get(guildId);
          if (stopped || current !== state || current.token !== token) return;
          current.cancel = null;
          current.token = null;
          const failedUntil = failuresUntil.get(guildId) ?? 0;
          if (failedUntil > deps.nowMs()) {
            scheduleRetryAt(guildId, failedUntil + current.spreadMs);
            return;
          }
          await ensureLoaded(guildId, true);
        } catch (error) {
          markBookUnloaded(guildId);
          deps.error(`guild bank ${guildId} lazy-load retry failed:`, error);
        }
      });
      if (!stopped && retries.get(guildId) === state && state.token === token) {
        state.cancel = cancel;
      } else {
        cancel();
      }
    } catch (error) {
      if (retries.get(guildId) === state && state.token === token) markBookUnloaded(guildId);
      deps.error(`guild bank ${guildId} lazy-load retry scheduling failed:`, error);
    }
  };

  const rememberFailure = (
    guildId: number,
    kind: 'busy' | 'transient' | 'permanent',
    ttlMs = GUILD_BANK_LAZY_LOAD_FAILURE_TTL_MS,
  ): void => {
    const now = deps.nowMs();
    const failedUntil = now + ttlMs;
    const refreshedExisting = failuresUntil.delete(guildId);
    if (!refreshedExisting && failuresUntil.size >= GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX) {
      for (const [failedGuildId, until] of failuresUntil) {
        if (until <= now) failuresUntil.delete(failedGuildId);
      }
    }
    if (failuresUntil.size < GUILD_BANK_LAZY_LOAD_FAILURE_CACHE_MAX) {
      failuresUntil.set(guildId, failedUntil);
    } else {
      // Never evict an unexpired guild: doing so lets a caller churn distinct
      // server-derived memberships until an older guild becomes DB-eligible.
      // Saturation is one bounded fail-closed memo for uncached guilds.
      failureOverflowUntil = Math.max(failureOverflowUntil, failedUntil);
    }
    if (stopped) return;
    if (kind === 'permanent') {
      markBookUnloaded(guildId);
      return;
    }
    const state = retryState(guildId);
    if (!state) {
      deps.recordBookUnloadedIncident();
      if (kind === 'busy') {
        deps.error(`guild bank ${guildId} lazy load retry capacity exhausted; bank remains inert`);
      }
      return;
    }
    if (kind === 'busy') {
      if (state.busyRearms >= GUILD_BANK_LAZY_LOAD_MAX_BUSY_REARMS) {
        markBookUnloaded(guildId);
        deps.error(`guild bank ${guildId} lazy load busy retries exhausted; bank remains inert`);
        return;
      }
      state.busyRearms++;
    } else if (state.loadRetries >= GUILD_BANK_LAZY_LOAD_MAX_LOAD_RETRIES) {
      markBookUnloaded(guildId);
      return;
    }
    scheduleRetryAt(guildId, failedUntil + state.spreadMs);
  };

  const ensureLoaded = (guildId: number, automatic = false): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (deps.hasLoaded(guildId)) {
      failuresUntil.delete(guildId);
      cancelRetry(guildId);
      return Promise.resolve();
    }

    const existing = inFlight.get(guildId);
    if (existing) return existing;

    const now = deps.nowMs();
    const failedUntil = failuresUntil.get(guildId) ?? 0;
    if (failedUntil > now) return Promise.resolve();
    failuresUntil.delete(guildId);
    if (!automatic && failureOverflowUntil > now) return Promise.resolve();

    if (automatic) {
      const rateRetryAt = automaticRetryAt(now);
      if (rateRetryAt !== null) {
        const state = retries.get(guildId);
        if (state) scheduleRetryAt(guildId, rateRetryAt + state.spreadMs);
        return Promise.resolve();
      }
    }

    if (active >= GUILD_BANK_LAZY_LOAD_MAX_ACTIVE) {
      rememberFailure(guildId, 'busy', GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS);
      return Promise.resolve();
    }

    const acquirePermit = deps.tryAcquireImmediatePermit;
    const permit = acquirePermit?.();
    if (acquirePermit && !permit) {
      rememberFailure(guildId, 'busy', GUILD_BANK_LAZY_LOAD_BUSY_TTL_MS);
      return Promise.resolve();
    }

    const state = retries.get(guildId);
    if (automatic) automaticStarts.push(now);
    if (state) {
      state.busyRearms = 0;
      if (automatic) state.loadRetries++;
    }
    active++;
    const operation = (async (): Promise<void> => {
      try {
        const loadedRow = await deps.loadRow(guildId);
        if (stopped) return;
        if (!loadedRow) {
          rememberFailure(guildId, 'transient');
          deps.error(`guild bank lazy load found no guild ${guildId}; bank remains inert`);
          return;
        }

        if (
          !loadedRow.oversized &&
          (loadedRow.dataBytes ?? 0) > GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES
        ) {
          deps.warn(
            `guild bank row for guild ${guildId} is ${loadedRow.dataBytes} bytes during lazy load (soft watch threshold ${GUILD_BANK_LAZY_LOAD_SOFT_ROW_BYTES})`,
          );
        }

        const result = deps.applyRows([loadedRow]);
        if (result.loaded.includes(guildId)) {
          failuresUntil.delete(guildId);
          cancelRetry(guildId);
          return;
        }

        const permanent = result.oversized.includes(guildId) || result.malformed.includes(guildId);
        rememberFailure(guildId, permanent ? 'permanent' : 'transient');
        const reason = result.oversized.includes(guildId)
          ? 'oversized'
          : result.malformed.includes(guildId)
            ? 'malformed'
            : 'missing after load';
        deps.error(`guild bank ${guildId} lazy load failed (${reason}); bank remains inert`);
      } catch (error) {
        rememberFailure(guildId, 'transient');
        deps.error(`guild bank ${guildId} lazy load failed; bank remains inert:`, error);
      }
    })();

    let tracked!: Promise<void>;
    tracked = operation.finally(() => {
      active--;
      try {
        permit?.release();
      } finally {
        if (inFlight.get(guildId) === tracked) inFlight.delete(guildId);
      }
    });
    inFlight.set(guildId, tracked);
    return tracked;
  };

  return {
    ensureLoaded,
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const guildId of [...retries.keys()]) cancelRetry(guildId);
      failuresUntil.clear();
      failureOverflowUntil = 0;
      automaticStarts.length = 0;
    },
  };
}
