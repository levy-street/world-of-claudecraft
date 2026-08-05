import { describe, expect, it } from 'vitest';

// Pins the WCAG AA text contrast of the light theme's palette (styles/tokens.css
// `:root[data-theme="light"]`) against the backgrounds it is actually painted over.
// Self-contained (does not import src/ui/theme.ts): admin stays independent of the
// game client bundle, and this is a small, fixed-palette check, not the runtime
// custom-color repair the game client's picker needs. A hex here drifting out of
// sync with tokens.css is a copy-paste risk, not a design decision, so the values
// are duplicated deliberately and kept next to their contrast expectation.

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function srgbChannel(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;
const AA_LARGE = 3;

// Light-theme tokens (styles/tokens.css `:root[data-theme="light"]`), paired with
// the surface each is actually rendered over in the app.
const PANEL_MID = '#faf8f3'; // mid stop of --panel-bg's gradient
const BG_APP = '#f4f1ea';
const NAV_BG = '#f0ebe3';
const NAV_HOVER_BG = '#e8e0d2';
const SURFACE_ACTIVE = '#efe6d4';
const BADGE_SUCCESS_BG = '#dcefdf';
const CALLOUT_BG = '#f2ecdf';
const CONTROL_BG = '#ffffff';
const BTN_ACCENT_GRAD_FROM = '#916a2c';
const BTN_ACCENT_GRAD_TO = '#7d5a1e';

describe('light theme WCAG AA text contrast', () => {
  it.each([
    ['--text on --bg-app', '#1c1917', BG_APP, AA_TEXT],
    ['--text on --panel-bg (mid stop)', '#1c1917', PANEL_MID, AA_TEXT],
    ['--text-soft on --panel-bg', '#44403c', PANEL_MID, AA_TEXT],
    ['--text-dim on --panel-bg', '#57534e', PANEL_MID, AA_TEXT],
    ['--gold on --panel-bg', '#8b5e1a', PANEL_MID, AA_TEXT],
    ['--gold-dim on --panel-bg', '#7d5820', PANEL_MID, AA_TEXT],
    ['--color-danger on --panel-bg', '#a83a2a', PANEL_MID, AA_TEXT],
    ['--badge-warn-text on --panel-bg', '#7a4a12', PANEL_MID, AA_TEXT],
    ['--badge-neutral-text on --panel-bg', '#57534e', PANEL_MID, AA_TEXT],
    ['--badge-success-text on --badge-success-bg', '#1f6b3a', BADGE_SUCCESS_BG, AA_TEXT],
    ['--text-soft on --nav-bg', '#44403c', NAV_BG, AA_TEXT],
    ['--text-bright on --nav-hover-bg', '#100d0a', NAV_HOVER_BG, AA_TEXT],
    ['--gold on --surface-active (nav/range-tab active row)', '#8b5e1a', SURFACE_ACTIVE, AA_TEXT],
    ['--gold on --callout-bg', '#8b5e1a', CALLOUT_BG, AA_TEXT],
    ['--control-placeholder on --control-bg', '#79746c', CONTROL_BG, AA_TEXT],
    ['fixed badge.admin text on fixed badge.admin bg', '#090909', '#ffd100', AA_TEXT],
    ['--btn-accent-text on --btn-accent-grad-from', '#fff8e6', BTN_ACCENT_GRAD_FROM, AA_TEXT],
    ['--btn-accent-text on --btn-accent-grad-to', '#fff8e6', BTN_ACCENT_GRAD_TO, AA_TEXT],
    // Non-text UI (chart stroke): WCAG 1.4.11 non-text contrast, 3:1.
    ['--chart-secondary stroke on --panel-bg', '#2f6fb0', PANEL_MID, AA_LARGE],
  ])('%s clears %s:1', (_label, fg, bg, min) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
