// Health guard for the extracted CSS modules (src/styles/*.css). Lightning CSS passes
// var() through unresolved, so a malformed color value like `color: var(--x) b0` (a
// dangling 8-digit-hex alpha left over from tokenizing a literal hex into a var) builds
// clean and only fails silently in the browser, where the whole declaration is dropped
// and the element falls back to inherited color. The .se-preview-hint rule shipped that
// bug from its original feature commit. This scans every module for that bug class so it
// cannot recur, and auto-covers any module added later (it globs the directory).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../src/styles/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('src/styles/*.css value validity', () => {
  // The single-value color longhands take exactly one color, so a var() followed by
  // another value token is always invalid. Limited to the strictly-single-value
  // longhands: border-color (1 to 4 colors), fill/stroke (SVG paint accepts url() + a
  // fallback), and custom properties (untyped, may legally hold token lists) are
  // excluded to avoid false positives. The leading boundary keeps `--x-color:` custom
  // props from matching the bare `color` branch.
  const malformedColor =
    /(?:^|[\s;{])(?:color|background-color|outline-color|caret-color|text-decoration-color|column-rule-color|border-top-color|border-right-color|border-bottom-color|border-left-color):\s*var\([^)]*\)\s+[^;}\s]/gi;

  it.each(files)('%s has no single-color longhand with a stray token after var()', (file) => {
    const hits = stripComments(read(file)).match(malformedColor) ?? [];
    expect(
      hits,
      `malformed color value(s) in ${file}: ${hits.map((h) => h.trim()).join(' | ')}`,
    ).toEqual([]);
  });
});
