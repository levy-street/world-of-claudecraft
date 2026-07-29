import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

// The mechanical half of the shared-walker rule in tests/CLAUDE.md: a guard that
// scans a directory of sources reads it through helpers/ts_files_under.ts or
// helpers/css_tree_under.ts, never its own directory call.
//
// A behavior test cannot cover that. Every scan root in this repo is flat or
// nearly so, so a producer built on a hand-rolled read returns the same list as
// the shared walk today, and the guard's own assertions cannot tell them apart:
// the drift only shows up the day something moves down a level, which is the
// silent narrowing the rule exists to stop (#2485, #2489, #2502). So the pin is a
// source scan of the guard file itself.
//
// It lives here rather than being copied per guard because the two ways to write
// it wrong are both easy to re-derive. FIRST, a needle written whole matches its
// own assertion line, so the pin passes with the import deleted; that is why the
// walker check below is a regex for the IMPORT STATEMENT shape, which a call
// site's bare `'css_tree_under'` argument cannot satisfy, rather than a substring
// the caller has to remember to split. SECOND, banning one spelling bans one
// spelling: `opendirSync`, `globSync`, and `fs.promises.readdir` all rebuild a
// hand-rolled walk with a `readdirSync` count still at zero.

/** Every way this repo could open a directory, all of them equally banned in a guard. */
const DIRECTORY_READS = ['readdirSync(', 'opendirSync(', 'globSync(', 'readdir(', 'opendir('];

/**
 * Assert that the test file at `sourceUrl` (pass `import.meta.url`) contains no
 * directory read of its own, and imports each walker in `walkerModules` (bare
 * module names under `helpers/`, e.g. `'css_tree_under'`).
 *
 * Comments are stripped first, so prose about a `readdirSync` this file no longer
 * makes cannot fail the pin. The line-comment strip keeps a `://` in a URL from
 * eating the rest of its line, which is a live bug this repo has already shipped
 * once in a comment stripper (#2499, the steam forbidden-login scan).
 */
export function expectScansOnlyThroughSharedWalkers(
  sourceUrl: string,
  walkerModules: string[],
): void {
  const name = fileURLToPath(sourceUrl).split('/').pop() ?? sourceUrl;
  const code = readFileSync(fileURLToPath(sourceUrl), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const spelling of DIRECTORY_READS) {
    expect(
      code.split(spelling).length - 1,
      `${name} reads a directory itself via ${spelling}: use the shared walker instead`,
    ).toBe(0);
  }
  for (const walker of walkerModules) {
    expect(
      new RegExp(`from\\s+'\\.\\/helpers\\/${walker}'`).test(code),
      `${name} no longer imports helpers/${walker}`,
    ).toBe(true);
  }
}
