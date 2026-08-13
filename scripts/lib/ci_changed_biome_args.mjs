// Pure builder for the biome argv `ci_changed.mjs` spawns, extracted so a
// Vitest suite can pin the exact argv (including the deliberate absence of
// a version suffix, see the comment below) without spawning real biome or
// executing the orchestrator's top-level side effects.

// `--no-install` makes npx resolve the version already installed in
// node_modules (the one this repo pins via package.json "@biomejs/biome")
// instead of fetching or falling back to a different cached/global copy.
// Deliberately UNVERSIONED here: a hardcoded `@x.y.z` suffix would be a
// second, unguarded copy of the pinned version that silently goes stale the
// next time package.json's biome dependency bumps, at which point
// `--no-install @biomejs/biome@<stale>` hard-fails for everyone (gate,
// gate:fast, and the pre-push floor) until someone finds this second copy.
/** @param {string} since @returns {string[]} */
export function buildBiomeArgs(since) {
  return [
    '--no-install',
    '@biomejs/biome',
    'ci',
    '--changed',
    `--since=${since}`,
    '--no-errors-on-unmatched',
  ];
}
