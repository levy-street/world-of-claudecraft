import { fileURLToPath } from 'node:url';
import { browserslistToTargets } from 'lightningcss';
import { describe, expect, it } from 'vitest';
import {
  loadBrowserslistFloors,
  parseBrowserslistFloors,
} from '../scripts/browserslist_targets.mjs';

// Guards the zero-dep .browserslistrc parser that feeds vite.config.ts's Lightning
// CSS targets. The parser is the single seam between the shipped floor file and
// lightningcss browserslistToTargets(); a regression here silently widens or drops
// the CSS engine floor, which is exactly what the Lightning minify behaviour (the
// backdrop-filter -webkit twin) depends on.
const rcPath = fileURLToPath(new URL('../.browserslistrc', import.meta.url));

describe('browserslist floor parser', () => {
  it('parses newline-separated "Browser >= X" floors into lightningcss ids', () => {
    expect(parseBrowserslistFloors('Chrome >= 120\nFirefox >= 121')).toEqual([
      'chrome 120',
      'firefox 121',
    ]);
  });

  it('accepts comma separation and ignores # comments and blank lines', () => {
    const text = '# floor\nChrome >= 120, Safari >= 17.2\n\n# trailing note';
    expect(parseBrowserslistFloors(text)).toEqual(['chrome 120', 'safari 17.2']);
  });

  it('strips a # comment BEFORE splitting on comma (a comment may contain a comma)', () => {
    // Load-bearing ordering: if comma-split ran first, the text after the comma in the
    // comment would lose its '#' and parse as a bogus floor. This is the exact bug the
    // real .browserslistrc comment (which contains commas) would trip.
    expect(parseBrowserslistFloors('Chrome >= 120 # primary, see note')).toEqual(['chrome 120']);
    expect(parseBrowserslistFloors('# a, b, c\nFirefox >= 121')).toEqual(['firefox 121']);
  });

  it('accepts the ff and ios_saf input aliases for in-floor browsers', () => {
    expect(parseBrowserslistFloors('ff >= 121')).toEqual(['firefox 121']);
    expect(parseBrowserslistFloors('ios_saf >= 17.2')).toEqual(['ios_saf 17.2']);
  });

  it('maps iOS to the ios_saf id browserslistToTargets understands', () => {
    expect(parseBrowserslistFloors('iOS >= 17.2')).toEqual(['ios_saf 17.2']);
  });

  it('throws on an unsupported query (not a bare ">=" floor)', () => {
    expect(() => parseBrowserslistFloors('last 2 versions')).toThrow();
    expect(() => parseBrowserslistFloors('Chrome > 120')).toThrow();
  });

  it('throws on an unknown browser name', () => {
    expect(() => parseBrowserslistFloors('Konqueror >= 5')).toThrow();
  });

  it('throws when no floors are defined', () => {
    expect(() => parseBrowserslistFloors('# only comments\n')).toThrow();
  });

  it('loads the shipped .browserslistrc and encodes the expected floor targets', () => {
    const floors = loadBrowserslistFloors(rcPath);
    expect(floors).toEqual(['chrome 120', 'firefox 121', 'safari 17.2', 'ios_saf 17.2']);
    // browserslistToTargets encodes major<<16 | minor<<8; confirm the floor survives
    // the round-trip into the object vite.config.ts hands Lightning CSS.
    expect(browserslistToTargets(floors)).toEqual({
      chrome: 120 << 16,
      firefox: 121 << 16,
      safari: (17 << 16) | (2 << 8),
      ios_saf: (17 << 16) | (2 << 8),
    });
  });
});
