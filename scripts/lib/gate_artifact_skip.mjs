// Pure helpers for gate orchestration dedupe (Phase 2 local-gate-perf).
// When scripts/gate.mjs has already run i18n:gen + wiki:content and checked
// i18n freshness, pretest must not regenerate the same artifacts. Standalone
// `npm test` leaves the env unset and still runs full pretest.
//
// Env contract (string "1" only; anything else is treated as off):
//   WOC_SKIP_PRETEST=1  -> scripts/pretest.mjs exits 0 without spawning gens

export const WOC_SKIP_PRETEST = 'WOC_SKIP_PRETEST';

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function shouldSkipPretest(env = process.env) {
  return env?.[WOC_SKIP_PRETEST] === '1';
}

/**
 * Env overlay applied to the gate's vitest step after generate-once.
 * @returns {Record<string, string>}
 */
export function gateVitestSkipPretestEnv() {
  return { [WOC_SKIP_PRETEST]: '1' };
}
