// The one clock-seconds formatter (src/ui/clock_seconds_core.ts): both arms
// (padded under a minutes token, bare in the final minute), the Intl routing
// (no ASCII padStart anywhere in the clock family), and the three consumers
// that used to hand-build the pad.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clockSeconds } from '../src/ui/clock_seconds_core';
import { setLanguage } from '../src/ui/i18n';
import { stripComments } from './helpers/strip_comments';

const CONSUMERS = [
  'src/ui/hud/professions/harvest_journal_window.ts',
  'src/ui/gather_node_tooltip_controller.ts',
  'src/ui/dungeon_finder_window.ts',
];

afterEach(() => setLanguage('en'));

describe('clockSeconds', () => {
  it('pads the under-a-minutes arm to two digits, byte-identical to the padStart it replaced', () => {
    for (let s = 0; s < 60; s++) {
      expect(clockSeconds(s, true)).toBe(String(s).padStart(2, '0'));
    }
  });

  it('leaves the bare arm unpadded (7s, never 07s)', () => {
    for (let s = 0; s < 60; s++) {
      expect(clockSeconds(s, false)).toBe(String(s));
    }
  });

  it('rounds to a whole second and never groups', () => {
    expect(clockSeconds(9.6, true)).toBe('10');
    expect(clockSeconds(9.4, false)).toBe('9');
    // A caller handing a raw total (the finder's mm:ss splits it first, but a
    // whole number must never pick up a grouping separator either way).
    expect(clockSeconds(1234, false)).toBe('1234');
  });

  it('routes through the house formatter: a locale switch changes nothing for Latin-digit locales, and the module carries no padStart', () => {
    setLanguage('de_DE');
    expect(clockSeconds(5, true)).toBe('05');
    expect(clockSeconds(5, false)).toBe('5');
    const src = stripComments(
      readFileSync(join(process.cwd(), 'src/ui/clock_seconds_core.ts'), 'utf8'),
    );
    expect(src).not.toContain('padStart');
    expect(src).toContain('minimumIntegerDigits: 2');
  });
});

describe('the three clock sites consume it (no hand-built pad left)', () => {
  it.each(CONSUMERS)('%s imports clockSeconds and spells no padStart', (file) => {
    const src = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
    expect(src).toMatch(/import \{ clockSeconds \} from '(\.\.\/)*(\.\/)?clock_seconds_core';/);
    expect(src).toContain('clockSeconds(');
    expect(src).not.toContain('padStart');
  });
});
