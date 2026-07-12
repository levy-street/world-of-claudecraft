import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the talents painter. The window paints DOM (not a Canvas),
// so its accent colors flow through inline `var(--color-*)` references rather than a
// getComputedStyle resolve; the contract is the same: NO raw hex survives
// in the painter, the accents reference design tokens, and those tokens exist in the
// sheet. The layout colors (card borders, tier rails, badges) live entirely in
// components.css; only the tooltip accent lines are painter-inlined. The DOM painting
// itself is covered by tests/talents_window_frame.test.ts; the pure tier/gating core
// is unit-tested in talents_view.test.ts.
const painter = readFileSync(new URL('../src/ui/talents_window.ts', import.meta.url), 'utf8');

describe('talents_window: no magic values', () => {
  it('carries no literal hex color in TS (colors flow through --color-* tokens)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('drives the tooltip accent colors through CSS custom properties', () => {
    for (const token of [
      'var(--color-talent-opt-dim)',
      'var(--color-talent-hint)',
      'var(--color-talent-req)',
      'var(--color-talent-dormant)',
      'var(--gold)',
    ]) {
      expect(painter, `expected ${token}`).toContain(token);
    }
  });

  it('defines the talent color tokens the painter and stylesheet read', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    for (const tok of [
      // arrow-dim doubles as the tier-card resting border (components.css).
      '--color-talent-arrow-dim',
      '--color-talent-opt-dim',
      '--color-talent-hint',
      '--color-talent-req',
      '--color-talent-dormant',
    ]) {
      expect(tokens, `missing ${tok}`).toContain(`${tok}:`);
    }
  });

  it('uses no em or en dashes (ASCII separators only)', () => {
    expect(painter.includes('—'), 'em dash found').toBe(false);
    expect(painter.includes('–'), 'en dash found').toBe(false);
  });
});

describe('talents_window: tier-row alignment stylesheet contract', () => {
  const css = readFileSync(new URL('../src/styles/components.css', import.meta.url), 'utf8');

  it('places every tier card explicitly on its tier grid row (no auto-placement)', () => {
    // The one-horizontal-band-per-tier alignment the tiered layout promises:
    // each tier's cards grid pins its cards to grid row 1 (the tal-col-N class
    // carries the column, empty cells stay empty). The DOM-side half (a card
    // never leaves its tier's band) is pinned in talents_window_frame.test.ts.
    expect(css).toMatch(/\.tal-tier-cards > \.tal-card \{\s*grid-row: 1;\s*\}/);
  });

  it('releases the row pin only inside the narrow-container collapse', () => {
    // When a tier collapses to a one-column stack the row pin must yield, or
    // every stacked card would overlap in the single pinned row.
    const collapse = css.slice(css.indexOf('@container (max-width: 700px)'));
    const release = collapse.slice(0, collapse.indexOf('.tal-specs'));
    expect(release).toContain('grid-row: auto;');
    expect(release).toContain('grid-column: auto;');
  });
});
