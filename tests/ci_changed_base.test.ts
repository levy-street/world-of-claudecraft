import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveChangedBaseRef } from '../scripts/lib/ci_changed_base.mjs';
import { buildBiomeArgs } from '../scripts/lib/ci_changed_biome_args.mjs';

// The injected-run suites below structurally cannot see an orchestrator's own
// spawn flags, and that blind spot bit all three once: through cmd.exe, the
// caret in resolveSelectBase's `ref^{commit}` probes is eaten, every base
// candidate "fails" to verify on Windows, and the run dies before linting or
// selecting anything. git is a real executable; only the npx/npm execs need
// the .cmd shim.
//
// These scan the sources, and they assert the ABSENCE of the bad pattern
// rather than the presence of one known-good line. A presence pin would stay
// green if a second, shelled `spawnSync('git', ...)` were added beside the
// good helper, which is exactly how the bug would come back, and it would red
// on a cosmetic reflow of the line it quotes.
const GIT_RUNNERS = [
  { file: 'ci_changed.mjs', anchor: 'function run(cmd, args) {', end: '\n}' },
  { file: 'gate_select.mjs', anchor: 'const git = (cmd, args) => {', end: '\n};' },
  { file: 'gate_shadow.mjs', anchor: 'const git = (cmd, args) => {', end: '\n};' },
] as const;

// import.meta.url, not process.cwd(): the scan must find the sources whatever
// directory vitest was started from (tests/ci_workflow.test.ts does the same).
const readScript = (file: string) =>
  readFileSync(new URL(`../scripts/${file}`, import.meta.url), 'utf8');

/** Every `spawnSync(...)` call in a source, sliced by paren depth so the
 *  assertions run against CALL text and never against prose in a comment. */
function spawnCalls(src: string): string[] {
  const out: string[] = [];
  const re = /spawnSync\(/g;
  let m: RegExpExecArray | null = re.exec(src);
  for (; m !== null; m = re.exec(src)) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    out.push(src.slice(m.index, i + 1));
  }
  return out;
}

/** A bare `shell` shorthand or an explicit `shell: true` in a spawn's opts. */
const SHELLED = /shell\s*[,}]|shell:\s*true/;

describe('gate orchestrators spawn git without a shell', () => {
  it.each(GIT_RUNNERS)('$file: the git runner opts out of the shell', ({ file, anchor, end }) => {
    const src = readScript(file);
    const start = src.indexOf(anchor);
    expect(start, `${file}: the git runner was renamed or reshaped`).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf(end, start) + end.length);
    const calls = spawnCalls(body);
    expect(calls.length, `${file}: the git runner spawns nothing`).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `${file}: git runner must pass shell: false`).toMatch(/shell:\s*false/);
      expect(call, `${file}: git runner must not carry a shell`).not.toMatch(SHELLED);
    }
  });

  it.each(GIT_RUNNERS.map((r) => r.file))(
    '%s: no direct git spawn carries a shell either',
    (file) => {
      const src = readScript(file);
      const direct = spawnCalls(src).filter((c) => /spawnSync\(\s*'git'/.test(c));
      for (const call of direct) {
        expect(call, `${file}: a direct git spawn must pass shell: false`).toMatch(
          /shell:\s*false/,
        );
        expect(call, `${file}: a direct git spawn must not carry a shell`).not.toMatch(SHELLED);
      }
    },
  );

  it('keeps the shell for the npx exec, which really is a .cmd on Windows', () => {
    // The fix is scoped to git: removing the shim everywhere would break the
    // biome exec, so pin that this one still has it.
    const npx = spawnCalls(readScript('ci_changed.mjs')).find((c) => /spawnSync\(\s*'npx'/.test(c));
    expect(npx, 'the npx biome exec went missing').toBeDefined();
    expect(npx).toMatch(SHELLED);
  });
});

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
