// Pure worker-count calculator for scripts/gate.mjs, split out per scripts/CLAUDE.md's
// module-first rule so Vitest can pin every branch without spawning the real gate.
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
const BYTES_PER_WORKER = 768 * 1024 * 1024; // 0.75 GiB: observed RSS ceiling for one heavy
// vitest fork worker in this repo's sim/render/server suites under load, with headroom.

export function computeGateWorkers({ cpuCount, freeMemBytes, envOverride }) {
  if (envOverride !== undefined) {
    const parsed = Number.parseInt(envOverride, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const cpuBound = Math.max(1, Math.floor(cpuCount / 2));
  const memBound = Math.max(1, Math.floor(freeMemBytes / BYTES_PER_WORKER));
  return Math.min(cpuBound, memBound);
}
