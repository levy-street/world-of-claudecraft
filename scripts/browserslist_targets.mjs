// Zero-dependency .browserslistrc floor parser for the Lightning CSS transformer.
//
// The project deliberately does NOT depend on the `browserslist` npm package (it
// pulls in caniuse-lite, a large and frequently updated data set); the only
// build-time CSS dependency is Lightning CSS itself. This helper reads the explicit
// "Browser >= X" floor lines from .browserslistrc and returns them in the array
// shape lightningcss's browserslistToTargets() expects (e.g. ['chrome 120',
// 'safari 17.2']), so .browserslistrc stays the single source of the engine floor
// and vite.config.ts never hand-types a target object.
//
// This is NOT a general browserslist query engine: only explicit ">=" floors are
// understood, which is all the project ships (a fixed big-3 plus mobile Safari
// floor). Anything else throws, so a typo cannot silently
// widen or drop the floor.
import { readFileSync } from 'node:fs';

// browserslist browser ids for the names this project's floor uses (big-3 + iOS),
// plus the obvious input aliases for those same browsers. A name
// outside this set throws rather than silently passing through, so a typo or a browser
// the floor does not target cannot quietly widen the engine baseline.
const BROWSER_IDS = {
  chrome: 'chrome',
  firefox: 'firefox',
  ff: 'firefox',
  safari: 'safari',
  ios: 'ios_saf',
  ios_saf: 'ios_saf',
};

// Parse the text of a .browserslistrc into the ['<id> <version>', ...] array that
// browserslistToTargets() consumes. Floors may be newline or comma separated and
// '#' starts a comment.
export function parseBrowserslistFloors(text) {
  const floors = [];
  for (const physicalLine of text.split('\n')) {
    // Strip a '#' comment FIRST, so a comment that happens to contain a comma is
    // not split into a bogus floor entry by the comma handling below.
    const code = physicalLine.replace(/#.*$/, '');
    for (const raw of code.split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      const m = entry.match(/^([A-Za-z_]+)\s*>=\s*([0-9]+(?:\.[0-9]+)*)$/);
      if (!m) {
        throw new Error(
          `Unsupported .browserslistrc entry (only "Browser >= X" floors are allowed): ${entry}`,
        );
      }
      const id = BROWSER_IDS[m[1].toLowerCase()];
      if (!id) throw new Error(`Unknown browser in .browserslistrc: ${m[1]}`);
      floors.push(`${id} ${m[2]}`);
    }
  }
  if (floors.length === 0) throw new Error('.browserslistrc defined no browser floors');
  return floors;
}

// Read a .browserslistrc from disk and return its parsed floor array.
export function loadBrowserslistFloors(path) {
  return parseBrowserslistFloors(readFileSync(path, 'utf8'));
}
