// Pure worker-count calculator for scripts/gate.mjs and scripts/gate_fast.mjs,
// split out per scripts/CLAUDE.md's module-first rule so Vitest can pin every
// branch without spawning the real gate.
//
// gate.mjs previously capped vitest at half the CPU cores, on the theory (its own header
// comment) that "an unbounded full run saturates every core and flakes the heavy sim suites
// when other work shares the machine." That theory has a gap: it only accounts for CPU. A
// dev box running several worktrees at once (this repo's own recommended workflow for
// parallel tasks) can have multiple `npm run gate` invocations each independently halving
// the SAME core count, so together they saturate every core anyway, and each vitest fork
// worker's RSS competes for a machine's finite RAM regardless of how many cores are free.
// When free memory runs out the OS starts swapping, and a worker that would pass in
// seconds instead times out waiting on swapped-in pages, presenting as a flaky test failure
// rather than a slow one.
//
// Phase 3 adds optional GATE_WORKER_TIER=low|medium|high as a *cap* on top of the free-mem
// clamp. It never replaces the clamp. GATE_MAX_WORKERS remains the expert absolute override
// (takes precedence over both the heuristic and the tier cap).
const BYTES_PER_WORKER = 768 * 1024 * 1024; // 0.75 GiB: observed RSS ceiling for one heavy
// vitest fork worker in this repo's sim/render/server suites under load, with headroom.

/** Caps applied after CPU/2 and free-mem bounds. high leaves only the heuristic. */
export const GATE_WORKER_TIER_CAPS = Object.freeze({
  low: 2,
  medium: 4,
  high: 8,
});

/**
 * @param {string | undefined | null} value
 * @returns {'low' | 'medium' | 'high' | null}
 */
export function parseGateWorkerTier(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return null;
}

/**
 * Resolve a tier label to a numeric worker cap, or undefined when unset/invalid.
 * Invalid values are ignored so a typo never hard-fails the gate.
 *
 * @param {string | undefined | null} value
 * @returns {number | undefined}
 */
export function resolveGateWorkerTierCap(value) {
  const tier = parseGateWorkerTier(value);
  if (!tier) return undefined;
  return GATE_WORKER_TIER_CAPS[tier];
}

/**
 * @param {{
 *   cpuCount: number,
 *   freeMemBytes: number,
 *   envOverride?: string | undefined,
 *   tierCap?: number | undefined,
 * }} opts
 * @returns {number}
 */
export function computeGateWorkers({ cpuCount, freeMemBytes, envOverride, tierCap }) {
  if (envOverride !== undefined) {
    const parsed = Number.parseInt(envOverride, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const cpuBound = Math.max(1, Math.floor(cpuCount / 2));
  const memBound = Math.max(1, Math.floor(freeMemBytes / BYTES_PER_WORKER));
  let workers = Math.min(cpuBound, memBound);
  if (tierCap !== undefined && tierCap !== null) {
    const cap = Number(tierCap);
    if (Number.isFinite(cap) && cap > 0) {
      workers = Math.min(workers, Math.floor(cap));
    }
  }
  return Math.max(1, workers);
}
