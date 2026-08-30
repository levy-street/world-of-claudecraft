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
  /** The absolute bounds: a settle under `fastSettlementMs` grows the
   *  window, one past `slowSettlementMs` halves it. Required without a
   *  judge; a lane with `judgeSettlement` leaves them out. */
  fastSettlementMs?: number;
  slowSettlementMs?: number;
  noProgressMs: number;
  maxSleepMs: number;
  /** How a settle is read. Absent, the two absolute bounds above decide. A
   *  judge sees what the bounds cannot: the
   *  unit's weight and how many units it shared the driver with, so it can
   *  read a settle RELATIVE to what this driver costs alone rather than
   *  against a millisecond figure measured on some other machine. */
  judgeSettlement?: SettlementJudge;
}

/** One settled unit, as a judge sees it. */
export interface SettlementSample {
  settlementMs: number;
  /** The unit's weight, whatever the caller prices in (the worker: thousands
   *  of GLSL characters); 1 when the caller did not say. */
  weight: number;
  /** The most units in flight at any moment of this unit's life, itself
   *  included: 1 is a unit the driver had to itself. */
  concurrency: number;
  /** The admission window when the unit settled. */
  windowLinks: number;
  /** The unit's synchronous prologue reported a program delta of zero: it
   *  linked nothing, so its settle is the queue's time, not a link's. The
   *  window credit is withheld by the lane whatever the judge says (the
   *  cheap-unit discount); a judge that keeps state must not learn from it. */
  cheap: boolean;
}

/** `fast` grows the window, `slow` halves it, `mid` leaves it. */
export type SettlementVerdict = 'fast' | 'mid' | 'slow';

export type SettlementJudge = (sample: SettlementSample) => SettlementVerdict;

export type AdaptiveLinkBudgetState = 'ramp' | 'steady' | 'backoff' | 'stalled' | 'revealed';

export type AdaptiveLinkBudgetTransitionReason =
  | 'fast-settlement'
  | 'mid-settlement'
  | 'slow-settlement'
  | 'failed'
  | 'no-progress'
  | 'reveal';

export interface AdaptiveLinkBudgetTransition {
  atMs: number;
  from: AdaptiveLinkBudgetState;
  to: AdaptiveLinkBudgetState;
  reason: AdaptiveLinkBudgetTransitionReason;
  windowLinks: number;
  inFlightLinks: number;
}

export interface AdaptiveLinkBudgetSnapshot {
  state: AdaptiveLinkBudgetState;
  windowLinks: number;
  minWindowLinks: number;
  maxWindowLinks: number;
  maxWindowObserved: number;
  estimatedLinksPerUnit: number;
  inFlightLinks: number;
  inFlightUnits: number;
  peakInFlightLinks: number;
  submittedUnits: number;
  settledUnits: number;
  failedUnits: number;
  backoffCount: number;
  noProgressCount: number;
  lastSettlementMs: number | null;
  transitions: AdaptiveLinkBudgetTransition[];
}

export interface AdaptiveLinkBudget {
  canSubmit(): boolean;
  awaitSlot(shouldStop: () => boolean): Promise<boolean>;
  /** `weight` is what the settlement judge prices the unit in; 1 when absent. */
  markSubmitted(id: string, weight?: number): void;
  markSyncEnd(id: string, chargedLinks: number): void;
  markSettled(id: string): void;
  markFailed(id: string): void;
  markReveal(): void;
  snapshot(): AdaptiveLinkBudgetSnapshot;
}

interface InFlightUnit {
  submittedAtMs: number;
  links: number;
  /** Its synchronous prologue reported a program delta of zero: the unit
   *  linked NOTHING, so how fast it settles says nothing about the driver. */
  cheap: boolean;
  weight: number;
  /** The most units in flight at once while this one was, itself included. */
  peakConcurrency: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const ADAPTIVE_LINK_BUDGET_MAX_TRANSITIONS = 32;

const positiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;

const finiteDuration = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

const positiveWeight = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 1;

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
    fastSettlementMs: finiteDuration(config.fastSettlementMs ?? Number.NaN, 0),
    slowSettlementMs: Math.max(
      finiteDuration(config.fastSettlementMs ?? Number.NaN, 0),
      finiteDuration(config.slowSettlementMs ?? Number.NaN, 0),
    ),
    noProgressMs: positiveInteger(config.noProgressMs, 1),
    maxSleepMs: positiveInteger(config.maxSleepMs, 1),
    judgeSettlement: config.judgeSettlement,
  };
}

/** The absolute bounds, as a judge: what every lane without one gets. A
 *  lane that gave neither bounds nor a judge reads every settle as `mid`. */
function absoluteJudge(config: AdaptiveLinkBudgetConfig): SettlementJudge {
  const fast = config.fastSettlementMs ?? 0;
  const slow = config.slowSettlementMs ?? 0;
  if (fast <= 0 && slow <= 0) return () => 'mid';
  return ({ settlementMs }) => {
    if (settlementMs <= fast) return 'fast';
    if (settlementMs >= slow) return 'slow';
    return 'mid';
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
  const judge = config.judgeSettlement ?? absoluteJudge(config);
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
  let peakInFlightLinks = 0;
  const transitions: AdaptiveLinkBudgetTransition[] = [];

  const inFlightLinks = (): number => {
    let total = 0;
    for (const unit of inFlight.values()) total += unit.links;
    return total;
  };
  const transition = (
    next: AdaptiveLinkBudgetState,
    reason: AdaptiveLinkBudgetTransitionReason,
  ): void => {
    if (state === next) return;
    if (transitions.length < ADAPTIVE_LINK_BUDGET_MAX_TRANSITIONS) {
      transitions.push({
        atMs: clock.now(),
        from: state,
        to: next,
        reason,
        windowLinks,
        inFlightLinks: inFlightLinks(),
      });
    }
    state = next;
  };
  const notePeak = (): void => {
    peakInFlightLinks = Math.max(peakInFlightLinks, inFlightLinks());
  };
  const backoff = (reason: AdaptiveLinkBudgetTransitionReason = 'slow-settlement'): void => {
    windowLinks = Math.max(config.minWindowLinks, Math.floor(windowLinks / 2));
    backoffCount++;
    transition('backoff', reason);
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
    const revealed = state === 'revealed';
    const stalled = state === 'stalled';
    inFlight.delete(id);
    const now = clock.now();
    lastProgressAtMs = now;
    if (failed) {
      failedUnits++;
      if (!revealed) backoff('failed');
      return;
    }
    settledUnits++;
    const settlementMs = Math.max(0, now - unit.submittedAtMs);
    lastSettlementMs = settlementMs;
    if (revealed) return;
    // A settle REFUTES the stall: the driver was slow, not wedged. The stall
    // closed admission while nothing settled (a wedged link must not pile
    // units behind it); with progress back, the lane reopens on the halved
    // window, which is what a settlement past noProgressMs is anyway, and
    // the next settles re-grow it. Terminal, the stall killed the whole
    // compile lane after ONE unit on the Intel iGPU (a 16-root unit settles
    // in more than 3 s there), on every login: 1 unit settled, 22 deferred
    // to the live resume lane, in the 2026-08-26 arrival matrix.
    if (stalled) {
      backoff();
      return;
    }
    const verdict = judge({
      settlementMs,
      weight: unit.weight,
      concurrency: unit.peakConcurrency,
      windowLinks,
      cheap: unit.cheap,
    });
    if (verdict === 'fast') {
      // The cheap-unit discount. A unit that linked no program settles
      // instantly whatever the driver is doing, so its speed is not headroom:
      // growing the window on it is how a lane of already-linked units (the
      // boot sweep's hidden entity views, tests/reveal_gate_wiring.test.ts)
      // ramps to the cap and submits to the wall. It still counts as
      // progress, it just buys no admission.
      if (unit.cheap) return;
      windowLinks = Math.min(config.maxWindowLinks, windowLinks + config.increaseLinks);
      maxWindowObserved = Math.max(maxWindowObserved, windowLinks);
      transition(windowLinks >= config.maxWindowLinks ? 'steady' : 'ramp', 'fast-settlement');
    } else if (verdict === 'slow') {
      backoff();
    } else {
      transition('steady', 'mid-settlement');
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
          transition('stalled', 'no-progress');
          return false;
        }
        if (canSubmit()) return true;
        await sleep(Math.min(config.maxSleepMs, config.noProgressMs - noProgressForMs));
      }
    },
    markSubmitted(id, weight) {
      if (inFlight.has(id)) return;
      if (inFlight.size === 0) lastProgressAtMs = clock.now();
      inFlight.set(id, {
        submittedAtMs: clock.now(),
        links: estimatedLinksPerUnit,
        cheap: false,
        weight: positiveWeight(weight),
        peakConcurrency: 0,
      });
      // Every unit in flight now shares the driver with this one.
      for (const unit of inFlight.values()) {
        unit.peakConcurrency = Math.max(unit.peakConcurrency, inFlight.size);
      }
      submittedUnits++;
      notePeak();
    },
    markSyncEnd(id, chargedLinks) {
      const unit = inFlight.get(id);
      if (!unit) return;
      const actualLinks = positiveInteger(chargedLinks, 1);
      unit.cheap = Number.isFinite(chargedLinks) && chargedLinks <= 0;
      unit.links = actualLinks;
      notePeak();
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
      transition('revealed', 'reveal');
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
        peakInFlightLinks,
        submittedUnits,
        settledUnits,
        failedUnits,
        backoffCount,
        noProgressCount,
        lastSettlementMs,
        transitions: transitions.slice(),
      };
    },
  };
}
