// The image build context has to carry everything vite.config.ts imports.
//
// .dockerignore excludes `scripts/*` and allowlists individual files under it.
// vite.config.ts imports several of those at module scope, so an import whose
// target is not allowlisted does not fail at review or in CI (both run with the
// whole repo present); it fails inside `docker compose build` with
// "failed to load config from /app/vite.config.ts", which is the LAST step
// before a deploy and the first one nobody watches.
//
// It has shipped twice: PR #3353 (build_bundle_pregen.mjs) and then the
// ci_balanced_sequencer.mjs chain in v0.38.0, which broke every environment's
// image build until this guard landed. The string pins elsewhere in the suite
// (`expect(dockerignore).toContain('!scripts/build_bot.mjs')`) cannot catch it,
// because a new import has no pin until someone remembers to write one. This
// test derives the set from the config's own imports instead.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectLocalImportClosure,
  isIgnoredByDockerignore,
} from '../scripts/lib/dockerignore_context.mjs';

const repoRoot = new URL('../', import.meta.url);

function readRepoFile(path: string): string | null {
  try {
    return readFileSync(new URL(path, repoRoot), 'utf8');
  } catch {
    return null;
  }
}

const dockerignore = readRepoFile('.dockerignore') ?? '';

describe('vite.config.ts survives the image build context', () => {
  it('reaches the image with every file it imports', () => {
    const closure = collectLocalImportClosure('vite.config.ts', readRepoFile);
    const dropped = closure.filter((path) => isIgnoredByDockerignore(dockerignore, path));
    // Named, not just counted: the failure message has to say which file to
    // allowlist, since the docker error only names vite.config.ts itself.
    expect(dropped).toEqual([]);
  });

  it('walks past the entry into transitive imports', () => {
    // The v0.38.0 break was two hops deep (vite.config.ts imports the
    // sequencer, which imports the partitioner, which imports the weights
    // JSON), so a walk that stopped at direct imports would have missed it.
    const closure = collectLocalImportClosure('vite.config.ts', readRepoFile);
    expect(closure).toContain('scripts/ci_balanced_sequencer.mjs');
    expect(closure).toContain('scripts/ci_shard_partition.mjs');
    expect(closure).toContain('scripts/ci_shard_weights.generated.json');
  });
});

describe('isIgnoredByDockerignore', () => {
  const rules = [
    'scripts/*',
    '!scripts/build_server.mjs',
    '!scripts/i18n_*.mjs',
    '!scripts/lib/',
    '!scripts/sfx/**',
  ].join('\n');

  it('drops a file under a wildcard-excluded directory', () => {
    expect(isIgnoredByDockerignore(rules, 'scripts/ci_shard_partition.mjs')).toBe(true);
  });

  it('keeps a file the allowlist names outright', () => {
    expect(isIgnoredByDockerignore(rules, 'scripts/build_server.mjs')).toBe(false);
  });

  it('keeps a file matched by an allowlisted glob, and only that glob', () => {
    expect(isIgnoredByDockerignore(rules, 'scripts/i18n_modulepreload.mjs')).toBe(false);
    expect(isIgnoredByDockerignore(rules, 'scripts/sfx_gain.mjs')).toBe(true);
  });

  it('carries a directory allowlist down to its contents', () => {
    expect(isIgnoredByDockerignore(rules, 'scripts/lib/ci_shard_plan.mjs')).toBe(false);
    expect(isIgnoredByDockerignore(rules, 'scripts/sfx/pack/tone.mjs')).toBe(false);
  });

  it('excludes a directory subtree, which is why the lib allowlist is needed', () => {
    // `scripts/*` alone would take scripts/lib with it. If this ever reports
    // false, the directory-tail semantics are gone and every allowlist line
    // under a directory pattern is silently doing nothing.
    expect(isIgnoredByDockerignore('scripts/*', 'scripts/lib/ci_shard_plan.mjs')).toBe(true);
  });

  it('leaves an unmatched path in the context', () => {
    expect(isIgnoredByDockerignore(rules, 'src/main.ts')).toBe(false);
  });

  it('ignores comments and blank lines', () => {
    expect(isIgnoredByDockerignore('# scripts/*\n\n', 'scripts/anything.mjs')).toBe(false);
  });

  it('lets the last matching rule win in both directions', () => {
    expect(isIgnoredByDockerignore('scripts/*\n!scripts/a.mjs', 'scripts/a.mjs')).toBe(false);
    expect(isIgnoredByDockerignore('!scripts/a.mjs\nscripts/*', 'scripts/a.mjs')).toBe(true);
  });
});

describe('collectLocalImportClosure', () => {
  const files: Record<string, string> = {
    'entry.ts':
      "import { a } from './one.mjs';\nimport data from './data.json' with { type: 'json' };",
    'one.mjs': "import { b } from './nested/two.mjs';\nimport 'vitest/node';",
    'nested/two.mjs': "import { c } from '../one.mjs';",
    'data.json': '{}',
  };
  const read = (path: string) => files[path] ?? null;

  it('returns the entry plus everything reachable from it', () => {
    expect(collectLocalImportClosure('entry.ts', read).sort()).toEqual([
      'data.json',
      'entry.ts',
      'nested/two.mjs',
      'one.mjs',
    ]);
  });

  it('resolves parent traversal rather than emitting a bogus path', () => {
    expect(collectLocalImportClosure('nested/two.mjs', read).sort()).toEqual([
      'nested/two.mjs',
      'one.mjs',
    ]);
  });

  it('terminates on an import cycle', () => {
    // one.mjs and nested/two.mjs import each other.
    expect(collectLocalImportClosure('one.mjs', read)).toHaveLength(2);
  });

  it('skips bare package specifiers, which the image installs itself', () => {
    expect(collectLocalImportClosure('one.mjs', read)).not.toContain('vitest/node');
  });

  it('drops a path that does not resolve to a readable file', () => {
    expect(collectLocalImportClosure('entry.ts', () => null)).toEqual([]);
  });
});
