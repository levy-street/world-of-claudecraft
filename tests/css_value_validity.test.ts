// Health guard for the extracted CSS modules (src/styles). Lightning CSS passes
// var() through unresolved, so a malformed color value like `color: var(--x) b0` (a
// dangling 8-digit-hex alpha left over from tokenizing a literal hex into a var) builds
// clean and only fails silently in the browser, where the whole declaration is dropped
// and the element falls back to inherited color. The .se-preview-hint rule shipped that
// bug from its original feature commit. This scans every module for that bug class so it
// cannot recur, and auto-covers any module added later at ANY DEPTH: it walks the
// directory recursively (helpers/css_tree_under.ts), because a miss here is a silent
// pass, and the single-level read this replaces would have let a sheet moved one folder
// down leave the scan with no failure and no diff (#2502). The header used to promise
// that auto-coverage while the read stopped at the top level.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cssTreeUnder } from './helpers/css_tree_under';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';

const STYLES_DIR = fileURLToPath(new URL('../src/styles/', import.meta.url));

// Every module this guard scans, keyed by its path relative to src/styles.
// Parameterized on the root so the recursion case below can drive this exact
// producer over a fixture tree: the real tree is flat, so no assertion over it
// can tell a recursive walk from a single-level one.
function sheets(root = STYLES_DIR): { file: string; css: string }[] {
  return cssTreeUnder(root).files.map(({ file, full }) => ({
    file,
    css: readFileSync(full, 'utf8').replace(/\r\n/g, '\n'),
  }));
}

const SHEETS = sheets();
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('src/styles CSS value validity', () => {
  // The single-value color longhands take exactly one color, so a var() followed by
  // another value token is always invalid. Limited to the strictly-single-value
  // longhands: border-color (1 to 4 colors), fill/stroke (SVG paint accepts url() + a
  // fallback), and custom properties (untyped, may legally hold token lists) are
  // excluded to avoid false positives. The leading boundary keeps `--x-color:` custom
  // props from matching the bare `color` branch.
  const malformedColor =
    /(?:^|[\s;{])(?:color|background-color|outline-color|caret-color|text-decoration-color|column-rule-color|border-top-color|border-right-color|border-bottom-color|border-left-color):\s*var\([^)]*\)\s+[^;}\s]/gi;

  const malformedIn = (css: string): string[] =>
    (stripComments(css).match(malformedColor) ?? []).map((hit) => hit.trim());

  it('scans every shipping module (the floor an empty or truncated walk cannot clear)', () => {
    // Without this the file has NO vacuity pin at all: `it.each([])` registers zero
    // cases, so an empty list passes the whole file green. The floor sits at the live
    // module count (10: the index.css barrel, the 7 it @imports, and the two
    // per-entry .extra.css), so losing a single sheet, a whole subtree, or the
    // extension filter fails here rather than covering less quietly. The names pin
    // that the 10 are the real modules and not 10 of something else.
    const names = SHEETS.map((s) => s.file);
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toEqual(
      expect.arrayContaining(['index.css', 'index.extra.css', 'play.extra.css', 'tokens.css']),
    );
  });

  it.each(SHEETS)(
    '$file has no single-color longhand with a stray token after var()',
    ({ file, css }) => {
      const hits = malformedIn(css);
      expect(hits, `malformed color value(s) in ${file}: ${hits.join(' | ')}`).toEqual([]);
    },
  );

  it('reads src/styles through the shared walker, with no flat reader beside it', () => {
    // The fixture above pins the PRODUCER; this pins that nothing else in the
    // file opens the directory. A second reader hand-rolled beside it would
    // return the same 10 sheets today, so no assertion here could notice it, and
    // the two could then drift apart exactly as css_corpus's pair did.
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['css_tree_under']);
  });

  it("scans a module in a SUBDIRECTORY, through this guard's own producer", () => {
    // The recursion pin. src/styles is flat today, so this is the only thing that
    // can tell the walk descends; it drives `sheets()` itself, not the shared walk
    // (helpers/css_tree_under.test.ts already owns that), so a consumer that
    // recursed and then filtered back to the top level would fail here.
    const root = mkdtempSync(path.join(tmpdir(), 'woc-css-value-validity-'));
    try {
      mkdirSync(path.join(root, 'nested', 'deeper'), { recursive: true });
      writeFileSync(path.join(root, 'top.css'), '.ok { color: var(--color-text); }\n');
      writeFileSync(
        path.join(root, 'nested', 'deeper', 'sunk.css'),
        '.se-preview-hint { color: var(--color-text) b0; }\n',
      );
      const scanned = sheets(root);
      expect(scanned.map((s) => s.file)).toEqual(['nested/deeper/sunk.css', 'top.css']);
      // And the nested sheet reaches the real assertion, not just the file list:
      // this is the hit the `it.each` case above would report as an offender.
      expect(malformedIn(scanned[0].css)).toEqual(['color: var(--color-text) b']);
      expect(malformedIn(scanned[1].css)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
