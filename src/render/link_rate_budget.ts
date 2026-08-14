import {
  type AdaptiveLinkBudget,
  type AdaptiveLinkBudgetConfig,
  type AdaptiveLinkBudgetSnapshot,
  createAdaptiveLinkBudget,
} from './adaptive_link_budget_core';

export interface LinkRateBudgetClock {
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LinkRateBudgetWaitOptions {
  /** Keep deadline checks frequent even when a large token debt is outstanding. */
  maxSleepMs?: number;
  shouldStop?: () => boolean;
}

export interface LinkRateBudgetConfig {
  linksPerSecond: number;
  burst: number;
}

export interface LinkRateBudget {
  readonly linksPerSecond: number;
  readonly burst: number;
  readonly unlimited: boolean;
  readonly charged: number;
  tokens(): number;
  waitMs(): number;
  awaitToken(options?: LinkRateBudgetWaitOptions): Promise<void>;
  charge(links: number): void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const MAX_INTERRUPTIBLE_WAIT_MS = 16;

function positiveInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

export function createLinkRateBudget(
  config: LinkRateBudgetConfig,
  clock: LinkRateBudgetClock,
): LinkRateBudget {
  const unlimited = !Number.isFinite(config.linksPerSecond) || config.linksPerSecond <= 0;
  const linksPerSecond = unlimited ? Number.POSITIVE_INFINITY : config.linksPerSecond;
  const burst = unlimited ? Number.POSITIVE_INFINITY : positiveInteger(config.burst);
  let tokens = burst;
  let last = clock.now();
  let charged = 0;
  const sleep = clock.sleep ?? defaultSleep;
  const refill = (): number => {
    if (unlimited) return tokens;
    const now = clock.now();
    const elapsedMs = Math.max(0, now - last);
    last = now;
    tokens = Math.min(burst, tokens + (elapsedMs * linksPerSecond) / 1000);
    return tokens;
  };
  const waitMs = (): number => {
    if (unlimited) return 0;
    const available = refill();
    return available >= 1 ? 0 : Math.ceil(((1 - available) * 1000) / linksPerSecond);
  };
  return {
    linksPerSecond,
    burst,
    unlimited,
    get charged() {
      return charged;
    },
    tokens: refill,
    waitMs,
    async awaitToken(options = {}) {
      const maxSleepMs =
        options.maxSleepMs === undefined
          ? Number.POSITIVE_INFINITY
          : Number.isFinite(options.maxSleepMs) && options.maxSleepMs > 0
            ? options.maxSleepMs
            : 1;
      for (;;) {
        if (options.shouldStop?.()) return;
        const ms = waitMs();
        if (ms <= 0) return;
        await sleep(Math.min(ms, maxSleepMs));
      }
    },
    charge(links) {
      const spent = Number.isFinite(links) ? Math.max(0, links) : 0;
      charged += spent;
      if (unlimited) return;
      refill();
      tokens -= spent;
    },
  };
}

export async function awaitSubmissionBudget(
  budget: LinkRateBudget,
  outOfTime: () => boolean,
): Promise<boolean> {
  if (outOfTime()) return false;
  if (budget.waitMs() <= 0) return true;
  await budget.awaitToken({
    maxSleepMs: MAX_INTERRUPTIBLE_WAIT_MS,
    shouldStop: outOfTime,
  });
  return !outOfTime();
}

export const EXPERIMENTAL_PREWARM_LINK_BURST = 8;

export interface SubmissionPacingKnobs {
  source: 'default' | 'query';
  mode: 'unlimited' | 'limited' | 'adaptive';
  linksPerSecond: number;
  burst: number;
  compileBatchRoots: number | null;
  hardMaxMs: number | null;
}

function positiveParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function positiveIntegerParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? positiveInteger(value) : null;
}

export function parseSubmissionPacingKnobs(search: string): SubmissionPacingKnobs {
  const params = new URLSearchParams(search);
  const experimental = params.has('perf');
  const rawRate = experimental ? params.get('linkrate') : null;
  const adaptiveRequested = experimental && params.get('linkmode') === 'adaptive';
  const adaptive = adaptiveRequested || rawRate === null;
  const parsedRate = rawRate === null ? Number.NaN : Number(rawRate);
  const linksPerSecond =
    rawRate !== null && Number.isFinite(parsedRate) && parsedRate > 0
      ? parsedRate
      : Number.POSITIVE_INFINITY;
  return {
    source: rawRate === null && !adaptiveRequested ? 'default' : 'query',
    mode: adaptive ? 'adaptive' : Number.isFinite(linksPerSecond) ? 'limited' : 'unlimited',
    // Adaptive pacing is the release default. The perf-only static rate stays
    // available for calibration, with zero retaining the unlimited control.
    linksPerSecond: adaptive ? Number.POSITIVE_INFINITY : linksPerSecond,
    burst: experimental
      ? (positiveIntegerParam(params, 'linkburst') ?? EXPERIMENTAL_PREWARM_LINK_BURST)
      : EXPERIMENTAL_PREWARM_LINK_BURST,
    compileBatchRoots: experimental ? positiveIntegerParam(params, 'compileroots') : null,
    hardMaxMs: experimental ? positiveParam(params, 'prewarmdeadline') : null,
  };
}

export interface PrewarmPacingReceipt {
  available: true;
  source: 'default' | 'query';
  mode: 'unlimited' | 'limited' | 'adaptive';
  linksPerSecond: number | null;
  burst: number | null;
  compileBatchRoots: number;
  hardMaxMs: number;
  chargedLinks: number;
  scope: 'compile-unit-sync-prologue' | 'compile-unit-lifecycle';
  adaptive?: AdaptiveLinkBudgetSnapshot;
}

export interface PrewarmPacing {
  readonly knobs: SubmissionPacingKnobs;
  readonly budget: LinkRateBudget;
  awaitSlot(outOfTime: () => boolean): Promise<boolean>;
  markSubmitted(id: string): void;
  markSyncEnd(id: string, chargedLinks: number): void;
  markSettled(id: string): void;
  markFailed(id: string): void;
  markReveal(): void;
  receipt(compileBatchRoots: number, hardMaxMs: number): PrewarmPacingReceipt;
}

export const ADAPTIVE_PREWARM_LINK_CONFIG: AdaptiveLinkBudgetConfig = {
  initialWindowLinks: 16,
  minWindowLinks: 8,
  maxWindowLinks: 32,
  initialLinkEstimate: 8,
  increaseLinks: 4,
  fastSettlementMs: 1_200,
  slowSettlementMs: 2_000,
  noProgressMs: 3_000,
  maxSleepMs: MAX_INTERRUPTIBLE_WAIT_MS,
};

export function createPrewarmPacing(search: string, clock: LinkRateBudgetClock): PrewarmPacing {
  const knobs = parseSubmissionPacingKnobs(search);
  const budget = createLinkRateBudget(knobs, clock);
  const adaptive: AdaptiveLinkBudget | null =
    knobs.mode === 'adaptive'
      ? createAdaptiveLinkBudget(ADAPTIVE_PREWARM_LINK_CONFIG, clock)
      : null;
  let chargedLinks = 0;
  return {
    knobs,
    budget,
    awaitSlot: (outOfTime) =>
      adaptive ? adaptive.awaitSlot(outOfTime) : awaitSubmissionBudget(budget, outOfTime),
    markSubmitted: (id) => adaptive?.markSubmitted(id),
    markSyncEnd: (id, links) => {
      const normalizedLinks = Number.isFinite(links) ? Math.max(0, links) : 0;
      chargedLinks += normalizedLinks;
      if (adaptive) adaptive.markSyncEnd(id, normalizedLinks);
      else budget.charge(normalizedLinks);
    },
    markSettled: (id) => adaptive?.markSettled(id),
    markFailed: (id) => adaptive?.markFailed(id),
    markReveal: () => adaptive?.markReveal(),
    receipt: (compileBatchRoots, hardMaxMs) => {
      if (adaptive) {
        return {
          available: true,
          source: knobs.source,
          mode: 'adaptive',
          linksPerSecond: null,
          burst: null,
          compileBatchRoots: positiveInteger(compileBatchRoots),
          hardMaxMs,
          chargedLinks,
          scope: 'compile-unit-lifecycle',
          adaptive: adaptive.snapshot(),
        };
      }
      return {
        available: true,
        source: knobs.source,
        mode: budget.unlimited ? 'unlimited' : 'limited',
        linksPerSecond: budget.unlimited ? null : budget.linksPerSecond,
        burst: knobs.burst,
        compileBatchRoots: positiveInteger(compileBatchRoots),
        hardMaxMs,
        chargedLinks: budget.charged,
        // Later continuations inside a compile root are observed separately by
        // the probe. Naming the controlled scope keeps a negative A/B honest.
        scope: 'compile-unit-sync-prologue',
      };
    },
  };
}
