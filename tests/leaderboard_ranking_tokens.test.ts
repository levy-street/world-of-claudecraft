// The leaderboard window's ranking ledger tokens (src/styles/tokens.css): a
// FIXED dark ground with fixed light foregrounds (DESIGN.md 4.1). Two contracts
// keep that safe on every theme preset: each foreground clears its contrast
// tier on the surfaces it is painted over, and no preset ever re-emits one of
// these tokens (a derived foreground on a fixed surface is what reads dark on
// dark under Parchment).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  MIN_LARGE_CONTRAST,
  MIN_TEXT_CONTRAST,
  PRESET_ORDER,
  resolveTheme,
  themeCssVars,
} from '../src/ui/theme';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tokensCss = readFileSync(join(repoRoot, 'src', 'styles', 'tokens.css'), 'utf8');

function token(name: string): string {
  const match = tokensCss.match(new RegExp(`\\s${name}:\\s*(#[0-9a-fA-F]{6});`));
  if (!match) throw new Error(`tokens.css declares no hex value for ${name}`);
  return match[1];
}

interface Pair {
  role: string;
  fg: string;
  surfaces: string[];
  min: number;
}

const SURFACES = [
  '--color-ranking-ground',
  '--color-ranking-well',
  '--color-ranking-control',
  '--color-ranking-control-hover',
];

const PAIRS: Pair[] = [
  {
    role: 'names, numbers and body text',
    fg: '--color-ranking-text',
    surfaces: SURFACES,
    min: MIN_TEXT_CONTRAST,
  },
  {
    role: 'tabs, detail lines and notes',
    fg: '--color-ranking-text-soft',
    surfaces: SURFACES,
    min: MIN_TEXT_CONTRAST,
  },
  {
    role: 'stat labels and muted cells',
    fg: '--color-ranking-text-muted',
    surfaces: SURFACES,
    min: MIN_TEXT_CONTRAST,
  },
  {
    role: 'ranks, subtitle and (You)',
    fg: '--color-ranking-emphasis',
    surfaces: SURFACES,
    min: MIN_TEXT_CONTRAST,
  },
  {
    role: 'headings, selected tab and scores',
    fg: '--color-gold-300',
    surfaces: SURFACES,
    min: MIN_TEXT_CONTRAST,
  },
  { role: 'gold place tint', fg: '--color-gold-500', surfaces: SURFACES, min: MIN_LARGE_CONTRAST },
  {
    role: 'silver place tint',
    fg: '--color-ranking-place-second',
    surfaces: SURFACES,
    min: MIN_LARGE_CONTRAST,
  },
  {
    role: 'bronze place tint',
    fg: '--color-ranking-place-third',
    surfaces: SURFACES,
    min: MIN_LARGE_CONTRAST,
  },
];

describe('ranking ledger tokens', () => {
  it.each(PAIRS)('$role ($fg) clears its tier on every ranking surface', (pair) => {
    for (const surface of pair.surfaces) {
      const ratio = contrastRatio(token(pair.fg), token(surface));
      expect(ratio, `${pair.fg} on ${surface} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(
        pair.min,
      );
    }
  });

  it('no theme preset re-emits a ranking token, so the fixed pairs hold on every preset', () => {
    const rankingNames = [...tokensCss.matchAll(/\s(--color-ranking-[a-z-]+):/g)].map((m) => m[1]);
    expect(rankingNames.length).toBeGreaterThan(10);
    // The two gold foregrounds in PAIRS are fixed values on this ground as well.
    const fixedNames = [...rankingNames, '--color-gold-300', '--color-gold-500'];
    for (const id of PRESET_ORDER) {
      const vars = themeCssVars(resolveTheme({ preset: id, custom: {} }));
      for (const name of fixedNames) expect(vars[name], `${id} re-emits ${name}`).toBeUndefined();
    }
  });
});
