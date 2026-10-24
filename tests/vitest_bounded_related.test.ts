// The bounded `vitest related` selection (scripts/lib/vitest_bounded_related.mjs).
// vitest's own walk kept every test file's dependency Set alive at once and
// exhausted the CI main process's heap on this suite. The replacement must
// select EXACTLY what vitest selects (the selective gate is the merge bar, so
// a narrower set would skip tests silently), in the same order, with bounded
// concurrency. Every pin below compares against vitest's own predicate.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import {
  BOUNDED_RELATED_PROVIDE_KEY,
  filterTestsBySourceBounded,
  installBoundedRelatedFilter,
  RELATED_WALK_BATCH,
  VERIFIED_VITEST_VERSION,
  vitestBoundedRelatedPlugin,
} from '../scripts/lib/vitest_bounded_related.mjs';

type Spec = { moduleId: string };
type Config = {
  related?: string[];
  changed?: unknown;
  watch?: boolean;
  root: string;
  forceRerunTriggers: string[];
};

// A small import graph: t* are test files, s* sources. Edges are the
// transitive deps vitest's getTestDependencies would return.
const GRAPH: Record<string, string[]> = {
  '/r/t1.test.ts': ['/r/s1.ts', '/r/s2.ts'],
  '/r/t2.test.ts': ['/r/s2.ts'],
  '/r/t3.test.ts': ['/r/s3.ts'],
  '/r/t4.test.ts': [],
  '/r/t5.test.ts': ['/r/s1.ts', '/r/t4.test.ts'],
};
const SPECS: Spec[] = Object.keys(GRAPH).map((moduleId) => ({ moduleId }));

/** vitest 4.1's own predicate, verbatim in meaning (filterTestsBySource). */
function vitestReference(specs: Spec[], related: string[]): Spec[] {
  return specs.filter((s) =>
    related.some((p) => p === s.moduleId || new Set(GRAPH[s.moduleId]).has(p)),
  );
}

function run(related: string[] | undefined, extra: Partial<Config> = {}, batch?: number) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const config: Config = { related, root: '/r', forceRerunTriggers: [], ...extra };
  const result = filterTestsBySourceBounded({
    specs: SPECS,
    config,
    findChangedFiles: async () => ['/r/s3.ts', '/r/s3.ts'],
    getTestDependencies: async (spec: Spec) => {
      calls.push(spec.moduleId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return new Set(GRAPH[spec.moduleId]);
    },
    matchesAny: (patterns: string[]) => (file: string) => patterns.includes(file),
    batch,
  });
  return { result, calls, config, maxInFlight: () => maxInFlight };
}

const ids = (specs: Spec[]) => specs.map((s) => s.moduleId);

describe('filterTestsBySourceBounded selects exactly what vitest selects', () => {
  const cases: [string, string[]][] = [
    ['one changed source', ['/r/s1.ts']],
    ['a source two files share', ['/r/s2.ts']],
    ['several sources', ['/r/s1.ts', '/r/s3.ts']],
    ['a seed test file plus a source', ['/r/t4.test.ts', '/r/s3.ts']],
    ['only seeds', ['/r/t2.test.ts', '/r/t3.test.ts']],
    ['a path nothing reaches', ['/r/nowhere.ts']],
  ];

  it.each(cases)('%s, at every batch size, in spec order', async (_name, related) => {
    const expected = ids(vitestReference(SPECS, related));
    for (const batch of [1, 2, 3, RELATED_WALK_BATCH]) {
      expect(ids(await run(related, {}, batch).result), `batch ${batch}`).toEqual(expected);
    }
  });

  it('keeps a file reached only through another test file (t5 imports t4)', async () => {
    expect(ids(await run(['/r/t4.test.ts']).result)).toEqual(['/r/t4.test.ts', '/r/t5.test.ts']);
  });
});

describe('filterTestsBySourceBounded memory shape', () => {
  it('never walks more files at once than the batch', async () => {
    const r = run(['/r/s1.ts'], {}, 2);
    await r.result;
    expect(r.maxInFlight()).toBe(2);
  });

  it('skips the walk for a file that is itself a related path', async () => {
    const r = run(['/r/t1.test.ts', '/r/t2.test.ts', '/r/s3.ts']);
    expect(ids(await r.result)).toEqual(['/r/t1.test.ts', '/r/t2.test.ts', '/r/t3.test.ts']);
    expect(r.calls.sort()).toEqual(['/r/t3.test.ts', '/r/t4.test.ts', '/r/t5.test.ts']);
  });

  it('rejects a batch that is not a positive integer', async () => {
    await expect(run(['/r/s1.ts'], {}, 0).result).rejects.toThrow(/positive integer/);
    await expect(run(['/r/s1.ts'], {}, 1.5).result).rejects.toThrow(/positive integer/);
  });
});

describe("filterTestsBySourceBounded keeps vitest's early exits", () => {
  it('returns every file when no related list is set', async () => {
    const r = run(undefined);
    expect(ids(await r.result)).toEqual(ids(SPECS));
    expect(r.calls).toEqual([]);
  });

  it('returns every file when a related path matches a force-rerun trigger', async () => {
    const r = run(['/r/s1.ts', '/r/vite.config.ts'], { forceRerunTriggers: ['/r/vite.config.ts'] });
    expect(ids(await r.result)).toEqual(ids(SPECS));
    expect(r.calls).toEqual([]);
  });

  it('walks normally when the triggers match nothing', async () => {
    const r = run(['/r/s3.ts'], { forceRerunTriggers: ['/r/vite.config.ts'] });
    expect(ids(await r.result)).toEqual(['/r/t3.test.ts']);
  });

  it('runs nothing for an empty related list outside watch mode', async () => {
    expect(await run([]).result).toEqual([]);
  });

  it('fills related from the VCS for --changed, deduplicated', async () => {
    const r = run(undefined, { changed: 'HEAD' });
    expect(ids(await r.result)).toEqual(['/r/t3.test.ts']);
    expect(r.config.related).toEqual(['/r/s3.ts']);
  });
});

describe('installBoundedRelatedFilter', () => {
  const fakeVitest = () => {
    const specifications = {
      filterTestsBySource: async (_specs: Spec[]): Promise<Spec[]> => [],
      getTestDependencies: async (spec: Spec) => new Set(GRAPH[spec.moduleId]),
    };
    return {
      specifications,
      config: { related: ['/r/s2.ts'], root: '/r', forceRerunTriggers: [] } as Config,
      vcs: { findChangedFiles: async () => [] },
    };
  };

  const quiet = { log: () => {} };

  it('replaces the live method with the bounded selection', async () => {
    const v = fakeVitest();
    const original = v.specifications.filterTestsBySource;
    installBoundedRelatedFilter(v, quiet);
    expect(v.specifications.filterTestsBySource).not.toBe(original);
    expect(ids(await v.specifications.filterTestsBySource(SPECS))).toEqual([
      '/r/t1.test.ts',
      '/r/t2.test.ts',
    ]);
  });

  // The merged CI leg passes the floor test files themselves as related
  // paths; through the installed method each must select itself, reached or
  // not (t4 imports nothing), alongside what the changed source reaches.
  it('keeps every seed test file through the installed method', async () => {
    const v = fakeVitest();
    v.config.related = ['/r/s3.ts', '/r/t4.test.ts', '/r/t2.test.ts'];
    installBoundedRelatedFilter(v, quiet);
    expect(ids(await v.specifications.filterTestsBySource(SPECS))).toEqual(
      ids(vitestReference(SPECS, v.config.related)),
    );
    expect(ids(await v.specifications.filterTestsBySource(SPECS))).toEqual([
      '/r/t2.test.ts',
      '/r/t3.test.ts',
      '/r/t4.test.ts',
      '/r/t5.test.ts',
    ]);
  });

  it('logs one line per install, and only for a related run', async () => {
    const lines: string[] = [];
    const v = fakeVitest();
    installBoundedRelatedFilter(v, { log: (line) => lines.push(line) });
    await v.specifications.filterTestsBySource(SPECS);
    await v.specifications.filterTestsBySource(SPECS);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[bounded-related\] related selection over 5 test file\(s\)/);
    expect(lines[0]).toContain(`batches of ${RELATED_WALK_BATCH}`);

    const plain = fakeVitest();
    plain.config.related = undefined;
    const silent: string[] = [];
    installBoundedRelatedFilter(plain, { log: (line) => silent.push(line) });
    expect(ids(await plain.specifications.filterTestsBySource(SPECS))).toEqual(ids(SPECS));
    expect(silent).toEqual([]);
  });

  it('installs once per instance', () => {
    const v = fakeVitest();
    installBoundedRelatedFilter(v, quiet);
    const installed = v.specifications.filterTestsBySource;
    installBoundedRelatedFilter(v, quiet);
    expect(v.specifications.filterTestsBySource).toBe(installed);
  });

  it('refuses any vitest release but the verified one', () => {
    expect(VERIFIED_VITEST_VERSION).toBe('4.1.12');
    expect(() =>
      installBoundedRelatedFilter(fakeVitest(), { ...quiet, vitestVersion: '4.2.0' }),
    ).toThrow(/verified against vitest 4\.1\.12, found 4\.2\.0/);
    // The installed release is the verified one, or every run would throw.
    const pkg = JSON.parse(
      readFileSync(path.resolve(__dirname, '../node_modules/vitest/package.json'), 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe(VERIFIED_VITEST_VERSION);
  });

  it('fails loudly when the vitest internals it replaces are gone', () => {
    const noFilter = fakeVitest() as Record<string, unknown>;
    noFilter.specifications = { getTestDependencies: async () => new Set() };
    expect(() => installBoundedRelatedFilter(noFilter, quiet)).toThrow(
      /filterTestsBySource is missing/,
    );
    const noDeps = fakeVitest() as Record<string, unknown>;
    noDeps.specifications = { filterTestsBySource: async () => [] };
    expect(() => installBoundedRelatedFilter(noDeps, quiet)).toThrow(
      /getTestDependencies is missing/,
    );
    const noVcs = fakeVitest() as Record<string, unknown>;
    delete noVcs.vcs;
    expect(() => installBoundedRelatedFilter(noVcs, quiet)).toThrow(/findChangedFiles is missing/);
  });
});

describe('wiring', () => {
  // The plugin provides this value from configureVitest in THIS run's main
  // process, right after installing; it is per run (not inherited like an
  // env var), so it proves the override is live for every vitest run of
  // this config, `vitest related` included.
  it('is installed in this very run', () => {
    expect(vitestBoundedRelatedPlugin().name).toBe('woc-vitest-bounded-related');
    expect((inject as (key: string) => unknown)(BOUNDED_RELATED_PROVIDE_KEY)).toBe(true);
  });

  it('is registered only inside the process.env.VITEST branch of vite.config.ts', () => {
    const config = readFileSync(path.resolve(__dirname, '../vite.config.ts'), 'utf8');
    expect(config.split('vitestBoundedRelatedPlugin()').length - 1).toBe(1);
    const branch = /\.\.\.\(process\.env\.VITEST\s*\?\s*\[([^\]]*)\]\s*:\s*\[\]\)/.exec(config);
    expect(branch).not.toBeNull();
    expect(branch![1]).toContain('vitestBoundedRelatedPlugin()');
  });
});
