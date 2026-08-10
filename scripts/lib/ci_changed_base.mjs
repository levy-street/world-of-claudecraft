// Resolves the correct `--since` ref for `biome ci --changed` when run LOCALLY
// (npm run ci:changed, consumed by scripts/gate.mjs and .githooks/pre-push).
//
// Without --since, biome falls back to biome.json's vcs.defaultBranch
// ("origin/main"). Every feature branch here is created off the latest
// release branch, not main (root CLAUDE.md: "Base your work off the latest
// release branch ... main trails it"), so a bare `biome ci --changed` sweeps
// in the ENTIRE drift between the branch and main, often 1000+ unrelated
// files, instead of the branch's real diff. Real CI never hits this: the
// `lint` job in .github/workflows/ci.yml resolves the PR's actual base_ref
// and passes it explicitly.
//
// The first cut of this module resolved the base via `@{upstream}`. That is
// wrong: once a branch is pushed with `git push -u`, its upstream IS its own
// pushed copy on origin, so `@{upstream}...HEAD` diffs the branch against
// itself and silently returns zero changed files. That is worse than the bug
// this module exists to fix (a wrong-but-nonempty diff versus a
// silently-empty one that reports "nothing to lint").
//
// The correct base is the same one the selective gate already resolves:
// scripts/lib/gate_discovery.mjs `resolveSelectBase` (env override, then the
// newest `origin/release/*` by version sort, then `origin/main`, then
// `origin/HEAD`, each verified with `git rev-parse --verify`). Reuse it
// rather than re-deriving base resolution a second, different way; an
// unresolvable base is a hard error here too, matching that module's
// fail-loud contract instead of narrowing silently.
//
// Pure: takes an injected `run` (matching resolveSelectBase's shape) so a
// unit test never shells out.

import { resolveSelectBase } from './gate_discovery.mjs';

/**
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   run: (cmd: string, args: string[]) => { status: number | null, stdout?: string },
 * }} deps
 * @returns {string} the resolved base ref
 * @throws {Error} when no base ref can be resolved (env override invalid, and
 *   no release branch or origin base exists)
 */
export function resolveChangedBaseRef({ env = {}, run }) {
  const { base, reason } = resolveSelectBase({ env, run });
  if (!base) {
    throw new Error(`ci:changed: could not resolve a --since base ref (${reason})`);
  }
  return base;
}
