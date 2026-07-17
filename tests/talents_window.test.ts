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

  it('un-zooms the fitBodyToWindow rect measurements by the live UI Scale before writing an author-space cap', () => {
    // fitBodyToWindow reads getBoundingClientRect() (visual/zoomed px under #ui's
    // `zoom: var(--ui-scale)`) but writes body.style.maxHeight (author px, which the
    // browser re-multiplies by that same zoom). Regression guard for the bug where
    // the cap came out ~47px too generous at uiScale 0.85 and clipped the foot panel
    // again, or ~120px too small at uiScale 1.4.
    expect(painter).toContain("import { getUiScale } from './ui_scale';");
    expect(painter).toMatch(/const uiScale = getUiScale\(\);/);
    expect(painter).toMatch(/bodyTop = \(.*\) \/ uiScale;/);
    expect(painter).toMatch(/footHeight = foot\.getBoundingClientRect\(\)\.height \/ uiScale;/);
  });
});

describe('talents_window: WAI-ARIA class/spec tabs', () => {
  // The class/spec tab strip's markup and roving Arrow/Home/End + Enter/Space
  // wiring now come from the shared tab_strip_view.ts / tab_strip_painter.ts
  // building block (their own contracts are pinned in tab_strip_view.test.ts /
  // tab_strip_painter.test.ts), the same modules social_window.ts composes for
  // its plain-button strip. This pins that talents_window composes them with
  // its div-tag + spent-points-badge shape instead of hand-rolling the markup
  // or the keyboard handler itself.
  it('builds its tab strip from the shared tab_strip_view / tab_strip_painter modules', () => {
    expect(painter).toContain("from './tab_strip_view'");
    expect(painter).toContain("from './tab_strip_painter'");
    expect(painter).toContain('tabStripHtml(');
    expect(painter).toContain('tabStripModel(');
    expect(painter).toContain('wireTabStrip(');
    expect(painter).toContain("panelId: 'tal-body'");
    expect(painter).toContain("stripClass: 'tal-tabs'");
    expect(painter).toContain("tabClass: 'tal-tab'");
    expect(painter).toContain("selectedClass: 'active'");
    expect(painter).toContain("tag: 'div'");
    expect(painter).toContain("id: 'class',");
    expect(painter).toContain("id: 'spec',");
  });

  it('refocuses the newly active tab only on a keyboard move, matching the shared wiring contract', () => {
    expect(painter).toContain('(id, focusFollow) => {');
    expect(painter).toContain('if (focusFollow) focusActiveTab(el,');
  });
});
