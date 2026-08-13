import { describe, expect, it } from 'vitest';
import { resolveChangedBaseRef } from '../scripts/lib/ci_changed_base.mjs';
import { buildBiomeArgs } from '../scripts/lib/ci_changed_biome_args.mjs';

type Run = (cmd: string, args: string[]) => { status: number | null; stdout?: string };

describe('resolveChangedBaseRef', () => {
  it('honors an explicit GATE_SELECT_BASE override once it verifies', () => {
    const run: Run = (_cmd, args) => {
      if (args[0] === 'rev-parse') return { status: 0 };
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
    const ref = resolveChangedBaseRef({ env: { GATE_SELECT_BASE: 'origin/release/v0.35.0' }, run });
    expect(ref).toBe('origin/release/v0.35.0');
  });

  it('throws when GATE_SELECT_BASE does not resolve to a commit', () => {
    const run: Run = (_cmd, args) => {
      if (args[0] === 'rev-parse') return { status: 128 };
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
    expect(() => resolveChangedBaseRef({ env: { GATE_SELECT_BASE: 'nope' }, run })).toThrow(
      /GATE_SELECT_BASE="nope"/,
    );
  });

  it(
    'bypasses the @{upstream} trap: a pushed branch whose upstream is its own copy ' +
      'must still resolve a real integration base, never that self-referencing ref',
    () => {
      // Regression for the bug this module used to have: after `git push -u`, a
      // branch's `@{upstream}` IS its own pushed copy on origin, so diffing
      // against it returns zero changed files. The fixed resolver never
      // consults `@{upstream}` at all; it goes straight to the shared
      // resolveSelectBase strategy (newest origin/release/*, then origin/main,
      // then origin/HEAD).
      const run: Run = (_cmd, args) => {
        if (args[0] === 'for-each-ref') {
          return { status: 0, stdout: 'origin/release/v0.36.0\norigin/release/v0.35.0\n' };
        }
        if (args[0] === 'rev-parse' && args.includes('origin/release/v0.36.0^{commit}')) {
          return { status: 0 };
        }
        throw new Error(`unexpected git ${args.join(' ')}`);
      };
      const ref = resolveChangedBaseRef({ env: {}, run });
      expect(ref).toBe('origin/release/v0.36.0');
    },
  );

  it('falls back to origin/main when no release branch resolves', () => {
    const run: Run = (_cmd, args) => {
      if (args[0] === 'for-each-ref') return { status: 0, stdout: '' };
      if (args[0] === 'rev-parse' && args.includes('origin/main^{commit}')) return { status: 0 };
      if (args[0] === 'rev-parse') return { status: 128 };
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
    const ref = resolveChangedBaseRef({ env: {}, run });
    expect(ref).toBe('origin/main');
  });

  it('falls back to origin/HEAD when neither a release branch nor origin/main resolves', () => {
    const run: Run = (_cmd, args) => {
      if (args[0] === 'for-each-ref') return { status: 0, stdout: '' };
      if (args[0] === 'rev-parse' && args.includes('origin/HEAD^{commit}')) return { status: 0 };
      if (args[0] === 'rev-parse') return { status: 128 };
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
    const ref = resolveChangedBaseRef({ env: {}, run });
    expect(ref).toBe('origin/HEAD');
  });

  it('throws a clear error when nothing resolves, rather than silently narrowing', () => {
    const run: Run = (_cmd, args) => {
      if (args[0] === 'for-each-ref') return { status: 0, stdout: '' };
      if (args[0] === 'rev-parse') return { status: 128 };
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
    expect(() => resolveChangedBaseRef({ env: {}, run })).toThrow(
      /could not resolve a --since base ref/,
    );
  });
});

describe('buildBiomeArgs', () => {
  it('pins --no-install and --changed with the resolved base, and never a version suffix', () => {
    const args = buildBiomeArgs('origin/release/v0.36.0');
    expect(args).toEqual([
      '--no-install',
      '@biomejs/biome',
      'ci',
      '--changed',
      '--since=origin/release/v0.36.0',
      '--no-errors-on-unmatched',
    ]);
    // Regression guard: a hardcoded `@x.y.z` suffix here is a second, unguarded
    // copy of package.json's pinned biome version that goes stale silently.
    expect(args.some((a) => /^@biomejs\/biome@/.test(a))).toBe(false);
  });
});
