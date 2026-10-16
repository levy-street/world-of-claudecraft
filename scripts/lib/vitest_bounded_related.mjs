// Bounded-memory `vitest related` selection.
//
// Vitest's own selection (VitestSpecifications.filterTestsBySource, vitest
// 4.1) walks the import graph of EVERY collected test file at once
// (`Promise.all` over all of them) and keeps each file's whole transitive
// dependency Set alive until the last walk finishes, then tests
// `related.some((p) => p === spec.moduleId || deps.has(p))` per file. Its
// heap is therefore O(test files x reachable graph), all live together. On
// this suite that crossed the CI runner's default heap (about 4 GB) and every
// selective PR shard died in the main process with "Ineffective
// mark-compacts near heap limit" (exit 134) before a single test reported.
//
// This module installs a drop-in replacement for that one method on the live
// Vitest instance. It decides each file with the SAME predicate, in the same
// order, with the same early exits; it only (1) walks a bounded batch of
// files at a time, (2) keeps one boolean per file instead of its dependency
// Set, and (3) skips the walk for a file that is itself a related path, whose
// answer the predicate already fixes. The selected set is identical; only
// the peak heap changes (measured on the full suite with CI's shard argv at
// the 4 GB ceiling: stock OOMs at about 3.97 GB live; this peaks at 0.57 GB
// and keeps the identical 4308 of 5699 files).
//
// It replaces vitest internals, so it is pinned to the vitest release it was
// verified against and refuses to install on any other: a bump must re-check
// the stock method and re-measure equivalence before moving the pin.

import { createRequire } from 'node:module';

/** Files walked concurrently. Bounds the live dependency Sets. */
export const RELATED_WALK_BATCH = 64;

/** The vitest release whose filterTestsBySource this reproduces. */
export const VERIFIED_VITEST_VERSION = '4.1.11';

/** provide/inject key a suite reads to prove the override is live in its run. */
export const BOUNDED_RELATED_PROVIDE_KEY = 'wocBoundedRelated';

const INSTALLED = Symbol.for('woc.vitestBoundedRelated');

/**
 * The selection itself, with vitest's semantics and bounded memory.
 *
 * @template {{ moduleId: string }} S
 * @param {{
 *   specs: readonly S[],
 *   config: { related?: string[], changed?: unknown, watch?: boolean, root: string, forceRerunTriggers: string[] },
 *   findChangedFiles: (opts: { root: string, changedSince: unknown }) => Promise<string[]>,
 *   getTestDependencies: (spec: S) => Promise<Set<string>>,
 *   matchesAny: (patterns: string[]) => (file: string) => boolean,
 *   batch?: number,
 * }} io
 * @returns {Promise<S[]>}
 */
export async function filterTestsBySourceBounded(io) {
  const { specs, config, findChangedFiles, getTestDependencies, matchesAny } = io;
  const batch = io.batch ?? RELATED_WALK_BATCH;
  if (!Number.isInteger(batch) || batch < 1) {
    throw new Error(`related walk batch must be a positive integer, got ${batch}`);
  }
  // Same prologue as vitest: --changed fills `related` from the VCS once.
  if (config.changed && !config.related) {
    const changed = await findChangedFiles({ root: config.root, changedSince: config.changed });
    config.related = Array.from(new Set(changed));
  }
  const related = config.related;
  if (!related) return [...specs];
  const triggers = config.forceRerunTriggers;
  if (triggers.length) {
    const matcher = matchesAny(triggers);
    if (related.some((file) => matcher(file))) return [...specs];
  }
  if (!config.watch && !related.length) return [];

  const relatedSet = new Set(related);
  /** @type {S[]} */
  const running = [];
  for (let i = 0; i < specs.length; i += batch) {
    const slice = specs.slice(i, i + batch);
    const keep = await Promise.all(
      slice.map(async (spec) => {
        if (relatedSet.has(spec.moduleId)) return true;
        const deps = await getTestDependencies(spec);
        return related.some((p) => deps.has(p));
      }),
    );
    slice.forEach((spec, j) => {
      if (keep[j]) running.push(spec);
    });
  }
  return running;
}

/**
 * Replace `vitest.specifications.filterTestsBySource` on a live Vitest
 * instance. Throws when the internals it relies on are missing or the vitest
 * release is not the verified one, so an upgrade fails every run loudly
 * instead of silently reverting to the unbounded walk or selecting
 * differently. Idempotent per instance.
 *
 * @param {any} vitest the Vitest instance (configureVitest context)
 * @param {{ batch?: number, vitestVersion?: string, log?: (line: string) => void }} [options]
 */
export function installBoundedRelatedFilter(vitest, options = {}) {
  const require = createRequire(import.meta.url);
  const version = options.vitestVersion ?? require('vitest/package.json').version;
  if (version !== VERIFIED_VITEST_VERSION) {
    throw new Error(
      `vitest_bounded_related: verified against vitest ${VERIFIED_VITEST_VERSION}, found ` +
        `${version}. Re-check stock filterTestsBySource against ` +
        'scripts/lib/vitest_bounded_related.mjs, re-measure equivalence, then move the pin.',
    );
  }
  const specifications = vitest?.specifications;
  for (const name of ['filterTestsBySource', 'getTestDependencies']) {
    if (typeof specifications?.[name] !== 'function') {
      throw new Error(
        `vitest_bounded_related: vitest.specifications.${name} is missing; vitest internals ` +
          'changed, re-check scripts/lib/vitest_bounded_related.mjs against the new release',
      );
    }
  }
  if (typeof vitest.vcs?.findChangedFiles !== 'function') {
    throw new Error('vitest_bounded_related: vitest.vcs.findChangedFiles is missing');
  }
  if (specifications[INSTALLED]) return;
  // The same picomatch vitest itself resolves, so trigger globs match alike.
  const pm = createRequire(require.resolve('vitest/package.json'))('picomatch');
  const log = options.log ?? ((line) => console.log(line));
  const batch = options.batch ?? RELATED_WALK_BATCH;
  let announced = false;
  specifications.filterTestsBySource = (specs) => {
    if (!announced && (vitest.config.related || vitest.config.changed)) {
      // One line in every related run's log, so a job log shows which
      // selection decided the test set.
      announced = true;
      log(
        `[bounded-related] related selection over ${specs.length} test file(s): bounded walk, ` +
          `batches of ${batch} (scripts/lib/vitest_bounded_related.mjs, vitest ${version})`,
      );
    }
    return filterTestsBySourceBounded({
      specs,
      config: vitest.config,
      findChangedFiles: (opts) => vitest.vcs.findChangedFiles(opts),
      getTestDependencies: (spec) => specifications.getTestDependencies(spec),
      matchesAny: (patterns) => pm(patterns),
      batch,
    });
  };
  specifications[INSTALLED] = true;
}

/** The Vitest plugin vite.config.ts registers under VITEST. */
export function vitestBoundedRelatedPlugin() {
  return {
    name: 'woc-vitest-bounded-related',
    /** @param {{ vitest: any, project: { provide(key: string, value: unknown): void } }} context */
    configureVitest({ vitest, project }) {
      installBoundedRelatedFilter(vitest);
      project.provide(BOUNDED_RELATED_PROVIDE_KEY, true);
    },
  };
}
