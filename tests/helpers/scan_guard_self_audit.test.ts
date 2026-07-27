import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './scan_guard_self_audit';

// A guard's own helper is the classic unpinned arm: production source never
// exercises it, so `codeOnly`, an extension filter, or a whole banned-spelling
// list can be deleted with every suite still green (#2499). Only a synthetic
// source file reaches these arms, so each one gets one here.

describe('expectScansOnlyThroughSharedWalkers', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'woc-scan-guard-self-audit-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const guard = (body: string): string => {
    const file = path.join(root, 'fake_guard.test.ts');
    writeFileSync(file, body);
    return pathToFileURL(file).href;
  };

  const clean = [
    "import { cssTreeUnder } from './helpers/css_tree_under';",
    "const files = cssTreeUnder('/x').files;",
  ].join('\n');

  it('passes a guard that reads only through the named walker', () => {
    expect(() =>
      expectScansOnlyThroughSharedWalkers(guard(clean), ['css_tree_under']),
    ).not.toThrow();
  });

  it.each([
    ['readdirSync', "const own = readdirSync('/x');"],
    ['opendirSync', "const own = opendirSync('/x');"],
    ['globSync', "const own = globSync('/x/*.css');"],
    ['readdir', "const own = await readdir('/x');"],
    ['opendir', "const own = await opendir('/x');"],
  ])('fails on a hand-rolled %s beside the walker', (spelling, line) => {
    // One case per spelling: a list that bans only `readdirSync` bans only
    // `readdirSync`, and every other row here rebuilds the same flat read with
    // that count still at zero.
    expect(() =>
      expectScansOnlyThroughSharedWalkers(guard(`${clean}\n${line}`), ['css_tree_under']),
    ).toThrow(new RegExp(`reads a directory itself via ${spelling}\\(`));
  });

  it('fails when the walker import is gone, even though the module name is still written', () => {
    // The trap this helper exists to survive: a needle written whole matches its
    // own assertion line, so a `toContain('helpers/css_tree_under')` pin passes
    // with the import deleted. Here the bare name appears in the file and the
    // check still fails, because it wants the IMPORT STATEMENT shape.
    const body = ["const walker = 'helpers/css_tree_under';", 'const files = walk(walker);'].join(
      '\n',
    );
    expect(() => expectScansOnlyThroughSharedWalkers(guard(body), ['css_tree_under'])).toThrow(
      /no longer imports helpers\/css_tree_under/,
    );
  });

  it('checks every walker it is given, not just the first', () => {
    const body = ["import { tsFilesUnder } from './helpers/ts_files_under';"].join('\n');
    expect(() =>
      expectScansOnlyThroughSharedWalkers(guard(body), ['ts_files_under', 'css_tree_under']),
    ).toThrow(/no longer imports helpers\/css_tree_under/);
  });

  it('ignores a directory read that is only mentioned in a comment', () => {
    // Prose about the flat `readdirSync` a guard NO LONGER makes is exactly what
    // these files are full of after the fix, so a strip-free scan would fail
    // every one of them.
    const body = [
      '/* this used to be a second, separately-flat readdirSync(dir) */',
      '// and a line comment mentioning readdirSync(dir) too',
      clean,
    ].join('\n');
    expect(() =>
      expectScansOnlyThroughSharedWalkers(guard(body), ['css_tree_under']),
    ).not.toThrow();
  });

  it('does not let a URL swallow the rest of its line while stripping comments', () => {
    // The shipped bug this strip is written against (#2499): a `[^:]` guard is
    // what keeps `https://` from reading as a line comment and deleting the live
    // code after it, which would hide a hand-rolled read on that same line.
    const body = [clean, "const doc = 'https://example.com'; const own = readdirSync('/x');"].join(
      '\n',
    );
    expect(() => expectScansOnlyThroughSharedWalkers(guard(body), ['css_tree_under'])).toThrow(
      /reads a directory itself via readdirSync\(/,
    );
  });
});
