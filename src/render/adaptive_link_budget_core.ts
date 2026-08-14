export interface AdaptiveLinkBudgetClock {
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface AdaptiveLinkBudgetConfig {
  initialWindowLinks: number;
  minWindowLinks: number;
  maxWindowLinks: number;
  initialLinkEstimate: number;
  increaseLinks: number;
  fastSettlementMs: number;
  slowSettlementMs: number;
  noProgressMs: number;
  maxSleepMs: number;
}

export type AdaptiveLinkBudgetState = 'ramp' | 'steady' | 'backoff' | 'stalled' | 'revealed';

export interface AdaptiveLinkBudgetSnapshot {
  state: AdaptiveLinkBudgetState;
  windowLinks: number;
  minWindowLinks: number;
  maxWindowLinks: number;
  maxWindowObserved: number;
  estimatedLinksPerUnit: number;
  inFlightLinks: number;
  inFlightUnits: number;
  submittedUnits: number;
  settledUnits: number;
  failedUnits: number;
  backoffCount: number;
  noProgressCount: number;
  lastSettlementMs: number | null;
}

export interface AdaptiveLinkBudget {
  canSubmit(): boolean;
  awaitSlot(shouldStop: () => boolean): Promise<boolean>;
  markSubmitted(id: string): void;
  markSyncEnd(id: string, chargedLinks: number): void;
  markSettled(id: string): void;
  markFailed(id: string): void;
  markReveal(): void;
  snapshot(): AdaptiveLinkBudgetSnapshot;
}

interface InFlightUnit {
  submittedAtMs: number;
  links: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const positiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;

const finiteDuration = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

function normalizedConfig(config: AdaptiveLinkBudgetConfig): AdaptiveLinkBudgetConfig {
  const minWindowLinks = positiveInteger(config.minWindowLinks, 1);
  const maxWindowLinks = Math.max(
    minWindowLinks,
    positiveInteger(config.maxWindowLinks, minWindowLinks),
  );
  return {
    initialWindowLinks: Math.min(
      maxWindowLinks,
      Math.max(minWindowLinks, positiveInteger(config.initialWindowLinks, minWindowLinks)),
    ),
    minWindowLinks,
    maxWindowLinks,
    initialLinkEstimate: positiveInteger(config.initialLinkEstimate, 1),
    increaseLinks: positiveInteger(config.increaseLinks, 1),
    fastSettlementMs: finiteDuration(config.fastSettlementMs, 0),
    slowSettlementMs: Math.max(
      finiteDuration(config.fastSettlementMs, 0),
      finiteDuration(config.slowSettlementMs, 0),
    ),
    noProgressMs: positiveInteger(config.noProgressMs, 1),
    maxSleepMs: positiveInteger(config.maxSleepMs, 1),
  };
}

/**
 * AIMD admission window for asynchronous shader work.
 *
 * The unit cost is provisional until its synchronous compile prologue reports
 * the actual program delta. This may overshoot the window by at most one unit,
 * but it prevents an unknown-cost unit from bypassing congestion accounting.
 */
export function createAdaptiveLinkBudget(
  inputConfig: AdaptiveLinkBudgetConfig,
  clock: AdaptiveLinkBudgetClock,
): AdaptiveLinkBudget {
  const config = normalizedConfig(inputConfig);
  const sleep = clock.sleep ?? defaultSleep;
  const inFlight = new Map<string, InFlightUnit>();
  let state: AdaptiveLinkBudgetState = 'ramp';
  let windowLinks = config.initialWindowLinks;
  let maxWindowObserved = windowLinks;
  let estimatedLinksPerUnit = config.initialLinkEstimate;
  let observedCharges = 0;
  let submittedUnits = 0;
  let settledUnits = 0;
  let failedUnits = 0;
  let backoffCount = 0;
  let noProgressCount = 0;
  let lastProgressAtMs = clock.now();
  let lastSettlementMs: number | null = null;

  const inFlightLinks = (): number => {
    let total = 0;
    for (const unit of inFlight.values()) total += unit.links;
    return total;
  };
  const backoff = (): void => {
    windowLinks = Math.max(config.minWindowLinks, Math.floor(windowLinks / 2));
    backoffCount++;
    state = 'backoff';
  };
  const hasNoProgress = (): boolean =>
    inFlight.size > 0 && clock.now() - lastProgressAtMs >= config.noProgressMs;
  const canSubmit = (): boolean => {
    if (state === 'stalled' || state === 'revealed') return false;
    if (hasNoProgress()) return false;
    if (inFlight.size === 0) return true;
    return inFlightLinks() + estimatedLinksPerUnit <= windowLinks;
  };
  const finish = (id: string, failed: boolean): void => {
    const unit = inFlight.get(id);
    if (!unit) return;
    const admissionClosed = state === 'stalled' || state === 'revealed';
    inFlight.delete(id);
    const now = clock.now();
    lastProgressAtMs = now;
    if (failed) {
      failedUnits++;
      if (!admissionClosed) backoff();
      return;
    }
    settledUnits++;
    const settlementMs = Math.max(0, now - unit.submittedAtMs);
    lastSettlementMs = settlementMs;
    if (admissionClosed) return;
    if (settlementMs <= config.fastSettlementMs) {
      windowLinks = Math.min(config.maxWindowLinks, windowLinks + config.increaseLinks);
      maxWindowObserved = Math.max(maxWindowObserved, windowLinks);
      state = windowLinks >= config.maxWindowLinks ? 'steady' : 'ramp';
    } else if (settlementMs >= config.slowSettlementMs) {
      backoff();
    } else {
      state = 'steady';
    }
  };

  return {
    canSubmit,
    async awaitSlot(shouldStop) {
      for (;;) {
        if (shouldStop() || state === 'revealed' || state === 'stalled') return false;
        const noProgressForMs = Math.max(0, clock.now() - lastProgressAtMs);
        if (hasNoProgress()) {
          noProgressCount++;
          state = 'stalled';
          return false;
        }
        if (canSubmit()) return true;
        await sleep(Math.min(config.maxSleepMs, config.noProgressMs - noProgressForMs));
      }
    },
    markSubmitted(id) {
      if (inFlight.has(id)) return;
      if (inFlight.size === 0) lastProgressAtMs = clock.now();
      inFlight.set(id, {
        submittedAtMs: clock.now(),
        links: estimatedLinksPerUnit,
      });
      submittedUnits++;
    },
    markSyncEnd(id, chargedLinks) {
      const unit = inFlight.get(id);
      if (!unit) return;
      const actualLinks = positiveInteger(chargedLinks, 1);
      unit.links = actualLinks;
      observedCharges++;
      estimatedLinksPerUnit =
        observedCharges === 1
          ? actualLinks
          : Math.max(1, Math.round(estimatedLinksPerUnit * 0.75 + actualLinks * 0.25));
    },
    markSettled(id) {
      finish(id, false);
    },
    markFailed(id) {
      finish(id, true);
    },
    markReveal() {
      state = 'revealed';
    },
    snapshot() {
      return {
        state,
        windowLinks,
        minWindowLinks: config.minWindowLinks,
        maxWindowLinks: config.maxWindowLinks,
        maxWindowObserved,
        estimatedLinksPerUnit,
        inFlightLinks: inFlightLinks(),
        inFlightUnits: inFlight.size,
        submittedUnits,
        settledUnits,
        failedUnits,
        backoffCount,
        noProgressCount,
        lastSettlementMs,
      };
    },
  };
}
