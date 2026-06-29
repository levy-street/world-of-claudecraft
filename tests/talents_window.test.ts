import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level guards for the talents painter. The window paints DOM (not a Canvas),
// so its colors flow through inline `var(--color-*)` references rather than a
// getComputedStyle resolve; the contract is the same: NO raw hex survives
// in the painter, the accents reference design tokens, and those tokens exist in the
// sheet. The DOM painting itself is covered by the byte-faithful extraction (the pure
// core is unit-tested in talents_view.test.ts; the painter markup mirrors the prior
// inline hud.ts code).
const painter = readFileSync(new URL('../src/ui/talents_window.ts', import.meta.url), 'utf8');

describe('talents_window: no magic values', () => {
  it('carries no literal hex color in TS (colors flow through --color-* tokens)', () => {
    const hex = painter.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex, `hex colors must move to tokens: ${hex.join(', ')}`).toEqual([]);
  });

  it('drives the tree-arrow + accent colors through CSS custom properties', () => {
    for (const token of [
      'var(--color-talent-arrow)',
      'var(--color-talent-arrow-dim)',
      'var(--color-talent-opt-dim)',
      'var(--color-talent-hint)',
      'var(--color-talent-req)',
      'var(--color-talent-dormant)',
      'var(--color-text-muted)',
      'var(--gold)',
    ]) {
      expect(painter, `expected ${token}`).toContain(token);
    }
  });

  it('defines the talent color tokens it reads in the design-token sheet', () => {
    const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
    for (const tok of [
      '--color-talent-arrow',
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
