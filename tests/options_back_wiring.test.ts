// The options window's title-bar Back control ([data-back]) is wired in ONE
// place: the render() dispatcher, after it calls the active sub-view renderer
// (options_window.ts, the comment above the querySelector spells it out). A
// sub-view REBUILD that invokes its own render<Sub>() directly re-mints the
// title bar via innerHTML and destroys that wiring, leaving a Back button that
// looks fine and does nothing until the window is closed and reopened. That
// shipped: changing any Interface / Audio / Controller setting killed Back for
// the rest of the visit. So the rule is structural: every applyControls rebuild
// callback routes through this.render(), never through a render<Sub>() sibling
// (the graphics panel wrote the reasoning first, beside its own callback).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_PATH = fileURLToPath(new URL('../src/ui/options_window.ts', import.meta.url));

/** The full text of one call expression starting at `start` (the index of the
 *  opening paren), by paren balancing; string/template contents are skipped so
 *  a paren inside a literal cannot desynchronize the walk. */
function callText(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced call expression');
}

describe('options window back-control wiring', () => {
  const source = readFileSync(SOURCE_PATH, 'utf8');

  it('every applyControls rebuild callback routes through render(), never a render<Sub>()', () => {
    const sites: string[] = [];
    // wireTabStrip is the same shape: a tab switch rebuilds the whole panel,
    // title bar included, so its callback must route through render() too.
    const re = /this\.applyControls\(|wireTabStrip\(/g;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      sites.push(callText(source, m.index + m[0].length - 1));
    }
    // Vacuity floor: the panels that rebuild on a control change all pass
    // through applyControls today; a refactor that removes them entirely
    // should retire this guard deliberately, not starve it quiet.
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const site of sites) {
      // A rebuild callback that names a specific sub-view renderer bypasses
      // the render() dispatcher, which is the only place [data-back] is wired.
      expect(site, `rebuild callback bypasses render():\n${site}`).not.toMatch(
        /this\.render[A-Z]\w*\(/,
      );
    }
  });

  it('render() is still the one wirer of [data-back]', () => {
    const wirings = source.match(/\[data-back\]'\)\?\.addEventListener/g) ?? [];
    expect(wirings).toHaveLength(1);
  });
});
