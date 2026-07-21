import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guard for the Phase 13 bag-item action menu's mobile stacking.
//
// The mobile window sheet override forces every managed window to z-index 95
// (hud.mobile.css, "Managed windows receive an inline desktop z-index"), which
// buried the shared #ctx-menu popup (base z-index 90 in hud.css): a bag-item
// action menu opened from inside the fullscreen mobile Bags sheet rendered
// BEHIND the sheet and was untappable. The fix is a mobile-scoped bump that
// keeps the popup above the sheet while leaving the desktop base value alone.
//
// File-based (read CSS, regex/flat-parse), the tests/fct_mobile_css.test.ts /
// mobile_window_transform.test.ts idiom: no jsdom.
const HUD_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/hud.css', import.meta.url)),
  'utf8',
);
const HUD_MOBILE_CSS = readFileSync(
  fileURLToPath(new URL('../src/styles/hud.mobile.css', import.meta.url)),
  'utf8',
);

function zIndexOf(css: string, selectorPattern: RegExp): number {
  const block = css.match(selectorPattern);
  if (!block) throw new Error(`no block matching ${selectorPattern}`);
  const z = block[0].match(/z-index:\s*(\d+)/);
  if (!z) throw new Error(`no z-index inside the block matching ${selectorPattern}`);
  return Number(z[1]);
}

describe('mobile #ctx-menu stacking (Phase 13 bag-item action menu)', () => {
  it('the mobile popup sits above the forced mobile window-sheet z-index', () => {
    const sheetZ = zIndexOf(HUD_MOBILE_CSS, /z-index:\s*\d+\s*!important/);
    const mobileMenuZ = zIndexOf(HUD_MOBILE_CSS, /body\.mobile-touch #ctx-menu\s*\{[^}]*\}/);
    // The sheet override is the documented 95; the popup must clear it or a
    // menu opened from inside the fullscreen Bags sheet renders behind it.
    expect(sheetZ).toBe(95);
    expect(mobileMenuZ).toBeGreaterThan(sheetZ);
  });

  it('the desktop base #ctx-menu z-index stays untouched at 90', () => {
    const desktopMenuZ = zIndexOf(HUD_CSS, /#ctx-menu\s*\{[^}]*\}/);
    expect(desktopMenuZ).toBe(90);
  });
});
